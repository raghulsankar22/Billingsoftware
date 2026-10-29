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
    const recorded = await db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_account_slot: 1, p_delivery: { deliveryNo: " DEL-10 ", deliveryDate: "2026-10-28" } });
    expect(recorded.error).toBeNull();
    expect(recorded.data).toMatchObject({ id: first.data.id, previousPdfPath });
    const after = (await db.from("bills").select("*, bill_items(*)").eq("id", first.data.id).single()).data;
    expect(after).toMatchObject({ bill_number: 1, customer_name: before.customer_name, total_loan_amount: before.total_loan_amount, total_assessed_value: before.total_assessed_value, delivery_no: "1", delivery_date: "2026-10-28", status: "issued", excel_sync_status: "pending", pdf_storage_path: null });
    expect(after.bill_items).toEqual(before.bill_items);
    expect((await db.from("business_profiles").select().eq("id", saved.id).single()).data.next_bill_number).toBe(2);
    expect((await db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_account_slot: 1, p_delivery: { deliveryNo: "DEL-11", deliveryDate: "2026-10-29" } })).error).toBeNull();
    expect((await db.from("bills").select()).data).toHaveLength(1);
    expect((await db.from("bills").select().eq("id", first.data.id).single()).data.delivery_no).toBe("1");
    expect((await db.from("business_profiles").select().eq("id", saved.id).single()).data.next_delivery_number).toBe(2);
  });
  it("rejects delivery for another account or invalid dates, but records delivery on a voided bill", async () => {
    const db = open(); await profile(db); await profile(db, 2); const first = await issue(db);
    const parameters = { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_account_slot: 1, p_delivery: { deliveryNo: "DEL-1", deliveryDate: "2026-10-28" } };
    expect((await db.rpc("record_bill_delivery", { ...parameters, p_account_slot: 2 })).error?.message).toContain("this account");
    expect((await db.rpc("record_bill_delivery", { ...parameters, p_delivery: { deliveryNo: "DEL-1", deliveryDate: "2026-10-02" } })).error?.message).toContain("before the bill date");
    expect((await db.rpc("record_bill_delivery", { ...parameters, p_delivery: { deliveryNo: "", deliveryDate: "2026-02-30" } })).error).toBeTruthy();
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
    const parameters = (id: string, account = 1) => ({ p_owner_id: localOwnerId, p_bill_id: id, p_account_slot: account, p_delivery: { deliveryDate: "2026-11-29" } });
    const results = await Promise.all([db.rpc("record_bill_delivery", parameters(first.data.id)), db.rpc("record_bill_delivery", parameters(second.data.id)), db.rpc("record_bill_delivery", parameters(other.data.id, 2))]);
    expect(results.every(result => !result.error)).toBe(true);
    const saved = await Promise.all([first, second, other].map(result => db.from("bills").select().eq("id", result.data.id).single()));
    expect(saved.map(result => result.data.delivery_no)).toEqual(["1", "2", "1"]);
    expect(saved[0].data.delivery_summary).toMatchObject({ chargedMonths: 1, principal: 10000, initialInterest: 200, interest: 200, total: 10200 });
    await db.rpc("record_bill_delivery", { ...parameters(first.data.id), p_delivery: { deliveryDate: "2026-12-29" } });
    expect((await db.from("bills").select().eq("id", first.data.id).single()).data).toMatchObject({ delivery_no: "1", delivery_summary: { interest: 400, total: 10400 } });
    expect((await db.rpc("get_next_delivery_number", { p_owner_id: localOwnerId, p_account_slot: 1 })).data.number).toBe(3);
  });
  it("continues after existing numeric delivery numbers and keeps old delivery references", async () => {
    const db = open(); await profile(db);
    const original = await issue(db, { ...bill, deliveryNo: "15", deliveryDate: "2026-10-28" });
    const next = await issue(db);
    expect((await db.rpc("get_next_delivery_number", { p_owner_id: localOwnerId, p_account_slot: 1 })).data.number).toBe(16);
    await db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: next.data.id, p_account_slot: 1, p_delivery: { deliveryDate: "2026-10-28" } });
    expect((await db.from("bills").select().eq("id", original.data.id).single()).data.delivery_no).toBe("15");
    expect((await db.from("bills").select().eq("id", next.data.id).single()).data.delivery_no).toBe("16");
  });
  it("lets an older voided bill supply missing metals before calculating delivery interest", async () => {
    const db = open(); const saved = await profile(db); const first = await issue(db);
    const stored = new DatabaseSync(join(opened[0].directory, "billing.sqlite"));
    stored.prepare("UPDATE records SET body=json_remove(body,'$.metal') WHERE table_name='bill_items'").run(); stored.close();
    await db.from("bills").update({ status: "void" }).eq("id", first.data.id);
    const parameters = { p_owner_id: localOwnerId, p_bill_id: first.data.id, p_account_slot: 1, p_delivery: { deliveryDate: "2026-10-28" } };
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
    await db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: oldBill.data.id, p_account_slot: 1, p_delivery: { deliveryDate: "2026-10-28" } });
    const previousProfiles = (await db.from("business_profiles").select().order("account_slot")).data;
    const previousBills = (await db.from("bills").select("*, bill_items(*)").eq("profile_id", first.id).order("bill_number")).data;
    const fourth = await add(db); const fifth = await add(db);
    const issued = await issue(db, { ...bill, accountSlot: fourth.data.account_slot });
    expect(issued.error).toBeNull();
    expect((await db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: issued.data.id, p_account_slot: 4, p_delivery: { deliveryDate: "2026-10-28" } })).error).toBeNull();
    expect((await db.from("bills").select().eq("id", issued.data.id).single()).data).toMatchObject({ profile_id: fourth.data.id, bill_number: 1, delivery_no: "1", business_snapshot: { business_name: details.businessName, license_number: details.licenseNumber } });
    expect((await db.from("business_profiles").select().eq("id", fourth.data.id).single()).data).toMatchObject({ next_bill_number: 2, next_delivery_number: 2 });
    expect((await db.from("bills").select().eq("profile_id", fifth.data.id)).data).toEqual([]);
    expect((await db.from("business_profiles").select().lte("account_slot", 3).order("account_slot")).data).toEqual(previousProfiles);
    expect((await db.from("bills").select("*, bill_items(*)").eq("profile_id", first.id).order("bill_number")).data).toEqual(previousBills);
    expect((await db.rpc("record_bill_delivery", { p_owner_id: localOwnerId, p_bill_id: issued.data.id, p_account_slot: 5, p_delivery: { deliveryDate: "2026-10-29" } })).error?.message).toContain("this account");
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
