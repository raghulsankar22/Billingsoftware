import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { accountSlots } from "./account-url";
import { createLocalDatabase, localOwnerId } from "./local-database";

const bill = { billDate: "2026-10-03", customerName: "A,B (Gold)", fatherName: "Parent", address: "123 Main Street", phone: "1234567890", items: [{ metal: "Gold", particulars: "Gold ring", grams: 1.125, assessedValue: 10.11, loanAmount: 8.01 }, { metal: "Silver", particulars: "Silver ring", grams: 2, assessedValue: 20.22, loanAmount: 9.02 }] };
const opened: { directory: string; db: ReturnType<typeof createLocalDatabase> }[] = [];
function open() { const directory = mkdtempSync(join(tmpdir(), "billing-local-")); const db = createLocalDatabase(directory); opened.push({ directory, db }); return db; }
async function profile(db: ReturnType<typeof open>, accountSlot = 1, nextBillNumber = 1) { const result = await db.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { businessName: "Finance", address: "123 Main Street", phone: "1234567890", accountSlot, nextBillNumber } }); expect(result.error).toBeNull(); return result.data; }
async function issue(db: ReturnType<typeof open>, input: Record<string, unknown> = bill) { return db.rpc("create_bill", { p_owner_id: localOwnerId, p_bill: input }); }
afterEach(() => { for (const { directory, db } of opened.splice(0)) { db.close(); rmSync(directory, { recursive: true, force: true }); } });

