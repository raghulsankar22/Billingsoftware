import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createLocalDatabase, localOwnerId } from "./local-database";
import { loadGlobalSearch } from "./global-search";

let directory: string;
let db: ReturnType<typeof createLocalDatabase>;
let stored: DatabaseSync;
const seed = (table: string, row: Record<string, unknown>) => stored.prepare("INSERT INTO records(table_name,id,body) VALUES(?,?,?)").run(table, String(row.id), JSON.stringify(row));
function bill(id: string, accountSlot = 1, values: Record<string, unknown> = {}) {
  seed("bills", { id, profile_id: `p${accountSlot}`, bill_number: 1, bill_date: "2026-10-01", customer_name: "Test Customer", father_name: "Parent", address: "123 Main Street", phone: "9876543210", government_id: "123456789012", status: "issued", created_at: "2026-10-01T00:00:00Z", total_loan_amount: 100, ...values });
}
const search = (q: string, params: Record<string, string> = {}) => loadGlobalSearch(db, localOwnerId, new URLSearchParams({ q, ...params }));
const ids = (result: Awaited<ReturnType<typeof search>>) => result.results.map(result => result.bill.id);

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "billing-global-search-"));
  db = createLocalDatabase(directory);
  stored = new DatabaseSync(join(directory, "billing.sqlite"));
  for (const accountSlot of [1, 2, 4, 17]) {
    seed("business_profiles", { id: `p${accountSlot}`, account_slot: accountSlot, owner_id: localOwnerId, business_name: `Finance ${accountSlot}`, address: `${accountSlot} Business Road`, phone: "1234567890", logo_url: null, license_number: `TN/${accountSlot}` });
  }
  seed("business_profiles", { id: "foreign", account_slot: 3, owner_id: "another-owner", business_name: "Private Finance" });
});
afterEach(() => { stored.close(); db.close(); rmSync(directory, { recursive: true, force: true }); });

