import { lostBillDeliveries } from "./lost-bill";
import { noticeBillHistory } from "./notices";
import { overdueBillHistory } from "./overdue";
import type { Bill } from "./types";

export type NavCounts = { bills: number; lostBills: number; notice: number; overdue: number };

/**
 * Menu badges for ONE account's bills, using the same rules as each screen opens with:
 * Notice = Notice 1 + Notice 2 for this month; Overdue = undelivered for more than 365 days.
 */
export function navCounts(bills: Bill[], today: string): NavCounts {
  const month = today.slice(0, 7);
  const safe = (count: () => number) => { try { return count(); } catch { return 0; } };
  return {
    bills: bills.length,
    lostBills: lostBillDeliveries(bills).length,
    notice: safe(() => noticeBillHistory(bills, month, 1).length + noticeBillHistory(bills, month, 2).length),
    overdue: safe(() => overdueBillHistory(bills, today).length),
  };
}

/** Short badge text: 1248 becomes "1.2k" so it fits on the slim bar. */
export function badgeText(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10_000) return `${(Math.floor(count / 100) / 10).toFixed(1).replace(/\.0$/, "")}k`;
  if (count < 1_000_000) return `${Math.floor(count / 1000)}k`;
  return "1M+";
}
