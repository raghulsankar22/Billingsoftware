import { describe, expect, it } from "vitest";
import { batchDeliverySchema, billSchema, deliverySchema } from "./validation";

const input = {
  billDate: "2026-10-03", customerName: "Customer", fatherName: "Father",
  address: "123 Market Road", phone: "9876543210",
  items: [{ particulars: "Gold ring", grams: 1.234, assessedValue: 100, loanAmount: 80 }],
};

describe("bill validation", () => {
  it("allows empty jewellery remarks and preserves trimmed condition notes", () => {
    expect(billSchema.parse(input).items[0].remarks).toBeUndefined();
    expect(billSchema.parse({ ...input, items: [{ ...input.items[0], remarks: "  Broken; missing stone  " }] }).items[0].remarks).toBe("Broken; missing stone");
    expect(billSchema.safeParse({ ...input, items: [{ ...input.items[0], remarks: "x".repeat(181) }] }).success).toBe(false);
  });
  it("requires an explicit has-bill or lost-bill choice for a single delivery", () => {
    for (const billReceiptStatus of [undefined, "", "other", null]) expect(deliverySchema.safeParse({ deliveryDate: "2026-10-30", billReceiptStatus }).success).toBe(false);
    for (const billReceiptStatus of ["has_bill", "lost_bill"]) expect(deliverySchema.safeParse({ deliveryDate: "2026-10-30", billReceiptStatus }).success).toBe(true);
  });
  it("requires a separate choice for every bill in a multiple delivery", () => {
    const first = { billId: "00000000-0000-4000-8000-000000000001", billReceiptStatus: "has_bill" };
    const second = { billId: "00000000-0000-4000-8000-000000000002" };
    expect(batchDeliverySchema.safeParse({ deliveryDate: "2026-10-30", deliveries: [first, second] }).success).toBe(false);
    expect(batchDeliverySchema.safeParse({ deliveryDate: "2026-10-30", deliveries: [first, { ...second, billReceiptStatus: "lost_bill" }] }).success).toBe(true);
  });
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
  it("accepts a blank or omitted customer mobile number", () => {
    expect(billSchema.parse({ ...input, phone: " " }).phone).toBe("");
    const { phone: _phone, ...withoutPhone } = input;
    expect(billSchema.parse(withoutPhone).phone).toBe("");
    expect(billSchema.safeParse({ ...input, phone: "123" }).success).toBe(false);
  });
  it("rejects grams that cannot be preserved at three decimal places", () => {
    expect(billSchema.safeParse({ ...input, items: [{ ...input.items[0], grams: 1.2345 }] }).success).toBe(false);
  });
});
