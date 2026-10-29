import { billLicenseNumber } from "./business-license";
import type { Bill, BusinessSnapshot } from "./types";

export function billPdfMetadata(
  bill: Pick<Bill, "businessSnapshot" | "status">,
  profile: Pick<BusinessSnapshot, "license_number">,
  documentType: "finance" | "delivery",
) {
  return JSON.stringify({ businessLicenseNumber: billLicenseNumber(bill, profile), billStatus: bill.status, documentType });
}
