import ExcelJS from "exceljs";
import { isAccountSlot } from "./account-url";
import { addReportSheet, loadReportBills } from "./excel-report";
import { createAdminSupabase } from "./supabase";
import type { Bill } from "./types";

export type AccountReport = { profileId: string; accountSlot: number; bills: Bill[] };

export async function loadAccountReports(ownerId: string): Promise<AccountReport[]> {
  const { data, error } = await createAdminSupabase().from("business_profiles").select("id,account_slot").eq("owner_id", ownerId).order("account_slot", { ascending: true });
  if (error) throw new Error("Unable to read business accounts. Please retry the Excel refresh.");
  if (!data?.length) throw new Error("Set up a business account before exporting Excel.");
  const reports: AccountReport[] = [];
  for (const profile of data) {
    if (!isAccountSlot(profile.account_slot) || typeof profile.id !== "string" || !/^[\w-]+$/.test(profile.id)) throw new Error("Invalid register account.");
    reports.push({ profileId: profile.id, accountSlot: profile.account_slot, bills: await loadReportBills(profile.id, { query: "" }) });
  }
  return reports;
}

export function buildAllAccountRegister(reports: AccountReport[]) {
  if (!reports.length) throw new Error("Set up a business account before exporting Excel.");
  const workbook = new ExcelJS.Workbook();
  for (const report of [...reports].sort((left, right) => left.accountSlot - right.accountSlot)) {
    if (!isAccountSlot(report.accountSlot)) throw new Error("Invalid register account.");
    addReportSheet(workbook, report.bills, `Account ${report.accountSlot}`, `Account_${report.accountSlot}_Bills`);
  }
  return workbook;
}