describe("durable local ledger", () => {
  it("returns one issued bill after a lost-response retry, including after reopening the ledger", async () => {
    let db = open(); const business = await profile(db); const operationId = randomUUID();
    const params = { p_owner_id: localOwnerId, p_operation_id: operationId, p_bill: { ...bill, accountSlot: 1 } };
    const first = await db.rpc("create_bill", params);
    expect(first.error).toBeNull();
    const entry = opened[0]; db.close(); entry.db = db = createLocalDatabase(entry.directory);
    const retry = await db.rpc("create_bill", params);
    expect(retry.error).toBeNull(); expect(retry.data.id).toBe(first.data.id);
    expect((await db.from("bills").select().eq("profile_id", business.id)).data).toHaveLength(1);
    expect((await db.from("business_profiles").select().eq("id", business.id).single()).data.next_bill_number).toBe(2);
    expect(db.history(1).entries.filter(entry => entry.action === "Created")).toHaveLength(1);
  });
  it("refuses reused issuance keys for changed requests, another account, or a deleted bill", async () => {
    const db = open(); await profile(db); await profile(db, 2); const operationId = randomUUID();
    const params = { p_owner_id: localOwnerId, p_operation_id: operationId, p_bill: { ...bill, accountSlot: 1 } };
    const first = await db.rpc("create_bill", params);
    expect((await db.rpc("create_bill", { ...params, p_bill: { ...params.p_bill, customerName: "Changed" } })).error?.message).toContain("different bill request");
    expect((await db.rpc("create_bill", { ...params, p_bill: { ...params.p_bill, accountSlot: 2 } })).error?.message).toContain("different bill request");
    expect((await db.rpc("delete_bill", { p_owner_id: localOwnerId, p_bill_id: first.data.id })).error).toBeNull();
    expect((await db.rpc("create_bill", params)).error?.message).toContain("deleted");
    expect((await db.from("bills").select()).data).toHaveLength(0);
  });
  it("atomically queues edits with their previous revision and handles retries safely", async () => {
    const db = open(); const business = await profile(db);
    const device = randomUUID(), createId = randomUUID(), editId = randomUUID();
    const untracked = await issue(db);
    expect(db.sync.counters(business.id)).toEqual({ nextBillNumber: 2, nextDeliveryNumber: 1 });
    db.sync.saveAssignment(business.id, device, 1, { nextBillNumber: 2, nextDeliveryNumber: 1 });
    const created = await db.rpc("create_bill_with_sync", { p_owner_id: localOwnerId, p_device_id: device, p_issuer_epoch: 1, p_operation_id: createId, p_bill: { ...bill, accountSlot: 1 } });
    expect(created.error).toBeNull();
    const params = { p_owner_id: localOwnerId, p_device_id: device, p_operation_id: editId, p_bill_id: created.data.id, p_bill: { ...bill, accountSlot: 1, customerName: "Updated Customer" } };
    expect((await db.rpc("edit_bill_with_sync", params)).error).toBeNull();
    const pending = db.sync.pending(business.id);
    expect(pending).toHaveLength(2);
    expect(pending[1]).toMatchObject({ id: editId, action: "update", baseOperationId: createId, payload: { billNumber: 2, customerName: "Updated Customer" } });
    expect((await db.rpc("edit_bill_with_sync", params)).error).toBeNull();
    expect((await db.rpc("edit_bill_with_sync", { ...params, p_bill: { ...params.p_bill, customerName: "Different" } })).error?.message).toContain("different bill edit");
    expect(db.sync.pending(business.id)).toHaveLength(2);
    const secondId = randomUUID();
    expect((await db.rpc("edit_bill_with_sync", { ...params, p_operation_id: secondId, p_bill: { ...params.p_bill, customerName: "Second Edit" } })).error).toBeNull();
    expect(db.sync.pending(business.id)[2]).toMatchObject({ id: secondId, baseOperationId: editId });
    const failed = await db.rpc("edit_bill_with_sync", { ...params, p_operation_id: randomUUID(), p_bill_id: untracked.data.id });
    expect(failed.error?.message).toContain("Sync this bill");
    expect((await db.from("bills").select().eq("id", untracked.data.id).single()).data.customer_name).toBe(bill.customerName);
    expect(db.sync.pending(business.id)).toHaveLength(3);
  });
  it("refuses every change outside the queue once an account joins sync, and leaves other accounts alone", async () => {
    const db = open(); const business = await profile(db); await profile(db, 2);
    const device = randomUUID(), params = { p_owner_id: localOwnerId };
    const before = await issue(db);
    db.sync.saveAssignment(business.id, device, 1, db.sync.counters(business.id));
    const refused = "uses online sync";
    expect((await issue(db)).error?.message).toContain(refused);
    expect((await db.rpc("edit_bill", { ...params, p_bill_id: before.data.id, p_bill: { ...bill, customerName: "Changed" } })).error?.message).toContain(refused);
    expect((await db.rpc("delete_bill", { ...params, p_bill_id: before.data.id })).error?.message).toContain(refused);
    expect((await db.rpc("replace_bill", { ...params, p_original_id: before.data.id, p_bill: bill })).error?.message).toContain(refused);
    expect((await db.rpc("record_bill_delivery", { ...params, p_bill_id: before.data.id, p_account_slot: 1, p_delivery: { deliveryDate: "2026-10-30", billReceiptStatus: "has_bill", collectedByRelation: "self" } })).error?.message).toContain(refused);
    expect((await db.rpc("record_bill_deliveries", { ...params, p_account_slot: 1, p_delivery: { deliveryDate: "2026-10-30", deliveries: [{ billId: before.data.id, billReceiptStatus: "has_bill", collectedByRelation: "self" }] } })).error?.message).toContain(refused);
    expect((await db.rpc("import_historical_bills", { ...params, p_account_slot: 1, p_bills: [{ billNo: 90, billDate: "2022-04-01", deliveryNo: "", deliveryDate: null, name: "Customer", address: "Street", particulars: "Ring", phone: "", amount: 100, metal: "Gold" }] })).error?.message).toContain(refused);
    expect((await db.from("bills").update({ status: "void" }).eq("id", before.data.id).select().maybeSingle()).error?.message).toContain(refused);
    const kept = (await db.from("bills").select().eq("id", before.data.id).single()).data;
    expect(kept).toMatchObject({ status: "issued", customer_name: bill.customerName, delivery_no: null });
    expect((await db.from("bills").select().eq("profile_id", business.id)).data).toHaveLength(1);
    expect((await issue(db, { ...bill, accountSlot: 2 })).error).toBeNull();
  });
  it("queues corrected delivery details with a synced edit", async () => {
    const db = open(); const business = await profile(db); const device = randomUUID(), createId = randomUUID();
    db.sync.saveAssignment(business.id, device, 1, { nextBillNumber: 1, nextDeliveryNumber: 1 });
    const created = await db.rpc("create_bill_with_sync", { p_owner_id: localOwnerId, p_device_id: device, p_issuer_epoch: 1, p_operation_id: createId, p_bill: { ...bill, accountSlot: 1 } });
    const edited = await db.rpc("edit_bill_with_sync", { p_owner_id: localOwnerId, p_device_id: device, p_operation_id: randomUUID(), p_bill_id: created.data.id, p_bill: { ...bill, deliveryNo: "7", deliveryDate: "2026-10-20" } });
    expect(edited.error).toBeNull();
    expect(db.sync.pending(business.id)[1].payload).toMatchObject({ deliveryNo: "7", deliveryDate: "2026-10-20" });
  });
  it("atomically issues and queues an offline bill only for the designated device", async () => {
    const db = open(); const business = await profile(db);
    const device = randomUUID(), otherDevice = randomUUID(), operationId = randomUUID();
    db.sync.saveAssignment(business.id, device, 1, { nextBillNumber: 1, nextDeliveryNumber: 1 });
    const params = { p_owner_id: localOwnerId, p_device_id: device, p_issuer_epoch: 1, p_operation_id: operationId, p_bill: { ...bill, accountSlot: 1 } };
    const first = await db.rpc("create_bill_with_sync", params);
    expect(first.error).toBeNull();
    const pending = db.sync.pending(business.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: operationId, deviceId: device, accountId: business.id, entityId: first.data.id, entityType: "bill", action: "create", issuerEpoch: 1, payload: { billNumber: 1, customerName: bill.customerName, items: [{ metal: "Gold", loanAmount: 8.01 }, { metal: "Silver", loanAmount: 9.02 }] } });
    const retry = await db.rpc("create_bill_with_sync", params);
    expect(retry.error).toBeNull(); expect(retry.data.id).toBe(first.data.id);
    expect(db.sync.pending(business.id)).toHaveLength(1);
    const altered = await db.rpc("create_bill_with_sync", { ...params, p_bill: { ...params.p_bill, customerName: "Different Customer" } });
    expect(altered.error?.message).toContain("different bill request");
    const other = await db.rpc("create_bill_with_sync", { ...params, p_device_id: otherDevice, p_operation_id: randomUUID() });
    expect(other.error?.message).toContain("does not have offline billing permission");
    expect((await db.from("business_profiles").select().eq("id", business.id).single()).data.next_bill_number).toBe(2);
    expect((await db.from("bills").select().eq("profile_id", business.id)).data).toHaveLength(1);
  });
  it("imports historical bills atomically, preserves missing delivery details and continues numbering", async () => {
    const db = open(); const business = await profile(db);
    const row = { billNo: 7001, billDate: "2022-04-01", deliveryNo: "6132", deliveryDate: "2022-05-01", name: "Customer", address: "Street", particulars: "Minor Chain", phone: "", amount: 11000, metal: "Gold" };
    const imported = await db.rpc("import_historical_bills", { p_owner_id: localOwnerId, p_account_slot: 1, p_bills: [row, { ...row, billNo: 7002, deliveryNo: "", deliveryDate: "2022-05-31" }, { ...row, billNo: 7003, deliveryNo: "", deliveryDate: null }] });
    expect(imported.error).toBeNull();
    const first = (await db.from("bills").select("*, bill_items(*)").eq("id", imported.data.ids[1]).single()).data;
    expect(first).toMatchObject({ bill_number: 7002, delivery_no: null, delivery_date: "2022-05-31", historical_delivery: true, historical_missing_details: true, father_name: null, total_assessed_value: null, total_loan_amount: 11000, bill_items: [{ grams: null, assessed_value: null, metal: "Gold" }] });
    const pending = (await db.from("bills").select().eq("id", imported.data.ids[2]).single()).data;
    expect(pending.historical_delivery).toBe(false);
    expect((await db.from("business_profiles").select().eq("id", business.id).single()).data).toMatchObject({ next_bill_number: 7004, next_delivery_number: 6133 });
    const duplicate = await db.rpc("import_historical_bills", { p_owner_id: localOwnerId, p_account_slot: 1, p_bills: [{ ...row, billNo: 8000 }, row] });
    expect(duplicate.error?.message).toContain("duplicated");
    expect((await db.from("bills").select().eq("profile_id", business.id)).data).toHaveLength(3);
    const next = await issue(db);
    expect((await db.from("bills").select().eq("id", next.data.id).single()).data.bill_number).toBe(7004);
  });
  it("won't save a delivery date before the bill date when creating or editing", async () => {
    const db = open(); await profile(db);
    const early = { ...bill, deliveryNo: "1", deliveryDate: "2026-10-02" };
    expect((await issue(db, early)).error?.message).toContain("before the bill date");
    const created = await issue(db);
    const edited = await db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: created.data.id, p_bill: early });
    expect(edited.error?.message).toContain("before the bill date");
    expect((await db.from("bills").select().eq("id", created.data.id).single()).data.delivery_no).toBeNull();
  });
  describe("register imports", () => {
    const row = { billNo: 1, billDate: "2022-04-01", deliveryNo: "", deliveryDate: null, name: "Customer", address: "Street", particulars: "Minor Chain", phone: "", amount: 11000, metal: "Gold" };
    const importBills = (db: ReturnType<typeof open>, bills: Record<string, unknown>[]) => db.rpc("import_historical_bills", { p_owner_id: localOwnerId, p_account_slot: 1, p_bills: bills });
    const stored = async (db: ReturnType<typeof open>, id: string) => (await db.from("bills").select("*, bill_items(*)").eq("id", id).single()).data;
    const receipt = { deliveryDate: "2026-10-30", billReceiptStatus: "has_bill", collectedByRelation: "self" };
    const deliver = (db: ReturnType<typeof open>, id: string, delivery: Record<string, unknown> = receipt) => db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: id, p_account_slot: 1, p_delivery: delivery });
    const blankEdit = { billDate: "2022-04-01", customerName: "Customer", fatherName: "", address: "Street", phone: "123", items: [{ metal: "Gold", particulars: "Minor Chain", grams: null, assessedValue: null, loanAmount: 11000 }] };

    it("doesn't let a wrong-column delivery number break numbering", async () => {
      const db = open(); await profile(db);
      const { data } = await importBills(db, [{ ...row, deliveryNo: "9876543210", deliveryDate: "2022-05-01" }, { ...row, billNo: 2, deliveryNo: "20220501", deliveryDate: "2022-05-01" }, { ...row, billNo: 3, deliveryNo: "40", deliveryDate: "2022-05-01" }, { ...row, billNo: 4 }]);
      const number = await db.rpc("get_next_delivery_number", { p_owner_id: localOwnerId, p_account_slot: 1 });
      expect(number.data.number).toBe(41);
      const delivered = await deliver(db, data.ids[3]);
      expect(delivered.error).toBeNull();
      expect((await stored(db, data.ids[3])).delivery_no).toBe("41");
      expect((await stored(db, data.ids[0])).delivery_no).toBe("9876543210");
    });
    it("imports a register's voided row as a voided bill", async () => {
      const db = open(); await profile(db);
      const { data } = await importBills(db, [{ ...row, voided: true }, { ...row, billNo: 2 }]);
      const voided = await stored(db, data.ids[0]);
      expect(voided.status).toBe("void");
      expect(voided.voided_at).toBeTruthy();
      expect((await stored(db, data.ids[1])).status).toBe("issued");
    });
    it("won't overwrite a complete register delivery", async () => {
      const db = open(); await profile(db);
      const { data } = await importBills(db, [{ ...row, deliveryNo: "6132", deliveryDate: "2022-05-01" }]);
      const before = await stored(db, data.ids[0]);
      expect((await deliver(db, data.ids[0])).error?.message).toContain("old register");
      expect(await stored(db, data.ids[0])).toEqual(before);
    });
    it("adds only what a register delivery is missing and calculates no interest", async () => {
      const db = open(); await profile(db);
      const { data } = await importBills(db, [{ ...row, deliveryDate: "2022-05-31" }, { ...row, billNo: 2, deliveryNo: "77" }]);
      expect((await deliver(db, data.ids[0])).error).toBeNull();
      expect(await stored(db, data.ids[0])).toMatchObject({ delivery_no: "78", delivery_date: "2022-05-31", delivery_summary: null });
      expect((await deliver(db, data.ids[1])).error).toBeNull();
      expect(await stored(db, data.ids[1])).toMatchObject({ delivery_no: "77", delivery_date: "2026-10-30", delivery_summary: null });
    });
    it("keeps normal interest for an imported bill delivered for the first time", async () => {
      const db = open(); await profile(db);
      const { data } = await importBills(db, [row]);
      expect((await deliver(db, data.ids[0])).error).toBeNull();
      expect((await stored(db, data.ids[0])).delivery_summary.principal).toBe(11000);
    });
    it("refuses a whole multiple-delivery batch containing a register delivery", async () => {
      const db = open(); await profile(db);
      const { data } = await importBills(db, [row, { ...row, billNo: 2, deliveryDate: "2022-05-31" }]);
      const batch = await db.rpc("record_bill_deliveries", { p_owner_id: localOwnerId, p_account_slot: 1, p_delivery: { deliveryDate: "2026-10-30", deliveries: data.ids.map((billId: string) => ({ billId, billReceiptStatus: "has_bill", collectedByRelation: "self" })) } });
      expect(batch.error?.message).toContain("Bill #2");
      expect((await stored(db, data.ids[0])).delivery_no).toBeNull();
    });
    it("lets an imported bill be corrected while unknown details stay blank", async () => {
      const db = open(); await profile(db);
      const { data } = await importBills(db, [row]);
      const edited = await db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: data.ids[0], p_bill: blankEdit });
      expect(edited.error).toBeNull();
      expect(await stored(db, data.ids[0])).toMatchObject({ phone: "123", father_name: null, historical_missing_details: true, total_assessed_value: null, total_loan_amount: 11000, bill_items: [{ grams: null, assessed_value: null }] });
    });
    it("stops showing Not recorded only once every detail is really entered", async () => {
      const db = open(); await profile(db);
      const { data } = await importBills(db, [row]);
      await db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: data.ids[0], p_bill: { ...blankEdit, items: [{ ...blankEdit.items[0], grams: 4.5 }] } });
      expect(await stored(db, data.ids[0])).toMatchObject({ historical_missing_details: true, total_assessed_value: null, bill_items: [{ grams: 4.5, assessed_value: null }] });
      await db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: data.ids[0], p_bill: { ...blankEdit, fatherName: "Parent", items: [{ ...blankEdit.items[0], grams: 4.5, assessedValue: 12100 }] } });
      expect(await stored(db, data.ids[0])).toMatchObject({ historical_missing_details: false, total_assessed_value: 12100, father_name: "Parent" });
    });
    it("still requires full details when editing an ordinary bill", async () => {
      const db = open(); await profile(db);
      const created = await issue(db);
      const edited = await db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: created.data.id, p_bill: blankEdit });
      expect(edited.error).toBeTruthy();
    });
    it("checks a workbook without saving anything", async () => {
      const db = open(); await profile(db);
      const params = { p_owner_id: localOwnerId, p_account_slot: 1 };
      expect((await db.rpc("check_historical_bills", { ...params, p_bills: [row] })).error).toBeNull();
      expect((await db.from("bills").select()).data).toHaveLength(0);
      expect((await db.rpc("check_historical_bills", { ...params, p_bills: [row, row] })).error?.message).toContain("duplicated");
    });
    it("stays responsive with 10,000 imported bills", async () => {
      const db = open(); await profile(db);
      const imported = await importBills(db, Array.from({ length: 10000 }, (_, index) => ({ ...row, billNo: index + 1 })));
      expect(imported.error).toBeNull();
      const started = performance.now();
      const { data } = await db.from("bills").select("*, bill_items(*)").eq("profile_id", imported.data.profileId);
      expect(data).toHaveLength(10000);
      expect(data[9999].bill_items).toHaveLength(1);
      expect(performance.now() - started).toBeLessThan(5000);
    }, 60000);
  });
  it("persists and edits jewellery remarks and requires a delivery choice before issuing a receipt", async () => {
    const db = open(); const business = await profile(db);
    const input = { ...bill, items: [{ ...bill.items[0], remarks: " Slightly bent; missing stone " }] };
    const first = await issue(db, input);
    const read = () => db.from("bills").select("*, bill_items(*)").eq("id", first.data.id).single();
    expect((await read()).data.bill_items[0].remarks).toBe("Slightly bent; missing stone");
    expect((await db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_account_slot: 1, p_delivery: { deliveryDate: "2026-10-30" } })).error).toBeTruthy();
    expect((await read()).data.delivery_no).toBeNull();
    expect((await db.from("business_profiles").select().eq("id", business.id).single()).data.next_delivery_number).toBe(1);
    expect((await db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_bill: { ...input, items: [{ ...input.items[0], remarks: "No screw" }] } })).error).toBeNull();
    const delivery = { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_account_slot: 1, p_delivery: { deliveryDate: "2026-10-30", billReceiptStatus: "lost_bill", collectedByRelation: "self", lostBillDeclarationSigned: true } };
    expect((await db.rpc("record_bill_delivery", { ...delivery, p_delivery: { ...delivery.p_delivery, lostBillDeclarationSigned: false } })).error).toBeTruthy();
    expect((await read()).data.delivery_no).toBeNull();
    expect((await db.rpc("record_bill_delivery", delivery)).error).toBeNull();
    expect((await read()).data).toMatchObject({ bill_number: 1, delivery_no: "1", delivery_bill_receipt_status: "lost_bill", bill_items: [{ remarks: "No screw" }] });
    const declaredAt = (await read()).data.delivery_lost_bill_declared_at;
    expect(declaredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await db.rpc("record_bill_delivery", delivery)).error).toBeNull();
    expect((await read()).data.delivery_lost_bill_declared_at).toBe(declaredAt);
    expect((await db.rpc("record_bill_delivery", { ...delivery, p_delivery: { ...delivery.p_delivery, billReceiptStatus: "has_bill", collectedByRelation: "self" } })).error).toBeNull();
    expect((await read()).data).toMatchObject({ delivery_no: "1", delivery_bill_receipt_status: "has_bill", delivery_lost_bill_declared_at: null });
    // Marking an older lost-bill delivery as signed.
    const mark = (account = 1) => db.rpc("mark_lost_bill_declared", { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_account_slot: account });
    expect((await mark()).error?.message).toContain("isn't recorded as a lost bill");
    // The app blocks direct ledger edits, so fake an older unsigned lost-bill delivery in this throwaway file.
    const raw = new DatabaseSync(join(opened.at(-1)!.directory, "billing.sqlite"));
    raw.prepare("UPDATE records SET body=json_set(body,'$.delivery_bill_receipt_status','lost_bill') WHERE table_name='bills' AND id=?").run(first.data.id);
    raw.close();
    expect((await read()).data).toMatchObject({ delivery_bill_receipt_status: "lost_bill", delivery_lost_bill_declared_at: null });
    expect((await mark(2)).error).toBeTruthy();
    expect((await read()).data.delivery_lost_bill_declared_at).toBeNull();
    const marked = await mark();
    expect(marked.error).toBeNull();
    expect((await read()).data).toMatchObject({ delivery_lost_bill_declared_at: marked.data.declaredAt, excel_sync_status: "pending", delivery_no: "1" });
    expect((await mark()).data.declaredAt).toBe(marked.data.declaredAt);
    const waiting = await issue(db, { ...bill, phone: "9000000002" });
    expect((await db.rpc("mark_lost_bill_declared", { p_owner_id: localOwnerId, p_bill_id: waiting.data.id, p_account_slot: 1 })).error?.message).toContain("no delivery yet");
  });
  it("saves separate account licenses, preserves issue snapshots and allows clearing the field", async () => {
    const db = open();
    const save = (accountSlot: number, licenseNumber?: string) => db.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { businessName: "Finance", address: "123 Main Street", phone: "1234567890", accountSlot, ...(licenseNumber === undefined ? {} : { licenseNumber }) } });
    const first = await save(1, " TN/ONE "); const second = await save(2, "TN/TWO");
    expect(first.data.license_number).toBe("TN/ONE");
    expect(second.data.license_number).toBe("TN/TWO");
    const issued = await issue(db);
    await save(1, "NEW/ONE");
    expect((await db.from("bills").select().eq("id", issued.data.id).single()).data.business_snapshot.license_number).toBe("TN/ONE");
    expect((await save(1)).data.license_number).toBe("NEW/ONE");
    expect((await save(1, "")).data.license_number).toBeNull();
    expect((await db.from("business_profiles").select().eq("id", second.data.id).single()).data.license_number).toBe("TN/TWO");
    expect((await save(1, "X".repeat(81))).error).toBeTruthy();
  });
  it("starts an empty account at one even when its saved starting number is higher", async () => {
    const db = open(); await profile(db, 1, 100);
    const created = await issue(db);
    expect(created.error).toBeNull();
    expect((await db.from("bills").select().eq("id", created.data.id).single()).data.bill_number).toBe(1);
  });
  it("resets to one after every bill has been deleted out of order", async () => {
    const db = open(); const saved = await profile(db);
    const created = [await issue(db), await issue(db), await issue(db)];
    for (const result of created) expect((await db.rpc("delete_bill", { p_owner_id: localOwnerId, p_bill_id: result.data.id })).error).toBeNull();
    expect((await db.from("business_profiles").select().eq("id", saved.id).single()).data.next_bill_number).toBe(1);
    const next = await issue(db);
    expect((await db.from("bills").select().eq("id", next.data.id).single()).data.bill_number).toBe(1);
  });
  it("repairs an older empty account's saved counter on reopen", async () => {
    const db = open(); const saved = await profile(db);
    const entry = opened[0];
    db.close();
    const stored = new DatabaseSync(join(entry.directory, "billing.sqlite"));
    stored.prepare("UPDATE records SET body=json_set(body,'$.next_bill_number',5) WHERE table_name='business_profiles' AND id=?").run(saved.id);
    stored.close();
    entry.db = createLocalDatabase(entry.directory);
    expect((await entry.db.from("business_profiles").select().eq("id", saved.id).single()).data.next_bill_number).toBe(1);
  });
  it("requires a Gold or Silver choice for new local bills", async () => {
    const db = open(); await profile(db);
    const missingMetal = { ...bill, items: [{ particulars: "Ring", grams: 1, assessedValue: 100, loanAmount: 80 }] };
    expect((await issue(db, missingMetal)).error?.message).toContain("Choose Gold or Silver");
    expect((await db.from("bills").select()).data).toHaveLength(0);
  });
  it("rejects changes to finalized financial data and prevents unvoiding", async () => {
    const db = open(); await profile(db); const created = await issue(db);
    for (const patch of [{ customer_name: "Changed" }, { bill_number: 100 }, { total_loan_amount: 0 }, { id: "changed" }]) {
      expect((await db.from("bills").update(patch).eq("id", created.data.id)).error).toBeTruthy();
    }
    const item = (await db.from("bill_items").select().eq("bill_id", created.data.id)).data[0];
    expect((await db.from("bill_items").update({ loan_amount: 0 }).eq("id", item.id)).error).toBeTruthy();
    expect((await db.from("business_profiles").update({ next_bill_number: 1 })).error).toBeTruthy();
    expect((await db.from("bills").update({ status: "void" }).eq("id", created.data.id)).error).toBeNull();
    expect((await db.from("bills").update({ status: "issued" }).eq("id", created.data.id)).error).toBeTruthy();
    expect((await db.from("bills").select().eq("id", created.data.id).single()).data).toMatchObject({ customer_name: bill.customerName, bill_number: 1, status: "void" });
  });
  it("serializes numbering, calculates exact cents, keeps snapshots and isolates accounts", async () => {
    const db = open(); const first = await profile(db, 1, 100); const second = await profile(db, 2, 50);
    const results = await Promise.all(Array.from({ length: 12 }, () => issue(db)));
    expect(results.every(result => !result.error)).toBe(true);
    const rows = await db.from("bills").select("*, bill_items(*)").eq("profile_id", first.id).order("bill_number");
    expect(rows.data.map((row: any) => row.bill_number)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(rows.data[0]).toMatchObject({ total_assessed_value: 30.33, total_loan_amount: 17.03, business_snapshot: { business_name: "Finance" } });
    expect(rows.data[0].bill_items).toHaveLength(2);
    expect(rows.data[0].bill_items.map((item: { metal: string }) => item.metal)).toEqual(["Gold", "Silver"]);
    expect((await profile(db, 1, 1)).next_bill_number).toBe(13);
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
  it("edits an issued bill in place without consuming a new number", async () => {
    const db = open(); const saved = await profile(db); const first = await issue(db);
    const bad = await db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_bill: { ...bill, items: [{ ...bill.items[0], loanAmount: -1 }] } });
    expect(bad.error).toBeTruthy();
    expect((await db.from("bills").select().eq("id", first.data.id).single()).data.customer_name).toBe(bill.customerName);
    const edited = await db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_bill: { ...bill, customerName: "Corrected customer", items: [{ metal: "Silver", particulars: "New ring", grams: 3, assessedValue: 50, loanAmount: 25 }] } });
    expect(edited.error).toBeNull();
    expect(edited.data.id).toBe(first.data.id);
    expect((await db.from("bills").select("*, bill_items(*)").eq("id", first.data.id).single()).data).toMatchObject({ bill_number: 1, customer_name: "Corrected customer", total_loan_amount: 25, status: "issued", excel_sync_status: "pending", pdf_storage_path: null, bill_items: [{ metal: "Silver", particulars: "New ring" }] });
    expect((await db.from("business_profiles").select().eq("id", saved.id).single()).data.next_bill_number).toBe(2);
    expect((await db.from("bills").select()).data).toHaveLength(1);
    expect((await db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_bill: { ...bill, accountSlot: 2 } })).error).toBeTruthy();
    expect((await db.from("bills").update({ status: "void" }).eq("id", first.data.id)).error).toBeNull();
    expect((await db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_bill: bill })).error).toBeTruthy();
  });
  it("records delivery on the same bill without changing its items, money or next number", async () => {
    const db = open(); const saved = await profile(db); const first = await issue(db);
    const previousPdfPath = `${saved.id}/${first.data.id}.pdf`;
    await db.from("bills").update({ pdf_storage_path: previousPdfPath }).eq("id", first.data.id);
    const before = (await db.from("bills").select("*, bill_items(*)").eq("id", first.data.id).single()).data;
    const recorded = await db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_account_slot: 1, p_delivery: { billReceiptStatus: "has_bill", collectedByRelation: "self", deliveryNo: " DEL-10 ", deliveryDate: "2026-10-28" } });
    expect(recorded.error).toBeNull();
    expect(recorded.data).toMatchObject({ id: first.data.id, previousPdfPath });
    const after = (await db.from("bills").select("*, bill_items(*)").eq("id", first.data.id).single()).data;
    expect(after).toMatchObject({ bill_number: 1, customer_name: before.customer_name, total_loan_amount: before.total_loan_amount, total_assessed_value: before.total_assessed_value, delivery_no: "1", delivery_date: "2026-10-28", status: "issued", excel_sync_status: "pending", pdf_storage_path: null });
    expect(after.bill_items).toEqual(before.bill_items);
    expect((await db.from("business_profiles").select().eq("id", saved.id).single()).data.next_bill_number).toBe(2);
    expect((await db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_account_slot: 1, p_delivery: { billReceiptStatus: "has_bill", collectedByRelation: "self", deliveryNo: "DEL-11", deliveryDate: "2026-10-29" } })).error).toBeNull();
    expect((await db.from("bills").select()).data).toHaveLength(1);
    expect((await db.from("bills").select().eq("id", first.data.id).single()).data.delivery_no).toBe("1");
    expect((await db.from("business_profiles").select().eq("id", saved.id).single()).data.next_delivery_number).toBe(2);
  });
  it("rejects delivery for another account or invalid dates, but records delivery on a voided bill", async () => {
    const db = open(); await profile(db); await profile(db, 2); const first = await issue(db);
    const parameters = { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_account_slot: 1, p_delivery: { billReceiptStatus: "has_bill", collectedByRelation: "self", deliveryNo: "DEL-1", deliveryDate: "2026-10-28" } };
    expect((await db.rpc("record_bill_delivery", { ...parameters, p_account_slot: 2 })).error?.message).toContain("this account");
    expect((await db.rpc("record_bill_delivery", { ...parameters, p_delivery: { billReceiptStatus: "has_bill", collectedByRelation: "self", deliveryNo: "DEL-1", deliveryDate: "2026-10-02" } })).error?.message).toContain("before the bill date");
    expect((await db.rpc("record_bill_delivery", { ...parameters, p_delivery: { billReceiptStatus: "has_bill", collectedByRelation: "self", deliveryNo: "", deliveryDate: "2026-02-30" } })).error).toBeTruthy();
    expect((await db.from("bills").select().eq("id", first.data.id).single()).data.delivery_no).toBeNull();
    await db.from("bills").update({ status: "void" }).eq("id", first.data.id);
    const voided = (await db.from("bills").select("*, bill_items(*)").eq("id", first.data.id).single()).data;
    expect((await db.rpc("record_bill_delivery", parameters)).error).toBeNull();
    const delivered = (await db.from("bills").select("*, bill_items(*)").eq("id", first.data.id).single()).data;
    expect(delivered).toMatchObject({ status: "void", voided_at: voided.voided_at, bill_number: 1, delivery_no: "1", delivery_date: "2026-10-28", total_loan_amount: voided.total_loan_amount });
    expect(delivered.bill_items).toEqual(voided.bill_items);
    expect((await db.from("bills").select()).data).toHaveLength(1);
  });
  it("allocates delivery numbers per account and saves the agreed monthly collection amounts", async () => {
    const db = open(); await profile(db); await profile(db, 2);
    const loan = { ...bill, billDate: "2026-10-28", items: [{ metal: "Gold", particulars: "Ring", grams: 5, assessedValue: 15000, loanAmount: 10000 }] };
    const first = await issue(db, loan); const second = await issue(db, loan); const other = await issue(db, { ...loan, accountSlot: 2 });
    const parameters = (id: string, account = 1) => ({ p_owner_id: localOwnerId, p_bill_id: id, p_account_slot: account, p_delivery: { billReceiptStatus: "has_bill", collectedByRelation: "self", deliveryDate: "2026-11-29" } });
    const results = await Promise.all([db.rpc("record_bill_delivery", parameters(first.data.id)), db.rpc("record_bill_delivery", parameters(second.data.id)), db.rpc("record_bill_delivery", parameters(other.data.id, 2))]);
    expect(results.every(result => !result.error)).toBe(true);
    const saved = await Promise.all([first, second, other].map(result => db.from("bills").select().eq("id", result.data.id).single()));
    expect(saved.map(result => result.data.delivery_no)).toEqual(["1", "2", "1"]);
    expect(saved[0].data.delivery_summary).toMatchObject({ chargedMonths: 1, principal: 10000, initialInterest: 200, interest: 200, total: 10200 });
    await db.rpc("record_bill_delivery", { ...parameters(first.data.id), p_delivery: { billReceiptStatus: "has_bill", collectedByRelation: "self", deliveryDate: "2026-12-29" } });
    expect((await db.from("bills").select().eq("id", first.data.id).single()).data).toMatchObject({ delivery_no: "1", delivery_summary: { interest: 400, total: 10400 } });
    expect((await db.rpc("get_next_delivery_number", { p_owner_id: localOwnerId, p_account_slot: 1 })).data.number).toBe(3);
  });
  it("continues after existing numeric delivery numbers and keeps old delivery references", async () => {
    const db = open(); await profile(db);
    const original = await issue(db, { ...bill, deliveryNo: "15", deliveryDate: "2026-10-28" });
    const next = await issue(db);
    expect((await db.rpc("get_next_delivery_number", { p_owner_id: localOwnerId, p_account_slot: 1 })).data.number).toBe(16);
    await db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: next.data.id, p_account_slot: 1, p_delivery: { billReceiptStatus: "has_bill", collectedByRelation: "self", deliveryDate: "2026-10-28" } });
    expect((await db.from("bills").select().eq("id", original.data.id).single()).data.delivery_no).toBe("15");
    expect((await db.from("bills").select().eq("id", next.data.id).single()).data.delivery_no).toBe("16");
  });
  it("lets an older voided bill supply missing metals before calculating delivery interest", async () => {
    const db = open(); const saved = await profile(db); const first = await issue(db);
    const stored = new DatabaseSync(join(opened[0].directory, "billing.sqlite"));
    stored.prepare("UPDATE records SET body=json_remove(body,'$.metal') WHERE table_name='bill_items'").run(); stored.close();
    await db.from("bills").update({ status: "void" }).eq("id", first.data.id);
    const parameters = { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_account_slot: 1, p_delivery: { billReceiptStatus: "has_bill", collectedByRelation: "self", deliveryDate: "2026-10-28" } };
    expect((await db.rpc("record_bill_delivery", parameters)).error?.message).toContain("Choose Gold or Silver");
    expect((await db.from("business_profiles").select().eq("id", saved.id).single()).data.next_delivery_number).toBe(1);
    expect((await db.rpc("record_bill_delivery", { ...parameters, p_delivery: { ...parameters.p_delivery, itemMetals: ["Gold", "Silver"] } })).error).toBeNull();
    expect((await db.from("bills").select().eq("id", first.data.id).single()).data).toMatchObject({ status: "void", delivery_no: "1", delivery_summary: { missingMetal: false, total: 17.03 } });
  });
  it("reuses a deleted latest bill number, including a voided bill", async () => {
    const db = open(); const saved = await profile(db); const first = await issue(db); const second = await issue(db);
    expect((await db.from("bills").update({ status: "void" }).eq("id", second.data.id)).error).toBeNull();
    expect((await db.rpc("delete_bill", { p_owner_id: localOwnerId, p_bill_id: second.data.id })).error).toBeNull();
    expect((await db.from("business_profiles").select().eq("id", saved.id).single()).data.next_bill_number).toBe(2);
    const next = await issue(db);
    expect((await db.from("bills").select().eq("id", next.data.id).single()).data.bill_number).toBe(2);
    expect((await db.from("bills").select()).data).toHaveLength(2);
    expect((await db.from("bill_items").select()).data).toHaveLength(4);
    expect((await db.rpc("delete_bill", { p_owner_id: localOwnerId, p_bill_id: second.data.id })).error).toBeTruthy();
  });
  it("does not renumber existing bills when an older bill is deleted", async () => {
    const db = open(); const saved = await profile(db);
    const first = await issue(db); const second = await issue(db); const third = await issue(db);
    expect((await db.rpc("delete_bill", { p_owner_id: localOwnerId, p_bill_id: second.data.id })).error).toBeNull();
    expect((await db.from("business_profiles").select().eq("id", saved.id).single()).data.next_bill_number).toBe(4);
    expect((await db.rpc("delete_bill", { p_owner_id: localOwnerId, p_bill_id: third.data.id })).error).toBeNull();
    expect((await db.from("business_profiles").select().eq("id", saved.id).single()).data.next_bill_number).toBe(3);
    const next = await issue(db);
    expect((await db.from("bills").select().eq("id", next.data.id).single()).data.bill_number).toBe(3);
    expect((await db.from("bills").select().eq("id", first.data.id).single()).data.bill_number).toBe(1);
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
  it("accepts a new versioned PDF only within the bill's own account path", async () => {
    const db = open(); const saved = await profile(db); const first = await issue(db);
    const current = `${saved.id}/${first.data.id}-${randomUUID()}.pdf`;
    expect((await db.from("bills").update({ pdf_storage_path: current }).eq("id", first.data.id)).error).toBeNull();
    expect((await db.from("bills").update({ pdf_storage_path: `${saved.id}/other-${randomUUID()}.pdf` }).eq("id", first.data.id)).error).toBeTruthy();
    expect((await db.from("bills").select().eq("id", first.data.id).single()).data.pdf_storage_path).toBe(current);
  });
  it("supports literal history search, count, paging and conditional void", async () => {
    const db = open(); await profile(db); const created = await issue(db); await issue(db);
    const result = await db.from("bills").select("*, bill_items(*)", { count: "exact" }).or(`customer_name.imatch.${JSON.stringify("A,B \\(Gold\\)")},bill_number.eq.999`).gte("bill_date", "2026-10-01").lte("bill_date", "2026-10-04").order("bill_number", { ascending: false }).range(0, 0);
    expect(result.count).toBe(2); expect(result.data).toHaveLength(1); expect(result.data[0].bill_number).toBe(2);
    expect((await db.from("bills").update({ status: "void" }).eq("id", created.data.id).eq("status", "issued").select("id,bill_number").maybeSingle()).data).toMatchObject({ id: created.data.id, bill_number: 1 });
    expect((await db.from("bills").update({ status: "void" }).eq("id", created.data.id).eq("status", "issued").maybeSingle()).data).toBeNull();
  });
});

