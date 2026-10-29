import { billingPeriod, type PeriodRange } from "./business-updates";
import type { Bill } from "./types";

/** A monthly cohort: October 2026 reviews all of October 2025. */
export function overduePeriod(reviewMonth: string): PeriodRange {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(reviewMonth) || Number(reviewMonth.slice(0, 4)) < 2) {
    throw new Error("Choose a valid review month and year.");
  }
  const previousYear = String(Number(reviewMonth.slice(0, 4)) - 1).padStart(4, "0");
  return billingPeriod("monthly", `${previousYear}-${reviewMonth.slice(5)}-01`);
}

export function overdueBillHistory(bills: readonly Bill[], reviewMonth: string, search = ""): Bill[] {
  return pendingBillHistory(bills, overduePeriod(reviewMonth), search);
}

export function pendingBillHistory(bills: readonly Bill[], range: PeriodRange, search = ""): Bill[] {
  const query = search.trim().toLocaleLowerCase().replace(/^#/, "");
  return bills.filter(bill => {
    if (bill.billDate < range.from || bill.billDate > range.to) return false;
    if (bill.deliveryNo?.trim() && bill.deliveryDate?.trim()) return false;
    return !query || [String(bill.billNumber), bill.customerCode, bill.customerName, bill.fatherName, bill.address, bill.phone, ...bill.items.map(item => item.particulars)]
      .some(value => value?.toLocaleLowerCase().includes(query));
  }).sort((a, b) => a.billDate.localeCompare(b.billDate) || a.billNumber - b.billNumber || a.id.localeCompare(b.id));
}
