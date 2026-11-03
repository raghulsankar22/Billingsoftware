import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bill } from "../lib/types";

vi.stubGlobal("React", React);
vi.mock("@/lib/account-url", () => import("../lib/account-url"));
vi.mock("@/lib/money", () => import("../lib/money"));
vi.mock("@/lib/interest", () => import("../lib/interest"));
vi.mock("@/lib/types", () => import("../lib/types"));
vi.mock("@/lib/business-license", () => import("../lib/business-license"));
vi.mock("@/lib/jewellery", () => import("../lib/jewellery"));
vi.mock("./api", () => ({ requestHeaders: async () => ({}) }));
vi.mock("./bill-conditions", () => ({ BillConditions: () => null }));
vi.mock("./language-provider", () => ({ useLanguage: () => ({ language: "ta", t: (text: string) => "Tamil interface " + text }) }));
import { BillDocument } from "./bill-document";

const bill: Bill = {
  id: "sample", billNumber: 1, billDate: "2026-11-02", customerName: "Kumar", fatherName: "Muthu", address: "Chennai", phone: "0000000000", status: "issued", excelSyncStatus: "pending", createdAt: "2026-11-02T00:00:00Z", amountInWords: "Rupees One Thousand Only", totalAssessedValue: 2000, totalLoanAmount: 1000, deliveryNo: "1", deliveryDate: "2026-11-02", items: [{ metal: "Gold", particulars: "Ring 2", grams: 5, assessedValue: 2000, loanAmount: 1000 }],
};
describe("English bill with bilingual particulars", () => {
  it.each(["finance", "delivery"] as const)("keeps %s details and headings English even in Tamil interface mode", documentType => {
    const html = renderToStaticMarkup(React.createElement(BillDocument, { bill, profile: { business_name: "Sample", address: "Chennai", phone: "9000000000" }, accountSlot: 1, documentType, onClose: () => {} }));
    expect(html).toContain("Ring (மோதிரம்) 2");
    for (const text of ["Kumar", "Muthu", "Chennai", "Amount in words:"]) expect(html).toContain(text);
    expect(html).toContain("Father&#x27;s Name / Husband&#x27;s Name:");
    expect(html).not.toContain("9000000000");
    expect(html).toContain("0000000000");
    expect(html).not.toContain("Tamil interface");
    expect(html).not.toContain("Tamil only");
    expect(bill.items[0].particulars).toBe("Ring 2");
  });
});
