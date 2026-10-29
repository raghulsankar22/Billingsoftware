import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { customerSchema, normalizeAadhaar, normalizePhone } from "./customers";
import { createLocalDatabase, localOwnerId } from "./local-database";

const details = { name: "Test Customer", fatherName: "Test Parent", address: "123 Test Street", phone: "9876543210", aadhaar: "123456789012" };
const opened: { directory: string; db: ReturnType<typeof createLocalDatabase> }[] = [];
function open() {
  const directory = mkdtempSync(join(tmpdir(), "billing-customers-"));
  const entry = { directory, db: createLocalDatabase(directory) };
  opened.push(entry); return entry;
}
async function profile(db: ReturnType<typeof createLocalDatabase>, accountSlot = 1) {
  const result = await db.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { businessName: "Test Finance", address: "123 Business Street", phone: "1234567890", accountSlot } });
  expect(result.error).toBeNull();
}
afterEach(() => {
  for (const { directory, db } of opened.splice(0)) { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

describe("customer validation", () => {
  it("normalizes formatted identifiers and trims required details", () => {
    expect(customerSchema.parse({ ...details, name: " Test Customer ", phone: "+91 (98765) 43210", aadhaar: "1234-5678 9012" })).toEqual(details);
    expect(normalizePhone("91 98765 43210")).toBe(details.phone);
    expect(normalizeAadhaar(" 1234 5678-9012 ")).toBe(details.aadhaar);
    expect(customerSchema.parse({ name: details.name, fatherName: details.fatherName, address: details.address })).toMatchObject({ phone: "", aadhaar: "" });
  });
  it("rejects short numbers, unexpected characters, incomplete details and oversized fields", () => {
    for (const patch of [{ name: " " }, { fatherName: " " }, { address: " " }, { phone: "1234567" }, { phone: "987654321x" }, { phone: "+449876543210" }, { aadhaar: "12345678901" }, { aadhaar: "1234x56789012" }, { phone: " ".repeat(81) }, { name: "x".repeat(121) }]) {
      expect(customerSchema.safeParse({ ...details, ...patch }).success).toBe(false);
    }
  });
});

describe("durable account customer records", () => {
  it("serializes simultaneous migrations and customer allocation with an older writer", async () => {
    const entry = open(); await profile(entry.db);
    const profileId = (await entry.db.from("business_profiles").select().single()).data.id;
    entry.db.close();
    const legacy = new DatabaseSync(join(entry.directory, "billing.sqlite"));
    legacy.exec(`DROP TABLE customers; DROP TABLE customer_number_sequence;
      CREATE TABLE customers (id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,name TEXT NOT NULL,father_name TEXT NOT NULL,address TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',aadhaar TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
    legacy.close();
    const script = `
      const { workerData, parentPort } = require("node:worker_threads");
      const { createRequire } = require("node:module");
      const taskRequire = createRequire(workerData.modulePath);
      const ts = taskRequire("typescript");
      const fs = require("node:fs");
      require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
      const { createLocalDatabase } = taskRequire(workerData.modulePath);
      parentPort.once("message", () => {
        let db;
        try {
          db = createLocalDatabase(workerData.directory);
          for (let index = 0; index < 6; index++) db.customers.save(1, { ...workerData.details, phone: "", aadhaar: "" });
          parentPort.postMessage({ done: true });
        } catch (error) { parentPort.postMessage({ error: error.message }); }
        finally { db?.close(); }
      });
      parentPort.postMessage({ ready: true });
    `;
    const workers = Array.from({ length: 3 }, () => new Worker(script, { eval: true, workerData: { modulePath: join(process.cwd(), "src/lib/local-database.ts"), directory: entry.directory, details } }));
    try {
      await Promise.all(workers.map(worker => new Promise<void>((resolve, reject) => { worker.once("message", () => resolve()); worker.once("error", reject); })));
      const results = workers.map(worker => new Promise<{ done?: boolean; error?: string }>((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); }));
      workers.forEach(worker => worker.postMessage("go"));
      expect(await Promise.all(results)).toEqual([{ done: true }, { done: true }, { done: true }]);
    } finally {
      await Promise.all(workers.map(worker => worker.terminate()));
      entry.db = createLocalDatabase(entry.directory);
    }
    const oldWriter = new DatabaseSync(join(entry.directory, "billing.sqlite"));
    oldWriter.prepare("INSERT INTO customers(id,profile_id,name,father_name,address,created_at,updated_at) VALUES('old-writer',?,'Legacy','Parent','123 Street','2026-01-01','2026-01-01')").run(profileId);
    oldWriter.close();
    expect(entry.db.customers.list(1).map(customer => customer.customerCode).sort()).toEqual(Array.from({ length: 19 }, (_, index) => `C${String(index + 1).padStart(6, "0")}`));
  }, 20_000);
  it("allocates global stable codes and never reuses a deleted customer's number", async () => {
    const entry = open(); await profile(entry.db); await profile(entry.db, 2);
    const first = entry.db.customers.save(1, details);
    const second = entry.db.customers.save(2, details);
    expect(first.customerCode).toBe("C000001");
    expect(second.customerCode).toBe("C000002");
    expect(entry.db.customers.save(1, { ...details, name: "Changed" }, first.id).customerCode).toBe(first.customerCode);
    expect(entry.db.customers.list(1, "c000001")).toMatchObject([{ id: first.id }]);
    expect(entry.db.customers.list(2, first.customerCode)).toEqual([]);
    const external = new DatabaseSync(join(entry.directory, "billing.sqlite"));
    expect(() => external.prepare("UPDATE customers SET customer_number=NULL WHERE id=?").run(first.id)).toThrow("cannot be changed");
    expect(() => external.prepare("UPDATE customers SET customer_number=1 WHERE id=?").run(second.id)).toThrow();
    external.prepare("DELETE FROM customers WHERE id=?").run(second.id); external.close();
    entry.db.close(); entry.db = createLocalDatabase(entry.directory);
    expect(entry.db.customers.lookup(1, { phone: first.phone })?.customerCode).toBe(first.customerCode);
    expect(entry.db.customers.save(2, details).customerCode).toBe("C000003");
  });
  it("backfills legacy rows deterministically and numbers inserts from an older open writer", async () => {
    const entry = open(); await profile(entry.db); await profile(entry.db, 2);
    const profiles = (await entry.db.from("business_profiles").select().order("account_slot")).data;
    entry.db.close();
    const legacy = new DatabaseSync(join(entry.directory, "billing.sqlite"));
    legacy.exec(`DROP TABLE customers; DROP TABLE customer_number_sequence;
      CREATE TABLE customers (id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,name TEXT NOT NULL,father_name TEXT NOT NULL,address TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',aadhaar TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
    const insert = legacy.prepare("INSERT INTO customers(id,profile_id,name,father_name,address,created_at,updated_at) VALUES(?,?,?,?,?,?,?)");
    insert.run("b", profiles[0].id, "Later", "Parent", "123 Street", "2026-01-02", "2026-01-02");
    insert.run("c", profiles[1].id, "Same day second", "Parent", "123 Street", "2026-01-01", "2026-01-01");
    insert.run("a", profiles[0].id, "First", "Parent", "123 Street", "2026-01-01", "2026-01-01");
    entry.db = createLocalDatabase(entry.directory);
    expect(entry.db.customers.list(1).map(customer => [customer.id, customer.customerCode])).toEqual([["a", "C000001"], ["b", "C000003"]]);
    expect(entry.db.customers.list(2)[0].customerCode).toBe("C000002");
    // This statement was prepared before migration, like the installed desktop app.
    insert.run("d", profiles[0].id, "Legacy insert", "Parent", "123 Street", "2026-01-03", "2026-01-03");
    legacy.prepare("UPDATE customers SET name=? WHERE id=?").run("Legacy edit", "a");
    expect(entry.db.customers.list(1, "c000004")[0].id).toBe("d");
    expect(entry.db.customers.list(1, "Legacy edit")[0].customerCode).toBe("C000001");
    expect(entry.db.customers.save(1, details).customerCode).toBe("C000005");
    legacy.close();
    entry.db.close(); entry.db = createLocalDatabase(entry.directory);
    expect(entry.db.customers.list(1, "c000004")[0].id).toBe("d");
    expect(entry.db.customers.save(2, details).customerCode).toBe("C000006");
  });
  it("validates customer bill links by account and snapshots the server's code through edits", async () => {
    const { db } = open(); await profile(db); await profile(db, 2);
    const first = db.customers.save(1, details);
    const other = db.customers.save(2, details);
    const second = db.customers.save(1, { ...details, phone: "", aadhaar: "" });
    const bill = { billDate: "2026-10-29", customerName: details.name, fatherName: details.fatherName, address: details.address, phone: details.phone, items: [{ metal: "Gold", particulars: "Ring", grams: 1, assessedValue: 100, loanAmount: 80 }] };
    const call = (name: string, patch: object, id?: string) => db.rpc(name, { p_owner_id: localOwnerId, p_bill_id: id, p_bill: { ...bill, ...patch } });
    for (const customerId of [other.id, "00000000-0000-4000-8000-000000000000", "C000001"]) {
      expect((await call("create_bill", { customerId })).error).not.toBeNull();
    }
    expect((await db.from("bills").select()).data).toHaveLength(0);
    const created = await call("create_bill", { customerId: first.id, customerCode: "C999999" });
    expect(created.error).toBeNull();
    const read = async () => (await db.from("bills").select().eq("id", created.data.id).single()).data;
    expect(await read()).toMatchObject({ bill_number: 1, customer_id: first.id, customer_code: first.customerCode });
    expect((await call("edit_bill", { customerId: other.id }, created.data.id)).error).not.toBeNull();
    expect((await call("edit_bill", {}, created.data.id)).error).toBeNull();
    expect(await read()).toMatchObject({ customer_id: first.id, customer_code: first.customerCode });
    expect((await call("edit_bill", { customerId: second.id, customerCode: "C999999" }, created.data.id)).error).toBeNull();
    expect(await read()).toMatchObject({ customer_id: second.id, customer_code: second.customerCode });
    expect((await call("edit_bill", { customerId: "" }, created.data.id)).error).toBeNull();
    expect(await read()).toMatchObject({ customer_id: null, customer_code: null });
    expect((await call("create_bill", {})).error).toBeNull();
  });
  it("adds customer storage to an existing ledger and keeps records through close/reopen", async () => {
    const entry = open(); await profile(entry.db);
    entry.db.close();
    const oldLedger = new DatabaseSync(join(entry.directory, "billing.sqlite"));
    oldLedger.exec("DROP TABLE customers"); oldLedger.close();
    entry.db = createLocalDatabase(entry.directory);
    const saved = entry.db.customers.save(1, { ...details, phone: "+91 98765-43210", aadhaar: "1234 5678 9012" });
    expect(saved).toMatchObject(details);
    entry.db.close(); entry.db = createLocalDatabase(entry.directory);
    expect(entry.db.customers.lookup(1, { phone: "+91 (98765) 43210" })).toEqual(saved);
    expect(entry.db.customers.lookup(1, { aadhaar: "1234-5678-9012" })).toEqual(saved);
    expect(entry.db.customers.list(1, "test parent")).toEqual([saved]);
    expect(entry.db.customers.list(1, "unmatched")).toEqual([]);
    expect((await entry.db.from("business_profiles").select()).data).toHaveLength(1);
  });
  it("requires a local owner's existing profile and isolates records and edits by account", async () => {
    const { db, directory } = open();
    expect(() => db.customers.save(1, details)).toThrow("Set up");
    await profile(db); await profile(db, 2);
    const first = db.customers.save(1, details);
    expect(db.customers.list(2)).toEqual([]);
    expect(db.customers.lookup(2, { phone: details.phone })).toBeNull();
    expect(() => db.customers.save(2, { ...details, name: "Other" }, first.id)).toThrow("this account");
    const other = db.customers.save(2, { ...details, name: "Other" });
    expect(db.customers.list(1)).toEqual([first]);
    expect(db.customers.list(2)).toEqual([other]);
    expect(() => db.customers.list(0)).toThrow("valid business account");
    const external = new DatabaseSync(join(directory, "billing.sqlite"));
    external.prepare("UPDATE records SET body=json_set(body,'$.owner_id','other-owner') WHERE table_name='business_profiles' AND json_extract(body,'$.account_slot')=2").run(); external.close();
    expect(() => db.customers.list(2)).toThrow("Set up");
  });
  it("rejects duplicate normalized identifiers, rolls back edits and enforces SQL uniqueness", async () => {
    const { db, directory } = open(); await profile(db);
    const first = db.customers.save(1, details);
    const second = db.customers.save(1, { ...details, name: "Second", phone: "9876543211", aadhaar: "123456789013" });
    expect(() => db.customers.save(1, { ...details, phone: "+91 98765 43210", aadhaar: "" })).toThrow("already exists");
    expect(() => db.customers.save(1, { ...details, phone: "", aadhaar: "1234-5678-9012" })).toThrow("already exists");
    expect(() => db.customers.save(1, { ...second, phone: first.phone }, second.id)).toThrow("already exists");
    expect(db.customers.lookup(1, { phone: second.phone })).toEqual(second);
    const external = new DatabaseSync(join(directory, "billing.sqlite"));
    expect(() => external.prepare("UPDATE customers SET phone=? WHERE id=?").run(first.phone, second.id)).toThrow();
    external.close();
    const changed = db.customers.save(1, { ...first, name: "Updated Customer", phone: "", aadhaar: "" }, first.id);
    expect(changed).toMatchObject({ id: first.id, createdAt: first.createdAt, name: "Updated Customer", phone: "", aadhaar: "" });
    expect(db.customers.lookup(1, { phone: first.phone })).toBeNull();
    expect(db.customers.save(1, details).id).not.toBe(first.id);
  });
  it("never autofills on partial or conflicting identifiers and allows optional identifiers", async () => {
    const { db } = open(); await profile(db);
    const first = db.customers.save(1, details);
    const second = db.customers.save(1, { ...details, phone: "9876543211", aadhaar: "123456789013" });
    expect(db.customers.lookup(1, { phone: first.phone, aadhaar: first.aadhaar })).toEqual(first);
    expect(() => db.customers.lookup(1, { phone: first.phone, aadhaar: second.aadhaar })).toThrow("same customer");
    expect(() => db.customers.lookup(1, { phone: first.phone, aadhaar: "999999999999" })).toThrow("same customer");
    expect(() => db.customers.lookup(1, { phone: "98765" })).toThrow();
    expect(db.customers.lookup(1, { phone: "9876543219" })).toBeNull();
    expect(db.customers.lookup(1, {})).toBeNull();
    db.customers.save(1, { ...details, phone: "", aadhaar: "" });
    db.customers.save(1, { ...details, phone: "", aadhaar: "" });
    expect(db.customers.list(1)).toHaveLength(4);
    const phoneOnly = db.customers.save(1, { ...details, phone: "9876543212", aadhaar: "" });
    const aadhaarOnly = db.customers.save(1, { ...details, phone: "", aadhaar: "123456789014" });
    expect(db.customers.lookup(1, { phone: phoneOnly.phone })).toEqual(phoneOnly);
    expect(db.customers.lookup(1, { aadhaar: aadhaarOnly.aadhaar })).toEqual(aadhaarOnly);
  });
  it("preserves an existing bill ID when omitted on edit and saves or clears an explicit ID", async () => {
    const { db } = open(); await profile(db);
    const bill = { billDate: "2026-10-29", customerName: details.name, fatherName: details.fatherName, address: details.address, phone: details.phone, items: [{ metal: "Gold", particulars: "Gold ring", grams: 1, assessedValue: 100, loanAmount: 80 }] };
    const created = await db.rpc("create_bill", { p_owner_id: localOwnerId, p_bill: { ...bill, governmentId: details.aadhaar } });
    expect(created.error).toBeNull();
    for (const [patch, expected] of [[{}, details.aadhaar], [{ governmentId: "123456789013" }, "123456789013"], [{ governmentId: "" }, null]] as const) {
      const result = await db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: created.data.id, p_bill: { ...bill, ...patch } });
      expect(result.error).toBeNull();
      expect((await db.from("bills").select().eq("id", created.data.id).single()).data.government_id).toBe(expected);
    }
  });
});
