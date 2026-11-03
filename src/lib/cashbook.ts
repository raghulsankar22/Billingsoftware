import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { billingToday } from "./business-updates";
import { currentLocalUser } from "./local-session-context";
import { isAccountSlot } from "./account-url";
import type { CashAccountDay, CashBillOption, CashBookView, CashEntry, CashEntryKind, CashTotals } from "./cashbook-types";

const money = z.number().finite().min(0).max(100_000_000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, "Use at most two decimal places.");
const note = z.string().trim().max(240);
const date = z.string().refine(value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value && value <= billingToday(), "Choose a real date no later than today.");
const identity = { operationId: z.string().uuid(), date };
export const cashBookActionSchema = z.discriminatedUnion("action", [
  z.object({ ...identity, action: z.literal("opening"), amount: money }).strict(),
  z.object({ ...identity, action: z.literal("entry"), kind: z.enum(["collection", "disbursement", "expense", "cash_in", "cash_out"]), method: z.enum(["cash", "upi", "bank"]), amount: money.refine(value => value > 0, "Enter an amount greater than zero."), principal: money.optional(), interest: money.optional(), discount: money.optional(), billId: z.string().uuid().optional(), note }).strict(),
  z.object({ ...identity, action: z.literal("reverse"), entryId: z.string().uuid(), note: note.min(3, "Explain the reversal.") }).strict(),
  z.object({ ...identity, action: z.literal("close"), countedCash: money, revision: z.string().regex(/^[a-f0-9]{64}$/), note, acknowledgeUnrecorded: z.boolean() }).strict(),
]);
type Row = Record<string, any>;
const paise = (value: number) => Math.round(value * 100);
const rupees = (value: number) => value / 100;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const emptyTotals = (): CashTotals => ({ cashIn: 0, cashOut: 0, upiIn: 0, upiOut: 0, bankIn: 0, bankOut: 0, principalReceived: 0, interestReceived: 0, discount: 0, loansPaid: 0, expenses: 0 });
const inward = (kind: CashEntryKind) => kind === "collection" || kind === "cash_in";
export class CashBookConflictError extends Error {}
function sum(values: number[]) {
  const total = values.reduce((previous, value) => previous + value, 0);
  if (!Number.isSafeInteger(total)) throw new Error("Money total is too large to calculate safely.");
  return total;
}

