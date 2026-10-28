import type { Bill, BusinessSnapshot } from "./types";

export function billLicenseNumber(bill: Pick<Bill, "businessSnapshot">, profile: Pick<BusinessSnapshot, "license_number">): string {
  // Older bills have no license field; new bills retain the license recorded at issue.
  const saved = bill.businessSnapshot?.license_number;
  return (saved === undefined ? profile.license_number : saved)?.trim() ?? "";
}

export function billLicenseMetadata(bill: Pick<Bill, "businessSnapshot">, profile: Pick<BusinessSnapshot, "license_number">): string {
  return JSON.stringify({ businessLicenseNumber: billLicenseNumber(bill, profile) });
}
