import { billingPeriod, type PeriodRange } from "./business-updates";
import { pendingBillHistory } from "./overdue";
import type { Bill } from "./types";

export type NoticeStage = 1 | 2;

/** Notice 1: twelve months earlier. Notice 2: thirteen months earlier. */
export function noticePeriod(reviewMonth: string, stage: NoticeStage): PeriodRange {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(reviewMonth) || Number(reviewMonth.slice(0, 4)) < 2) {
    throw new Error("Choose a valid review month and year.");
  }
  const previousYear = String(Number(reviewMonth.slice(0, 4)) - 1).padStart(4, "0");
  const first = billingPeriod("monthly", previousYear + "-" + reviewMonth.slice(5) + "-01");
  if (stage === 1) return first;
  if (stage !== 2) throw new Error("Choose Notice 1 or Notice 2.");
  const month = Number(first.from.slice(5, 7));
  const year = Number(first.from.slice(0, 4)) - (month === 1 ? 1 : 0);
  if (year < 1) throw new Error("Choose a later review month.");
  return billingPeriod("monthly", `${String(year).padStart(4, "0")}-${String(month === 1 ? 12 : month - 1).padStart(2, "0")}-01`);
}

export function noticeBillHistory(bills: readonly Bill[], reviewMonth: string, stage: NoticeStage, search = ""): Bill[] {
  return pendingBillHistory(bills, noticePeriod(reviewMonth, stage), search);
}

/**
 * A notice list is the bills of its month that are still undelivered, plus any bills the owner added by hand
 * (a bill missed last month, say). Added bills are shown only while they are still undelivered, obey the same
 * search box, and appear once even if they also belong to the month.
 */
export function mergeNoticeBills(natural: readonly Bill[], added: readonly Bill[], search = ""): Bill[] {
  const everything: PeriodRange = { from: "0001-01-01", to: "9999-12-31" };
  const extras = pendingBillHistory(added, everything, search);
  const seen = new Set(natural.map(bill => bill.id));
  return [...natural, ...extras.filter(bill => !seen.has(bill.id))]
    .sort((a, b) => a.billDate.localeCompare(b.billDate) || a.billNumber - b.billNumber || a.id.localeCompare(b.id));
}
