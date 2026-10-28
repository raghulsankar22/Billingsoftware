export type BillStatus = "issued" | "void" | "sync_pending" | "sync_failed";

export type BusinessSnapshot = { business_name: string; address: string; phone: string; logo_url?: string | null; license_number?: string | null };

export type BillItemInput = {
  metal?: "Gold" | "Silver";
  particulars: string;
  grams: number;
  assessedValue: number;
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
  profileId?: string;
  billNumber: number;
  status: BillStatus;
  replacementForId?: string;
  totalAssessedValue: number;
  totalLoanAmount: number;
  amountInWords: string;
  excelSyncStatus: "synced" | "pending" | "failed";
  excelSyncError?: string;
  createdAt: string;
  businessSnapshot?: BusinessSnapshot;
  deliverySummary?: RepaymentSummary;
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
