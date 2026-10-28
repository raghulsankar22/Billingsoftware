import { describe, expect, it } from "vitest";
import { calculateRepayment } from "./interest";
import type { BillItemInput } from "./types";

const item = (metal: "Gold" | "Silver" | undefined, loanAmount: number): BillItemInput => ({ metal, particulars: "Ring", grams: 1, assessedValue: loanAmount + 1000, loanAmount });

describe("bill repayment overview", () => {
  it("charges the first extra month only after the calendar anniversary", () => {
    const result = calculateRepayment([item("Gold", 6000)], "2026-10-28", "2026-11-29");
    expect(result.chargedMonths).toBe(1);
    expect(result.lines[0]).toMatchObject({ ratePercent: 2, principal: 6000, initialInterest: 120, interest: 120, total: 6120 });
    expect(result.total).toBe(6120);
    expect(calculateRepayment([item("Gold", 10000)], "2026-10-28", "2026-11-28")).toMatchObject({ chargedMonths: 0, initialInterest: 200, interest: 0, total: 10000 });
    expect(calculateRepayment([item("Gold", 10000)], "2026-10-28", "2026-11-29")).toMatchObject({ chargedMonths: 1, initialInterest: 200, interest: 200, total: 10200 });
    expect(calculateRepayment([item("Gold", 10000)], "2026-10-28", "2026-12-29")).toMatchObject({ chargedMonths: 2, initialInterest: 200, interest: 400, total: 10400 });
  });
  it("uses 2.5% for gold at or below ₹5,000 and 3% for silver", () => {
    const result = calculateRepayment([item("Gold", 5000), item("Silver", 10000)], "2026-10-28", "2026-11-27");
    expect(result.lines.map((line) => line.ratePercent)).toEqual([2.5, 3]);
    expect(result).toMatchObject({ chargedMonths: 0, principal: 15000, initialInterest: 425, interest: 0, total: 15000 });
  });
  it("applies the gold threshold to the combined gold loan in the bill", () => {
    const result = calculateRepayment([item("Gold", 3000), item("Gold", 3000), item("Silver", 1000)], "2026-10-28", "2026-11-27");
    expect(result.lines.map((line) => line.ratePercent)).toEqual([2, 2, 3]);
    expect(result).toMatchObject({ principal: 7000, initialInterest: 150, interest: 0, total: 7000 });
  });
  it("shows zero interest on the bill date and rejects earlier dates", () => {
    expect(calculateRepayment([item("Silver", 1000)], "2026-10-28", "2026-10-28")).toMatchObject({ initialInterest: 30, interest: 0, total: 1000 });
    expect(() => calculateRepayment([item("Silver", 1000)], "2026-10-28", "2026-10-27")).toThrow("before the bill date");
  });
  it("does not invent a rate for an older bill without a metal", () => {
    const result = calculateRepayment([item(undefined, 1000)], "2026-10-28", "2026-11-27");
    expect(result).toMatchObject({ missingMetal: true, principal: 1000, initialInterest: null, interest: null, total: null });
  });
  it("uses the last day of a shorter month as its anniversary", () => {
    expect(calculateRepayment([item("Silver", 1000)], "2027-01-31", "2027-02-28")).toMatchObject({ chargedMonths: 0, total: 1000 });
    expect(calculateRepayment([item("Silver", 1000)], "2027-01-31", "2027-03-01")).toMatchObject({ chargedMonths: 1, total: 1030 });
  });
});
