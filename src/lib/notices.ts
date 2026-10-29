import { billingPeriod, type PeriodRange } from "./business-updates";
import { overduePeriod, pendingBillHistory } from "./overdue";
import type { Bill } from "./types";

export type NoticeStage = 1 | 2;

/** Notice 1: twelve months earlier. Notice 2: thirteen months earlier. */
export function noticePeriod(reviewMonth: string, stage: NoticeStage): PeriodRange {
  const first = overduePeriod(reviewMonth);
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
