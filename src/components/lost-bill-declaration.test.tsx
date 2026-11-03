import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lostBillTamilStatement } from "../lib/lost-bill";
import type { Bill } from "../lib/types";
import { DeclarationPage } from "./lost-bill-declaration";

// Tests don't resolve the "@/" shortcut, so point it at the real files.
vi.mock("@/lib/money", async () => import("../lib/money"));
vi.mock("@/lib/jewellery", async () => import("../lib/jewellery"));
vi.mock("@/lib/business-license", async () => import("../lib/business-license"));
vi.mock("@/lib/lost-bill", async () => import("../lib/lost-bill"));
vi.mock("@/lib/types", async () => import("../lib/types"));
// The test runner compiles JSX to React.createElement calls.
(globalThis as { React?: typeof React }).React = React;

const profile = { business_name: "Sample Finance", address: "1 Demo Street", phone: "9000000000", license_number: "LIC-1" };
const bill: Bill = {
  id: "b1", billNumber: 3, status: "issued", billDate: "2026-09-01", customerName: "Arun Prakash", fatherName: "Prakash Rao", address: "9 Market Lane", phone: "9000000033", governmentId: "1111 2222 3333",
  items: [{ metal: "Gold", particulars: "Studs 2", grams: 2, assessedValue: 10000, loanAmount: 7000 }], totalAssessedValue: 10000, totalLoanAmount: 7000, amountInWords: "Seven thousand rupees only",
  excelSyncStatus: "synced", createdAt: "2026-09-01T00:00:00.000Z", deliveryNo: "1", deliveryDate: "2026-11-01", deliveryBillReceiptStatus: "lost_bill", deliveryCollectedByRelation: "son", deliveryCollectedByName: "Vijay Arun",
};

describe("lost bill declaration", () => {
  it("prints the bill, the owner's Tamil sentence and every signature box", () => {
    const html = renderToStaticMarkup(<DeclarationPage bills={[bill]} profile={profile} />);
    for (const text of ["LOST BILL DECLARATION", "Arun Prakash", "Prakash Rao", "Studs (தோடு) 2", "2026-11-01", "Vijay Arun (Son)", lostBillTamilStatement, "Customer Signature", "Thumb Impression", "Witness Signature", "Witness Name", "Business Signature", "Signature of Vijay Arun (Son)"]) expect(html).toContain(text);
    expect(html).toContain("XXXXXXXX3333");
    expect(html).not.toContain("1111 2222 3333");
    expect(html).not.toContain(profile.phone);
    expect(html).toContain(bill.phone);
  });
  it("uses details typed on the delivery screen before saving", () => {
    const waiting = { ...bill, deliveryNo: "", deliveryDate: "", deliveryCollectedByRelation: undefined, deliveryCollectedByName: undefined };
    const html = renderToStaticMarkup(<DeclarationPage bills={[waiting]} profile={profile} pending={{ deliveryDate: "2026-11-02", collectedBy: { relation: "self", name: "" }, deliveryNumbers: { b1: "4" } }} />);
    expect(html).toContain("2026-11-02");
    expect(html).toContain("Arun Prakash (Customer)");
    expect(html).not.toContain("Signature of");
  });
});
