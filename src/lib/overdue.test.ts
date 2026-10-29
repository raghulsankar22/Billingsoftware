import { describe, expect, it } from "vitest";
import type { Bill } from "./types";
import { overdueBillHistory, overduePeriod } from "./overdue";

function bill(id: string, patch: Partial<Bill> = {}): Bill {
  return { id, billNumber: 1, billDate: "2025-10-01", status: "issued", customerName: "Test Customer", fatherName: "Test Parent", address: "123 Test Street", phone: "1234567890", items: [], totalAssessedValue: 11000, totalLoanAmount: 10000, amountInWords: "Rupees Ten Thousand Only", excelSyncStatus: "synced", createdAt: "2025-10-01T00:00:00Z", ...patch };
}

describe("monthly overdue cohorts", () => {
  it("uses the whole previous-year month, including days after today's day number", () => {
    expect(overduePeriod("2026-10")).toEqual({ from: "2025-10-01", to: "2025-10-31" });
    expect(overdueBillHistory([
      bill("before", { billDate: "2025-09-30" }), bill("first"), bill("last", { billDate: "2025-10-31" }),
      bill("after", { billDate: "2025-11-01" }), bill("older", { billDate: "2024-10-01" }), bill("current", { billDate: "2026-10-01" }),
    ], "2026-10").map(row => row.id)).toEqual(["first", "last"]);
  });
  it("supports all twelve months, year boundaries and actual leap-year month lengths", () => {
    const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    lengths.forEach((days, index) => {
      const month = String(index + 1).padStart(2, "0");
      expect(overduePeriod(`2026-${month}`)).toEqual({ from: `2025-${month}-01`, to: `2025-${month}-${days}` });
    });
    expect(overduePeriod("2025-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(overduePeriod("2101-02").to).toBe("2100-02-28");
    expect(overduePeriod("2001-02").to).toBe("2000-02-29");
  });
  it("excludes completed deliveries, including deliveries on voided bills", () => {
    const pending = bill("pending");
    const voided = bill("voided", { status: "void", billNumber: 2 });
    const delivered = bill("delivered", { deliveryNo: "1", deliveryDate: "2026-10-28" });
    const deliveredVoid = bill("delivered-void", { status: "void", deliveryNo: "2", deliveryDate: "2026-10-29" });
    expect(overdueBillHistory([delivered, deliveredVoid, voided, pending], "2026-10").map(row => row.id)).toEqual(["pending", "voided"]);
  });
  it("keeps bills with incomplete delivery records visible until delivery is completed", () => {
    expect(overdueBillHistory([bill("no-date", { deliveryNo: "1" }), bill("no-number", { deliveryDate: "2026-10-29" }), bill("whitespace", { deliveryNo: " ", deliveryDate: " " })], "2026-10")).toHaveLength(3);
  });
  it("filters literal customer details and keeps deterministic ordering without mutating history", () => {
    const late = bill("late", { billNumber: 3, billDate: "2025-10-30", customerCode: "C000001", customerName: "A.B (Gold)" });
    const early = bill("early", { billNumber: 2 });
    const input = [late, early];
    expect(overdueBillHistory(input, "2026-10").map(row => row.id)).toEqual(["early", "late"]);
    expect(input[0]).toBe(late);
    expect(overdueBillHistory(input, "2026-10", "c000001")).toEqual([late]);
    expect(overdueBillHistory(input, "2026-10", "A.B (Gold)")).toEqual([late]);
    expect(overdueBillHistory(input, "2026-10", "123 test street")).toHaveLength(2);
    expect(overdueBillHistory(input, "2026-10", "nobody")).toEqual([]);
  });
  it.each(["", "2026-00", "2026-13", "2026-1", "2026-10-29", "2026-10junk", "0001-10", "abcd-10"])("rejects invalid review month %s", month => {
    expect(() => overduePeriod(month)).toThrow("valid review month");
  });
});
