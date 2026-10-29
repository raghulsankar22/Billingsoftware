import { toBill } from "./bills";
import { normalizeAadhaar, normalizePhone } from "./customers";
import { localOwnerId, type createLocalDatabase } from "./local-database";
import type { Bill, BusinessSnapshot } from "./types";

export type GlobalSearchResult = {
  accountSlot: number;
  profile: BusinessSnapshot;
  bill: Bill;
  matchedCustomerCode?: string;
};

type SearchDatabase = Pick<ReturnType<typeof createLocalDatabase>, "from" | "customers">;

function positiveInteger(value: string | null, fallback: number, name: string, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum) {
    throw new Error(`${name} must be a positive integer${maximum < Number.MAX_SAFE_INTEGER ? ` no greater than ${maximum}` : ""}.`);
  }
  return Number(value);
}

/** Search immutable bill snapshots across every account owned by the local user. */
export async function loadGlobalSearch(database: SearchDatabase, ownerId: string, params: URLSearchParams) {
  if (ownerId !== localOwnerId) throw new Error("Invalid local owner.");
  const query = params.get("q")?.trim() ?? "";
  if (!query) throw new Error("Enter a customer name, address, phone, Aadhaar or customer ID.");
  if (query.length > 200) throw new Error("Search must be no longer than 200 characters.");
  const page = positiveInteger(params.get("page"), 1, "page");
  const pageSize = positiveInteger(params.get("pageSize"), 50, "pageSize", 100);
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset + pageSize)) throw new Error("The requested page is too large.");

  const literal = query.toLocaleLowerCase();
  const compactCode = query.replace(/[\s-]/g, "").toUpperCase();
  const fullCustomerCode = /^C\d{6,}$/.test(compactCode) ? compactCode : undefined;
  // Only identifier-shaped queries receive normalization. Text containing a digit
  // must not accidentally match every phone containing that digit.
  const phoneQuery = /^[+\d\s()-]+$/.test(query) ? normalizePhone(query) : "";
  const aadhaarQuery = /^[\d\s-]+$/.test(query) ? normalizeAadhaar(query) : "";
  const { data: profiles, error: profileError } = await database.from("business_profiles").select("*").eq("owner_id", ownerId);
  if (profileError) throw profileError;
  const identityQuery = fullCustomerCode ?? (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query) ? query : undefined);
  const identity = identityQuery ? database.customers.identity(identityQuery) : null;
  const customer = identity?.customer;
  const results: GlobalSearchResult[] = [];
  for (const profile of profiles ?? []) {
    const accountSlot = Number(profile.account_slot);
    const { data: rows, error } = await database.from("bills").select("*, bill_items(*)").eq("profile_id", profile.id);
    if (error) throw error;
    for (const row of rows ?? []) {
      const bill = toBill({ ...row, items: row.bill_items });
      const snapshotMatch = [bill.customerName, bill.address, bill.phone, bill.governmentId, bill.customerCode, bill.customerId]
        .some(value => value?.toLocaleLowerCase().includes(literal));
      const identifierMatch = (phoneQuery !== "" && /^\d+$/.test(phoneQuery) && normalizePhone(bill.phone).includes(phoneQuery))
        || (aadhaarQuery !== "" && /^\d+$/.test(aadhaarQuery) && normalizeAadhaar(bill.governmentId ?? "").includes(aadhaarQuery));
      const canonicalCodeMatch = fullCustomerCode !== undefined && bill.customerCode?.toUpperCase() === fullCustomerCode;
      const linkedCustomerMatch = identity !== null && ((!!bill.customerId && identity.ids.includes(bill.customerId))
        || (!!bill.customerCode && identity.codes.includes(bill.customerCode.toUpperCase())));
      // A historical bill without either canonical link may be associated by an
      // exact saved identifier. A conflicting Aadhaar overrides a shared phone;
      // an exact Aadhaar still identifies a customer whose phone has changed.
      const billAadhaar = normalizeAadhaar(bill.governmentId ?? "");
      const conflictingAadhaar = !!identity?.aadhaars.length && /^\d{12}$/.test(billAadhaar) && !identity.aadhaars.includes(billAadhaar);
      const legacyCustomerMatch = identity !== null && !bill.customerId && !bill.customerCode
        && ((identity.phones.includes(normalizePhone(bill.phone)) && !conflictingAadhaar)
          || identity.aadhaars.includes(billAadhaar));
      const matches = identityQuery
        ? canonicalCodeMatch || linkedCustomerMatch || legacyCustomerMatch || bill.customerId === identityQuery
        : snapshotMatch || identifierMatch;
      if (!matches) continue;
      results.push({
        accountSlot,
        profile: {
          business_name: String(profile.business_name), address: String(profile.address), phone: String(profile.phone),
          logo_url: profile.logo_url ?? null, license_number: profile.license_number ?? null,
        },
        bill,
        ...(legacyCustomerMatch ? { matchedCustomerCode: customer!.customerCode } : {}),
      });
    }
  }
  results.sort((left, right) => right.bill.billDate.localeCompare(left.bill.billDate)
    || left.accountSlot - right.accountSlot
    || right.bill.billNumber - left.bill.billNumber
    || left.bill.id.localeCompare(right.bill.id));
  return { results: results.slice(offset, offset + pageSize), total: results.length, page, pageSize, hasMore: offset + pageSize < results.length };
}
