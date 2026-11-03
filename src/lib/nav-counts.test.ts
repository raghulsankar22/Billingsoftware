import { describe, expect, it } from "vitest";
import { badgeText, navCounts } from "./nav-counts";
import type { Bill } from "./types";

let next = 1;
const bill = (billDate: string, patch: Partial<Bill> = {}): Bill => ({
  id: `b${next}`, billNumber: next++, status: "issued", billDate, customerName: "Sample", fatherName: "Parent", address: "1 Street", phone: "",
  items: [{ metal: "Gold", particulars: "Ring 1", grams: 1, assessedValue: 1000, loanAmount: 800 }], totalAssessedValue: 1000, totalLoanAmount: 800,
  amountInWords: "Eight hundred rupees only", excelSyncStatus: "synced", createdAt: `${billDate}T00:00:00.000Z`, ...patch,
});
const delivered = { deliveryNo: "1", deliveryDate: "2026-11-01" };

describe("menu counts", () => {
  it("counts one account's bills with the same rules as each screen", () => {
    const bills = [
      bill("2025-11-10"),                                                        // Notice 1 for Nov 2026; not yet 366 days old
      bill("2025-10-20"),                                                        // Notice 2 for Nov 2026; overdue (378 days)
      bill("2025-11-01"),                                                        // Notice 1; exactly 366 days before 2026-11-02 → overdue
      bill("2025-11-03"),                                                        // Notice 1; only 364 days → not overdue
      bill("2024-05-05"),                                                        // overdue only
      bill("2025-11-12", delivered),                                             // delivered: never counted as pending
      bill("2026-10-01", { ...delivered, deliveryBillReceiptStatus: "lost_bill" }), // lost-bill delivery
      bill("2024-01-01", { status: "void" }),                                    // voided but undelivered: still overdue, like the Overdue screen
    ];
    expect(navCounts(bills, "2026-11-02")).toEqual({ bills: 8, lostBills: 1, notice: 4, overdue: 4 });
  });
  it("shows zero for an empty account and never throws on a bad date", () => {
    expect(navCounts([], "2026-11-02")).toEqual({ bills: 0, lostBills: 0, notice: 0, overdue: 0 });
    expect(navCounts([bill("2025-01-01")], "not-a-date")).toMatchObject({ bills: 1, notice: 0, overdue: 0 });
  });
  it("shortens large badges to fit the slim bar", () => {
    expect([0, 7, 999, 1000, 1248, 9999, 12_345, 2_000_000].map(badgeText)).toEqual(["0", "7", "999", "1k", "1.2k", "9.9k", "12k", "1M+"]);
  });
});
