import { describe, expect, it } from "vitest";
import type { Bill } from "./types";
import { overdueBillHistory, overduePeriod } from "./overdue";

function bill(id: string, patch: Partial<Bill> = {}): Bill {
  return { id, billNumber: 1, billDate: "2025-10-01", status: "issued", customerName: "Test Customer", fatherName: "Test Parent", address: "123 Test Street", phone: "1234567890", items: [], totalAssessedValue: 11000, totalLoanAmount: 10000, amountInWords: "Rupees Ten Thousand Only", excelSyncStatus: "synced", createdAt: "2025-10-01T00:00:00Z", ...patch };
}

describe("age-based overdue bills", () => {
  it("includes every older month and year, but only after 365 days", () => {
    expect(overduePeriod("2026-11-02")).toEqual({ from: "0001-01-01", to: "2025-11-01" });
    expect(overdueBillHistory([
      bill("older", { billDate: "2024-10-01" }), bill("previous-month", { billDate: "2025-09-30" }),
      bill("day-366", { billDate: "2025-11-01" }), bill("day-365", { billDate: "2025-11-02" }),
      bill("recent", { billDate: "2026-10-01" }), bill("future", { billDate: "2027-01-01" }),
    ], "2026-11-02").map(row => row.id)).toEqual(["older", "previous-month", "day-366"]);
  });
  it("counts elapsed days across leap years rather than calendar anniversaries", () => {
    expect(overduePeriod("2025-02-28").to).toBe("2024-02-28");
    expect(overduePeriod("2024-03-01").to).toBe("2023-03-01");
    expect(overduePeriod("2026-01-01").to).toBe("2024-12-31");
  });
  it("excludes completed deliveries, including deliveries on voided bills", () => {
    const pending = bill("pending");
    const voided = bill("voided", { status: "void", billNumber: 2 });
    const delivered = bill("delivered", { deliveryNo: "1", deliveryDate: "2026-10-28" });
    const deliveredVoid = bill("delivered-void", { status: "void", deliveryNo: "2", deliveryDate: "2026-10-29" });
    expect(overdueBillHistory([delivered, deliveredVoid, voided, pending], "2026-11-02").map(row => row.id)).toEqual(["pending", "voided"]);
  });
  it("keeps bills with incomplete delivery records visible until delivery is completed", () => {
    expect(overdueBillHistory([bill("no-date", { deliveryNo: "1" }), bill("no-number", { deliveryDate: "2026-10-29" }), bill("whitespace", { deliveryNo: " ", deliveryDate: " " })], "2026-11-02")).toHaveLength(3);
  });
  it("excludes imported historical deliveries even when a delivery detail is missing", () => {
    expect(overdueBillHistory([bill("no-date", { historicalDelivery: true, deliveryNo: "1" }), bill("no-number", { historicalDelivery: true, deliveryDate: "2026-10-29" }), bill("pending")], "2026-11-02").map(row => row.id)).toEqual(["pending"]);
  });
  it("filters literal customer details and keeps deterministic ordering without mutating history", () => {
    const late = bill("late", { billNumber: 3, billDate: "2025-10-30", customerCode: "C000001", customerName: "A.B (Gold)" });
    const early = bill("early", { billNumber: 2 });
    const input = [late, early];
    expect(overdueBillHistory(input, "2026-11-02").map(row => row.id)).toEqual(["early", "late"]);
    expect(input[0]).toBe(late);
    expect(overdueBillHistory(input, "2026-11-02", "c000001")).toEqual([late]);
    expect(overdueBillHistory(input, "2026-11-02", "A.B (Gold)")).toEqual([late]);
    expect(overdueBillHistory(input, "2026-11-02", "123 test street")).toHaveLength(2);
    expect(overdueBillHistory(input, "2026-11-02", "nobody")).toEqual([]);
  });
  it.each(["", "2026-00-01", "2026-13-01", "2026-1-01", "2026-02-30", "2026-10junk", "0001-10-01", "abcd-10-01"])("rejects invalid as-of date %s", month => {
    expect(() => overduePeriod(month)).toThrow("valid date");
  });
});
