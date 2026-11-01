import { backup, DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { mkdirSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync, linkSync, unlinkSync } from "node:fs";
import { resolve, dirname, isAbsolute } from "node:path";
import { batchDeliverySchema, billSchema, deliverySchema, historicalBillEditSchema, historicalImportSchema } from "./validation";
import { sequenceDeliveryNumber } from "./delivery-status";
import { calculateRepayment } from "./interest";
import { jewelleryChoices, jewelleryKey, jewelleryNameSchema } from "./jewellery";
import { isAccountSlot } from "./account-url";
import { profileSchema } from "./profile-validation";
import { aadhaarOwnerNotice, customerCode, customerSchema, normalizeAadhaar, SharedPhoneError, type Customer, type CustomerInput } from "./customers";
import { scopedDataDirectory } from "./local-session-context";
import { createLocalIssuerStore } from "./sync-local-issuer";
import { createSyncOutbox } from "./sync-outbox";
import { parseSyncBill } from "./sync-bill";

type Row = Record<string, any>;
type Result = { data: any; error: Error | null; count?: number | null };
const tables = new Set(["business_profiles", "bills", "bill_items"]);
const connections = new Map<string, DatabaseSync>();
export const localOwnerId = "local-owner";
export function localDataDirectory() { return scopedDataDirectory(); }
function failure(error: unknown) { return { data: null, error: error instanceof Error ? error : new Error(String(error)), count: null }; }

/** Server-only, durable local ledger. Transactions serialize numbering and corrections. */
export function createLocalDatabase(directory = localDataDirectory()) {
  const root = resolve(directory); mkdirSync(root, { recursive: true });
  const filename = resolve(root, "billing.sqlite");
  let db = connections.get(filename);
  if (!db) {
    db = new DatabaseSync(filename);
    db.exec("PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records (table_name TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(table_name,id)); CREATE UNIQUE INDEX IF NOT EXISTS profile_account ON records(json_extract(body,'$.owner_id'), json_extract(body,'$.account_slot')) WHERE table_name='business_profiles'; CREATE UNIQUE INDEX IF NOT EXISTS bill_number ON records(json_extract(body,'$.profile_id'), json_extract(body,'$.bill_number')) WHERE table_name='bills'; CREATE UNIQUE INDEX IF NOT EXISTS replacement ON records(json_extract(body,'$.replacement_for_id')) WHERE table_name='bills' AND json_extract(body,'$.replacement_for_id') IS NOT NULL;");
    db.prepare("UPDATE records AS profile SET body=json_set(body,'$.next_bill_number',1,'$.next_delivery_number',1,'$.updated_at',?) WHERE table_name='business_profiles' AND (json_extract(body,'$.next_bill_number') IS NOT 1 OR json_extract(body,'$.next_delivery_number') IS NOT 1) AND NOT EXISTS (SELECT 1 FROM records AS bill WHERE bill.table_name='bills' AND json_extract(bill.body,'$.profile_id')=profile.id)").run(new Date().toISOString());
    createLocalIssuerStore(db);
    db.exec(`CREATE TABLE IF NOT EXISTS sync_local_bill_heads (profile_id TEXT NOT NULL, bill_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_local_requests (operation_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, device_id TEXT NOT NULL, issuer_epoch INTEGER NOT NULL, request_hash TEXT NOT NULL, bill_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_local_edit_requests (operation_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, device_id TEXT NOT NULL, request_hash TEXT NOT NULL, bill_id TEXT NOT NULL);`);
    connections.set(filename, db);
  }
  const database = db;
  database.exec("CREATE TABLE IF NOT EXISTS jewellery_items (name_key TEXT PRIMARY KEY, name TEXT NOT NULL)");
  // Older desktop releases insert without customer_number. Allocate it in a
  // trigger shared by every writer, and serialize schema inspection/backfill.
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, profile_id TEXT NOT NULL,
    name TEXT NOT NULL, father_name TEXT NOT NULL, address TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '' CHECK(phone='' OR (length(phone)=10 AND phone NOT GLOB '*[^0-9]*')),
    aadhaar TEXT NOT NULL DEFAULT '' CHECK(aadhaar='' OR (length(aadhaar)=12 AND aadhaar NOT GLOB '*[^0-9]*')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS customers_profile ON customers(profile_id);
  CREATE UNIQUE INDEX IF NOT EXISTS customer_aadhaar ON customers(profile_id,aadhaar) WHERE aadhaar<>'';`);
    if (!database.prepare("PRAGMA table_info(customers)").all().some(column => column.name === "customer_number")) {
      database.exec("ALTER TABLE customers ADD COLUMN customer_number INTEGER CHECK(customer_number IS NULL OR (typeof(customer_number)='integer' AND customer_number>0))");
    }
    if (!database.prepare("PRAGMA table_info(customers)").all().some(column => column.name === "canonical_id")) {
      database.exec("ALTER TABLE customers ADD COLUMN canonical_id TEXT");
    }
    if (!database.prepare("PRAGMA table_info(customers)").all().some(column => column.name === "phone_shared")) {
      // Set when staff confirm this person shares a phone with someone else, e.g. family.
      database.exec("ALTER TABLE customers ADD COLUMN phone_shared INTEGER NOT NULL DEFAULT 0");
    }
    database.exec("DROP INDEX IF EXISTS customer_phone");
    database.exec(`CREATE TABLE IF NOT EXISTS customer_number_sequence (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), last_number INTEGER NOT NULL CHECK(last_number>=0)
    );
    INSERT INTO customer_number_sequence(singleton,last_number) VALUES(1,0) ON CONFLICT(singleton) DO NOTHING;
    UPDATE customer_number_sequence SET last_number=MAX(last_number,COALESCE((SELECT MAX(customer_number) FROM customers),0)) WHERE singleton=1;`);
    const missing = database.prepare("SELECT id FROM customers WHERE customer_number IS NULL ORDER BY created_at,id").all();
    for (const customer of missing) {
      database.exec("UPDATE customer_number_sequence SET last_number=last_number+1 WHERE singleton=1");
      database.prepare("UPDATE customers SET customer_number=(SELECT last_number FROM customer_number_sequence WHERE singleton=1) WHERE id=?").run(customer.id);
    }
    database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS customer_number ON customers(customer_number) WHERE customer_number IS NOT NULL;
    CREATE TRIGGER IF NOT EXISTS customer_number_allocate AFTER INSERT ON customers
    BEGIN
      UPDATE customer_number_sequence SET last_number=MAX(last_number+1,COALESCE(NEW.customer_number,0)) WHERE singleton=1;
      UPDATE customers SET customer_number=(SELECT last_number FROM customer_number_sequence WHERE singleton=1) WHERE id=NEW.id AND customer_number IS NULL;
    END;
    CREATE TRIGGER IF NOT EXISTS customer_number_immutable BEFORE UPDATE OF customer_number ON customers
    WHEN OLD.customer_number IS NOT NULL AND NEW.customer_number IS NOT OLD.customer_number
    BEGIN SELECT RAISE(ABORT,'Customer number cannot be changed.'); END;`);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
  const jewelleryList = () => jewelleryChoices(database.prepare("SELECT name FROM jewellery_items ORDER BY name COLLATE NOCASE, name").all().map(row => String(row.name)));
  const rows = (table: string): Row[] => {
    if (!tables.has(table)) throw new Error(`Local storage does not support ${table}.`);
    return database.prepare("SELECT body FROM records WHERE table_name=?").all(table).map(row => JSON.parse(String(row.body)));
  };
  const save = (table: string, row: Row) => database.prepare("INSERT INTO records(table_name,id,body) VALUES(?,?,?) ON CONFLICT(table_name,id) DO UPDATE SET body=excluded.body").run(table, row.id, JSON.stringify(row));
  const transaction = <T>(operation: () => T): T => {
    database.exec("BEGIN IMMEDIATE");
    try { const result = operation(); database.exec("COMMIT"); return result; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  };
  const slot = (value: unknown) => { const n = value === undefined ? 1 : value; if (!isAccountSlot(n)) throw new Error("Choose a valid business account."); return n; };
  const owner = (value: unknown) => { if (value !== localOwnerId) throw new Error("Invalid local owner."); return localOwnerId; };
  const hasBills = (profileId: string) => rows("bills").some(bill => bill.profile_id === profileId);
  const customerProfile = (account: number) => {
    const accountNumber = slot(account);
    const profiles = rows("business_profiles").filter(row => row.owner_id === localOwnerId);
    const profile = profiles.find(row => row.account_slot === accountNumber)
      ?? (accountNumber <= 3 ? profiles.sort((left, right) => left.account_slot - right.account_slot)[0] : undefined);
    if (!profile) throw new Error("Set up this business account first.");
    return String(profile.id);
  };
  const toCustomer = (row: Row): Customer => ({ id: String(row.id), customerCode: customerCode(Number(row.customer_number)), name: String(row.name), fatherName: String(row.father_name), address: String(row.address), phone: String(row.phone), aadhaar: String(row.aadhaar), createdAt: String(row.created_at), updatedAt: String(row.updated_at) });
  // Keep legacy rows, numbers and per-profile SQL intact. Reconcile on every
  // access because an already-running desktop release can still insert/edit them.
  const customerIdentities = () => {
    const ownedProfiles = new Set(rows("business_profiles").filter(profile => profile.owner_id === localOwnerId).map(profile => String(profile.id)));
    const customers = database.prepare("SELECT * FROM customers ORDER BY customer_number,created_at,id").all().filter(row => ownedProfiles.has(String(row.profile_id)));
    const parent = customers.map((_, index) => index);
    const rootOf = (index: number): number => parent[index] === index ? index : (parent[index] = rootOf(parent[index]));
    const aadhaars = customers.map(row => new Set(row.aadhaar ? [String(row.aadhaar)] : []));
    const join = (left: number, right: number) => {
      left = rootOf(left); right = rootOf(right);
      if (left === right) return;
      const keys = new Set([...aadhaars[left], ...aadhaars[right]]);
      if (keys.size > 1) return;
      const first = Math.min(left, right); const second = Math.max(left, right);
      parent[second] = first; aadhaars[first] = keys;
    };
    const byId = new Map(customers.map((row, index) => [String(row.id), index]));
    customers.forEach((row, index) => { const previous = byId.get(String(row.canonical_id)); if (previous !== undefined) join(index, previous); });
    const byAadhaar = new Map<string, number>();
    customers.forEach((row, index) => {
      if (!row.aadhaar) return;
      const previous = byAadhaar.get(String(row.aadhaar));
      if (previous !== undefined) join(index, previous); else byAadhaar.set(String(row.aadhaar), index);
    });
    const byPhone = new Map<string, number[]>();
    customers.forEach((row, index) => { if (row.phone) byPhone.set(String(row.phone), [...(byPhone.get(String(row.phone)) ?? []), index]); });
    for (const indexes of byPhone.values()) {
      // A phone shared by different Aadhaar holders cannot identify its blank-ID
      // records either. Never let a blank Aadhaar bridge two different people.
      // Someone confirmed as sharing this phone is never merged because of it.
      const joinable = indexes.filter(index => !customers[index].phone_shared);
      const keys = new Set(joinable.flatMap(index => [...aadhaars[rootOf(index)]]));
      if (keys.size <= 1) joinable.slice(1).forEach(index => join(joinable[0], index));
    }
    const groups = new Map<number, Row[]>();
    customers.forEach((row, index) => { const root = rootOf(index); groups.set(root, [...(groups.get(root) ?? []), row]); });
    const update = database.prepare("UPDATE customers SET canonical_id=? WHERE id=? AND canonical_id IS NOT ?");
    return [...groups.values()].map(aliases => {
      const canonical = aliases[0];
      aliases.forEach(alias => update.run(canonical.id, alias.id, canonical.id));
      const latest = [...aliases].sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)) || Number(left.customer_number) - Number(right.customer_number))[0];
      const customer = toCustomer({ ...latest, id: canonical.id, customer_number: canonical.customer_number, created_at: canonical.created_at });
      const ids = aliases.map(alias => String(alias.id));
      const codes = aliases.map(alias => customerCode(Number(alias.customer_number)));
      const phones = [...new Set(aliases.map(alias => String(alias.phone)).filter(Boolean))]
        .filter(phone => (byPhone.get(phone) ?? []).every(index => ids.includes(String(customers[index].id))));
      const identifiers = { phones, aadhaars: [...new Set(aliases.map(alias => String(alias.aadhaar)).filter(Boolean))] };
      return { customer, ids, codes, ...identifiers, aliases, detailId: String(latest.id) };
    });
  };
  const findIdentity = (identifier: string) => customerIdentities().find(identity => identity.ids.includes(identifier) || identity.codes.includes(identifier.toUpperCase()));
  // Built once per query: a request can return every bill in the account.
  const billCanonicalizer = (identities: ReturnType<typeof customerIdentities>) => {
    const ownedProfiles = new Set(rows("business_profiles").filter(profile => profile.owner_id === localOwnerId).map(profile => profile.id));
    const byId = new Map(identities.flatMap(identity => identity.ids.map(id => [id, identity] as const)));
    const byCode = new Map(identities.flatMap(identity => identity.codes.map(code => [code, identity] as const)));
    return (row: Row): Row => {
      if (!ownedProfiles.has(row.profile_id)) return row;
      const identity = row.customer_id ? byId.get(String(row.customer_id)) : row.customer_code ? byCode.get(String(row.customer_code).toUpperCase()) : undefined;
      return identity ? { ...row, customer_id: identity.customer.id, customer_code: identity.customer.customerCode } : row;
    };
  };
  const customerLink = (profileId: string, id?: string) => {
    if (!id) return { customer_id: null, customer_code: null };
    if (!rows("business_profiles").some(profile => profile.id === profileId && profile.owner_id === localOwnerId)) throw new Error("Invalid local owner.");
    // Bill input remains a UUID; codes are accepted only by the search resolver.
    const identity = findIdentity(id);
    if (!identity || !identity.ids.includes(id)) throw new Error("Customer not found in this account.");
    return { customer_id: identity.customer.id, customer_code: identity.customer.customerCode };
  };
  const nextDeliveryNumber = (profile: Row) => rows("bills").filter(bill => bill.profile_id === profile.id).reduce((next, bill) => Math.max(next, (sequenceDeliveryNumber(bill.delivery_no) ?? 0) + 1), Math.max(1, Number(profile.next_delivery_number) || 1));
  const checkHistoricalImport = (ownerId: string, parameters: Row) => {
    const account = slot(parameters.p_account_slot);
    const profile = rows("business_profiles").find(row => row.owner_id === ownerId && row.account_slot === account);
    if (!profile) throw new Error("Set up this business account first.");
    refuseIfSyncManaged(profile.id);
    const input = historicalImportSchema.parse(parameters.p_bills);
    const numbers = new Set(rows("bills").filter(row => row.profile_id === profile.id).map(row => row.bill_number));
    for (const bill of input) {
      if (numbers.has(bill.billNo)) throw new Error(`Bill #${bill.billNo} is duplicated. No bills were imported.`);
      numbers.add(bill.billNo);
      if (bill.deliveryDate && bill.deliveryDate < bill.billDate) throw new Error(`Bill #${bill.billNo} has a delivery date before the bill date.`);
    }
    return { profile, input };
  };
  // Once an account joins online sync, a change outside the queue would make the
  // device and server disagree on bills and numbers, so only queued writes are allowed.
  const refuseIfSyncManaged = (profileId: string) => {
    if (database.prepare("SELECT 1 FROM sync_local_issuers WHERE profile_id=?").get(profileId)) throw new Error("This account uses online sync, and this change isn't supported through sync yet.");
  };
  const saveCustomer = (account: number, input: CustomerInput, id?: string, options: { allowSharedPhone?: boolean } = {}): Customer => {
    const profileId = customerProfile(account);
    const identities = customerIdentities();
    const previous = id === undefined ? undefined : identities.find(identity => identity.ids.includes(id));
    if (id !== undefined && !previous) throw new Error("Customer not found in this account.");
    const aadhaarMatches = input.aadhaar ? identities.filter(identity => identity.aadhaars.includes(input.aadhaar)) : [];
    const phoneMatches = input.phone ? identities.filter(identity => identity.aliases.some(alias => alias.phone === input.phone)) : [];
    const phoneAadhaars = new Set([...phoneMatches.flatMap(identity => identity.aadhaars), ...(input.aadhaar ? [input.aadhaar] : [])]);
    // Same phone but different details: never quietly treat this person as the saved one.
    const nameKey = (text: unknown) => String(text ?? "").trim().toLocaleLowerCase();
    const others = phoneMatches.filter(identity => identity !== previous);
    const sameDetails = (identity: (typeof others)[number]) => identity.aliases.some(alias => nameKey(alias.name) === nameKey(input.name) && nameKey(alias.father_name) === nameKey(input.fatherName));
    const provenDifferent = Boolean(input.aadhaar) && others.every(identity => identity.aadhaars.length > 0);
    const sharesPhone = !aadhaarMatches.length && others.length > 0 && !others.some(sameDetails) && !provenDifferent;
    if (sharesPhone && !options.allowSharedPhone) throw new SharedPhoneError(others[0].customer);
    const exactRepeat = !previous && !aadhaarMatches.length && !input.aadhaar ? others.filter(sameDetails) : [];
    if (exactRepeat.length === 1) return exactRepeat[0].customer;
    if (!sharesPhone && !input.aadhaar && phoneMatches.length > 1) throw new Error("This phone belongs to multiple customers. Enter Aadhaar to choose the same customer.");
    const matches = aadhaarMatches.length ? aadhaarMatches : sharesPhone ? [] : phoneAadhaars.size <= 1 ? phoneMatches : [];
    if (matches.some(identity => identity !== previous) && previous) throw new Error("A customer with this phone or Aadhaar already exists. Choose that customer instead.");
    if (!previous && matches.length > 1) throw new Error("This phone belongs to multiple customers. Enter Aadhaar to choose the same customer.");
    if (!previous && matches.length === 1) {
      const existing = matches[0];
      if (input.aadhaar && existing.aadhaars.some(aadhaar => aadhaar !== input.aadhaar)) throw new Error("Phone and Aadhaar do not match the same customer.");
      return existing.customer;
    }
    if (previous && input.aadhaar && previous.aliases.some(alias => alias.id !== previous.detailId && alias.aadhaar && alias.aadhaar !== input.aadhaar)) throw new Error("Phone and Aadhaar do not match the same customer.");
    const customerId = previous?.detailId ?? randomUUID();
    const previousTime = previous ? Date.parse(previous.customer.updatedAt) : NaN;
    const now = new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
    database.prepare("INSERT INTO customers(id,profile_id,name,father_name,address,phone,aadhaar,created_at,updated_at,phone_shared) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,father_name=excluded.father_name,address=excluded.address,phone=excluded.phone,aadhaar=excluded.aadhaar,updated_at=excluded.updated_at,phone_shared=MAX(phone_shared,excluded.phone_shared)")
      .run(customerId, profileId, input.name, input.fatherName, input.address, input.phone, input.aadhaar, previous?.customer.createdAt ?? now, now, sharesPhone ? 1 : 0);
    return findIdentity(customerId)!.customer;
  };
  // A new bill with a phone or Aadhaar and no saved customer chosen also saves that customer,
  // in the same transaction. Details a customer record can't hold still save the bill, unlinked.
  // An Aadhaar identifies one person, so someone else's must not go on a bill unnoticed.
  const refuseOtherPersonsAadhaar = (name: unknown, aadhaar: unknown, customerId?: string) => {
    const value = normalizeAadhaar(String(aadhaar ?? ""));
    const owner = value ? customerIdentities().find(identity => identity.aadhaars.includes(value)) : undefined;
    if (!owner || (customerId && owner.ids.includes(customerId))) return;
    const key = (text: unknown) => String(text ?? "").trim().toLocaleLowerCase();
    if (owner.aliases.some(alias => key(alias.name) === key(name))) return;
    throw new Error(`This Aadhaar is saved for ${owner.customer.name} (${owner.customer.customerCode}), ${aadhaarOwnerNotice}. Correct the Aadhaar, or enter it again to use ${owner.customer.name}.`);
  };
  const withNewCustomer = (input: Row): Row => {
    refuseOtherPersonsAadhaar(input?.customerName, input?.governmentId, input?.customerId);
    if (input?.customerId || !(String(input?.phone ?? "").trim() || String(input?.governmentId ?? "").trim())) return input;
    const details = customerSchema.safeParse({ name: input.customerName, fatherName: input.fatherName, address: input.address, phone: input.phone ?? "", aadhaar: input.governmentId ?? "" });
    if (!details.success) return input;
    return { ...input, customerId: saveCustomer(slot(input.accountSlot), details.data, undefined, { allowSharedPhone: input.allowSharedPhone === true }).id };
  };
  const issue = (ownerId: string, input: Row, queued = false) => {
    const bill = billSchema.parse(input);
    if (bill.items.some(item => !item.metal)) throw new Error("Choose Gold or Silver for every item.");
    if (bill.deliveryDate && bill.deliveryDate < bill.billDate) throw new Error("Delivery date cannot be before the bill date.");
    const profile = rows("business_profiles").find(p => p.owner_id === ownerId && p.account_slot === slot(input.accountSlot));
    if (!profile) throw new Error("Business profile is required");
    if (!queued) refuseIfSyncManaged(profile.id);
    const link = customerLink(profile.id, bill.customerId);
    const nextBillNumber = hasBills(profile.id) ? profile.next_bill_number : 1;
    if (nextBillNumber >= 2147483647) throw new Error("Bill number limit reached");
    const now = new Date().toISOString(); const id = randomUUID();
    const cents = (key: "assessedValue" | "loanAmount") => bill.items.reduce((sum, item) => sum + Math.round(item[key] * 100), 0) / 100;
    save("bills", { id, ...link, profile_id: profile.id, bill_number: nextBillNumber, bill_date: bill.billDate, delivery_no: bill.deliveryNo || null, delivery_date: bill.deliveryDate || null, customer_name: bill.customerName, father_name: bill.fatherName, address: bill.address, phone: bill.phone, government_id: bill.governmentId || null, total_assessed_value: cents("assessedValue"), total_loan_amount: cents("loanAmount"), status: "issued", replacement_for_id: null, excel_sync_status: "pending", excel_sync_error: null, pdf_storage_path: null, pdf_error: null, created_at: now, voided_at: null, business_snapshot: { business_name: profile.business_name, address: profile.address, phone: profile.phone, logo_url: profile.logo_url, license_number: profile.license_number ?? null } });
    bill.items.forEach((item, index) => save("bill_items", { id: randomUUID(), bill_id: id, metal: item.metal, particulars: item.particulars, remarks: item.remarks, grams: item.grams, assessed_value: item.assessedValue, loan_amount: item.loanAmount, sort_order: index }));
    save("business_profiles", { ...profile, next_bill_number: nextBillNumber + 1, updated_at: now });
    return { id };
  };
  const billOwner = (ownerId: string, id: string) => {
    const bill = rows("bills").find(row => row.id === id);
    const profile = rows("business_profiles").find(row => row.id === bill?.profile_id && row.owner_id === ownerId);
    if (!bill || !profile) throw new Error("Bill not found in this account.");
    return { bill, profile };
  };
  // Both single and multiple delivery operations call this inside one ledger transaction.
  const recordDelivery = (ownerId: string, billId: string, account: unknown, delivery: unknown) => {
    const { bill, profile } = billOwner(ownerId, billId);
    if (slot(account) !== profile.account_slot) throw new Error("Bill not found in this account.");
    refuseIfSyncManaged(profile.id);
    if (!["issued", "void"].includes(bill.status)) throw new Error("Delivery cannot be recorded for this bill status.");
    const input = deliverySchema.parse(delivery);
    // A register delivery really happened: never replace what it recorded or invent interest for it.
    const historical = bill.historical_delivery === true;
    if (historical && bill.delivery_no && bill.delivery_date) throw new Error(`Bill #${bill.bill_number}'s delivery came from your old register and is already complete. Use Edit bill to correct it.`);
    const deliveryDate = historical && bill.delivery_date ? String(bill.delivery_date) : input.deliveryDate;
    if (deliveryDate < bill.bill_date) throw new Error("Delivery date cannot be before the bill date.");
    const savedItems = rows("bill_items").filter(item => item.bill_id === bill.id).sort((left, right) => left.sort_order - right.sort_order);
    if (!savedItems.length) throw new Error("This bill has no pledged items.");
    if (input.itemMetals && input.itemMetals.length !== savedItems.length) throw new Error("The item list changed. Find the bill again.");
    const items = savedItems.map((item, index) => ({ metal: item.metal === "Gold" || item.metal === "Silver" ? item.metal : input.itemMetals?.[index] ?? undefined, particulars: String(item.particulars), grams: Number(item.grams), assessedValue: Number(item.assessed_value), loanAmount: Number(item.loan_amount) }));
    if (items.some(item => !item.metal)) throw new Error("Choose Gold or Silver for each item before saving delivery.");
    const summary = historical ? bill.delivery_summary ?? null : calculateRepayment(items, bill.bill_date, deliveryDate);
    const nextNumber = nextDeliveryNumber(profile);
    if (!bill.delivery_no && (!Number.isSafeInteger(nextNumber) || nextNumber >= 2147483647)) throw new Error("Delivery number limit reached.");
    const deliveryNo = bill.delivery_no || String(nextNumber);
    const now = new Date().toISOString();
    if (!bill.delivery_no) save("business_profiles", { ...profile, next_delivery_number: nextNumber + 1, updated_at: now });
    savedItems.forEach((item, index) => { if (!item.metal) save("bill_items", { ...item, metal: items[index].metal }); });
    const updated = { ...bill, delivery_no: deliveryNo, delivery_date: deliveryDate, delivery_bill_receipt_status: input.billReceiptStatus, delivery_collected_by_relation: input.collectedByRelation, delivery_collected_by_name: input.collectedByRelation === "self" ? bill.customer_name : input.collectedByName, delivery_summary: summary, excel_sync_status: "pending", excel_sync_error: null, pdf_storage_path: null, pdf_error: null, delivery_pdf_storage_path: null, delivery_pdf_error: null, updated_at: now };
    save("bills", updated);
    return { id: bill.id, previousPdfPath: bill.pdf_storage_path, previousDeliveryPdfPath: bill.delivery_pdf_storage_path, bill: { ...billCanonicalizer(customerIdentities())(updated), bill_items: rows("bill_items").filter(item => item.bill_id === bill.id).sort((left, right) => left.sort_order - right.sort_order) } };
  };
  // Undoes a delivery but keeps a record of it. Its number stays used, because a paper receipt may exist.
  const cancelDelivery = (ownerId: string, billId: string, account: unknown) => {
    const { bill, profile } = billOwner(ownerId, billId);
    if (slot(account) !== profile.account_slot) throw new Error("Bill not found in this account.");
    refuseIfSyncManaged(profile.id);
    if (!bill.delivery_no && !bill.delivery_date) throw new Error("This bill has no delivery to cancel.");
    if (bill.historical_delivery === true) throw new Error("This delivery came from your old register, so it can't be cancelled here. Use Edit bill to correct it.");
    const now = new Date().toISOString();
    const cancelled = { delivery_no: bill.delivery_no, delivery_date: bill.delivery_date, bill_receipt_status: bill.delivery_bill_receipt_status ?? null, collected_by_relation: bill.delivery_collected_by_relation ?? null, collected_by_name: bill.delivery_collected_by_name ?? null, delivery_summary: bill.delivery_summary ?? null, cancelled_at: now };
    const updated = { ...bill, delivery_no: null, delivery_date: null, delivery_bill_receipt_status: null, delivery_collected_by_relation: null, delivery_collected_by_name: null, delivery_summary: null, cancelled_deliveries: [...(Array.isArray(bill.cancelled_deliveries) ? bill.cancelled_deliveries : []), cancelled], excel_sync_status: "pending", excel_sync_error: null, pdf_storage_path: null, pdf_error: null, delivery_pdf_storage_path: null, delivery_pdf_error: null, updated_at: now };
    save("bills", updated);
    return { id: bill.id, previousPdfPath: bill.pdf_storage_path, previousDeliveryPdfPath: bill.delivery_pdf_storage_path };
  };
  const editBill = (ownerId: string, billId: string, value: Row, queued = false) => {
    const { bill: original, profile } = billOwner(ownerId, billId);
    if (!queued) refuseIfSyncManaged(profile.id);
    if (original.status !== "issued") throw new Error("Only issued bills can be edited.");
    if (value.accountSlot !== undefined && slot(value.accountSlot) !== profile.account_slot) throw new Error("A bill must remain in its original account.");
    // Register imports keep unknown details blank until someone actually records them.
    const keepsBlanks = original.historical_missing_details === true;
    const input = keepsBlanks ? historicalBillEditSchema.parse(value) : billSchema.parse(value);
    if (input.governmentId !== original.government_id || input.customerName !== original.customer_name) refuseOtherPersonsAadhaar(input.customerName, input.governmentId, input.customerId);
    const link = input.customerId === undefined ? {} : customerLink(profile.id, input.customerId);
    if (input.items.some(item => !item.metal)) throw new Error("Choose Gold or Silver for every item.");
    if (input.deliveryDate && input.deliveryDate < input.billDate) throw new Error("Delivery date cannot be before the bill date.");
    const total = (key: "assessedValue" | "loanAmount") => input.items.some(item => item[key] === null) ? null : input.items.reduce((sum, item) => sum + Math.round(Number(item[key]) * 100), 0) / 100;
    const stillMissing = keepsBlanks && (!input.fatherName || input.items.some(item => item.grams === null || item.assessedValue === null));
    const deliverySummary = input.deliveryNo && input.deliveryDate ? calculateRepayment(input.items, input.billDate, input.deliveryDate) : null;
    save("bills", { ...original, ...link, historical_missing_details: stillMissing, bill_date: input.billDate, delivery_no: input.deliveryNo || null, delivery_date: input.deliveryDate || null, delivery_summary: original.historical_delivery ? original.delivery_summary ?? null : deliverySummary, customer_name: input.customerName, father_name: input.fatherName || null, address: input.address, phone: input.phone, government_id: input.governmentId === undefined ? original.government_id ?? null : input.governmentId || null, total_assessed_value: total("assessedValue"), total_loan_amount: total("loanAmount"), excel_sync_status: "pending", excel_sync_error: null, pdf_storage_path: null, pdf_error: null, delivery_pdf_storage_path: null, delivery_pdf_error: null, updated_at: new Date().toISOString() });
    database.prepare("DELETE FROM records WHERE table_name='bill_items' AND json_extract(body,'$.bill_id')=?").run(original.id);
    input.items.forEach((item, index) => save("bill_items", { id: randomUUID(), bill_id: original.id, metal: item.metal, particulars: item.particulars, remarks: item.remarks, grams: item.grams, assessed_value: item.assessedValue, loan_amount: item.loanAmount, sort_order: index }));
    return { id: original.id, previousPdfPath: original.pdf_storage_path, previousDeliveryPdfPath: original.delivery_pdf_storage_path };
  };
  const syncBillPayload = (bill: Row) => {
    const items = rows("bill_items").filter(row => row.bill_id === bill.id).sort((a, b) => a.sort_order - b.sort_order);
    return JSON.parse(JSON.stringify({ billNumber: bill.bill_number, billDate: bill.bill_date, ...(bill.delivery_no ? { deliveryNo: bill.delivery_no } : {}), ...(bill.delivery_date ? { deliveryDate: bill.delivery_date } : {}), customerName: bill.customer_name, fatherName: bill.father_name, address: bill.address, phone: bill.phone, ...(bill.government_id ? { governmentId: bill.government_id } : {}), ...(bill.customer_id ? { customerId: bill.customer_id } : {}), businessSnapshot: bill.business_snapshot,
      items: items.map(item => ({ id: item.id, metal: item.metal, particulars: item.particulars, ...(item.remarks ? { remarks: item.remarks } : {}), grams: item.grams, assessedValue: item.assessed_value, loanAmount: item.loan_amount })) }));
  };
  class Query {
    private filters: ((row: Row) => boolean)[] = [];
    private orders: { key: string; ascending: boolean }[] = [];
    private columns = "*"; private start = 0; private end = Infinity; private patch?: Row;
    constructor(private table: string) {}
    select(columns = "*", _options?: unknown) { this.columns = columns; return this; }
    update(patch: Row) { this.patch = patch; return this; }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
    gte(key: string, value: any) { this.filters.push(row => row[key] >= value); return this; }
    lte(key: string, value: any) { this.filters.push(row => row[key] <= value); return this; }
    ilike(key: string, value: string) { const pattern = new RegExp("^" + value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", "i"); this.filters.push(row => pattern.test(String(row[key]))); return this; }
    or(expression: string) {
      const parts = expression.match(/(?:[^,\"]|\"(?:\\.|[^\"\\])*\")+/g) ?? [];
      const predicates = parts.map(part => {
        const match = /^([a-z_]+)\.(eq|imatch)\.(.*)$/.exec(part); if (!match) throw new Error("Unsupported local search filter");
        const [, key, operation, raw] = match; const value = raw.startsWith('"') ? JSON.parse(raw) : raw;
        if (operation === "imatch") { const regex = new RegExp(value, "i"); return (row: Row) => regex.test(String(row[key])); }
        return (row: Row) => String(row[key]) === String(value);
      });
      this.filters.push(row => predicates.some(predicate => predicate(row))); return this;
    }
    order(key: string, options?: { ascending?: boolean }) { this.orders.push({ key, ascending: options?.ascending !== false }); return this; }
    range(start: number, end: number) { this.start = start; this.end = end; return this; }
    private execute(mode?: "single" | "maybeSingle"): Result {
      try {
        let result = rows(this.table).filter(row => this.filters.every(filter => filter(row))); const count = result.length;
        if (this.patch) transaction(() => {
          const patch = this.patch!;
          const allowed = new Set(["status", "voided_at", "excel_sync_status", "excel_sync_error", "pdf_storage_path", "pdf_error", "delivery_pdf_storage_path", "delivery_pdf_error"]);
          if (this.table !== "bills" || Object.keys(patch).some(key => !allowed.has(key))) throw new Error("Direct ledger updates are blocked. Use Edit bill to make corrections.");
          if (patch.status !== undefined && patch.status !== "void") throw new Error("A void bill cannot be reissued.");
          if (patch.voided_at !== undefined && patch.status !== "void") throw new Error("Void timestamp requires voiding the bill.");
          if (patch.excel_sync_status !== undefined && !["pending", "synced", "failed"].includes(patch.excel_sync_status)) throw new Error("Invalid register status.");
          result = result.map(row => {
            if (patch.status === "void" && row.status !== "issued") throw new Error("Only issued bills can be voided.");
            if (patch.status === "void") refuseIfSyncManaged(row.profile_id);
            for (const key of ["pdf_storage_path", "delivery_pdf_storage_path"]) if (patch[key] != null) {
              pdfPath("bill-pdfs", patch[key]);
              const prefix = `${row.profile_id}/${row.id}`;
              const suffix = patch[key].startsWith(prefix) ? patch[key].slice(prefix.length) : "";
              if (suffix !== ".pdf" && !/^-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i.test(suffix)) throw new Error("PDF must belong to its bill.");
            }
            const changed = { ...row, ...patch, ...(patch.status === "void" ? { voided_at: patch.voided_at || new Date().toISOString() } : {}) };
            save(this.table, changed); return changed;
          });
        });
        result.sort((a, b) => { for (const order of this.orders) { if (a[order.key] !== b[order.key]) return (a[order.key] < b[order.key] ? -1 : 1) * (order.ascending ? 1 : -1); } return 0; });
        const canonicalize = this.table === "bills" ? billCanonicalizer(transaction(customerIdentities)) : (row: Row) => row;
        const itemsByBill = new Map<string, Row[]>();
        if (this.columns.includes("bill_items(")) {
          for (const item of rows("bill_items")) { const list = itemsByBill.get(item.bill_id); if (list) list.push(item); else itemsByBill.set(item.bill_id, [item]); }
          for (const list of itemsByBill.values()) list.sort((a, b) => a.sort_order - b.sort_order);
        }
        result = result.slice(this.start, this.end === Infinity ? undefined : this.end + 1).map(storedRow => {
          // Canonicalize references in responses; printed customer/financial
          // snapshots in stored bills remain byte-for-byte unchanged.
          const row = canonicalize(storedRow);
          const joined = this.columns.includes("bill_items(") ? { ...row, bill_items: itemsByBill.get(row.id) ?? [] } : row;
          return this.columns.includes("*") ? joined : Object.fromEntries(this.columns.split(",").map(key => [key.trim(), joined[key.trim()]]));
        });
        if (mode && (result.length > 1 || (mode === "single" && result.length !== 1))) throw new Error("Expected one record");
        return { data: mode ? result[0] ?? null : result, error: null, count };
      } catch (error) { return failure(error); }
    }
    single() { return Promise.resolve(this.execute("single")); }
    maybeSingle() { return Promise.resolve(this.execute("maybeSingle")); }
    then(resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve(this.execute()).then(resolve, reject); }
  }
  function pdfPath(bucket: string, path: string) {
    if (bucket !== "bill-pdfs" || isAbsolute(path) || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..") || !/^[a-zA-Z0-9_/-]+\.pdf$/.test(path)) throw new Error("Invalid PDF storage path");
    return resolve(root, "bill-pdfs", path);
  }
  return {
    sync: {
      counters: (profileId: string) => createLocalIssuerStore(database).counters(profileId),
      saveAssignment: (profileId: string, deviceId: string, epoch: number, counters: { nextBillNumber: number; nextDeliveryNumber: number }) => createLocalIssuerStore(database).saveAssignment(profileId, deviceId, epoch, counters),
      pending: (profileId: string) => createSyncOutbox(database).pending(profileId),
      /** The administrator's list of changes waiting for review. */
      held: (profileId: string) => createSyncOutbox(database).held(profileId),
      resolveHeld: (profileId: string, operationId: string, decision: "retry" | "dismiss") => createSyncOutbox(database).resolve(profileId, operationId, decision),
    },
    backupBeforeImport: async () => {
      const directory = resolve(root, "backups");
      mkdirSync(directory, { recursive: true });
      const target = resolve(directory, `before-import-${randomUUID()}.sqlite`);
      await backup(database, target);
      return target;
    },
    customers: {
      list: (account: number, search = ""): Customer[] => transaction(() => {
        customerProfile(account);
        if (search.length > 200) throw new Error("Customer search is too long.");
        const query = search.trim().toLocaleLowerCase();
        return customerIdentities().filter(identity => !query || [...identity.codes, ...identity.ids, ...identity.aliases.flatMap(alias => [alias.name, alias.father_name, alias.address, alias.phone, alias.aadhaar])].some(value => String(value).toLocaleLowerCase().includes(query)))
          .map(identity => identity.customer).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
      }),
      resolve: (identifier: string): Customer | null => transaction(() => findIdentity(identifier)?.customer ?? null),
      identity: (identifier: string) => transaction(() => {
        const identity = findIdentity(identifier);
        if (!identity) return null;
        const { customer, ids, codes, phones, aadhaars } = identity;
        return { customer, ids, codes, phones, aadhaars };
      }),
      lookup: (account: number, identifiers: { phone?: string; aadhaar?: string }): Customer | null => transaction(() => {
        customerProfile(account);
        const { phone, aadhaar } = customerSchema.pick({ phone: true, aadhaar: true }).parse(identifiers);
        if (!phone && !aadhaar) return null;
        const identities = customerIdentities();
        const matches = identities.filter(identity => identity.aliases.some(alias => (phone && alias.phone === phone) || (aadhaar && alias.aadhaar === aadhaar)));
        if (phone && aadhaar) {
          const exact = matches.filter(identity => identity.aliases.some(alias => alias.aadhaar === aadhaar)
            && identity.aliases.some(alias => alias.phone === phone || !alias.phone));
          if (exact.length === 1) return exact[0].customer;
          if (matches.length) throw new Error("Phone and Aadhaar do not match the same customer.");
        }
        if (matches.length > 1) throw new Error("This phone belongs to multiple customers. Enter Aadhaar to choose the same customer.");
        return matches[0]?.customer ?? null;
      }),
      phoneMatches: (account: number, value: string): Customer[] => transaction(() => {
        customerProfile(account);
        const { phone } = customerSchema.pick({ phone: true }).parse({ phone: value });
        if (!phone) return [];
        return customerIdentities().filter(identity => identity.aliases.some(alias => alias.phone === phone)).map(identity => identity.customer);
      }),
      save: (account: number, value: unknown, id?: string, options: { allowSharedPhone?: boolean } = {}): Customer => {
        const input = customerSchema.parse(value);
        return transaction(() => saveCustomer(account, input, id, options));
      },
    },
    jewellery: {
      list: jewelleryList,
      add: (value: unknown) => {
        const name = jewelleryNameSchema.parse(value);
        return transaction(() => {
          const existing = jewelleryList().find(choice => jewelleryKey(choice) === jewelleryKey(name));
          if (existing) return { name: existing, items: jewelleryList() };
          database.prepare("INSERT INTO jewellery_items(name_key,name) VALUES(?,?) ON CONFLICT(name_key) DO NOTHING").run(jewelleryKey(name), name);
          return { name, items: jewelleryList() };
        });
      },
    },
    from: (table: string) => new Query(table),
    auth: { getUser: async () => ({ data: { user: { id: localOwnerId } }, error: null }) },
    rpc: async (name: string, parameters: Row): Promise<Result> => {
      try { const data = transaction(() => {
        const ownerId = owner(parameters.p_owner_id);
        if (name === "save_business_profile" || name === "create_business_account") {
          const input = profileSchema.parse(parameters.p_profile);
          const creating = name === "create_business_account";
          const account = creating
            ? rows("business_profiles").filter(row => row.owner_id === ownerId).reduce((highest, row) => Math.max(highest, slot(row.account_slot)), 3) + 1
            : slot(parameters.p_profile.accountSlot);
          if (!isAccountSlot(account)) throw new Error("Business account limit reached.");
          const previous = rows("business_profiles").find(row => row.owner_id === ownerId && row.account_slot === account); const now = new Date().toISOString();
          if (creating && previous) throw new Error("Business account already exists.");
          const licenseNumber = input.licenseNumber === undefined ? previous?.license_number ?? null : input.licenseNumber.trim() || null;
          const profile = { id: previous?.id ?? randomUUID(), owner_id: ownerId, account_slot: account, business_name: input.businessName, address: input.address, phone: input.phone, logo_url: input.logoUrl || null, license_number: licenseNumber, next_bill_number: previous && hasBills(previous.id) ? previous.next_bill_number : 1, next_delivery_number: previous && hasBills(previous.id) ? nextDeliveryNumber(previous) : 1, created_at: previous?.created_at ?? now, updated_at: now }; save("business_profiles", profile); return profile;
        }
        if (name === "create_bill") return issue(ownerId, withNewCustomer(parameters.p_bill));
        if (name === "create_bill_with_sync") {
          const operationId = z.string().uuid().parse(parameters.p_operation_id);
          const deviceId = z.string().uuid().parse(parameters.p_device_id);
          const epoch = z.number().int().nonnegative().safe().parse(parameters.p_issuer_epoch);
          const account = slot(parameters.p_bill?.accountSlot);
          const input = billSchema.parse(parameters.p_bill);
          const profile = rows("business_profiles").find(row => row.owner_id === ownerId && row.account_slot === account);
          if (!profile) throw new Error("Business profile is required.");
          const requestHash = createHash("sha256").update(JSON.stringify({ account, input })).digest("hex");
          const previous = database.prepare("SELECT * FROM sync_local_requests WHERE operation_id=?").get(operationId);
          if (previous) {
            if (previous.profile_id !== profile.id || previous.device_id !== deviceId || Number(previous.issuer_epoch) !== epoch || previous.request_hash !== requestHash) throw new Error("A different bill request already uses this operation ID.");
            return { id: String(previous.bill_id) };
          }
          const issuer = createLocalIssuerStore(database);
          if (!issuer.canIssue(profile.id, deviceId, epoch)) throw new Error("This device does not have offline billing permission.");
          const created = issue(ownerId, { ...input, accountSlot: account }, true);
          const bill = rows("bills").find(row => row.id === created.id)!;
          const payload = syncBillPayload(bill);
          const operation = parseSyncBill({ id: operationId, deviceId, accountId: profile.id, entityId: bill.id, entityType: "bill", action: "create", occurredAt: new Date().toISOString(), issuerEpoch: epoch, payload });
          createSyncOutbox(database).enqueue(operation);
          database.prepare("INSERT INTO sync_local_bill_heads(profile_id,bill_id,operation_id) VALUES(?,?,?)").run(profile.id, bill.id, operationId);
          database.prepare("INSERT INTO sync_local_requests(operation_id,profile_id,device_id,issuer_epoch,request_hash,bill_id) VALUES(?,?,?,?,?,?)").run(operationId, profile.id, deviceId, epoch, requestHash, bill.id);
          return created;
        }
        if (name === "check_historical_bills") { checkHistoricalImport(ownerId, parameters); return { ok: true }; }
        if (name === "import_historical_bills") {
          const { profile, input } = checkHistoricalImport(ownerId, parameters);
          const now = new Date().toISOString();
          const ids: string[] = [];
          for (const bill of input) {
            const id = randomUUID(); ids.push(id);
            save("bills", { id, profile_id: profile.id, bill_number: bill.billNo, bill_date: bill.billDate,
              delivery_no: bill.deliveryNo || null, delivery_date: bill.deliveryDate, historical_delivery: Boolean(bill.deliveryNo || bill.deliveryDate), historical_import: true, historical_missing_details: true,
              customer_id: null, customer_code: null, customer_name: bill.name, father_name: null, address: bill.address, phone: bill.phone, government_id: null,
              total_assessed_value: null, total_loan_amount: bill.amount, status: bill.voided ? "void" : "issued", replacement_for_id: null,
              excel_sync_status: "pending", excel_sync_error: null, pdf_storage_path: null, pdf_error: null, created_at: now, voided_at: bill.voided ? now : null,
              business_snapshot: { business_name: profile.business_name, address: profile.address, phone: profile.phone, logo_url: profile.logo_url, license_number: profile.license_number ?? null } });
            save("bill_items", { id: randomUUID(), bill_id: id, metal: bill.metal, particulars: bill.particulars, remarks: null, grams: null, assessed_value: null, loan_amount: bill.amount, sort_order: 0 });
          }
          const nextBillNumber = Math.max(Number(profile.next_bill_number) || 1, ...input.map(bill => bill.billNo + 1));
          const deliveryNumbers = input.map(bill => sequenceDeliveryNumber(bill.deliveryNo) ?? 0);
          const nextDelivery = Math.max(Number(profile.next_delivery_number) || 1, ...deliveryNumbers.map(number => number + 1));
          save("business_profiles", { ...profile, next_bill_number: nextBillNumber, next_delivery_number: nextDelivery, updated_at: now });
          return { ids, count: ids.length, profileId: profile.id };
        }
        if (name === "mark_import_register_synced") {
          const account = slot(parameters.p_account_slot);
          const profile = rows("business_profiles").find(row => row.owner_id === ownerId && row.account_slot === account);
          if (!profile || !Array.isArray(parameters.p_ids) || parameters.p_ids.length > 10000) throw new Error("Invalid import sync request.");
          const ids = new Set(parameters.p_ids);
          for (const bill of rows("bills")) if (ids.has(bill.id) && bill.profile_id === profile.id) save("bills", { ...bill, excel_sync_status: "synced", excel_sync_error: null });
          return { ok: true };
        }
        if (name === "get_next_delivery_number") {
          const profile = rows("business_profiles").find(profile => profile.owner_id === ownerId && profile.account_slot === slot(parameters.p_account_slot));
          if (!profile) throw new Error("Business profile is required.");
          return { number: nextDeliveryNumber(profile) };
        }
        if (name === "record_bill_delivery") return recordDelivery(ownerId, parameters.p_bill_id, parameters.p_account_slot, parameters.p_delivery);
        if (name === "cancel_bill_delivery") return cancelDelivery(ownerId, parameters.p_bill_id, parameters.p_account_slot);
        if (name === "record_bill_deliveries") {
          const input = batchDeliverySchema.parse(parameters.p_delivery);
          for (const delivery of input.deliveries) {
            const { bill } = billOwner(ownerId, delivery.billId);
            if (bill.historical_delivery === true) throw new Error(`Bill #${bill.bill_number}'s delivery came from your old register. Complete it in Single Delivery; no deliveries were saved.`);
          }
          return input.deliveries.map(delivery => recordDelivery(ownerId, delivery.billId, parameters.p_account_slot, { deliveryDate: input.deliveryDate, itemMetals: delivery.itemMetals, billReceiptStatus: delivery.billReceiptStatus, collectedByRelation: delivery.collectedByRelation, collectedByName: delivery.collectedByName }));
        }
        if (name === "edit_bill") return editBill(ownerId, parameters.p_bill_id, parameters.p_bill);
        if (name === "edit_bill_with_sync") {
          const operationId = z.string().uuid().parse(parameters.p_operation_id);
          const deviceId = z.string().uuid().parse(parameters.p_device_id);
          const { bill: original, profile } = billOwner(ownerId, parameters.p_bill_id);
          const input = billSchema.parse(parameters.p_bill);
          const account = parameters.p_bill.accountSlot === undefined ? profile.account_slot : slot(parameters.p_bill.accountSlot);
          if (account !== profile.account_slot) throw new Error("A bill must remain in its original account.");
          const requestHash = createHash("sha256").update(JSON.stringify({ account, billId: original.id, input })).digest("hex");
          const previous = database.prepare("SELECT * FROM sync_local_edit_requests WHERE operation_id=?").get(operationId);
          if (previous) {
            if (previous.profile_id !== profile.id || previous.device_id !== deviceId || previous.request_hash !== requestHash || previous.bill_id !== original.id) throw new Error("A different bill edit already uses this operation ID.");
            return { id: original.id, previousPdfPath: null, previousDeliveryPdfPath: null };
          }
          const head = database.prepare("SELECT operation_id FROM sync_local_bill_heads WHERE profile_id=? AND bill_id=?").get(profile.id, original.id);
          if (!head || typeof head.operation_id !== "string") throw new Error("Sync this bill before editing it on this device.");
          const edited = editBill(ownerId, original.id, { ...input, accountSlot: account }, true);
          const bill = rows("bills").find(row => row.id === original.id)!;
          const operation = parseSyncBill({ id: operationId, deviceId, accountId: profile.id, entityId: original.id, entityType: "bill", action: "update", baseOperationId: head.operation_id, occurredAt: new Date().toISOString(), payload: syncBillPayload(bill) });
          createSyncOutbox(database).enqueue(operation);
          database.prepare("UPDATE sync_local_bill_heads SET operation_id=? WHERE profile_id=? AND bill_id=?").run(operationId, profile.id, original.id);
          database.prepare("INSERT INTO sync_local_edit_requests(operation_id,profile_id,device_id,request_hash,bill_id) VALUES(?,?,?,?,?)").run(operationId, profile.id, deviceId, requestHash, original.id);
          return edited;
        }
        if (name === "delete_bill") {
          const { bill, profile } = billOwner(ownerId, parameters.p_bill_id);
          refuseIfSyncManaged(profile.id);
          const reuseNumber = bill.bill_number === profile.next_bill_number - 1;
          database.prepare("DELETE FROM records WHERE table_name='bill_items' AND json_extract(body,'$.bill_id')=?").run(bill.id);
          for (const replacement of rows("bills").filter(row => row.replacement_for_id === bill.id)) save("bills", { ...replacement, replacement_for_id: null });
          database.prepare("DELETE FROM records WHERE table_name='bills' AND id=?").run(bill.id);
          const nextBillNumber = !hasBills(profile.id) ? 1 : reuseNumber ? bill.bill_number : profile.next_bill_number;
          if (nextBillNumber !== profile.next_bill_number || !hasBills(profile.id)) save("business_profiles", { ...profile, next_bill_number: nextBillNumber, ...(!hasBills(profile.id) ? { next_delivery_number: 1 } : {}), updated_at: new Date().toISOString() });
          return { id: bill.id, billNumber: bill.bill_number, nextBillNumber, previousPdfPath: bill.pdf_storage_path };
        }
        if (name === "replace_bill") {
          const original = rows("bills").find(row => row.id === parameters.p_original_id); const profile = rows("business_profiles").find(row => row.id === original?.profile_id && row.owner_id === ownerId);
          if (!original || !profile) throw new Error("Original bill not found");
          if (original.status !== "issued") throw new Error("Only issued bills can be replaced");
          if (parameters.p_bill.accountSlot !== undefined && slot(parameters.p_bill.accountSlot) !== profile.account_slot) throw new Error("A replacement must remain in the original account");
          save("bills", { ...original, status: "void", voided_at: new Date().toISOString(), excel_sync_status: "pending", excel_sync_error: null });
          const created = issue(ownerId, { ...parameters.p_bill, accountSlot: profile.account_slot }); const replacement = rows("bills").find(row => row.id === created.id)!; save("bills", { ...replacement, replacement_for_id: original.id }); return created;
        }
        throw new Error(`Unsupported local operation: ${name}`);
      }); return { data, error: null }; } catch (error) { return failure(error); }
    },
    storage: { from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array, _options?: unknown) => {
        try {
          const destination = pdfPath(bucket, path);
          if (bytes.byteLength > 10485760) throw new Error("PDF exceeds 10 MB");
          mkdirSync(dirname(destination), { recursive: true });
          const temporary = `${destination}.${randomUUID()}.tmp`;
          try {
            writeFileSync(temporary, bytes, { flag: "wx" });
            const descriptor = openSync(temporary, "r+");
            try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
            // Publish only complete bytes, without replacing an existing immutable PDF.
            linkSync(temporary, destination);
          } finally {
            try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          }
          return { data: { path }, error: null };
        } catch (error) { return failure(error); }
      },
      download: async (path: string) => { try { return { data: new Blob([new Uint8Array(readFileSync(pdfPath(bucket, path)))]), error: null }; } catch (error) { return failure(error); } },
      remove: async (paths: string[]) => { try { for (const path of paths) { try { unlinkSync(pdfPath(bucket, path)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } } return { data: paths, error: null }; } catch (error) { return failure(error); } },
    }) },
    close: () => { database.close(); connections.delete(filename); },
  };
}
