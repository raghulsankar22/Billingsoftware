import { describe, expect, it } from "vitest";
import { toBill, totals } from "./bills";
import type { BillInput } from "./types";

describe("bill persistence mapping", () => {
  it("restores pledge items in their issued order", () => {
    const bill = toBill({ items: [
      { particulars: "Chain", grams: "2", assessed_value: "200", loan_amount: "100", sort_order: 1 },
      { particulars: "Ring", grams: "1", assessed_value: "100", loan_amount: "50", sort_order: 0 },
    ] });
    expect(bill.items.map((item) => item.particulars)).toEqual(["Ring", "Chain"]);
  });
  it("adds currency in paise without accumulated binary fractions", () => {
    const input: BillInput = { billDate: "2026-10-03", customerName: "Customer", fatherName: "Father", address: "123 Road", phone: "9876543210", items: [
      { particulars: "Ring", grams: 1, assessedValue: 0.1, loanAmount: 0.1 },
      { particulars: "Chain", grams: 2, assessedValue: 0.2, loanAmount: 0.2 },
    ] };
    expect(totals(input)).toEqual({ assessedValue: 0.3, loanAmount: 0.3 });
  });
});
