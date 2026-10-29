import { createAdminSupabase } from "./supabase";
import { toBill } from "./bills";
import { billRegisterRow, createRegister, formatRegisterSheet } from "./register";
import type { Bill } from "./types";

type ReportFilters = { query: string; from?: string; to?: string };

function reportDate(value: string | null) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error("Report dates must be valid dates in YYYY-MM-DD format.");
  return value;
}

export function reportFilters(parameters: URLSearchParams): ReportFilters {
  const from = reportDate(parameters.get("from")); const to = reportDate(parameters.get("to"));
  if (from && to && from > to) throw new Error("The report's start date must be on or before its end date.");
  const query = parameters.get("q")?.trim() ?? "";
  if (query.length > 120) throw new Error("Report search must be at most 120 characters.");
  return { query, from, to };
}

export async function loadReportBills(profileId: string, filters: ReportFilters) {
  const supabase = createAdminSupabase(); const bills: Bill[] = []; const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from("bills").select("*, bill_items(*)").eq("profile_id", profileId).order("bill_number", { ascending: true });
    if (filters.from) query = query.gte("bill_date", filters.from);
    if (filters.to) query = query.lte("bill_date", filters.to);
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error("Unable to read the Excel register. Please retry the download.");
    for (const row of data ?? []) {
      const bill = toBill({ ...row, items: row.bill_items });
      const search = filters.query.toLowerCase();
      // Treat punctuation literally rather than interpolating it into a database filter.
      if (!search || bill.customerName.toLowerCase().includes(search) || bill.phone.includes(search) || (/^\d+$/.test(search) && bill.billNumber === Number(search))) bills.push(bill);
    }
    if (!data || data.length < pageSize) break;
  }
  return bills;
}

export function buildReportRegister(bills: Bill[]) {
  const workbook = createRegister(); const sheet = workbook.getWorksheet("Bills")!; const table = sheet.getTable("Bills");
  for (const bill of bills) table.addRow(billRegisterRow(bill));
  table.commit();
  bills.forEach((bill, index) => { if (bill.status === "void") sheet.getRow(index + 2).font = { color: { argb: "FFB42318" }, strike: true }; });
  formatRegisterSheet(sheet);
  return workbook;
}
