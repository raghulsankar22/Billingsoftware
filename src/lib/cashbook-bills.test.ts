import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createLocalDatabase, localOwnerId } from "./local-database";
import { createBackupPackage, verifyBackupPackage } from "./backup-package";

const roots: string[] = [];
const databases: ReturnType<typeof createLocalDatabase>[] = [];
const temp = () => { const root = mkdtempSync(join(tmpdir(), "billing-cash-integration-")); roots.push(root); return root; };
afterEach(() => { for (const database of databases.splice(0)) database.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const input = { billDate: "2026-10-01", customerName: "Sample Person", fatherName: "Sample Parent", address: "123 Sample Street", phone: "1234567890", items: [{ metal: "Gold", particulars: "Ring", grams: 10, assessedValue: 2000, loanAmount: 1000 }] };
async function fixture() {
  const root = temp(); const database = createLocalDatabase(root); databases.push(database);
  const rpc = (name: string, parameters: Record<string, unknown>) => database.rpc(name, { p_owner_id: localOwnerId, ...parameters });
  const profile = await rpc("save_business_profile", { p_profile: { businessName: "Sample Business", address: "123 Sample Street", phone: "1234567890", accountSlot: 1, nextBillNumber: 1 } }); expect(profile.error).toBeNull();
  const issue = async () => { const result = await rpc("create_bill", { p_bill: input }); expect(result.error).toBeNull(); return result.data.id as string; };
  const billId = await issue();
  const save = (value: Record<string, unknown>) => database.cashBook.post(1, { date: "2026-10-03", operationId: randomUUID(), ...value });
  save({ action: "opening", date: "2026-10-01", amount: 10000 });
  const payout = (id = billId) => save({ action: "entry", kind: "disbursement", date: "2026-10-01", method: "cash", amount: 1000, billId: id, note: "Actual payout" });
  const deliver = (id = billId) => rpc("record_bill_delivery", { p_bill_id: id, p_account_slot: 1, p_delivery: { deliveryDate: "2026-10-03", billReceiptStatus: "has_bill", collectedByRelation: "self" } });
  const collect = () => { const interest = database.cashBook.view(1, "2026-10-03").accounts[0].bills.find(bill => bill.id === billId)!.expectedInterest!; return save({ action: "entry", kind: "collection", method: "cash", amount: 1000 + interest, principal: 1000, interest, discount: 0, billId, note: "Received in full" }); };
  return { root, database, rpc, issue, billId, profile: profile.data, save, payout, deliver, collect };
}
describe("cash book integration with the existing ledger", () => {
  it("blocks financial corrections, voids, replacement and deletion but allows customer text and document sync", async () => {
    const context = await fixture(); context.payout();
    expect((await context.rpc("edit_bill", { p_bill_id: context.billId, p_bill: { ...input, billDate: "2026-10-02" } })).error?.message).toContain("confirmed money");
    expect((await context.rpc("edit_bill", { p_bill_id: context.billId, p_bill: { ...input, items: [{ ...input.items[0], loanAmount: 900 }] } })).error?.message).toContain("confirmed money");
    expect((await context.rpc("edit_bill", { p_bill_id: context.billId, p_bill: { ...input, customerName: "Corrected Person", address: "456 Sample Street" } })).error).toBeNull();
    expect((await context.database.from("bills").update({ excel_sync_status: "synced", pdf_error: null }).eq("id", context.billId)).error).toBeNull();
    expect((await context.database.from("bills").update({ status: "void" }).eq("id", context.billId)).error?.message).toContain("confirmed money");
    expect((await context.rpc("delete_bill", { p_bill_id: context.billId })).error?.message).toContain("confirmed money");
    expect((await context.rpc("replace_bill", { p_original_id: context.billId, p_bill: input })).error?.message).toContain("confirmed money");
    const entryId = context.database.cashBook.view(1, "2026-10-01").accounts[0].entries[0].id;
    context.save({ action: "reverse", entryId, note: "Incorrect bill payout" });
    expect((await context.rpc("delete_bill", { p_bill_id: context.billId })).error).toBeNull();
    const replacement = await context.issue(); expect(replacement).not.toBe(context.billId);
    context.payout(replacement);
    const report = context.database.cashBook.view(1, "2026-10-03").accounts[0];
    expect(report.entries[0]).toMatchObject({ billId: context.billId, billNumber: 1, reversesId: entryId });
  });
  it("allows delivery after payout, but protects collected delivery details and rolls back batch delivery", async () => {
    const context = await fixture(); context.payout(); expect((await context.deliver()).error).toBeNull(); context.collect();
    expect((await context.deliver()).error?.message).toContain("confirmed money");
    expect((await context.rpc("cancel_bill_delivery", { p_bill_id: context.billId, p_account_slot: 1 })).error?.message).toContain("confirmed money");
    const current = (await context.database.from("bills").select().eq("id", context.billId).single()).data;
    expect((await context.rpc("edit_bill", { p_bill_id: context.billId, p_bill: { ...input, deliveryNo: current.delivery_no, deliveryDate: current.delivery_date, fatherName: "Corrected Parent" } })).error).toBeNull();
    const second = await context.issue();
    const batch = await context.rpc("record_bill_deliveries", { p_account_slot: 1, p_delivery: { deliveryDate: "2026-10-03", deliveries: [{ billId: second, billReceiptStatus: "has_bill", collectedByRelation: "self" }, { billId: context.billId, billReceiptStatus: "has_bill", collectedByRelation: "self" }] } });
    expect(batch.error?.message).toContain("confirmed money");
    expect((await context.database.from("bills").select().eq("id", second).single()).data.delivery_no).toBeNull();
    const entryId = context.database.cashBook.view(1, "2026-10-03").accounts[0].entries[0].id;
    context.save({ action: "reverse", entryId, note: "Collection entered against wrong delivery" });
    expect((await context.rpc("cancel_bill_delivery", { p_bill_id: context.billId, p_account_slot: 1 })).error).toBeNull();
  });
  it("never guesses money for imported deliveries with missing historic fields", async () => {
    const context = await fixture();
    const imported = await context.rpc("import_historical_bills", { p_account_slot: 1, p_bills: [{ billNo: 50, billDate: "2026-10-01", deliveryNo: "OLD", deliveryDate: "2026-10-03", name: "Old Sample", address: "123 Old Street", particulars: "Ring", phone: "", amount: 500, metal: "Gold" }] });
    expect(imported.error).toBeNull();
    const report = context.database.cashBook.view(1, "2026-10-03").accounts[0];
    expect(report.entries).toHaveLength(0); expect(report.bills.find(bill => bill.billNumber === 50)).toMatchObject({ expectedInterest: null, collectionRecorded: false });
    expect((await context.rpc("edit_bill", { p_bill_id: imported.data.ids[0], p_bill: { ...input, customerName: "Corrected Old Sample", fatherName: "", phone: "", deliveryNo: "OLD", deliveryDate: "2026-10-03", items: [{ metal: "Gold", particulars: "Ring", grams: null, assessedValue: null, loanAmount: 500 }] } })).error).toBeNull();
  });
  it("refuses money writes for a sync-managed account", async () => {
    const context = await fixture();
    context.database.sync.saveAssignment(context.profile.id, randomUUID(), 1, context.database.sync.counters(context.profile.id));
    expect(() => context.payout()).toThrow("online sync");
    expect(context.database.cashBook.view(1, "2026-10-03").accounts[0].entries).toHaveLength(0);
  });
  it("preserves unknown delivery interest during cosmetic edits after confirmed collection and closing", async () => {
    const context = await fixture();
    const created = await context.rpc("create_bill", { p_bill: { ...input, deliveryNo: "9", deliveryDate: "2026-10-03" } }); expect(created.error).toBeNull();
    const billId = created.data.id;
    expect(context.database.cashBook.view(1, "2026-10-03").accounts[0].bills.find(bill => bill.id === billId)?.expectedInterest).toBeNull();
    context.save({ action: "entry", kind: "collection", method: "cash", amount: 1017, principal: 1000, interest: 17, discount: 0, billId, note: "Confirmed old receipt interest" });
    const before = context.database.cashBook.view(1, "2026-10-03").accounts[0];
    context.save({ action: "close", countedCash: before.expectedCash, revision: before.revision, note: "", acknowledgeUnrecorded: true });
    expect((await context.rpc("edit_bill", { p_bill_id: billId, p_bill: { ...input, deliveryNo: "9", deliveryDate: "2026-10-03", customerName: "Corrected Customer" } })).error).toBeNull();
    const after = context.database.cashBook.view(1, "2026-10-03").accounts[0];
    expect(after.bills.find(bill => bill.id === billId)?.expectedInterest).toBeNull();
    expect(after).toMatchObject({ expectedCash: before.expectedCash, countedCash: before.expectedCash, totals: { interestReceived: 17 } });
  });
  it("includes opening, journal, closing and retry history in complete SQLite backups", async () => {
    const context = await fixture(); context.payout();
    const view = context.database.cashBook.view(1, "2026-10-03");
    context.save({ action: "close", countedCash: 9000, revision: view.accounts[0].revision, note: "", acknowledgeUnrecorded: true });
    const folder = temp(); const destination = join(folder, "sample.billing-backup");
    await createBackupPackage(context.root, destination); expect(verifyBackupPackage(destination).preview.ledgerCount).toBe(1);
    const recovered = createLocalDatabase(destination); databases.push(recovered);
    expect(recovered.cashBook.view(1, "2026-10-03")).toEqual(context.database.cashBook.view(1, "2026-10-03"));
    expect(recovered.cashBook.view(1, "2026-10-01").accounts[0].entries).toHaveLength(1);
    expect(() => recovered.cashBook.post(1, { action: "opening", operationId: randomUUID(), date: "2026-10-01", amount: 0 })).toThrow("already set");
  });
});