describe("additional local business accounts", () => {
  const details = { businessName: "Additional Finance", address: "456 Business Street", phone: "9876543210", licenseNumber: "LICENSE/FOUR", logoUrl: "https://example.com/logo.png" };
  const add = (db: ReturnType<typeof open>, input: unknown = details) => db.rpc("create_business_account", { p_owner_id: localOwnerId, p_profile: input });

  it("creates accounts 4 and 5 without filling unset original slots and persists their full details", async () => {
    const db = open(); await profile(db, 2);
    const original = (await db.from("business_profiles").select().order("account_slot")).data;
    const fourth = await add(db, { ...details, nextBillNumber: 99, accountSlot: 2 });
    const fifth = await add(db, { ...details, businessName: "Fifth Finance" });
    expect(fourth.error).toBeNull(); expect(fifth.error).toBeNull();
    expect(fourth.data).toMatchObject({ account_slot: 4, owner_id: localOwnerId, business_name: details.businessName, address: details.address, phone: details.phone, license_number: details.licenseNumber, logo_url: details.logoUrl, next_bill_number: 1, next_delivery_number: 1 });
    expect(fifth.data).toMatchObject({ account_slot: 5, business_name: "Fifth Finance", next_bill_number: 1, next_delivery_number: 1 });
    expect(new Set([original[0].id, fourth.data.id, fifth.data.id]).size).toBe(3);
    const all = (await db.from("business_profiles").select().order("account_slot")).data;
    expect(all.map((row: { account_slot: number }) => row.account_slot)).toEqual([2, 4, 5]);
    expect(accountSlots(all)).toEqual([1, 2, 3, 4, 5]);
    expect(all[0]).toEqual(original[0]);
    const entry = opened[0]; db.close(); entry.db = createLocalDatabase(entry.directory);
    expect((await entry.db.from("business_profiles").select().order("account_slot")).data).toEqual(all);
    const edited = await entry.db.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { ...details, businessName: "Updated fourth", accountSlot: 4 } });
    expect(edited.error).toBeNull(); expect(edited.data.id).toBe(fourth.data.id);
    expect((await entry.db.from("business_profiles").select().eq("account_slot", 5).single()).data).toEqual(fifth.data);
  });

  it("starts account 4 at bill 1 and delivery 1 while preserving other accounts and register rows", async () => {
    const db = open(); const first = await profile(db); await profile(db, 3);
    const oldBill = await issue(db); await issue(db);
    await db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: oldBill.data.id, p_account_slot: 1, p_delivery: { billReceiptStatus: "has_bill", collectedByRelation: "self", deliveryDate: "2026-10-28" } });
    const previousProfiles = (await db.from("business_profiles").select().order("account_slot")).data;
    const previousBills = (await db.from("bills").select("*, bill_items(*)").eq("profile_id", first.id).order("bill_number")).data;
    const fourth = await add(db); const fifth = await add(db);
    const issued = await issue(db, { ...bill, accountSlot: fourth.data.account_slot });
    expect(issued.error).toBeNull();
    expect((await db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: issued.data.id, p_account_slot: 4, p_delivery: { billReceiptStatus: "has_bill", collectedByRelation: "self", deliveryDate: "2026-10-28" } })).error).toBeNull();
    expect((await db.from("bills").select().eq("id", issued.data.id).single()).data).toMatchObject({ profile_id: fourth.data.id, bill_number: 1, delivery_no: "1", business_snapshot: { business_name: details.businessName, license_number: details.licenseNumber } });
    expect((await db.from("business_profiles").select().eq("id", fourth.data.id).single()).data).toMatchObject({ next_bill_number: 2, next_delivery_number: 2 });
    expect((await db.from("bills").select().eq("profile_id", fifth.data.id)).data).toEqual([]);
    expect((await db.from("business_profiles").select().lte("account_slot", 3).order("account_slot")).data).toEqual(previousProfiles);
    expect((await db.from("bills").select("*, bill_items(*)").eq("profile_id", first.id).order("bill_number")).data).toEqual(previousBills);
    expect((await db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: issued.data.id, p_account_slot: 5, p_delivery: { billReceiptStatus: "has_bill", collectedByRelation: "self", deliveryDate: "2026-10-29" } })).error?.message).toContain("this account");
    expect((await db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: issued.data.id, p_bill: { ...bill, accountSlot: 1 } })).error?.message).toContain("original account");
    const fifthBill = await issue(db, { ...bill, accountSlot: 5 });
    expect((await db.from("bills").select().eq("id", fifthBill.data.id).single()).data).toMatchObject({ profile_id: fifth.data.id, bill_number: 1 });
  });

  it("validates complete details and account IDs without allocating on failure", async () => {
    const db = open();
    for (const input of [null, {}, { ...details, businessName: "X" }, { ...details, businessName: "X".repeat(161) }, { ...details, address: "abc" }, { ...details, phone: "123" }, { ...details, licenseNumber: "X".repeat(81) }, { ...details, logoUrl: "bad-url" }, { ...details, nextBillNumber: -1 }]) {
      expect((await add(db, input)).error).toBeTruthy();
    }
    expect((await db.rpc("create_business_account", { p_owner_id: "someone-else", p_profile: details })).error?.message).toContain("Invalid local owner");
    for (const accountSlot of [null, 0, -1, 1.5, NaN, Infinity, 2_147_483_647, "4", true, []]) {
      expect((await db.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { ...details, accountSlot } })).error).toBeTruthy();
      expect((await db.rpc("get_next_delivery_number", { p_owner_id: localOwnerId, p_account_slot: accountSlot })).error).toBeTruthy();
    }
    expect((await db.from("business_profiles").select()).data).toEqual([]);
    expect((await add(db)).data.account_slot).toBe(4);
  });

  it("allocates above the highest saved account and rejects overflow without changing it", async () => {
    const db = open(); await profile(db, 8);
    expect((await add(db)).data.account_slot).toBe(9);
    const last = await profile(db, 2_147_483_646);
    const before = (await db.from("business_profiles").select().order("account_slot")).data;
    expect((await add(db)).error?.message).toContain("Business account limit");
    expect((await db.from("business_profiles").select().order("account_slot")).data).toEqual(before);
    expect((await db.from("business_profiles").select().eq("id", last.id).single()).data).toEqual(last);
  });

  it("allocates unique slots concurrently across independent SQLite connections", async () => {
    const db = open(); await profile(db);
    const original = (await db.from("business_profiles").select()).data[0];
    const script = `
      const { workerData, parentPort } = require("node:worker_threads");
      const { createRequire } = require("node:module");
      const taskRequire = createRequire(workerData.modulePath);
      const ts = taskRequire("typescript");
      const fs = require("node:fs");
      require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
      const { createLocalDatabase, localOwnerId } = taskRequire(workerData.modulePath);
      const db = createLocalDatabase(workerData.directory);
      parentPort.once("message", async () => {
        try {
          const profiles = [];
          for (let index = 0; index < 4; index++) {
            const result = await db.rpc("create_business_account", { p_owner_id: localOwnerId, p_profile: workerData.details });
            if (result.error) throw result.error;
            profiles.push(result.data);
          }
          parentPort.postMessage({ profiles });
        } catch (error) { parentPort.postMessage({ error: error.message }); }
        finally { db.close(); }
      });
      parentPort.postMessage({ ready: true });
    `;
    const workers = Array.from({ length: 3 }, () => new Worker(script, { eval: true, workerData: { modulePath: join(process.cwd(), "src/lib/local-database.ts"), directory: opened[0].directory, details } }));
    try {
      const ready = workers.map(worker => new Promise<void>((resolve, reject) => { worker.once("message", () => resolve()); worker.once("error", reject); }));
      await Promise.all(ready);
      const results = workers.map(worker => new Promise<{ profiles?: { id: string; account_slot: number }[]; error?: string }>((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); }));
      workers.forEach(worker => worker.postMessage("go"));
      const completed = await Promise.all(results);
      expect(completed.map(result => result.error)).toEqual([undefined, undefined, undefined]);
      const allocated = completed.flatMap(result => result.profiles ?? []);
      expect(allocated.map(profile => profile.account_slot).sort((left, right) => left - right)).toEqual(Array.from({ length: 12 }, (_, index) => index + 4));
      expect(new Set(allocated.map(profile => profile.id)).size).toBe(12);
      expect((await db.from("business_profiles").select().eq("id", original.id).single()).data).toEqual(original);
    } finally { await Promise.all(workers.map(worker => worker.terminate())); }
  }, 20_000);
});

