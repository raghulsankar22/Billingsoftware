import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync, linkSync, unlinkSync } from "node:fs";
import { resolve, dirname, isAbsolute } from "node:path";
import { batchDeliverySchema, billSchema, deliverySchema } from "./validation";
import { calculateRepayment } from "./interest";
import { jewelleryChoices, jewelleryKey, jewelleryNameSchema } from "./jewellery";
import { isAccountSlot } from "./account-url";
import { profileSchema } from "./profile-validation";
import { customerSchema, type Customer } from "./customers";

type Row = Record<string, any>;
type Result = { data: any; error: Error | null; count?: number | null };
const tables = new Set(["business_profiles", "bills", "bill_items"]);
const connections = new Map<string, DatabaseSync>();
export const localOwnerId = "local-owner";
export function localDataDirectory() { return resolve(process.env.LOCAL_DATA_DIR || resolve(process.cwd(), "data")); }
function failure(error: unknown) { return { data: null, error: error instanceof Error ? error : new Error(String(error)), count: null }; }

/** Server-only, durable local ledger. Transactions serialize numbering and corrections. */
export function createLocalDatabase(directory = localDataDirectory()) {
  const root = resolve(directory); mkdirSync(root, { recursive: true });
  const filename = resolve(root, "billing.sqlite");
  let db = connections.get(filename);
  if (!db) {
    db = new DatabaseSync(filename);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS records (table_name TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(table_name,id)); CREATE UNIQUE INDEX IF NOT EXISTS profile_account ON records(json_extract(body,'$.owner_id'), json_extract(body,'$.account_slot')) WHERE table_name='business_profiles'; CREATE UNIQUE INDEX IF NOT EXISTS bill_number ON records(json_extract(body,'$.profile_id'), json_extract(body,'$.bill_number')) WHERE table_name='bills'; CREATE UNIQUE INDEX IF NOT EXISTS replacement ON records(json_extract(body,'$.replacement_for_id')) WHERE table_name='bills' AND json_extract(body,'$.replacement_for_id') IS NOT NULL;");
    db.prepare("UPDATE records AS profile SET body=json_set(body,'$.next_bill_number',1,'$.next_delivery_number',1,'$.updated_at',?) WHERE table_name='business_profiles' AND (json_extract(body,'$.next_bill_number') IS NOT 1 OR json_extract(body,'$.next_delivery_number') IS NOT 1) AND NOT EXISTS (SELECT 1 FROM records AS bill WHERE bill.table_name='bills' AND json_extract(bill.body,'$.profile_id')=profile.id)").run(new Date().toISOString());
    connections.set(filename, db);
  }
  const database = db;
  database.exec("CREATE TABLE IF NOT EXISTS jewellery_items (name_key TEXT PRIMARY KEY, name TEXT NOT NULL)");
  database.exec(`CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, profile_id TEXT NOT NULL,
    name TEXT NOT NULL, father_name TEXT NOT NULL, address TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '' CHECK(phone='' OR (length(phone)=10 AND phone NOT GLOB '*[^0-9]*')),
    aadhaar TEXT NOT NULL DEFAULT '' CHECK(aadhaar='' OR (length(aadhaar)=12 AND aadhaar NOT GLOB '*[^0-9]*')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS customers_profile ON customers(profile_id);
  CREATE UNIQUE INDEX IF NOT EXISTS customer_phone ON customers(profile_id,phone) WHERE phone<>'';
  CREATE UNIQUE INDEX IF NOT EXISTS customer_aadhaar ON customers(profile_id,aadhaar) WHERE aadhaar<>'';`);
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
    const profile = rows("business_profiles").find(row => row.owner_id === localOwnerId && row.account_slot === accountNumber);
    if (!profile) throw new Error("Set up this business account first.");
    return String(profile.id);
  };
  const toCustomer = (row: Row): Customer => ({ id: String(row.id), name: String(row.name), fatherName: String(row.father_name), address: String(row.address), phone: String(row.phone), aadhaar: String(row.aadhaar), createdAt: String(row.created_at), updatedAt: String(row.updated_at) });
  const nextDeliveryNumber = (profile: Row) => rows("bills").filter(bill => bill.profile_id === profile.id && /^\d+$/.test(String(bill.delivery_no ?? ""))).reduce((next, bill) => Math.max(next, Number(bill.delivery_no) + 1), Math.max(1, Number(profile.next_delivery_number) || 1));
  const issue = (ownerId: string, input: Row) => {
    const bill = billSchema.parse(input);
    if (bill.items.some(item => !item.metal)) throw new Error("Choose Gold or Silver for every item.");
    const profile = rows("business_profiles").find(p => p.owner_id === ownerId && p.account_slot === slot(input.accountSlot));
    if (!profile) throw new Error("Business profile is required");
    const nextBillNumber = hasBills(profile.id) ? profile.next_bill_number : 1;
    if (nextBillNumber >= 2147483647) throw new Error("Bill number limit reached");
    const now = new Date().toISOString(); const id = randomUUID();
    const cents = (key: "assessedValue" | "loanAmount") => bill.items.reduce((sum, item) => sum + Math.round(item[key] * 100), 0) / 100;
    save("bills", { id, profile_id: profile.id, bill_number: nextBillNumber, bill_date: bill.billDate, delivery_no: bill.deliveryNo || null, delivery_date: bill.deliveryDate || null, customer_name: bill.customerName, father_name: bill.fatherName, address: bill.address, phone: bill.phone, government_id: bill.governmentId || null, total_assessed_value: cents("assessedValue"), total_loan_amount: cents("loanAmount"), status: "issued", replacement_for_id: null, excel_sync_status: "pending", excel_sync_error: null, pdf_storage_path: null, pdf_error: null, created_at: now, voided_at: null, business_snapshot: { business_name: profile.business_name, address: profile.address, phone: profile.phone, logo_url: profile.logo_url, license_number: profile.license_number ?? null } });
    bill.items.forEach((item, index) => save("bill_items", { id: randomUUID(), bill_id: id, metal: item.metal, particulars: item.particulars, grams: item.grams, assessed_value: item.assessedValue, loan_amount: item.loanAmount, sort_order: index }));
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
    if (!["issued", "void"].includes(bill.status)) throw new Error("Delivery cannot be recorded for this bill status.");
    const input = deliverySchema.parse(delivery);
    if (input.deliveryDate < bill.bill_date) throw new Error("Delivery date cannot be before the bill date.");
    const savedItems = rows("bill_items").filter(item => item.bill_id === bill.id).sort((left, right) => left.sort_order - right.sort_order);
    if (!savedItems.length) throw new Error("This bill has no pledged items.");
    if (input.itemMetals && input.itemMetals.length !== savedItems.length) throw new Error("The item list changed. Find the bill again.");
    const items = savedItems.map((item, index) => ({ metal: item.metal === "Gold" || item.metal === "Silver" ? item.metal : input.itemMetals?.[index] ?? undefined, particulars: String(item.particulars), grams: Number(item.grams), assessedValue: Number(item.assessed_value), loanAmount: Number(item.loan_amount) }));
    if (items.some(item => !item.metal)) throw new Error("Choose Gold or Silver for each item before saving delivery.");
    const summary = calculateRepayment(items, bill.bill_date, input.deliveryDate);
    const nextNumber = nextDeliveryNumber(profile);
    if (!bill.delivery_no && (!Number.isSafeInteger(nextNumber) || nextNumber >= 2147483647)) throw new Error("Delivery number limit reached.");
    const deliveryNo = bill.delivery_no || String(nextNumber);
    const now = new Date().toISOString();
    if (!bill.delivery_no) save("business_profiles", { ...profile, next_delivery_number: nextNumber + 1, updated_at: now });
    savedItems.forEach((item, index) => { if (!item.metal) save("bill_items", { ...item, metal: items[index].metal }); });
    const updated = { ...bill, delivery_no: deliveryNo, delivery_date: input.deliveryDate, delivery_summary: summary, excel_sync_status: "pending", excel_sync_error: null, pdf_storage_path: null, pdf_error: null, delivery_pdf_storage_path: null, delivery_pdf_error: null, updated_at: now };
    save("bills", updated);
    return { id: bill.id, previousPdfPath: bill.pdf_storage_path, previousDeliveryPdfPath: bill.delivery_pdf_storage_path, bill: { ...updated, bill_items: rows("bill_items").filter(item => item.bill_id === bill.id).sort((left, right) => left.sort_order - right.sort_order) } };
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
        result = result.slice(this.start, this.end === Infinity ? undefined : this.end + 1).map(row => {
          const joined = this.columns.includes("bill_items(") ? { ...row, bill_items: rows("bill_items").filter(item => item.bill_id === row.id).sort((a, b) => a.sort_order - b.sort_order) } : row;
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
    customers: {
      list: (account: number, search = ""): Customer[] => {
        const profileId = customerProfile(account);
        if (search.length > 200) throw new Error("Customer search is too long.");
        const query = search.trim().toLocaleLowerCase();
        return database.prepare("SELECT * FROM customers WHERE profile_id=? ORDER BY name COLLATE NOCASE, id").all(profileId)
          .map(toCustomer).filter(customer => !query || [customer.name, customer.fatherName, customer.address, customer.phone, customer.aadhaar].some(value => value.toLocaleLowerCase().includes(query)));
      },
      lookup: (account: number, identifiers: { phone?: string; aadhaar?: string }): Customer | null => {
        const profileId = customerProfile(account);
        const { phone, aadhaar } = customerSchema.pick({ phone: true, aadhaar: true }).parse(identifiers);
        if (!phone && !aadhaar) return null;
        const matches = database.prepare("SELECT * FROM customers WHERE profile_id=? AND ((?<>'' AND phone=?) OR (?<>'' AND aadhaar=?))").all(profileId, phone, phone, aadhaar, aadhaar).map(toCustomer);
        if (phone && aadhaar && matches.some(customer => customer.phone !== phone || customer.aadhaar !== aadhaar)) throw new Error("Phone and Aadhaar do not match the same customer.");
        return matches[0] ?? null;
      },
      save: (account: number, value: unknown, id?: string): Customer => {
        const input = customerSchema.parse(value);
        return transaction(() => {
          const profileId = customerProfile(account);
          const previous = id === undefined ? undefined : database.prepare("SELECT * FROM customers WHERE profile_id=? AND id=?").get(profileId, id);
          if (id !== undefined && !previous) throw new Error("Customer not found in this account.");
          const customerId = id ?? randomUUID();
          const duplicate = database.prepare("SELECT id FROM customers WHERE profile_id=? AND id<>? AND ((?<>'' AND phone=?) OR (?<>'' AND aadhaar=?))").get(profileId, customerId, input.phone, input.phone, input.aadhaar, input.aadhaar);
          if (duplicate) throw new Error("A customer with this phone or Aadhaar already exists in this account.");
          const now = new Date().toISOString();
          const customer: Customer = { ...input, id: customerId, createdAt: previous ? String(previous.created_at) : now, updatedAt: now };
          database.prepare("INSERT INTO customers(id,profile_id,name,father_name,address,phone,aadhaar,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,father_name=excluded.father_name,address=excluded.address,phone=excluded.phone,aadhaar=excluded.aadhaar,updated_at=excluded.updated_at")
            .run(customer.id, profileId, customer.name, customer.fatherName, customer.address, customer.phone, customer.aadhaar, customer.createdAt, customer.updatedAt);
          return customer;
        });
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
        if (name === "create_bill") return issue(ownerId, parameters.p_bill);
        if (name === "get_next_delivery_number") {
          const profile = rows("business_profiles").find(profile => profile.owner_id === ownerId && profile.account_slot === slot(parameters.p_account_slot));
          if (!profile) throw new Error("Business profile is required.");
          return { number: nextDeliveryNumber(profile) };
        }
        if (name === "record_bill_delivery") return recordDelivery(ownerId, parameters.p_bill_id, parameters.p_account_slot, parameters.p_delivery);
        if (name === "record_bill_deliveries") {
          const input = batchDeliverySchema.parse(parameters.p_delivery);
          return input.deliveries.map(delivery => recordDelivery(ownerId, delivery.billId, parameters.p_account_slot, { deliveryDate: input.deliveryDate, itemMetals: delivery.itemMetals }));
        }
        if (name === "edit_bill") {
          const { bill: original, profile } = billOwner(ownerId, parameters.p_bill_id);
          if (original.status !== "issued") throw new Error("Only issued bills can be edited.");
          if (parameters.p_bill.accountSlot !== undefined && slot(parameters.p_bill.accountSlot) !== profile.account_slot) throw new Error("A bill must remain in its original account.");
          const input = billSchema.parse(parameters.p_bill);
          if (input.items.some(item => !item.metal)) throw new Error("Choose Gold or Silver for every item.");
          const total = (key: "assessedValue" | "loanAmount") => input.items.reduce((sum, item) => sum + Math.round(item[key] * 100), 0) / 100;
          const deliverySummary = input.deliveryNo && input.deliveryDate && input.deliveryDate >= input.billDate ? calculateRepayment(input.items, input.billDate, input.deliveryDate) : null;
          save("bills", { ...original, bill_date: input.billDate, delivery_no: input.deliveryNo || null, delivery_date: input.deliveryDate || null, delivery_summary: deliverySummary, customer_name: input.customerName, father_name: input.fatherName, address: input.address, phone: input.phone, government_id: input.governmentId === undefined ? original.government_id ?? null : input.governmentId || null, total_assessed_value: total("assessedValue"), total_loan_amount: total("loanAmount"), excel_sync_status: "pending", excel_sync_error: null, pdf_storage_path: null, pdf_error: null, delivery_pdf_storage_path: null, delivery_pdf_error: null, updated_at: new Date().toISOString() });
          database.prepare("DELETE FROM records WHERE table_name='bill_items' AND json_extract(body,'$.bill_id')=?").run(original.id);
          input.items.forEach((item, index) => save("bill_items", { id: randomUUID(), bill_id: original.id, metal: item.metal, particulars: item.particulars, grams: item.grams, assessed_value: item.assessedValue, loan_amount: item.loanAmount, sort_order: index }));
          return { id: original.id, previousPdfPath: original.pdf_storage_path, previousDeliveryPdfPath: original.delivery_pdf_storage_path };
        }
        if (name === "delete_bill") {
          const { bill, profile } = billOwner(ownerId, parameters.p_bill_id);
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
