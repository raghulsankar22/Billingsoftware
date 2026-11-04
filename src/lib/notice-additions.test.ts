import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalDatabase, localOwnerId } from "./local-database";

let counter = 0;
// Each customer gets their own phone number, because one number may belong to only one customer.
const input = (customerName: string) => ({ billDate: "2025-06-10", customerName, fatherName: "Parent", address: "123 Main Street", phone: `98765${String(++counter).padStart(5, "0")}`, items: [{ metal: "Gold", particulars: "Gold ring", grams: 2, assessedValue: 1100, loanAmount: 1000 }] });
const opened: { directory: string; db: ReturnType<typeof createLocalDatabase> }[] = [];
function open() { const directory = mkdtempSync(join(tmpdir(), "billing-notice-")); const db = createLocalDatabase(directory); opened.push({ directory, db }); return db; }
async function profile(db: ReturnType<typeof open>, accountSlot: number) {
  const result = await db.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { businessName: `Finance ${accountSlot}`, address: "123 Main Street", phone: "1234567890", accountSlot, nextBillNumber: 1 } });
  expect(result.error).toBeNull(); return String(result.data.id);
}
async function issue(db: ReturnType<typeof open>, accountSlot: number, name: string) {
  const result = await db.rpc("create_bill", { p_owner_id: localOwnerId, p_bill: { ...input(name), accountSlot } });
  expect(result.error).toBeNull(); return String(result.data.id);
}
afterEach(() => { for (const { directory, db } of opened.splice(0)) { db.close(); rmSync(directory, { recursive: true, force: true }); } });

describe("bills added by hand to a notice list", () => {
  it("remembers added bills per business account, month and notice, and ignores repeats", async () => {
    const db = open();
    const one = await profile(db, 1); const two = await profile(db, 2);
    const first = await issue(db, 1, "First Customer"); const second = await issue(db, 1, "Second Customer");
    expect(db.noticeAdditions.list(one, "2026-11", 1)).toEqual([]);
    db.noticeAdditions.add(one, "2026-11", 1, first);
    db.noticeAdditions.add(one, "2026-11", 1, first);
    db.noticeAdditions.add(one, "2026-11", 1, second);
    expect(db.noticeAdditions.list(one, "2026-11", 1).sort()).toEqual([first, second].sort());
    expect(db.noticeAdditions.list(one, "2026-11", 2)).toEqual([]);
    expect(db.noticeAdditions.list(one, "2026-12", 1)).toEqual([]);
    expect(db.noticeAdditions.list(two, "2026-11", 1)).toEqual([]);
  });

  it("refuses a bill that is not in the business account, and keeps the notice length rules", async () => {
    const db = open();
    const one = await profile(db, 1); const two = await profile(db, 2);
    const other = await issue(db, 2, "Other Account");
    expect(() => db.noticeAdditions.add(one, "2026-11", 1, other)).toThrow(/not found in this business account/);
    expect(() => db.noticeAdditions.add(one, "2026-11", 1, "missing")).toThrow(/not found/);
    const mine = await issue(db, 1, "Mine");
    expect(() => db.noticeAdditions.add(one, "November", 1, mine)).toThrow();
    expect(() => db.noticeAdditions.add(one, "2026-11", 3, mine)).toThrow();
    expect(db.noticeAdditions.list(two, "2026-11", 1)).toEqual([]);
  });

  it("takes a bill off the list without touching the bill, and forgets a bill that is deleted", async () => {
    const db = open();
    const one = await profile(db, 1);
    const kept = await issue(db, 1, "Kept"); const removed = await issue(db, 1, "Deleted");
    db.noticeAdditions.add(one, "2026-11", 2, kept);
    db.noticeAdditions.add(one, "2026-11", 2, removed);
    db.noticeAdditions.remove(one, "2026-11", 2, kept);
    expect(db.noticeAdditions.list(one, "2026-11", 2)).toEqual([removed]);
    const bills = await db.from("bills").select("*").eq("profile_id", one);
    expect(bills.data.map((row: { id: string }) => row.id).sort()).toEqual([kept, removed].sort());
    expect((await db.rpc("delete_bill", { p_owner_id: localOwnerId, p_bill_id: removed })).error).toBeNull();
    expect(db.noticeAdditions.list(one, "2026-11", 2)).toEqual([]);
  });
});
