import { isDelivered } from "./delivery-status";
import { loadReportBills } from "./excel-report";
import { createLocalDatabase } from "./local-database";
import type { Bill } from "./types";

/** The bills the owner added by hand to this notice that are still undelivered. */
export async function addedNoticeBills(profileId: string, month: string, stage: number): Promise<Bill[]> {
  const ids = new Set(createLocalDatabase().noticeAdditions.list(profileId, month, stage));
  if (!ids.size) return [];
  return (await loadReportBills(profileId, { query: "" })).filter(bill => ids.has(bill.id) && !isDelivered(bill));
}
