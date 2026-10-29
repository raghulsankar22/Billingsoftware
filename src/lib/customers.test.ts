import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
