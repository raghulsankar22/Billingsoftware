import { describe, expect, it } from "vitest";
import { amountInWords, assessedValueForLoan, itemSummary } from "./money";

describe("assessedValueForLoan", () => {
  it("adds ten percent to the loan amount", () => {
    expect(assessedValueForLoan(10000)).toBe(11000);
    expect(assessedValueForLoan(5000)).toBe(5500);
    expect(assessedValueForLoan(1234.56)).toBe(1358.02);
    expect(assessedValueForLoan(1.05)).toBe(1.16);
  });
  it("clears the assessment when the loan is empty or invalid", () => {
    for (const loan of [0, -1, NaN, Infinity]) expect(assessedValueForLoan(loan)).toBe(0);
  });
});

describe("amountInWords", () => {
  it("formats Indian rupee groups", () => {
    expect(amountInWords(1254300)).toBe("Rupees Twelve Lakh Fifty Four Thousand Three Hundred Only");
  });

  it("includes paise when supplied", () => {
    expect(amountInWords(8000.5)).toBe("Rupees Eight Thousand and Fifty Paise Only");
  });

  it("names zero rupees for amounts below one rupee", () => {
    expect(amountInWords(0.5)).toBe("Rupees Zero and Fifty Paise Only");
  });
});

describe("itemSummary", () => {
  it("keeps all pledged items in one Excel register cell", () => {
    expect(itemSummary([{ particulars: "Gold Ring", grams: 3.2, assessedValue: 10000, loanAmount: 8000 }, { particulars: "Chain", grams: 7, assessedValue: 22000, loanAmount: 18000 }])).toBe("Gold Ring (3.2 g), Chain (7 g)");
  });
  it("includes the selected metal without changing older item descriptions", () => {
    expect(itemSummary([{ metal: "Gold", particulars: "Ring", grams: 3.2, assessedValue: 100, loanAmount: 80 }, { metal: "Silver", particulars: "Chain", grams: 7, assessedValue: 200, loanAmount: 150 }])).toBe("Gold: Ring (3.2 g), Silver: Chain (7 g)");
  });
});