describe("a new bill saves its customer", () => {
  const person = { ...bill, customerName: "Ravi Kumar", fatherName: "Mani", phone: "9876543210", governmentId: "" };
  const saved = (db: ReturnType<typeof open>) => db.customers.list(1);
  const billRow = async (db: ReturnType<typeof open>, id: string) => (await db.from("bills").select("*").eq("id", id).single()).data;

  it("creates a customer ID and links it to the bill", async () => {
    const db = open(); await profile(db);
    const created = await issue(db, person);
    expect(created.error).toBeNull();
    const customers = saved(db);
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({ name: "Ravi Kumar", fatherName: "Mani", phone: "9876543210" });
    expect(await billRow(db, created.data.id)).toMatchObject({ customer_id: customers[0].id, customer_code: customers[0].customerCode });
  });

  it("creates one from Aadhaar alone, and reuses it for the same Aadhaar", async () => {
    const db = open(); await profile(db);
    const first = await issue(db, { ...person, phone: "", governmentId: "123412341234" });
    const second = await issue(db, { ...person, phone: "", governmentId: "123412341234" });
    expect(saved(db)).toHaveLength(1);
    expect((await billRow(db, second.data.id)).customer_id).toBe((await billRow(db, first.data.id)).customer_id);
  });

  it("creates nothing without a phone or Aadhaar", async () => {
    const db = open(); await profile(db);
    const created = await issue(db, { ...person, phone: "" });
    expect(created.error).toBeNull();
    expect(saved(db)).toHaveLength(0);
    expect((await billRow(db, created.data.id)).customer_id).toBeNull();
  });

  it("still saves the bill when the phone can't go on a customer record", async () => {
    const db = open(); await profile(db);
    const created = await issue(db, { ...person, phone: "2345678" });
    expect(created.error).toBeNull();
    expect(saved(db)).toHaveLength(0);
  });

  it("reuses the customer when the same person comes back", async () => {
    const db = open(); await profile(db);
    await issue(db, person); await issue(db, { ...person, customerName: "RAVI KUMAR" });
    expect(saved(db)).toHaveLength(1);
  });

  it("asks before giving a family member the same phone, and issues no bill until answered", async () => {
    const db = open(); const business = await profile(db);
    await issue(db, person);
    const refused = await issue(db, { ...person, customerName: "Lakshmi", fatherName: "Raman" });
    expect(refused.error?.message).toMatch(/different person/);
    expect(saved(db)).toHaveLength(1);
    expect(db.sync.counters(business.id).nextBillNumber).toBe(2);
    const allowed = await issue(db, { ...person, customerName: "Lakshmi", fatherName: "Raman", allowSharedPhone: true });
    expect(allowed.error).toBeNull();
    expect(saved(db)).toHaveLength(2);
    expect(db.sync.counters(business.id).nextBillNumber).toBe(3);
  });

  it("keeps a chosen customer and adds no new one", async () => {
    const db = open(); await profile(db);
    const chosen = db.customers.save(1, { name: "Ravi Kumar", fatherName: "Mani", address: "123 Main Street", phone: "9876543210", aadhaar: "" });
    const created = await issue(db, { ...person, customerId: chosen.id });
    expect(created.error).toBeNull();
    expect(saved(db)).toHaveLength(1);
    expect((await billRow(db, created.data.id)).customer_id).toBe(chosen.id);
  });

  it("leaves no customer behind when the bill can't be saved", async () => {
    const db = open(); await profile(db);
    const refused = await issue(db, { ...person, items: [] });
    expect(refused.error).not.toBeNull();
    expect(saved(db)).toHaveLength(0);
  });
});

