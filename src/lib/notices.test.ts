import { describe, expect, it } from "vitest";
import { noticeBillHistory, noticePeriod } from "./notices";
import type { Bill } from "./types";

const bill = (id: string, billDate: string, patch: Partial<Bill> = {}): Bill => ({
  id, billNumber: 1, billDate, status: "issued", customerName: "Example Customer", fatherName: "Parent", address: "Example Street", phone: "", items: [], totalAssessedValue: 1100, totalLoanAmount: 1000, amountInWords: "Rupees One Thousand Only", excelSyncStatus: "synced", createdAt: "2025-01-01T00:00:00Z", ...patch,
});

describe("monthly notice lists", () => {
  it("uses October last year for Notice 1 and September last year for Notice 2", () => {
    expect(noticePeriod("2026-10", 1)).toEqual({ from: "2025-10-01", to: "2025-10-31" });
    expect(noticePeriod("2026-10", 2)).toEqual({ from: "2025-09-01", to: "2025-09-30" });
    const bills = [bill("sep-first", "2025-09-01"), bill("sep-last", "2025-09-30"), bill("oct-first", "2025-10-01"), bill("oct-last", "2025-10-31"), bill("older", "2025-08-31"), bill("newer", "2025-11-01")];
    expect(noticeBillHistory(bills, "2026-10", 1).map(row => row.id)).toEqual(["oct-first", "oct-last"]);
    expect(noticeBillHistory(bills, "2026-10", 2).map(row => row.id)).toEqual(["sep-first", "sep-last"]);
  });
  it("handles every month, January rollover and leap years", () => {
    for (let month = 1; month <= 12; month++) {
      const review = `2026-${String(month).padStart(2, "0")}`;
      const range = noticePeriod(review, 2);
      expect(range.from.slice(0, 7)).toBe(month === 1 ? "2024-12" : `2025-${String(month - 1).padStart(2, "0")}`);
      expect(range.to.slice(0, 7)).toBe(range.from.slice(0, 7));
    }
    expect(noticePeriod("2025-03", 2)).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(noticePeriod("2026-03", 2).to).toBe("2025-02-28");
  });
  it("excludes delivered bills while retaining voided and incomplete deliveries in both stages", () => {
    for (const stage of [1, 2] as const) {
      const date = stage === 1 ? "2025-10-01" : "2025-09-01";
      const bills = [bill("delivered", date, { deliveryNo: "1", deliveryDate: "2026-10-29" }), bill("void-delivered", date, { status: "void", deliveryNo: "2", deliveryDate: "2026-10-29" }), bill("pending", date, { customerCode: "C000003" }), bill("void", date, { status: "void" }), bill("incomplete", date, { deliveryNo: "3" })];
      expect(noticeBillHistory(bills, "2026-10", stage).map(row => row.id)).toEqual(["incomplete", "pending", "void"]);
      expect(noticeBillHistory(bills, "2026-10", stage, "c000003").map(row => row.id)).toEqual(["pending"]);
    }
  });
  it.each(["", "2026-00", "2026-13", "2026-1", "0001-10"])("rejects invalid review month %s", month => {
    expect(() => noticePeriod(month, 2)).toThrow();
  });
});
