import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Bill } from "../lib/types";
import { NoticeLetterPage } from "./notice-letters";

vi.mock("@/lib/money", async () => import("../lib/money"));
vi.mock("@/lib/jewellery", async () => import("../lib/jewellery"));
vi.mock("@/lib/business-license", async () => import("../lib/business-license"));
vi.mock("@/lib/notice-messages", async () => import("../lib/notice-messages"));
(globalThis as { React?: typeof React }).React = React;

const profile = { business_name: "Sample Finance", address: "1 Demo Street", phone: "9000000000", license_number: "LIC-1" };
const shopPhone = profile.phone;
const bill = (id: string, billNumber: number, particulars: string): Bill => ({
  id, billNumber, status: "issued", billDate: "2025-10-05", customerCode: "C000007", customerName: "Kumar Raman", fatherName: "Raman Pillai", address: "12 North Street", phone: "9000000011",
  items: [{ metal: "Gold", particulars, grams: 4.2, assessedValue: 20000, loanAmount: 15000 }], totalAssessedValue: 20000, totalLoanAmount: 15000, amountInWords: "Fifteen thousand rupees only",
  excelSyncStatus: "synced", createdAt: "2025-10-05T00:00:00.000Z",
});

describe("notice letters", () => {
  it("prints the customer's address, every bill, both messages and no amounts", () => {
    const html = renderToStaticMarkup(<NoticeLetterPage bills={[bill("a", 4, "Ring 1"), bill("b", 9, "Chain 1")]} stage={2} profile={profile} today="2026-11-02" lastDate="2026-11-22" />);
    for (const text of ["NOTICE 2 · FINAL NOTICE", "இறுதி அறிவிப்பு", "Kumar Raman", "C000007", "Raman Pillai", "12 North Street", "Gold: Ring (மோதிரம்) 1", "Gold: Chain (சயின்) 1", "02/11/2026", "22/11/2026", "Bill No. 4 dated 05/10/2025 and Bill No. 9 dated 05/10/2025", "விதிகளின்படி ஏலத்திற்கு", "Authorised Signature"]) expect(html).toContain(text);
    expect(html).not.toContain("15,000");
    expect(html).not.toContain("₹");
    expect(html).not.toContain(shopPhone);
  });
  it("shows no last date on Notice 1", () => {
    const html = renderToStaticMarkup(<NoticeLetterPage bills={[bill("a", 4, "Ring 1")]} stage={1} profile={profile} today="2026-11-02" lastDate="2026-11-22" />);
    expect(html).toContain("NOTICE 1");
    expect(html).not.toContain("Last date");
    expect(html).not.toContain("22/11/2026");
  });
});