describe("who took the jewellery and whose Aadhaar it is", () => {
  const person = { ...bill, customerName: "Ravi Kumar", fatherName: "Mani", phone: "9876543210", governmentId: "111122223333" };
  const deliver = (db: ReturnType<typeof open>, id: string, who: Record<string, unknown>) => db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: id, p_account_slot: 1, p_delivery: { deliveryDate: "2026-10-30", billReceiptStatus: "has_bill", ...who } });
  const read = async (db: ReturnType<typeof open>, id: string) => (await db.from("bills").select("*").eq("id", id).single()).data;

  it("saves the relative's name and relation, or the customer's own name", async () => {
    const db = open(); await profile(db);
    const first = await issue(db, person), second = await issue(db, person);
    expect((await deliver(db, first.data.id, { collectedByRelation: "son", collectedByName: "Arun" })).error).toBeNull();
    expect(await read(db, first.data.id)).toMatchObject({ delivery_collected_by_relation: "son", delivery_collected_by_name: "Arun" });
    expect((await deliver(db, second.data.id, { collectedByRelation: "self" })).error).toBeNull();
    expect(await read(db, second.data.id)).toMatchObject({ delivery_collected_by_relation: "self", delivery_collected_by_name: "Ravi Kumar" });
  });

  it("refuses a delivery with no one named, and uses no delivery number", async () => {
    const db = open(); const business = await profile(db);
    const created = await issue(db, person);
    expect((await deliver(db, created.data.id, {})).error).not.toBeNull();
    expect((await deliver(db, created.data.id, { collectedByRelation: "wife" })).error?.message).toMatch(/name of the person/);
    expect((await read(db, created.data.id)).delivery_no).toBeFalsy();
    expect(db.sync.counters(business.id).nextDeliveryNumber).toBe(1);
  });

  it("gives every bill in a multiple delivery the person named", async () => {
    const db = open(); await profile(db);
    const first = await issue(db, person), second = await issue(db, { ...person, customerName: "RAVI KUMAR" });
    const who = { billReceiptStatus: "has_bill", collectedByRelation: "wife", collectedByName: "Lakshmi" };
    const saved = await db.rpc("record_bill_deliveries", { p_owner_id: localOwnerId, p_account_slot: 1, p_delivery: { deliveryDate: "2026-10-30", deliveries: [{ billId: first.data.id, ...who }, { billId: second.data.id, ...who }] } });
    expect(saved.error).toBeNull();
    for (const id of [first.data.id, second.data.id]) expect(await read(db, id)).toMatchObject({ delivery_collected_by_relation: "wife", delivery_collected_by_name: "Lakshmi" });
  });

  it("stops a new bill that has someone else's Aadhaar, and saves nothing", async () => {
    const db = open(); const business = await profile(db);
    await issue(db, person);
    const refused = await issue(db, { ...person, customerName: "Lakshmi", fatherName: "Raman" });
    expect(refused.error?.message).toMatch(/This Aadhaar is saved for Ravi Kumar \(C000001\)/);
    expect(db.customers.list(1)).toHaveLength(1);
    expect(db.sync.counters(business.id).nextBillNumber).toBe(2);
    expect((await issue(db, { ...person, customerName: "ravi kumar" })).error).toBeNull();
  });

  it("stops an edit that leaves someone else's Aadhaar on a renamed bill, but not other edits", async () => {
    const db = open(); await profile(db);
    const created = await issue(db, person);
    const edit = (changes: Record<string, unknown>) => db.rpc("edit_bill", { p_owner_id: localOwnerId, p_bill_id: created.data.id, p_bill: { ...person, ...changes } });
    expect((await edit({ customerName: "Lakshmi", customerId: "" })).error?.message).toMatch(/This Aadhaar is saved for/);
    expect((await edit({ address: "45 New Street" })).error).toBeNull();
    expect((await edit({ customerName: "Lakshmi", customerId: "", governmentId: "" })).error).toBeNull();
  });
});