describe("all-account bill search", () => {
  it("searches all owned profiles, including later accounts, with their own profile and full history", async () => {
    bill("one");
    bill("two", 2, { status: "void" });
    bill("four", 4, { delivery_no: "1", delivery_date: "2026-10-10", business_snapshot: { business_name: "Old Finance" } });
    bill("seventeen", 17);
    bill("foreign-bill", 1, { profile_id: "foreign" });
    seed("bill_items", { id: "item", bill_id: "one", metal: "Gold", particulars: "Ring", grams: 1, loan_amount: 100, assessed_value: 200, sort_order: 0 });
    const result = await search("tEsT cUsToMeR", { account: "2" });
    expect(ids(result)).toEqual(["one", "two", "four", "seventeen"]);
    expect(result).toMatchObject({ total: 4, page: 1, pageSize: 50, hasMore: false });
    expect(result.results[2]).toMatchObject({ accountSlot: 4, profile: { business_name: "Finance 4", address: "4 Business Road", license_number: "TN/4" }, bill: { billNumber: 1, deliveryNo: "1", businessSnapshot: { business_name: "Old Finance" } } });
    expect(result.results[0].bill.items).toEqual([{ metal: "Gold", particulars: "Ring", grams: 1, loanAmount: 100, assessedValue: 200 }]);
    expect(result.results[1].bill.status).toBe("void");
    await expect(loadGlobalSearch(db, "another-owner", new URLSearchParams({ q: "Test" }))).rejects.toThrow("Invalid local owner");
  });

  it("matches address, phone and Aadhaar snapshots including formatted and partial identifiers", async () => {
    bill("one", 1, { phone: "+91 (98765) 43210", government_id: "1234-5678 9012" });
    for (const q of ["MAIN STREET", "9876543210", "+91 98765-43210", "43210", "123456789012", "1234 5678-9012", "5678"]) {
      expect(ids(await search(q))).toEqual(["one"]);
    }
    expect(ids(await search("Customer7"))).toEqual([]);
    expect(ids(await search("+"))).toEqual(["one"]);
    expect(ids(await search("()"))).toEqual([]);
  });

  it("treats wildcard, regex and query syntax as literal text", async () => {
    const special = 'A,B (Gold) .* %_ \\"';
    bill("literal", 1, { customer_name: special });
    bill("plain", 2);
    for (const q of [special, ".*", "%_", 'Gold) .*', '\\"']) expect(ids(await search(q))).toEqual(["literal"]);
    expect(ids(await search("customer_name.eq.Test Customer"))).toEqual([]);
  });

  it("matches canonical codes and UUID links, and resolves legacy bills only by exact same-profile identity", async () => {
    const customer = db.customers.save(1, { name: "Test Customer", fatherName: "Parent", address: "123 Main Street", phone: "9876543210", aadhaar: "123456789012" });
    const other = db.customers.save(1, { name: "Test Customer", fatherName: "Parent", address: "123 Main Street", phone: "8888888888", aadhaar: "" });
    const elsewhere = db.customers.save(2, { name: "Test Customer", fatherName: "Parent", address: "123 Main Street", phone: "9876543210", aadhaar: "123456789012" });
    bill("linked", 1, { customer_id: customer.id, customer_code: customer.customerCode, phone: "", government_id: "" });
    bill("uuid-only", 1, { bill_number: 2, customer_id: customer.id, phone: "", government_id: "" });
    bill("code-only", 1, { bill_number: 3, customer_code: customer.customerCode, phone: "", government_id: "" });
    bill("legacy-phone", 1, { bill_number: 4, phone: "+91 98765 43210", government_id: "" });
    bill("legacy-aadhaar", 1, { bill_number: 5, phone: "", government_id: "1234-5678-9012" });
    bill("same-name", 1, { bill_number: 6, phone: "", government_id: "" });
    bill("different-link", 1, { bill_number: 7, customer_id: other.id });
    bill("different-code", 1, { bill_number: 8, customer_code: other.customerCode });
    bill("different-profile", 2);
    const result = await search(customer.customerCode.toLowerCase());
    expect(ids(result)).toEqual(["legacy-aadhaar", "legacy-phone", "code-only", "uuid-only", "linked"]);
    expect(result.total).toBe(5);
    expect(result.results.filter(result => result.matchedCustomerCode).map(result => result.bill.id)).toEqual(["legacy-aadhaar", "legacy-phone"]);
    expect(result.results[0]).toMatchObject({ matchedCustomerCode: customer.customerCode, bill: { customerCode: undefined, customerId: undefined } });
    expect(ids(await search(`C-${customer.customerCode.slice(1)}`))).toEqual(ids(result));
    expect(ids(await search(customer.id))).toEqual(["uuid-only", "linked"]);
    expect(ids(await search(elsewhere.customerCode))).toEqual(["different-profile"]);
  });

  it("sorts and paginates the complete match set without losing or duplicating bills", async () => {
    for (let index = 0; index < 235; index++) {
      const account = [1, 2, 4, 17][index % 4];
      bill(`bill-${String(index).padStart(3, "0")}`, account, { bill_number: Math.floor(index / 4) + 1, bill_date: index % 3 === 0 ? "2026-10-03" : "2026-10-01" });
    }
    const full = [];
    for (let page = 1; page <= 3; page++) {
      const result = await search("Main", { page: String(page), pageSize: "100" });
      expect(result).toMatchObject({ total: 235, page, pageSize: 100, hasMore: page < 3 });
      full.push(...result.results);
    }
    expect(full).toHaveLength(235);
    expect(new Set(full.map(result => result.bill.id)).size).toBe(235);
    for (let index = 1; index < full.length; index++) {
      const left = full[index - 1], right = full[index];
      expect(left.bill.billDate > right.bill.billDate || (left.bill.billDate === right.bill.billDate && (left.accountSlot < right.accountSlot || (left.accountSlot === right.accountSlot && left.bill.billNumber > right.bill.billNumber)))).toBe(true);
    }
    expect(await search("Main", { page: "4", pageSize: "100" })).toMatchObject({ results: [], total: 235, hasMore: false });
  });

  it("uses full customer codes as exact identities instead of matching code prefixes or text mentions", async () => {
    bill("exact-code", 1, { customer_code: "C100000" });
    bill("longer-code", 1, { bill_number: 2, customer_code: "C1000000" });
    bill("name-mention", 2, { customer_name: "Customer C100000" });
    bill("address-mention", 4, { address: "C100000 Main Street" });
    for (const q of ["C100000", "c100000", "C-100000"]) expect(ids(await search(q))).toEqual(["exact-code"]);
    expect(ids(await search("C1000000"))).toEqual(["longer-code"]);
  });

  it("does not infer legacy identity from a shared phone when Aadhaar conflicts", async () => {
    const customer = db.customers.save(1, { name: "Test Customer", fatherName: "Parent", address: "123 Main Street", phone: "9876543210", aadhaar: "123456789012" });
    bill("conflicting-aadhaar", 1, { government_id: "9999-9999-9999" });
    bill("changed-phone", 1, { bill_number: 2, phone: "8888888888", government_id: "1234-5678 9012" });
    bill("missing-aadhaar", 1, { bill_number: 3, government_id: "" });
    bill("older-general-id", 1, { bill_number: 4, government_id: "ID-123" });
    const result = await search(customer.customerCode);
    expect(ids(result)).toEqual(["older-general-id", "missing-aadhaar", "changed-phone"]);
    expect(result.results.every(result => result.matchedCustomerCode === customer.customerCode)).toBe(true);
    expect(ids(await search("9876543210"))).toEqual(["older-general-id", "missing-aadhaar", "conflicting-aadhaar"]);
  });

  it("rejects empty, overlong and malformed pagination inputs", async () => {
    for (const q of ["", " ", "x".repeat(201)]) await expect(search(q)).rejects.toThrow();
    const invalidPages: Record<string, string>[] = [{ page: "0" }, { page: "1.1" }, { page: "-2" }, { page: "9007199254740991" }, { pageSize: "101" }, { pageSize: "0" }, { pageSize: "abc" }];
    for (const params of invalidPages) {
      await expect(search("Test", params)).rejects.toThrow();
    }
    expect(await search("missing")).toMatchObject({ results: [], total: 0, hasMore: false });
  });
});
