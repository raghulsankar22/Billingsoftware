import { describe, expect, it } from "vitest";
import { toBill } from "./bills";
import { declarationGroups, lostBillDeliveries, maskedId } from "./lost-bill";
import { billRegisterRow } from "./register";
import type { Bill } from "./types";

const bill = (values: Partial<Bill>): Bill => ({
  id: crypto.randomUUID(), billNumber: 1, status: "issued", billDate: "2026-10-01", customerName: "Kumar", fatherName: "Raman", address: "12 Main Street", phone: "9000000001",
  items: [{ metal: "Gold", particulars: "Ring 1", grams: 2, assessedValue: 9000, loanAmount: 5000 }], totalAssessedValue: 9000, totalLoanAmount: 5000, amountInWords: "Five thousand rupees only",
  excelSyncStatus: "synced", createdAt: "2026-10-01T00:00:00.000Z", ...values,
});

describe("customer bill lost", () => {
  it("lists only delivered bills where the customer lost the bill, and searches them", () => {
    const lost = bill({ billNumber: 4, deliveryNo: "7", deliveryDate: "2026-11-02", deliveryBillReceiptStatus: "lost_bill" });
    const kept = bill({ billNumber: 5, deliveryNo: "8", deliveryDate: "2026-11-02", deliveryBillReceiptStatus: "has_bill" });
    const waiting = bill({ billNumber: 6, deliveryBillReceiptStatus: "lost_bill" });
    const other = bill({ billNumber: 9, customerName: "Selvi", phone: "9000000002", deliveryNo: "9", deliveryDate: "2026-11-01", deliveryBillReceiptStatus: "lost_bill" });
    expect(lostBillDeliveries([lost, kept, waiting, other]).map(entry => entry.billNumber)).toEqual([9, 4]);
    expect(lostBillDeliveries([lost, kept, waiting, other], "selvi").map(entry => entry.billNumber)).toEqual([9]);
  });
  it("prints only the last four characters of an ID", () => {
    expect(maskedId("1234 5678 9012")).toBe("XXXXXXXX9012");
    expect(maskedId("")).toBe("");
    expect(maskedId("12")).toBe("12");
  });
  it("puts each customer's bills on one page", () => {
    const groups = declarationGroups([bill({ billNumber: 1 }), bill({ billNumber: 2, customerName: "Selvi" }), bill({ billNumber: 3 })]);
    expect(groups.map(group => group.map(entry => entry.billNumber))).toEqual([[1, 3], [2]]);
  });
  it("reads the signed date and notes it in the Excel register", () => {
    const row = { id: "x", bill_number: 1, status: "issued", bill_date: "2026-10-01", customer_name: "Kumar", father_name: "Raman", address: "12 Main Street", phone: "", items: [], total_loan_amount: 5000, delivery_no: "1", delivery_date: "2026-11-02" };
    const signed = toBill({ ...row, delivery_bill_receipt_status: "lost_bill", delivery_lost_bill_declared_at: "2026-11-02T10:00:00.000Z" });
    expect(signed.lostBillDeclaredAt).toBe("2026-11-02T10:00:00.000Z");
    expect(String(billRegisterRow(signed)[6])).toContain("[Declaration signed]");
    // A stale date never shows once the bill is marked as "has bill".
    expect(toBill({ ...row, delivery_bill_receipt_status: "has_bill", delivery_lost_bill_declared_at: "2026-11-02T10:00:00.000Z" }).lostBillDeclaredAt).toBeUndefined();
  });
});