export function createCashBook(database: DatabaseSync, assertWritable: (profileId: string) => void) {
  database.exec(`CREATE TABLE IF NOT EXISTS cash_openings(profile_id TEXT PRIMARY KEY, date TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>=0), actor TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cash_entries(sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, profile_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('collection','disbursement','expense','cash_in','cash_out')), date TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('cash','upi','bank')), amount INTEGER NOT NULL CHECK(amount>0), principal INTEGER NOT NULL CHECK(principal>=0), interest INTEGER NOT NULL CHECK(interest>=0), discount INTEGER NOT NULL CHECK(discount>=0), bill_id TEXT, bill_number INTEGER, delivery_no TEXT, note TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL, reverses_id TEXT UNIQUE REFERENCES cash_entries(id));
    CREATE INDEX IF NOT EXISTS cash_entries_profile_date ON cash_entries(profile_id,date,sequence);
    CREATE INDEX IF NOT EXISTS cash_entries_bill ON cash_entries(bill_id,kind);
    CREATE TABLE IF NOT EXISTS cash_closings(id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, date TEXT NOT NULL, opening_cash INTEGER NOT NULL, expected_cash INTEGER NOT NULL, counted_cash INTEGER NOT NULL CHECK(counted_cash>=0), difference INTEGER NOT NULL, note TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(profile_id,date));
    CREATE TABLE IF NOT EXISTS cash_requests(id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, request_hash TEXT NOT NULL);`);
  for (const table of ["cash_openings", "cash_entries", "cash_closings", "cash_requests"]) {
    database.exec("CREATE TRIGGER IF NOT EXISTS " + table + "_no_update BEFORE UPDATE ON " + table + " BEGIN SELECT RAISE(ABORT,'Money records are read-only. Use a reversal.'); END; CREATE TRIGGER IF NOT EXISTS " + table + "_no_delete BEFORE DELETE ON " + table + " BEGIN SELECT RAISE(ABORT,'Money records are read-only. Use a reversal.'); END;");
  }
  const profiles = () => database.prepare("SELECT id,body FROM records WHERE table_name='business_profiles'").all().map(row => ({ ...JSON.parse(String(row.body)), id: String(row.id) }) as Row).filter(profile => profile.owner_id === "local-owner");
  function profileFor(account: number) {
    if (!isAccountSlot(account)) throw new Error("Choose a valid business account.");
    const profile = profiles().find(row => row.account_slot === account);
    if (!profile) throw new Error("Business profile is required.");
    return profile;
  }
  const entriesFor = (profileId: string): Row[] => database.prepare("SELECT * FROM cash_entries WHERE profile_id=? ORDER BY sequence").all(profileId);
  const active = (billId: string, kind?: string): Row[] => database.prepare("SELECT entry.* FROM cash_entries entry WHERE entry.bill_id=? AND entry.reverses_id IS NULL AND NOT EXISTS(SELECT 1 FROM cash_entries reversal WHERE reversal.reverses_id=entry.id)" + (kind ? " AND entry.kind=?" : "")).all(...(kind ? [billId, kind] : [billId]));
  const lastClosing = (profileId: string): Row | undefined => database.prepare("SELECT * FROM cash_closings WHERE profile_id=? ORDER BY date DESC LIMIT 1").get(profileId);
  function billsFor(profileId: string, day: string): CashBillOption[] {
    const recorded = database.prepare("SELECT entry.bill_id,entry.kind,entry.date,reversal.date AS reversal_date FROM cash_entries entry LEFT JOIN cash_entries reversal ON reversal.reverses_id=entry.id WHERE entry.profile_id=? AND entry.reverses_id IS NULL AND entry.bill_id IS NOT NULL").all(profileId);
    const state = new Map<string, { recorded: boolean; blocked: boolean }>();
    for (const row of recorded) {
      const key = String(row.bill_id) + ":" + String(row.kind);
      const previous = state.get(key) ?? { recorded: false, blocked: false };
      state.set(key, { recorded: previous.recorded || (String(row.date) <= day && (row.reversal_date === null || String(row.reversal_date) > day)), blocked: previous.blocked || row.reversal_date === null || String(row.reversal_date) > day });
    }
    return database.prepare("SELECT id,body FROM records WHERE table_name='bills' AND json_extract(body,'$.profile_id')=?").all(profileId).map(row => {
      const bill = JSON.parse(String(row.body));
      const collection = state.get(String(row.id) + ":collection");
      const disbursement = state.get(String(row.id) + ":disbursement");
      const collected = collection?.recorded ?? false;
      const disbursed = disbursement?.recorded ?? false;
      const delivered = Boolean(bill.delivery_date || bill.delivery_no);
      const expectedInterest = typeof bill.delivery_summary?.interest === "number" && Number.isFinite(bill.delivery_summary.interest) ? bill.delivery_summary.interest : null;
      return { id: String(row.id), billNumber: Number(bill.bill_number), billDate: String(bill.bill_date), customerName: String(bill.customer_name), principal: Number(bill.total_loan_amount), deliveryDate: bill.delivery_date || null, deliveryNo: bill.delivery_no || null, expectedInterest, canCollect: delivered && Boolean(bill.delivery_date) && bill.delivery_date <= day && !collection?.blocked, canDisburse: bill.status === "issued" && !delivered && bill.bill_date <= day && !disbursement?.blocked, collectionRecorded: collected, disbursementRecorded: disbursed };
    }).sort((left, right) => right.billNumber - left.billNumber);
  }
  function accountDay(account: number, day: string): CashAccountDay {
    const profile = profileFor(account);
    const opening = database.prepare("SELECT * FROM cash_openings WHERE profile_id=?").get(profile.id);
    const previous = database.prepare("SELECT * FROM cash_closings WHERE profile_id=? AND date<? ORDER BY date DESC LIMIT 1").get(profile.id, day);
    const closing = database.prepare("SELECT * FROM cash_closings WHERE profile_id=? AND date=?").get(profile.id, day);
    const latest = lastClosing(profile.id);
    const rows = entriesFor(profile.id);
    const reversed = new Set(rows.flatMap(row => row.reverses_id ? [String(row.reverses_id)] : []));
    const flow = (row: Row) => (inward(row.kind) ? 1 : -1) * (row.reverses_id ? -1 : 1) * Number(row.amount);
    const validOpening = opening && String(opening.date) <= day;
    const openingPaise = validOpening ? sum([Number(previous?.counted_cash ?? opening.amount), ...rows.filter(row => row.method === "cash" && row.date < day && (previous ? row.date > String(previous.date) : row.date >= String(opening.date))).map(flow)]) : null;
    const daily = rows.filter(row => row.date === day);
    const totals = emptyTotals();
    for (const row of daily) {
      const reversal = row.reverses_id ? -1 : 1;
      const direction = (inward(row.kind) ? 1 : -1) * reversal;
      const key = (row.method + (direction > 0 ? "In" : "Out")) as "cashIn" | "cashOut" | "upiIn" | "upiOut" | "bankIn" | "bankOut";
      totals[key] = sum([totals[key], Number(row.amount)]);
      if (row.kind === "collection") {
        totals.principalReceived = sum([totals.principalReceived, reversal * Number(row.principal)]);
        totals.interestReceived = sum([totals.interestReceived, reversal * Number(row.interest)]);
        totals.discount = sum([totals.discount, reversal * Number(row.discount)]);
      }
      if (row.kind === "disbursement") totals.loansPaid = sum([totals.loansPaid, reversal * Number(row.amount)]);
      if (row.kind === "expense") totals.expenses = sum([totals.expenses, reversal * Number(row.amount)]);
    }
    const entries: CashEntry[] = daily.map(row => ({ id: String(row.id), kind: row.kind, date: row.date, method: row.method, amount: rupees(Number(row.amount)), principal: rupees(Number(row.principal)), interest: rupees(Number(row.interest)), discount: rupees(Number(row.discount)), billId: row.bill_id, billNumber: row.bill_number == null ? null : Number(row.bill_number), deliveryNo: row.delivery_no, note: row.note, actor: row.actor, createdAt: row.created_at, reversesId: row.reverses_id, reversed: reversed.has(String(row.id)) }));
    const bills = billsFor(profile.id, day);
    const expectedPaise = openingPaise === null ? null : sum([openingPaise, totals.cashIn, -totals.cashOut]);
    const revision = digest({ opening: opening ?? null, previous: previous ?? null, entries: rows.filter(row => row.date <= day).map(row => row.id), latest: latest?.id ?? null, bills });
    return { accountSlot: account, profileId: profile.id, businessName: String(profile.business_name), opening: opening ? { date: String(opening.date), amount: rupees(Number(opening.amount)) } : null, openingCash: closing ? rupees(Number(closing.opening_cash)) : openingPaise === null ? null : rupees(openingPaise), expectedCash: closing ? rupees(Number(closing.expected_cash)) : expectedPaise === null ? null : rupees(expectedPaise), countedCash: closing ? rupees(Number(closing.counted_cash)) : null, difference: closing ? rupees(Number(closing.difference)) : null, closed: Boolean(closing) || Boolean(latest && latest.date >= day), closingNote: String(closing?.note ?? ""), lastClosedDate: latest?.date ?? null, revision, totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, rupees(value)])) as CashTotals, entries, bills, unrecorded: { disbursements: bills.filter(bill => bill.billDate === day && bill.canDisburse && !bill.disbursementRecorded).length, collections: bills.filter(bill => bill.deliveryDate === day && !bill.collectionRecorded).length } };
  }
  function view(account: number, day: string, all = false): CashBookView {
    date.parse(day);
    profileFor(account);
    const accounts = (all ? profiles().sort((left, right) => left.account_slot - right.account_slot).map(profile => Number(profile.account_slot)) : [account]).map(slot => accountDay(slot, day));
    const combinedTotals = emptyTotals();
    for (const key of Object.keys(combinedTotals) as (keyof CashTotals)[]) combinedTotals[key] = rupees(sum(accounts.map(row => paise(row.totals[key]))));
    const balance = (key: "openingCash" | "expectedCash" | "countedCash" | "difference") => accounts.some(row => row[key] === null) ? null : rupees(sum(accounts.map(row => paise(row[key]!))));
    return { date: day, accounts, combined: { openingCash: balance("openingCash"), expectedCash: balance("expectedCash"), countedCash: balance("countedCash"), difference: balance("difference"), totals: combinedTotals } };
  }
  function assertOpen(profileId: string, day: string) {
    const opening = database.prepare("SELECT date FROM cash_openings WHERE profile_id=?").get(profileId);
    if (!opening || day < String(opening.date)) throw new Error("Set opening cash first and choose a date on or after its starting date.");
    const latest = lastClosing(profileId);
    if (latest && day <= latest.date) throw new Error("That cash-book date is closed. Post a correction on an open day.");
  }
  function post(account: number, value: unknown): CashBookView {
    const input = cashBookActionSchema.parse(value);
    database.exec("BEGIN IMMEDIATE");
    try {
      const profile = profileFor(account);
      assertWritable(profile.id);
      const requestHash = digest(input);
      const existing = database.prepare("SELECT * FROM cash_requests WHERE id=?").get(input.operationId);
      if (existing) {
        if (existing.profile_id !== profile.id || existing.request_hash !== requestHash) throw new Error("That operation ID belongs to a different money request.");
        const result = view(account, input.date);
        database.exec("COMMIT");
        return result;
      }
      const actor = currentLocalUser()?.username ?? "Local user";
      const now = new Date().toISOString();
      if (input.action === "opening") {
        if (database.prepare("SELECT profile_id FROM cash_openings WHERE profile_id=?").get(profile.id)) throw new Error("Opening cash is already set. Use cash introduced or withdrawn for later movements.");
        database.prepare("INSERT INTO cash_openings(profile_id,date,amount,actor,created_at) VALUES(?,?,?,?,?)").run(profile.id, input.date, paise(input.amount), actor, now);
      } else {
        assertOpen(profile.id, input.date);
        if (input.action === "close") {
          const current = accountDay(account, input.date);
          if (current.revision !== input.revision) throw new CashBookConflictError("The cash book changed. Refresh and check the counted cash before closing.");
          if ((current.unrecorded.collections || current.unrecorded.disbursements) && !input.acknowledgeUnrecorded) throw new Error("Check and acknowledge bills whose payments are Not recorded before closing.");
          const counted = paise(input.countedCash);
          const expected = paise(current.expectedCash!);
          if (counted !== expected && input.note.length < 3) throw new Error("Explain the difference between expected and counted cash.");
          database.prepare("INSERT INTO cash_closings(id,profile_id,date,opening_cash,expected_cash,counted_cash,difference,note,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), profile.id, input.date, paise(current.openingCash!), expected, counted, counted - expected, input.note, actor, now);
        } else {
          let entry: Row;
          if (input.action === "reverse") {
            const original = database.prepare("SELECT * FROM cash_entries WHERE id=? AND profile_id=?").get(input.entryId, profile.id);
            if (!original || original.reverses_id) throw new Error("Choose an original money record in this account.");
            if (input.date < String(original.date)) throw new Error("A reversal cannot predate its original money record.");
            if (database.prepare("SELECT id FROM cash_entries WHERE reverses_id=?").get(input.entryId)) throw new Error("That money record has already been reversed.");
            entry = { ...original, date: input.date, note: input.note, reverses_id: original.id };
          } else {
            const billKind = input.kind === "collection" || input.kind === "disbursement";
            const bill = input.billId ? billsFor(profile.id, input.date).find(row => row.id === input.billId) : undefined;
            if (billKind && !bill) throw new Error("Choose a bill in this business account.");
            if (!billKind && input.billId) throw new Error("Manual expenses and cash movements cannot be attached to a bill.");
            if (input.kind === "collection" && !bill?.canCollect) throw new Error("Record delivery first, or reverse the earlier collection before recording another one.");
            if (input.kind === "disbursement" && !bill?.canDisburse) throw new Error("Choose an undelivered issued bill without a recorded disbursement.");
            if ((input.kind === "cash_in" || input.kind === "cash_out") && input.method !== "cash") throw new Error("Cash introduced and withdrawn must use Cash.");
            let principal = 0, interest = 0, discount = 0;
            if (input.kind === "collection") {
              if (input.principal === undefined || input.interest === undefined || input.discount === undefined) throw new Error("Enter principal, interest received and interest discount explicitly.");
              principal = paise(input.principal); interest = paise(input.interest); discount = paise(input.discount);
              if (principal !== paise(bill!.principal)) throw new Error("Partial principal payments are not supported. Enter the full bill principal.");
              if (paise(input.amount) !== sum([principal, interest])) throw new Error("Amount received must equal principal plus interest actually received.");
              if (bill!.expectedInterest !== null && sum([interest, discount]) !== paise(bill!.expectedInterest)) throw new Error("Interest received plus interest discount must equal the saved delivery interest.");
              if ((discount > 0 || bill!.expectedInterest === null) && input.note.length < 3) throw new Error("Explain the interest discount or manually entered historical interest.");
            } else {
              if ((input.principal ?? 0) !== 0 || (input.interest ?? 0) !== 0 || (input.discount ?? 0) !== 0) throw new Error("Principal and interest allocations apply only to collections.");
              if (input.kind === "disbursement") {
                if (paise(input.amount) > paise(bill!.principal)) throw new Error("Actual loan payout cannot exceed the recorded principal.");
                if (paise(input.amount) < paise(bill!.principal) && input.note.length < 3) throw new Error("Explain why the actual loan payout is lower than principal.");
              } else if (input.note.length < 3) throw new Error("Describe the expense or cash movement.");
            }
            entry = { kind: input.kind, date: input.date, method: input.method, amount: paise(input.amount), principal, interest, discount, bill_id: bill?.id ?? null, bill_number: bill?.billNumber ?? null, delivery_no: input.kind === "collection" ? bill?.deliveryNo ?? null : null, note: input.note, reverses_id: null };
          }
          database.prepare("INSERT INTO cash_entries(id,profile_id,kind,date,method,amount,principal,interest,discount,bill_id,bill_number,delivery_no,note,actor,created_at,reverses_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), profile.id, entry.kind, entry.date, entry.method, entry.amount, entry.principal, entry.interest, entry.discount, entry.bill_id, entry.bill_number, entry.delivery_no, entry.note, actor, now, entry.reverses_id);
        }
      }
      database.prepare("INSERT INTO cash_requests(id,profile_id,request_hash) VALUES(?,?,?)").run(input.operationId, profile.id, requestHash);
      const result = view(account, input.date);
      database.exec("COMMIT");
      return result;
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  }
  function assertBillChangeAllowed(billId: string, kind?: "collection") {
    if (active(billId, kind).length) throw new Error("This bill has a confirmed money record. Reverse the affected payment in Payments / Daily Closing before changing or deleting its financial details.");
  }
  return { view, post, assertBillChangeAllowed };
}
