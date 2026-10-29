import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalDatabase, localOwnerId } from "./local-database";

let db: ReturnType<typeof createLocalDatabase>;
let directory: string;
const profileInput = { businessName: "Batch Finance", address: "123 Test Street", phone: "1234567890" };
async function open() {
  directory = mkdtempSync(join(tmpdir(), "billing-batch-")); db = createLocalDatabase(directory);
  await db.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { ...profileInput, accountSlot: 1 } });
}
async function loan(metal = "Gold", amount = 10000, accountSlot = 1, billDate = "2026-10-28") {
  const result = await db.rpc("create_bill", { p_owner_id: localOwnerId, p_bill: { accountSlot, billDate, customerName: "Test Customer", fatherName: "Test Parent", address: "123 Test Street", phone: "", items: [{ metal, particulars: "Ring 2, Studs 1", grams: 3, assessedValue: amount * 2, loanAmount: amount }] } });
  expect(result.error).toBeNull(); return result.data.id as string;
}
function deliver(ids: string[], deliveryDate = "2026-11-29") {
  return db.rpc("record_bill_deliveries", { p_owner_id: localOwnerId, p_account_slot: 1, p_delivery: { deliveryDate, deliveries: ids.map(billId => ({ billId })) } });
}
afterEach(() => { db?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });

describe("atomic multiple bill deliveries", () => {
  it("saves separate delivery numbers, interest and void status and reuses numbers on retry", async () => {
    await open();
    const ids = [await loan(), await loan("Silver", 2000), await loan("Gold", 5000)];
    await db.from("bills").update({ status: "void" }).eq("id", ids[1]);
    expect((await deliver(ids)).error).toBeNull();
    expect((await deliver(ids)).error).toBeNull();
    const rows = (await db.from("bills").select().order("bill_number")).data;
    expect(rows.map((row: any) => row.delivery_no)).toEqual(["1", "2", "3"]);
    expect(rows.map((row: any) => row.delivery_summary.interest)).toEqual([200, 60, 125]);
    expect(rows.reduce((sum: number, row: any) => sum + row.delivery_summary.total, 0)).toBe(17385);
    expect(rows[1].status).toBe("void");
    expect((await db.rpc("get_next_delivery_number", { p_owner_id: localOwnerId, p_account_slot: 1 })).data.number).toBe(4);
  });

  it("rolls back the whole batch and numbering when a later bill belongs to another account", async () => {
    await open();
    await db.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { ...profileInput, accountSlot: 2 } });
    const own = await loan(); const other = await loan("Silver", 2000, 2);
    expect((await deliver([own, other])).error?.message).toContain("this account");
    const rows = (await db.from("bills").select()).data;
    expect(rows.every((row: any) => !row.delivery_no)).toBe(true);
    expect((await db.rpc("get_next_delivery_number", { p_owner_id: localOwnerId, p_account_slot: 1 })).data.number).toBe(1);
    expect((await deliver([own])).error).toBeNull();
  });

  it("rejects duplicates and rolls back when a later bill has a future issue date", async () => {
    await open(); const own = await loan(); const future = await loan("Gold", 10000, 1, "2026-11-30");
    expect((await deliver([own, own])).error).toBeTruthy();
    expect((await deliver([own, future])).error?.message).toContain("before the bill date");
    expect((await db.from("bills").select()).data.every((row: any) => !row.delivery_no)).toBe(true);
    expect((await db.rpc("get_next_delivery_number", { p_owner_id: localOwnerId, p_account_slot: 1 })).data.number).toBe(1);
  });
});
