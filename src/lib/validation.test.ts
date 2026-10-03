import { describe, expect, it } from "vitest";
import { billSchema } from "./validation";

const input = {
  billDate: "2026-10-03", customerName: "Customer", fatherName: "Father",
  address: "123 Market Road", phone: "9876543210",
  items: [{ particulars: "Gold ring", grams: 1.234, assessedValue: 100, loanAmount: 80 }],
};

describe("bill validation", () => {
  it.each(["2026-02-30", "2026-13-01", "not-a-date", "2026-10-03junk"])("rejects invalid date %s", (billDate) => {
    expect(billSchema.safeParse({ ...input, billDate }).success).toBe(false);
  });
  it("validates optional delivery dates", () => {
    expect(billSchema.safeParse({ ...input, deliveryDate: "2026-02-30" }).success).toBe(false);
    expect(billSchema.safeParse({ ...input, deliveryDate: "" }).success).toBe(true);
  });
  it("accepts a real leap day", () => {
    expect(billSchema.safeParse({ ...input, billDate: "2028-02-29" }).success).toBe(true);
  });
  it("rejects money that cannot be preserved at two decimal places", () => {
    expect(billSchema.safeParse({ ...input, items: [{ ...input.items[0], loanAmount: 1.234 }] }).success).toBe(false);
  });
  it("accepts ordinary decimal currency", () => {
    expect(billSchema.safeParse({ ...input, items: [{ ...input.items[0], loanAmount: 19.99 }] }).success).toBe(true);
  });
  it("rejects grams that cannot be preserved at three decimal places", () => {
    expect(billSchema.safeParse({ ...input, items: [{ ...input.items[0], grams: 1.2345 }] }).success).toBe(false);
  });
});
