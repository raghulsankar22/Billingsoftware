import { describe, expect, it } from "vitest";
import { containsTamil, isEnglishRecord } from "./english-records";
import { canConfirmEnglish, suggestEnglish } from "./tamil-input";
import { billSchema, historicalBillEditSchema } from "./validation";
import { customerSchema } from "./customers";
import { profileSchema } from "./profile-validation";
import { jewelleryNameSchema } from "./jewellery";

const input = { billDate: "2026-10-03", customerName: "Kumar", fatherName: "Raja", address: "12 Market Street", phone: "9876543210", items: [{ metal: "Gold", particulars: "Ring 2", grams: 2, assessedValue: 1100, loanAmount: 1000 }] };

describe("legacy spelling helpers and native text validation", () => {
  it("suggests a small local vocabulary without guessing unknown names", () => {
    expect(suggestEnglish("குமார்")).toBe("Kumar");
    expect(suggestEnglish("ராஜா")).toBe("Raja");
    expect(suggestEnglish("12 சென்னை தெரு")).toBe("12 Chennai Street");
    expect(suggestEnglish("மோதிரம் 2")).toBe("Ring 2");
    expect(suggestEnglish("அறியாதபெயர்")).toBe("அறியாதபெயர்");
    expect(canConfirmEnglish(suggestEnglish("அறியாதபெயர்"))).toBe(false);
    expect(canConfirmEnglish("  ")).toBe(false);
    expect(canConfirmEnglish("Kumar")).toBe(true);
    expect(suggestEnglish("9876543210 123456789012 ID-42 ₹ 2.5")).toBe("9876543210 123456789012 ID-42 ₹ 2.5");
  });
  it("accepts native Tamil text while retaining identifier validation", () => {
    expect(containsTamil("குமார்")).toBe(true);
    expect(isEnglishRecord("José O’Neil — ₹100")).toBe(true);
    expect(billSchema.parse({ ...input, customerName: "José O’Neil", address: "12 Café Road — ₹100" }).customerName).toBe("José O’Neil");
    for (const field of ["customerName", "fatherName", "address"]) expect(billSchema.safeParse({ ...input, [field]: "குமார்" }).success).toBe(true);
    for (const field of ["deliveryNo", "governmentId", "phone"]) expect(billSchema.safeParse({ ...input, [field]: "குமார்" }).success).toBe(false);
    for (const field of ["particulars", "remarks"]) expect(billSchema.safeParse({ ...input, items: [{ ...input.items[0], [field]: "மோதிரம்" }] }).success).toBe(true);
    expect(customerSchema.safeParse({ name: "குமார்", fatherName: "Raja", address: "12 Street" }).success).toBe(true);
    expect(profileSchema.safeParse({ businessName: "தமிழ்", address: "12 Street", phone: "9876543210" }).success).toBe(true);
    expect(jewelleryNameSchema.safeParse("மோதிரம்").success).toBe(true);
    expect(jewelleryNameSchema.parse("Café Pendant")).toBe("Café Pendant");
  });
  it("keeps historical missing details editable without inventing data", () => {
    expect(historicalBillEditSchema.parse({ ...input, fatherName: "", address: "", items: [{ ...input.items[0], grams: null, assessedValue: null }] })).toMatchObject({ fatherName: "", address: "" });
  });
});
