import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createLocalDatabase, localOwnerId } from "./local-database";
import { runAsLocalUser } from "./local-session-context";
import { withBillAuditReason } from "./bill-audit";

const opened: { directory: string; db: ReturnType<typeof createLocalDatabase> }[] = [];
const input = { billDate: "2026-01-01", customerName: "Private Customer", fatherName: "Private Parent", address: "Private Street 123", phone: "9876543210", governmentId: "123456789012", items: [{ metal: "Gold", particulars: "Private Jewellery", remarks: "Private marks", grams: 2, assessedValue: 110, loanAmount: 100 }] };
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "billing-history-")), db = createLocalDatabase(directory); opened.push({ directory, db });
  for (const accountSlot of [1, 2]) expect((await db.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { accountSlot, businessName: "Sample Finance", address: "123 Sample Road", phone: "1234567890" } })).error).toBeNull();
  return { directory, db };
}
afterEach(() => { for (const { directory, db } of opened.splice(0)) { db.close(); rmSync(directory, { recursive: true, force: true }); } });
describe("private append-only bill history", () => {
  it("records the signed-in actor and safe reason atomically, without personal text", async () => {
    const { directory, db } = await setup();
    const issued = await runAsLocalUser({ id: randomUUID(), username: "cashier", administrator: false, legacyData: false }, () => db.rpc("create_bill", { p_owner_id: localOwnerId, p_bill: input }));
    expect(issued.error).toBeNull();
    expect(db.history(1).entries[0]).toMatchObject({ action: "Created", actor: "cashier", billNumber: 1, loan: 100 });
    const edited = await withBillAuditReason("customer_request", () => db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: issued.data.id, p_bill: { ...input, address: "Different Private Street" } }));
    expect(edited.error).toBeNull(); expect(db.history(1).entries[0]).toMatchObject({ action: "Edited", reason: "Customer requested correction", changes: ["Customer details"] });
    const before = db.history(1).total;
    expect((await db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: issued.data.id, p_bill: { ...input, items: [] } })).error).not.toBeNull();
    expect(db.history(1).total).toBe(before); expect(db.history(2).entries).toEqual([]);
    const raw = new DatabaseSync(join(directory, "billing.sqlite"));
    try {
      const contents = JSON.stringify(raw.prepare("SELECT * FROM bill_history").all());
      for (const text of [input.customerName, input.fatherName, input.address, input.phone, input.governmentId, "Private Jewellery", "Private marks"]) expect(contents).not.toContain(text);
      expect(() => raw.exec("DELETE FROM bill_history")).toThrow(/read-only/); expect(() => raw.exec("UPDATE bill_history SET actor='someone'" )).toThrow(/read-only/);
    } finally { raw.close(); }
  });
  it("records jewellery-only edits, voids and deletes, retains deleted IDs when numbers are reused, and ignores output refreshes", async () => {
    const { db } = await setup();
    const created = await db.rpc("create_bill", { p_owner_id: localOwnerId, p_bill: input });
    await db.from("bills").update({ excel_sync_status: "synced" }).eq("id", created.data.id);
    expect(db.history(1).total).toBe(1);
    await db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: created.data.id, p_bill: { ...input, items: [{ ...input.items[0], particulars: "Changed Jewellery" }] } });
    expect(db.history(1).entries[0].changes).toContain("Jewellery details");
    await db.from("bills").update({ status: "void" }).eq("id", created.data.id);
    expect(db.history(1).entries[0].action).toBe("Voided");
    await withBillAuditReason("duplicate", () => db.rpc("delete_bill", { p_owner_id: localOwnerId, p_bill_id: created.data.id }));
    expect(db.history(1).entries[0]).toMatchObject({ action: "Deleted", billId: created.data.id, reason: "Duplicate entry" });
    const next = await db.rpc("create_bill", { p_owner_id: localOwnerId, p_bill: input });
    expect(next.data.id).not.toBe(created.data.id); expect(db.history(1, { billNumber: 1 }).total).toBe(5);
    expect(db.history(1, { billId: created.data.id }).total).toBe(4);
  });
  it("records delivery, cancellation and signed confirmations without storing collector details", async () => {
    const { db, directory } = await setup();
    const created = await db.rpc("create_bill", { p_owner_id: localOwnerId, p_bill: input });
    const delivered = await db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: created.data.id, p_account_slot: 1, p_delivery: { deliveryDate: "2026-02-02", billReceiptStatus: "has_bill", collectedByRelation: "self" } });
    expect(delivered.error).toBeNull(); expect(db.history(1).entries[0].action).toBe("Delivered");
    const cancelled = await db.rpc("cancel_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: created.data.id, p_account_slot: 1 });
    expect(cancelled.error).toBeNull(); expect(db.history(1).entries[0].action).toBe("Delivery cancelled");
    const lost = await db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: created.data.id, p_account_slot: 1, p_delivery: { deliveryDate: "2026-02-02", billReceiptStatus: "lost_bill", lostBillDeclarationSigned: true, collectedByRelation: "self" } });
    expect(lost.error).toBeNull();
    const fixture = new DatabaseSync(join(directory, "billing.sqlite"));
    try { fixture.prepare("UPDATE records SET body=json_set(body,'$.delivery_lost_bill_declared_at',NULL) WHERE id=? AND table_name='bills'").run(created.data.id); } finally { fixture.close(); }
    expect((await db.rpc("mark_lost_bill_declared", { p_owner_id: localOwnerId, p_bill_id: created.data.id, p_account_slot: 1 })).error).toBeNull();
    expect(db.history(1).entries[0]).toMatchObject({ action: "Declaration confirmed", changes: ["Signed declaration"] });
    const count = db.history(1).total;
    await db.rpc("mark_lost_bill_declared", { p_owner_id: localOwnerId, p_bill_id: created.data.id, p_account_slot: 1 });
    expect(db.history(1).total).toBe(count);
  });
});
