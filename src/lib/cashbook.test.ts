import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createCashBook } from "./cashbook";
import type { CashBookAction, CashEntryKind, PaymentMethod } from "./cashbook-types";

const opened: DatabaseSync[] = [];
afterEach(() => { for (const database of opened.splice(0)) database.close(); });
function fixture() {
  const database = new DatabaseSync(":memory:"); opened.push(database);
  database.exec("CREATE TABLE records(table_name TEXT NOT NULL,id TEXT PRIMARY KEY,body TEXT NOT NULL)");
  const profiles = [randomUUID(), randomUUID()];
  const put = (table: string, id: string, body: object) => database.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)").run(table, id, JSON.stringify(body));
  profiles.forEach((id, index) => put("business_profiles", id, { owner_id: "local-owner", account_slot: index + 1, business_name: "Sample " + (index + 1) }));
  const writable = vi.fn();
  const book = createCashBook(database, writable);
  const save = (input: Record<string, unknown>, account = 1) => book.post(account, { operationId: randomUUID(), date: "2026-10-03", ...input });
  const opening = (amount = 10000, account = 1) => save({ action: "opening", date: "2026-10-01", amount }, account);
  const entry = (kind: CashEntryKind, amount: number, method: PaymentMethod = "cash", extra: Record<string, unknown> = {}, account = 1) => save({ action: "entry", kind, amount, method, note: "Sample record", ...extra }, account);
  const bill = (body: Record<string, unknown> = {}, account = 1) => { const id = randomUUID(); put("bills", id, { profile_id: profiles[account - 1], bill_number: 1, bill_date: "2026-10-01", customer_name: "Sample Customer", total_loan_amount: 1000, status: "issued", ...body }); return id; };
  const day = (date = "2026-10-03", account = 1) => book.view(account, date).accounts[0];
  const close = (countedCash: number, extra: Record<string, unknown> = {}) => save({ action: "close", countedCash, revision: day().revision, note: "", acknowledgeUnrecorded: true, ...extra });
  return { database, book, put, profiles, writable, save, opening, entry, bill, day, close };
}

