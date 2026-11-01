export type BillStatus = "issued" | "void" | "sync_pending" | "sync_failed";

export const billReceiptLabels = { has_bill: "Customer has bill", lost_bill: "Customer lost bill" } as const;
export type BillReceiptStatus = keyof typeof billReceiptLabels;

export const collectedByRelationLabels = { self: "Customer (self)", husband: "Husband", wife: "Wife", father: "Father", mother: "Mother", son: "Son", daughter: "Daughter", brother: "Brother", sister: "Sister", other: "Other" } as const;
export type CollectedByRelation = keyof typeof collectedByRelationLabels;
export type CollectedBy = { relation: CollectedByRelation | ""; name: string };
export const collectedByComplete = ({ relation, name }: CollectedBy) => relation === "self" || (Boolean(relation) && name.trim().length >= 2);
/** For example "Ravi Kumar (Son)". Older deliveries have no one recorded. */
export function collectedByText(bill: { deliveryCollectedByName?: string; deliveryCollectedByRelation?: CollectedByRelation }): string {
  if (!bill.deliveryCollectedByName || !bill.deliveryCollectedByRelation) return "";
  return `${bill.deliveryCollectedByName} (${bill.deliveryCollectedByRelation === "self" ? "Customer" : collectedByRelationLabels[bill.deliveryCollectedByRelation]})`;
}

export type BusinessSnapshot = { business_name: string; address: string; phone: string; logo_url?: string | null; license_number?: string | null };

export type BillItemInput = {
  metal?: "Gold" | "Silver";
  particulars: string;
  remarks?: string;
  /** null only on a register-imported bill whose weight was never recorded. */
  grams: number | null;
  /** null only on a register-imported bill whose value was never recorded. */
  assessedValue: number | null;
  loanAmount: number;
};

export type RepaymentSummary = {
  chargedMonths: number;
  lines: { metal?: "Gold" | "Silver"; particulars: string; principal: number; ratePercent: number | null; initialInterest: number | null; interest: number | null; total: number | null }[];
  principal: number;
  initialInterest: number | null;
  interest: number | null;
  total: number | null;
  missingMetal: boolean;
};

export type BillInput = {
  customerId?: string;
  deliveryNo?: string;
  deliveryDate?: string;
  billDate: string;
  customerName: string;
  fatherName: string;
  address: string;
  phone: string;
  governmentId?: string;
  items: BillItemInput[];
};

export type Bill = BillInput & {
  id: string;
  customerCode?: string;
  profileId?: string;
  billNumber: number;
  status: BillStatus;
  replacementForId?: string;
  totalAssessedValue: number | null;
  totalLoanAmount: number;
  amountInWords: string;
  excelSyncStatus: "synced" | "pending" | "failed";
  excelSyncError?: string;
  createdAt: string;
  businessSnapshot?: BusinessSnapshot;
  deliverySummary?: RepaymentSummary;
  deliveryBillReceiptStatus?: BillReceiptStatus;
  deliveryCollectedByName?: string;
  deliveryCollectedByRelation?: CollectedByRelation;
  cancelledDeliveries?: { deliveryNo: string; deliveryDate: string; cancelledAt: string }[];
  /** An old delivery recorded from a register, even if its number or date was absent. */
  historicalDelivery?: boolean;
  historicalMissingDetails?: boolean;
  historicalImport?: boolean;
};

export const registerHeaders = [
  "Delivery No.",
  "Delivery Date",
  "Date",
  "Bill No.",
  "Address",
  "Name",
  "Particulars",
  "Phone",
  "Amount",
] as const;
