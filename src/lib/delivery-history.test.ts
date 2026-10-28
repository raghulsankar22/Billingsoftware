import { describe, expect, it } from "vitest";
import { deliveryBillHistory, deliveryCollection } from "./delivery-history";
import type { Bill } from "./types";

const delivered: Bill = {
  id: "delivered", billNumber: 42, billDate: "2026-10-28", deliveryNo: "2", deliveryDate: "2026-11-29", status: "issued",
  customerName: "Sample Customer", fatherName: "Father", address: "Sample address", phone: "9876543210",
  items: [{ metal: "Gold", particulars: "Gold ring", grams: 5, assessedValue: 15000, loanAmount: 10000 }],
  totalAssessedValue: 15000, totalLoanAmount: 10000, amountInWords: "Rupees Ten Thousand Only", excelSyncStatus: "synced", createdAt: "2026-10-28T00:00:00Z",
};

describe("delivery bill history", () => {
  it("includes both issued and voided delivered bills, but no incomplete delivery entries", () => {
    const voided = { ...delivered, id: "voided", status: "void" as const, deliveryNo: "10" };
    const bills = [delivered, voided, { ...delivered, id: "not-delivered", deliveryNo: "" }, { ...delivered, id: "missing-date", deliveryDate: "" }];
    expect(deliveryBillHistory(bills).map(bill => bill.id)).toEqual(["voided", "delivered"]);
    expect(bills[0].id).toBe("delivered");
  });
  it.each(["#2", "42", "customer", "9876543210", "2026-11-29", "29/11/2026", "29-11-2026", "gold ring"])("finds delivery receipts by %s", query => {
    expect(deliveryBillHistory([delivered], query)).toHaveLength(1);
  });
  it("returns no unrelated results or regex-style matches", () => {
    expect(deliveryBillHistory([delivered], "absent")).toEqual([]);
    expect(deliveryBillHistory([delivered], ".*")).toEqual([]);
  });
  it("uses the delivery date rather than today for the collection balance", () => {
    expect(deliveryCollection(delivered)).toMatchObject({ principal: 10000, interest: 200, total: 10200 });
  });
  it("preserves an existing saved delivery collection snapshot", () => {
    const summary = deliveryCollection(delivered)!;
    expect(deliveryCollection({ ...delivered, deliveryDate: "2027-12-29", deliverySummary: summary })).toBe(summary);
    expect(deliveryCollection({ ...delivered, deliveryDate: "" })).toBeNull();
  });
});
