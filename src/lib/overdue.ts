import { billingPeriod, type PeriodRange } from "./business-updates";
import type { Bill } from "./types";
import { isDelivered } from "./delivery-status";

export function overduePeriod(asOfDate: string): PeriodRange {
  billingPeriod("daily", asOfDate);
  const cutoff = new Date(asOfDate + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - 366);
  if (cutoff.getUTCFullYear() < 1) throw new Error("Choose a valid date after year 1.");
  return { from: "0001-01-01", to: cutoff.toISOString().slice(0, 10) };
}

export function overdueBillHistory(bills: readonly Bill[], asOfDate: string, search = ""): Bill[] {
  return pendingBillHistory(bills, overduePeriod(asOfDate), search);
}

export function pendingBillHistory(bills: readonly Bill[], range: PeriodRange, search = ""): Bill[] {
  const query = search.trim().toLocaleLowerCase().replace(/^#/, "");
  return bills.filter(bill => {
    if (bill.billDate < range.from || bill.billDate > range.to) return false;
    if (isDelivered(bill)) return false;
    return !query || [String(bill.billNumber), bill.customerCode, bill.customerName, bill.fatherName, bill.address, bill.phone, ...bill.items.map(item => item.particulars)]
      .some(value => value?.toLocaleLowerCase().includes(query));
  }).sort((a, b) => a.billDate.localeCompare(b.billDate) || a.billNumber - b.billNumber || a.id.localeCompare(b.id));
}
