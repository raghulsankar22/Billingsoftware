import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalDatabase, localOwnerId } from "./local-database";

const bill = { billDate: "2026-10-03", customerName: "A,B (Gold)", fatherName: "Parent", address: "123 Main Street", phone: "1234567890", items: [{ particulars: "Gold ring", grams: 1.125, assessedValue: 10.11, loanAmount: 8.01 }, { particulars: "Silver ring", grams: 2, assessedValue: 20.22, loanAmount: 9.02 }] };
const opened: { directory: string; db: ReturnType<typeof createLocalDatabase> }[] = [];
function open() { const directory = mkdtempSync(join(tmpdir(), "billing-local-")); const db = createLocalDatabase(directory); opened.push({ directory, db }); return db; }
async function profile(db: ReturnType<typeof open>, accountSlot = 1, nextBillNumber = 1) { const result = await db.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { businessName: "Finance", address: "123 Main Street", phone: "1234567890", accountSlot, nextBillNumber } }); expect(result.error).toBeNull(); return result.data; }
async function issue(db: ReturnType<typeof open>, input = bill) { return db.rpc("create_bill", { p_owner_id: localOwnerId, p_bill: input }); }
afterEach(() => { for (const { directory, db } of opened.splice(0)) { db.close(); rmSync(directory, { recursive: true, force: true }); } });

describe("durable local ledger", () => {
  it("serializes numbering, calculates exact cents, keeps snapshots and isolates accounts", async () => {
    const db = open(); const first = await profile(db, 1, 100); const second = await profile(db, 2, 50);
    const results = await Promise.all(Array.from({ length: 12 }, () => issue(db)));
    expect(results.every(result => !result.error)).toBe(true);
    const rows = await db.from("bills").select("*, bill_items(*)").eq("profile_id", first.id).order("bill_number");
    expect(rows.data.map((row: any) => row.bill_number)).toEqual(Array.from({ length: 12 }, (_, index) => index + 100));
    expect(rows.data[0]).toMatchObject({ total_assessed_value: 30.33, total_loan_amount: 17.03, business_snapshot: { business_name: "Finance" } });
    expect(rows.data[0].bill_items).toHaveLength(2);
    expect((await profile(db, 1, 1)).next_bill_number).toBe(112);
    expect((await db.from("bills").select().eq("profile_id", second.id)).data).toEqual([]);
  });
  it("rolls back a failed replacement and never consumes its number", async () => {
    const db = open(); const saved = await profile(db); const first = await issue(db);
    const failed = await db.rpc("replace_bill", { p_owner_id: localOwnerId, p_original_id: first.data.id, p_bill: { ...bill, items: [{ ...bill.items[0], loanAmount: -1 }] } });
    expect(failed.error).toBeTruthy();
    expect((await db.from("bills").select().eq("id", first.data.id).single()).data.status).toBe("issued");
    expect((await db.from("business_profiles").select().eq("id", saved.id).single()).data.next_bill_number).toBe(2);
    const replacement = await db.rpc("replace_bill", { p_owner_id: localOwnerId, p_original_id: first.data.id, p_bill: bill });
    expect(replacement.error).toBeNull();
    expect((await db.from("bills").select().eq("id", replacement.data.id).single()).data).toMatchObject({ bill_number: 2, replacement_for_id: first.data.id });
    expect((await db.rpc("replace_bill", { p_owner_id: localOwnerId, p_original_id: first.data.id, p_bill: bill })).error).toBeTruthy();
  });
  it("preserves SQLite and immutable PDFs across reopen and rejects traversal", async () => {
    const db = open(); await profile(db); await issue(db); const bytes = new Uint8Array([37, 80, 68, 70]);
    expect((await db.storage.from("bill-pdfs").upload("profile/bill.pdf", bytes)).error).toBeNull();
    expect((await db.storage.from("bill-pdfs").upload("profile/bill.pdf", new Uint8Array([0]))).error).toBeTruthy();
    expect((await db.storage.from("bill-pdfs").upload("../escaped.pdf", bytes)).error).toBeTruthy();
    const entry = opened[0]; db.close(); entry.db = createLocalDatabase(entry.directory);
    expect((await entry.db.from("bills").select()).data).toHaveLength(1);
    const pdf = await entry.db.storage.from("bill-pdfs").download("profile/bill.pdf");
    expect(new Uint8Array(await pdf.data!.arrayBuffer())).toEqual(bytes);
  });
  it("supports literal history search, count, paging and conditional void", async () => {
    const db = open(); await profile(db); const created = await issue(db); await issue(db);
    const result = await db.from("bills").select("*, bill_items(*)", { count: "exact" }).or(`customer_name.imatch.${JSON.stringify("A,B \\(Gold\\)")},bill_number.eq.999`).gte("bill_date", "2026-10-01").lte("bill_date", "2026-10-04").order("bill_number", { ascending: false }).range(0, 0);
    expect(result.count).toBe(2); expect(result.data).toHaveLength(1); expect(result.data[0].bill_number).toBe(2);
    expect((await db.from("bills").update({ status: "void" }).eq("id", created.data.id).eq("status", "issued").select("id,bill_number").maybeSingle()).data).toMatchObject({ id: created.data.id, bill_number: 1 });
    expect((await db.from("bills").update({ status: "void" }).eq("id", created.data.id).eq("status", "issued").maybeSingle()).data).toBeNull();
  });
});