describe("cancelling a delivery bill", () => {
  const person = { ...bill, customerName: "Ravi Kumar", fatherName: "Mani", phone: "9876543210" };
  const who = { deliveryDate: "2026-10-30", billReceiptStatus: "has_bill", collectedByRelation: "son", collectedByName: "Arun" };
  const deliver = (db: ReturnType<typeof open>, id: string) => db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: id, p_account_slot: 1, p_delivery: who });
  const cancel = (db: ReturnType<typeof open>, id: string, account = 1) => db.rpc("cancel_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: id, p_account_slot: account });
  const read = async (db: ReturnType<typeof open>, id: string) => (await db.from("bills").select("*").eq("id", id).single()).data;

  it("returns the bill to awaiting delivery and keeps a record of what was cancelled", async () => {
    const db = open(); await profile(db);
    const created = await issue(db, person);
    await deliver(db, created.data.id);
    expect((await cancel(db, created.data.id)).error).toBeNull();
    const row = await read(db, created.data.id);
    expect(row).toMatchObject({ status: "issued", delivery_no: null, delivery_date: null, delivery_bill_receipt_status: null, delivery_collected_by_name: null, delivery_summary: null, bill_number: 1 });
    expect(row.cancelled_deliveries).toHaveLength(1);
    expect(row.cancelled_deliveries[0]).toMatchObject({ delivery_no: "1", delivery_date: "2026-10-30", collected_by_relation: "son", collected_by_name: "Arun" });
  });

  it("never uses the cancelled delivery number again", async () => {
    const db = open(); const business = await profile(db);
    const created = await issue(db, person);
    await deliver(db, created.data.id); await cancel(db, created.data.id);
    expect(db.sync.counters(business.id).nextDeliveryNumber).toBe(2);
    expect((await deliver(db, created.data.id)).error).toBeNull();
    expect((await read(db, created.data.id)).delivery_no).toBe("2");
    await cancel(db, created.data.id);
    expect((await read(db, created.data.id)).cancelled_deliveries).toHaveLength(2);
  });

  it("refuses a bill with no delivery, another account's bill, and a delivery from an old register", async () => {
    const db = open(); await profile(db); await profile(db, 2);
    const created = await issue(db, person);
    expect((await cancel(db, created.data.id)).error?.message).toMatch(/no delivery to cancel/);
    await deliver(db, created.data.id);
    expect((await cancel(db, created.data.id, 2)).error?.message).toMatch(/not found/i);
    expect((await read(db, created.data.id)).delivery_no).toBe("1");
    const imported = await db.rpc("import_historical_bills", { p_owner_id: localOwnerId, p_account_slot: 1, p_bills: [{ billNo: 50, billDate: "2022-01-04", deliveryNo: "900", deliveryDate: "2022-01-05", name: "Old Customer", address: "", phone: "", particulars: "Ring", amount: 1000, metal: "Gold", voided: false }] });
    expect(imported.error).toBeNull();
    const old = (await db.from("bills").select("*").eq("bill_number", 50).single()).data;
    expect((await cancel(db, old.id)).error?.message).toMatch(/old register/);
    expect((await read(db, old.id)).delivery_no).toBe("900");
  });

  it("can cancel a voided bill's delivery, and the bill stays voided", async () => {
    const db = open(); await profile(db);
    const created = await issue(db, person);
    await deliver(db, created.data.id);
    await db.from("bills").update({ status: "void" }).eq("id", created.data.id);
    expect((await cancel(db, created.data.id)).error).toBeNull();
    expect(await read(db, created.data.id)).toMatchObject({ status: "void", delivery_no: null });
  });
});
