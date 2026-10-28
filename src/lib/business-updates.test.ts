import { describe, expect, it } from "vitest";
import { billingPeriod, billingToday, businessUpdates } from "./business-updates";
import type { Bill } from "./types";

const loan: Bill = {
  id: "loan", billNumber: 1, billDate: "2026-10-28", status: "issued", customerName: "Customer", fatherName: "Father", address: "Sample address", phone: "",
  items: [{ metal: "Gold", particulars: "Ring", grams: 5, assessedValue: 15000, loanAmount: 10000 }], totalAssessedValue: 15000, totalLoanAmount: 10000,
  amountInWords: "Rupees Ten Thousand Only", excelSyncStatus: "synced", createdAt: "2026-10-28T00:00:00Z",
};

describe("daily, weekly and monthly business updates", () => {
  it("uses India calendar dates for the default", () => {
    expect(billingToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("uses exactly the selected day", () => {
    expect(billingPeriod("daily", "2026-10-28")).toEqual({ from: "2026-10-28", to: "2026-10-28" });
  });
  it.each(["2026-10-26", "2026-10-28", "2026-11-01"])("uses Monday through Sunday for %s", date => {
    expect(billingPeriod("weekly", date)).toEqual({ from: "2026-10-26", to: "2026-11-01" });
  });
  it("handles weeks crossing the end of the year", () => {
    expect(billingPeriod("weekly", "2027-01-01")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });
  it.each([
    ["2026-10-28", "2026-10-01", "2026-10-31"],
    ["2026-11-29", "2026-11-01", "2026-11-30"],
    ["2026-02-20", "2026-02-01", "2026-02-28"],
    ["2028-02-20", "2028-02-01", "2028-02-29"],
  ])("uses the complete calendar month for %s", (date, from, to) => {
    expect(billingPeriod("monthly", date)).toEqual({ from, to });
  });
  it.each(["", "2026-02-30", "not-a-date"])("rejects invalid date %s", date => {
    expect(() => billingPeriod("daily", date)).toThrow("valid date");
  });
  it("shows all dated bills, including voided ones, while keeping active and voided totals separate", () => {
    const bills = [
      { ...loan, id: "monday", billDate: "2026-10-26" },
      { ...loan, id: "sunday", billDate: "2026-11-01" },
      { ...loan, id: "before", billDate: "2026-10-25" },
      { ...loan, id: "after", billDate: "2026-11-02" },
      { ...loan, id: "voided", status: "void" as const },
    ];
    const report = businessUpdates(bills, billingPeriod("weekly", "2026-10-28"));
    expect(report.loans.map(bill => bill.id)).toEqual(["sunday", "voided", "monday"]);
    expect(report.loanAmount).toBe(20000);
    expect(report.activeLoans).toHaveLength(2);
    expect(report.voidedLoans).toHaveLength(1);
    expect(report.voidedLoanAmount).toBe(10000);
    expect(report.recordedLoanAmount).toBe(30000);
  });
  it.each(["daily", "weekly", "monthly"] as const)("does not hide all-voided bills in the %s report", period => {
    const datedBills = Array.from({ length: 5 }, (_, index) => ({ ...loan, id: `void-${index}`, billNumber: index + 1, status: "void" as const }));
    const report = businessUpdates(datedBills, billingPeriod(period, "2026-10-28"));
    expect(report.loans).toHaveLength(5);
    expect(report.activeLoans).toHaveLength(0);
    expect(report.voidedLoans).toHaveLength(5);
    expect(report.loanAmount).toBe(0);
    expect(report.voidedLoanAmount).toBe(50000);
    expect(report.recordedLoanAmount).toBe(50000);
  });
  it("counts delivery by delivery date even for an older voided loan", () => {
    const delivered = { ...loan, status: "void" as const, deliveryNo: "1", deliveryDate: "2026-11-29" };
    const report = businessUpdates([delivered], billingPeriod("monthly", "2026-11-15"));
    expect(report.loans).toEqual([]);
    expect(report.deliveries).toHaveLength(1);
    expect(report).toMatchObject({ deliveryPrincipal: 10000, deliveryInterest: 200, deliveryTotal: 10200, incompleteDeliveries: 0 });
    expect(businessUpdates([delivered], billingPeriod("daily", "2026-10-28")).deliveries).toEqual([]);
  });
  it("sums loan amounts in integer paise", () => {
    expect(businessUpdates([{ ...loan, totalLoanAmount: 0.1 }, { ...loan, id: "second", totalLoanAmount: 0.2 }], billingPeriod("daily", loan.billDate)).loanAmount).toBe(0.3);
  });
  it("flags incomplete interest rather than treating it as a confirmed zero", () => {
    const missingMetal = { ...loan, deliveryNo: "1", deliveryDate: "2026-11-29", items: [{ ...loan.items[0], metal: undefined }] };
    expect(businessUpdates([missingMetal], billingPeriod("monthly", "2026-11-01"))).toMatchObject({ incompleteDeliveries: 1, deliveryPrincipal: 10000, deliveryInterest: 0, deliveryTotal: 0 });
  });
});
