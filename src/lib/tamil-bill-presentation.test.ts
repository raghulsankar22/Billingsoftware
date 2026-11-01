import { describe, expect, it } from "vitest";
import { createTamilBillDraft, tamilBillText } from "./tamil-bill-presentation";
import type { Bill, BusinessSnapshot } from "./types";

const profile: BusinessSnapshot = { business_name: "Kumar", address: "12 Chennai Street", phone: "9876543210", license_number: "LIC-42" };
const bill: Bill = {
  id: "bill-42", billNumber: 42, billDate: "2026-11-02", customerName: "Muthu", fatherName: "Raja", address: "12 Chennai Street",
  phone: "9876543210", governmentId: "123456789012", items: [{ metal: "Gold", particulars: "Ring 2", remarks: "", grams: 2.5, assessedValue: 12000, loanAmount: 10000 }],
  totalAssessedValue: 12000, totalLoanAmount: 10000, amountInWords: "Ten thousand rupees only", status: "issued", excelSyncStatus: "synced", createdAt: "2026-11-02T00:00:00Z",
};

describe("Tamil bill presentation stays outside English records", () => {
  it("creates Tamil text without translating identifiers or financial data", () => {
    const before = JSON.stringify([bill, profile]);
    const draft = createTamilBillDraft(bill, profile);
    expect(draft).toMatchObject({ customerName: "முத்து", fatherName: "ராஜா", address: "12 சென்னை தெரு", "particulars-0": "மோதிரம் 2" });
    expect(Object.keys(draft).sort()).toEqual(["businessName", "businessAddress", "customerName", "fatherName", "address", "collector", "particulars-0", "remarks-0"].sort());
    expect(JSON.stringify([bill, profile])).toBe(before);
    draft.customerName = "திருத்தப்பட்ட பெயர்";
    expect(bill.customerName).toBe("Muthu");
    expect(bill.phone).toBe("9876543210");
    expect(bill.governmentId).toBe("123456789012");
    expect(bill.items[0].loanAmount).toBe(10000);
    expect(bill.amountInWords).toBe("Ten thousand rupees only");
  });
  it("keeps historical blanks blank and uses known semantic display labels", () => {
    const draft = createTamilBillDraft({ ...bill, fatherName: "", address: "", historicalImport: true }, profile);
    expect(draft.fatherName).toBe("");
    expect(draft.address).toBe("");
    expect(tamilBillText("Gold")).toBe("தங்கம்");
    expect(tamilBillText("Silver")).toBe("வெள்ளி");
  });
  it("keeps collector spelling display-only and leaves snapshots untouched", () => {
    const delivered = { ...bill, deliveryNo: "D-42", deliveryDate: "2026-11-03", deliveryCollectedByName: "Ravi", deliveryCollectedByRelation: "son" as const, businessSnapshot: { ...profile, business_name: "Raja" } };
    const before = JSON.stringify(delivered);
    const draft = createTamilBillDraft(delivered, delivered.businessSnapshot);
    expect(draft.collector).toBe("ரவி");
    expect(draft.businessName).toBe("ராஜா");
    expect(JSON.stringify(delivered)).toBe(before);
    expect(createTamilBillDraft(bill, profile).customerName).toBe("முத்து");
  });
});
