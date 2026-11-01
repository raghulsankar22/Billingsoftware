import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bill, BusinessSnapshot } from "../lib/types";

vi.stubGlobal("React", React);
vi.mock("@/lib/business-license", () => import("../lib/business-license"));
vi.mock("@/lib/tamil-bill-presentation", () => import("../lib/tamil-bill-presentation"));
vi.mock("@/lib/interest", () => import("../lib/interest"));
vi.mock("@/lib/money", () => import("../lib/money"));
vi.mock("@/lib/types", () => import("../lib/types"));
vi.mock("@/lib/bill-conditions", () => import("../lib/bill-conditions"));
import { TamilBillDocument } from "./tamil-bill-document";

const profile: BusinessSnapshot = { business_name: "Kumar", address: "12 Chennai Street", phone: "9876543210" };
const bill: Bill = {
  id: "sample", billNumber: 42, billDate: "2026-11-02", customerName: "Muthu", fatherName: "Raja", address: "12 Chennai Street", phone: "9876543210", governmentId: "123456789012",
  items: [{ metal: "Gold", particulars: "Ring 2", grams: 2.5, assessedValue: 12000, loanAmount: 10000 }], totalAssessedValue: 12000, totalLoanAmount: 10000,
  amountInWords: "Ten thousand rupees only", status: "issued", excelSyncStatus: "synced", createdAt: "2026-11-02T00:00:00Z",
};

describe("Tamil bill markup", () => {
  it("renders Tamil customer text and original financial data behind review", () => {
    const before = JSON.stringify(bill);
    const html = renderToStaticMarkup(React.createElement(TamilBillDocument, { bill, profile, delivery: false, onClose() {}, onEnglish() {} }));
    expect(html).toContain("முத்து");
    expect(html).toContain("ராஜா");
    expect(html).toContain("12 சென்னை தெரு");
    expect(html).toContain("123456789012");
    expect(html).toContain("9876543210");
    expect(html).toContain("Ten thousand rupees only");
    expect(html).toMatch(/disabled="">தமிழில் அச்சிடு/);
    expect(html).not.toContain('class="bill-modal tamil-bill-modal tamil-bill-reviewed"');
    expect(JSON.stringify(bill)).toBe(before);
  });
  it("renders delivery receipts and preserves missing historical collection totals", () => {
    const delivered: Bill = { ...bill, deliveryNo: "DEL-42", deliveryDate: "2026-11-03", historicalDelivery: true, deliveryCollectedByName: "Ravi", deliveryCollectedByRelation: "son" };
    const html = renderToStaticMarkup(React.createElement(TamilBillDocument, { bill: delivered, profile, delivery: true, onClose() {}, onEnglish() {} }));
    expect(html).toContain("நகை திருப்பி வழங்கிய ரசீது");
    expect(html).toContain("DEL-42");
    expect(html).toContain("ரவி");
    expect(html).not.toContain("வசூலிக்க வேண்டிய தொகை</h3>");
  });
});
