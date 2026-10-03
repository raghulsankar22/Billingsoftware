import type { SupabaseClient } from "@supabase/supabase-js";
import { toBill } from "./bills";

const batchSize = 500;

function calendarDate(value: string): string | undefined {
  const indianDate = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(value);
  const date = indianDate ? `${indianDate[3]}-${indianDate[2]}-${indianDate[1]}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : undefined;
}

function dateFilter(params: URLSearchParams, key: string) {
  const value = params.get(key)?.trim();
  if (!value) return undefined;
  const date = calendarDate(value);
  if (!date) throw new Error(`${key} must be a valid date (YYYY-MM-DD or DD/MM/YYYY).`);
  return date;
}

function positiveInteger(value: string | null, fallback: number, name: string, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum) {
    throw new Error(`${name} must be a positive integer${maximum < Number.MAX_SAFE_INTEGER ? ` no greater than ${maximum}` : ""}.`);
  }
  return Number(value);
}

export async function loadBillHistory(supabase: SupabaseClient, profileId: string, params: URLSearchParams) {
  const search = params.get("q")?.trim() ?? "";
  if (search.length > 200) throw new Error("Search must be no longer than 200 characters.");
  const date = dateFilter(params, "date");
  const from = dateFilter(params, "from");
  const to = dateFilter(params, "to");
  if (from && to && from > to) throw new Error("The start date must be on or before the end date.");
  const paginated = params.has("page") || params.has("pageSize");
  const page = positiveInteger(params.get("page"), 1, "page");
  const pageSize = positiveInteger(params.get("pageSize"), 50, "pageSize", batchSize);
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset + pageSize)) throw new Error("The requested page is too large.");

  const buildQuery = () => {
    let query = supabase.from("bills").select("*, bill_items(*)", { count: "exact" })
      .eq("profile_id", profileId).order("bill_number", { ascending: false }).order("id", { ascending: false });
    if (search) {
      // A literal regex avoids PostgREST's special '*' alias for LIKE wildcards.
      // Quote its value separately so commas and parentheses cannot alter OR filters.
      const pattern = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const quoted = `"${pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      const filters = [`customer_name.imatch.${quoted}`, `phone.imatch.${quoted}`];
      const number = search.replace(/^#/, "");
      if (/^\d+$/.test(number) && Number.isSafeInteger(Number(number))) filters.push(`bill_number.eq.${Number(number)}`);
      const searchDate = calendarDate(search);
      if (searchDate) filters.push(`bill_date.eq.${searchDate}`);
      query = query.or(filters.join(","));
    }
    if (date) query = query.eq("bill_date", date);
    if (from) query = query.gte("bill_date", from);
    if (to) query = query.lte("bill_date", to);
    return query;
  };

  const bills = [];
  let start = paginated ? offset : 0;
  let total = 0;
  // Advance by returned rows as hosted API limits can be lower than our batch size.
  do {
    const end = paginated ? offset + pageSize - 1 : start + batchSize - 1;
    const { data, error, count } = await buildQuery().range(start, end);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    total = count ?? start + rows.length;
    bills.push(...rows.map((row) => toBill({ ...row, items: row.bill_items })));
    start += rows.length;
    if (rows.length === 0 || start >= total || (paginated && start >= offset + pageSize)) break;
  } while (true);
  return { bills, total, page: paginated ? page : 1, pageSize: paginated ? pageSize : bills.length, hasMore: start < total };
}
