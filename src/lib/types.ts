export type BillStatus = "issued" | "void" | "sync_pending" | "sync_failed";

export type BillItemInput = {
  particulars: string;
  grams: number;
  assessedValue: number;
  loanAmount: number;
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
  billNumber: number;
  status: BillStatus;
  replacementForId?: string;
  totalAssessedValue: number;
  totalLoanAmount: number;
  amountInWords: string;
  excelSyncStatus: "synced" | "pending" | "failed";
  excelSyncError?: string;
  createdAt: string;
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