describe("confirmed payments and daily closing", () => {
  it("does not infer historical cash, loan payouts or collections", () => {
    const context = fixture();
    context.bill(); context.bill({ delivery_date: "2026-10-03", delivery_no: "1", delivery_summary: { interest: 50 } });
    const report = context.day();
    expect(report).toMatchObject({ opening: null, openingCash: null, expectedCash: null, entries: [], unrecorded: { disbursements: 0, collections: 1 } });
    expect(report.totals).toMatchObject({ cashIn: 0, cashOut: 0, interestReceived: 0 });
    expect(() => context.entry("expense", 1)).toThrow("Set opening cash first");
  });
  it("separates physical cash, digital payments, principal, interest and discounts", () => {
    const context = fixture(); context.opening();
    const billId = context.bill();
    context.entry("disbursement", 980, "cash", { billId, date: "2026-10-01", note: "Initial deduction" });
    context.put("bills", billId, { profile_id: context.profiles[0], bill_number: 1, bill_date: "2026-10-01", customer_name: "Sample", total_loan_amount: 1000, status: "issued", delivery_date: "2026-10-03", delivery_no: "1", delivery_summary: { interest: 50 } });
    context.entry("collection", 1030, "cash", { billId, principal: 1000, interest: 30, discount: 20, note: "Approved discount" });
    context.entry("expense", 30); context.entry("expense", 100, "upi"); context.entry("expense", 200, "bank");
    context.entry("cash_in", 50); context.entry("cash_out", 20);
    const report = context.day();
    expect(report).toMatchObject({ openingCash: 9020, expectedCash: 10050, totals: { cashIn: 1080, cashOut: 50, upiOut: 100, bankOut: 200, principalReceived: 1000, interestReceived: 30, discount: 20, expenses: 330 } });
    expect(context.day("2026-10-01").totals.loansPaid).toBe(980);
  });
  it("requires full principal, saved delivery interest and an explanation for discounts", () => {
    const context = fixture(); context.opening(); const billId = context.bill({ delivery_date: "2026-10-03", delivery_no: "1", delivery_summary: { interest: 50 } });
    const collect = (extra: Record<string, unknown>) => context.entry("collection", 1050, "upi", { billId, principal: 1000, interest: 50, discount: 0, ...extra });
    expect(() => collect({ principal: 900 })).toThrow("Partial principal");
    expect(() => collect({ amount: 1001 })).toThrow("must equal principal");
    expect(() => collect({ interest: 40, amount: 1040 })).toThrow("saved delivery interest");
    expect(() => collect({ interest: 40, discount: 10, amount: 1040, note: "" })).toThrow("Explain");
    collect({}); expect(context.day().totals.upiIn).toBe(1050);
    expect(() => collect({})).toThrow("earlier collection");
  });
  it("requires explicitly entered historical interest and does not invent it", () => {
    const context = fixture(); context.opening(); const billId = context.bill({ historical_delivery: true, delivery_date: "2026-10-03", delivery_no: "OLD" });
    expect(context.day().bills[0].expectedInterest).toBeNull();
    expect(() => context.entry("collection", 1000, "bank", { billId, principal: 1000, interest: 0, discount: 0, note: "" })).toThrow("historical interest");
    context.entry("collection", 1020, "bank", { billId, principal: 1000, interest: 20, discount: 0, note: "Interest confirmed from old receipt" });
    expect(context.day().totals).toMatchObject({ bankIn: 1020, interestReceived: 20, cashIn: 0 });
  });
  it("rejects unsupported or inconsistent payment allocations", () => {
    const context = fixture(); context.opening(); const billId = context.bill();
    expect(() => context.entry("collection", 1000, "cash", { billId, principal: 1000, interest: 0, discount: 0 })).toThrow("Record delivery first");
    expect(() => context.entry("disbursement", 1001, "cash", { billId })).toThrow("exceed");
    expect(() => context.entry("disbursement", 999, "cash", { billId, note: "" })).toThrow("lower than principal");
    expect(() => context.entry("expense", 10, "cash", { billId })).toThrow("cannot be attached");
    expect(() => context.entry("expense", 10, "cash", { interest: 1 })).toThrow("only to collections");
    expect(() => context.entry("cash_in", 10, "upi")).toThrow("must use Cash");
    expect(() => context.entry("expense", 10, "cash", { note: "" })).toThrow("Describe");
    context.entry("disbursement", 1000, "bank", { billId });
    expect(() => context.entry("disbursement", 1000, "bank", { billId })).toThrow("without a recorded");
  });
  it("counts only eligible unrecorded payouts and requires acknowledgement before closing", () => {
    const context = fixture(); context.opening(); context.bill({ bill_date: "2026-10-03" }); context.bill({ bill_date: "2026-10-03", status: "void" });
    expect(context.day().unrecorded.disbursements).toBe(1);
    expect(() => context.close(10000, { acknowledgeUnrecorded: false })).toThrow("acknowledge");
    context.close(10000); expect(context.day().closed).toBe(true);
  });
  it("carries counted cash and keeps discrepancies separate from income", () => {
    const context = fixture(); context.opening(); context.entry("expense", 100, "cash", { date: "2026-10-02" }); context.entry("cash_in", 20);
    expect(context.day().openingCash).toBe(9900);
    expect(() => context.close(9910)).toThrow("Explain the difference");
    context.close(9910, { note: "Cash count short by ten" });
    expect(context.day()).toMatchObject({ closed: true, expectedCash: 9920, countedCash: 9910, difference: -10 });
    expect(context.day("2026-10-04")).toMatchObject({ openingCash: 9910, expectedCash: 9910 });
    expect(context.day().totals).toMatchObject({ expenses: 0, interestReceived: 0 });
    expect(() => context.entry("expense", 1)).toThrow("closed");
    expect(() => context.entry("expense", 1, "cash", { date: "2026-10-02" })).toThrow("closed");
    expect(() => context.close(9910)).toThrow("closed");
  });
  it("protects against stale closing screens and carries earlier unclosed days", () => {
    const context = fixture(); context.opening(); const revision = context.day().revision;
    context.entry("expense", 0.29, "cash", { date: "2026-10-02" });
    expect(() => context.close(9999.71, { revision })).toThrow("changed");
    expect(context.day().expectedCash).toBe(9999.71);
    context.close(9999.71); expect(context.day("2026-10-05").expectedCash).toBe(9999.71);
    expect(() => context.save({ action: "opening", amount: 0 })).toThrow("already set");
  });
  it("reverses on an open date without rewriting a closed day", () => {
    const context = fixture(); context.opening(); context.entry("expense", 100); const original = context.day().entries[0];
    context.close(9900); context.save({ action: "reverse", date: "2026-10-04", entryId: original.id, note: "Wrong expense" });
    expect(context.day()).toMatchObject({ expectedCash: 9900, countedCash: 9900, entries: [{ id: original.id, reversed: true }] });
    expect(context.day("2026-10-04")).toMatchObject({ openingCash: 9900, expectedCash: 10000, totals: { cashIn: 100, expenses: -100 }, entries: [{ reversesId: original.id }] });
    expect(() => context.save({ action: "reverse", date: "2026-10-04", entryId: original.id, note: "Again" })).toThrow("already been reversed");
    const reversal = context.day("2026-10-04").entries[0];
    expect(() => context.save({ action: "reverse", date: "2026-10-04", entryId: reversal.id, note: "Again" })).toThrow("original money record");
  });
  it("isolates accounts, sync restrictions and changed idempotency payloads", () => {
    const context = fixture(); context.opening(); context.opening(200, 2);
    const request = { action: "entry", operationId: randomUUID(), date: "2026-10-03", kind: "expense", method: "cash", amount: 0.29, note: "Sample" } satisfies CashBookAction;
    context.book.post(1, request); context.book.post(1, request);
    expect(context.day().entries).toHaveLength(1);
    expect(() => context.book.post(1, { ...request, amount: 1 })).toThrow("different money request");
    expect(() => context.book.post(2, request)).toThrow("different money request");
    expect(context.day("2026-10-03", 2).entries).toHaveLength(0);
    const billId = context.bill({}, 2);
    expect(() => context.entry("disbursement", 1000, "cash", { billId })).toThrow("this business account");
    const entryId = context.day().entries[0].id;
    expect(() => context.save({ action: "reverse", entryId, note: "Other account" }, 2)).toThrow("this account");
    context.writable.mockImplementation(() => { throw new Error("Account uses online sync"); });
    expect(() => context.entry("expense", 1)).toThrow("online sync");
  });
  it("keeps combined unknown balances unknown and never includes foreign-owned profiles", () => {
    const context = fixture(); context.opening(100);
    const foreign = randomUUID(); context.put("business_profiles", foreign, { owner_id: "someone-else", account_slot: 3, business_name: "Not ours" });
    let report = context.book.view(1, "2026-10-03", true);
    expect(report.accounts).toHaveLength(2); expect(report.combined.openingCash).toBeNull();
    context.opening(200, 2); report = context.book.view(1, "2026-10-03", true);
    expect(report.combined).toMatchObject({ openingCash: 300, expectedCash: 300, countedCash: null, difference: null });
    expect(() => context.book.view(3, "2026-10-03")).toThrow("Business profile");
  });
  it("validates real dates, precision and bounds before posting anything", () => {
    const context = fixture(); context.opening();
    for (const date of ["2026-02-30", "2026-2-01", "2999-01-01", "not a date"]) expect(() => context.entry("expense", 1, "cash", { date })).toThrow();
    for (const amount of [-1, 0, 0.001, Infinity, NaN, 100000001]) expect(() => context.entry("expense", amount)).toThrow();
    expect(() => context.entry("expense", 1, "cash", { date: "2026-09-30" })).toThrow("starting date");
    context.entry("expense", 0.29); context.entry("expense", 0.1); context.entry("expense", 0.2);
    expect(context.day().totals.cashOut).toBe(0.59); expect(context.day().expectedCash).toBe(9999.41);
  });
  it("keeps money immutable and preserves a failed operation for a valid retry", () => {
    const context = fixture(); context.opening(); const operationId = randomUUID();
    expect(() => context.save({ action: "entry", operationId, kind: "expense", method: "cash", amount: 10, note: "" })).toThrow();
    context.save({ action: "entry", operationId, kind: "expense", method: "cash", amount: 10, note: "Corrected note" }); context.close(9990);
    for (const table of ["cash_openings", "cash_entries", "cash_closings", "cash_requests"]) {
      expect(() => context.database.exec("DELETE FROM " + table)).toThrow("read-only");
      expect(() => context.database.exec("UPDATE " + table + " SET " + (table === "cash_requests" ? "request_hash=request_hash" : "date=date"))).toThrow("read-only");
    }
  });
  it("requires reversals before changing confirmed bill finances", () => {
    const context = fixture(); context.opening(); const billId = context.bill(); context.entry("disbursement", 1000, "cash", { billId });
    expect(() => context.book.assertBillChangeAllowed(billId)).toThrow("confirmed money");
    expect(() => context.book.assertBillChangeAllowed(billId, "collection")).not.toThrow();
    context.save({ action: "reverse", entryId: context.day().entries[0].id, note: "Wrong payout" });
    expect(() => context.book.assertBillChangeAllowed(billId)).not.toThrow();
  });
  it("does not let a later reversal authorize an earlier duplicate collection", () => {
    const context = fixture(); context.opening();
    const billId = context.bill({ delivery_date: "2026-10-01", delivery_no: "1", delivery_summary: { interest: 0 } });
    const collection = { billId, principal: 1000, interest: 0, discount: 0, date: "2026-10-01" };
    context.entry("collection", 1000, "cash", collection);
    context.save({ action: "reverse", entryId: context.day("2026-10-01").entries[0].id, note: "Correct collection method" });
    expect(context.day("2026-10-02").bills[0]).toMatchObject({ collectionRecorded: true, canCollect: false });
    expect(() => context.entry("collection", 1000, "cash", { ...collection, date: "2026-10-02" })).toThrow("earlier collection");
    expect(context.day("2026-10-02").expectedCash).toBe(11000);
    expect(context.day().bills[0]).toMatchObject({ collectionRecorded: false, canCollect: true });
    context.entry("collection", 1000, "upi", { ...collection, date: "2026-10-03" });
    expect(context.day().totals).toMatchObject({ cashOut: 1000, upiIn: 1000 });
    expect(context.day("2026-10-02").bills[0].collectionRecorded).toBe(true);
  });
  it("keeps payout chronology and future record states date-aware", () => {
    const context = fixture(); context.opening(); const billId = context.bill();
    context.entry("disbursement", 1000, "cash", { billId, date: "2026-10-01" });
    context.save({ action: "reverse", entryId: context.day("2026-10-01").entries[0].id, note: "Correct payout method" });
    expect(context.day("2026-10-02").bills[0]).toMatchObject({ disbursementRecorded: true, canDisburse: false });
    expect(() => context.entry("disbursement", 1000, "bank", { billId, date: "2026-10-02" })).toThrow("without a recorded");
    context.entry("disbursement", 1000, "bank", { billId });
    const future = context.bill(); context.entry("disbursement", 1000, "bank", { billId: future });
    expect(context.day("2026-10-02").bills.find(bill => bill.id === future)).toMatchObject({ disbursementRecorded: false, canDisburse: false });
  });
});
