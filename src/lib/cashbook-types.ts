export type PaymentMethod = "cash" | "upi" | "bank";
export type CashEntryKind = "collection" | "disbursement" | "expense" | "cash_in" | "cash_out";
export type CashEntry = {
  id: string;
  kind: CashEntryKind;
  date: string;
  method: PaymentMethod;
  amount: number;
  principal: number;
  interest: number;
  discount: number;
  billId: string | null;
  billNumber: number | null;
  deliveryNo: string | null;
  note: string;
  actor: string;
  createdAt: string;
  reversesId: string | null;
  reversed: boolean;
};
export type CashTotals = {
  cashIn: number;
  cashOut: number;
  upiIn: number;
  upiOut: number;
  bankIn: number;
  bankOut: number;
  principalReceived: number;
  interestReceived: number;
  discount: number;
  loansPaid: number;
  expenses: number;
};
export type CashBillOption = {
  id: string;
  billNumber: number;
  billDate: string;
  customerName: string;
  principal: number;
  deliveryDate: string | null;
  deliveryNo: string | null;
  expectedInterest: number | null;
  canCollect: boolean;
  canDisburse: boolean;
  collectionRecorded: boolean;
  disbursementRecorded: boolean;
};
export type CashAccountDay = {
  accountSlot: number;
  profileId: string;
  businessName: string;
  opening: { date: string; amount: number } | null;
  openingCash: number | null;
  expectedCash: number | null;
  countedCash: number | null;
  difference: number | null;
  closed: boolean;
  closingNote: string;
  lastClosedDate: string | null;
  revision: string;
  totals: CashTotals;
  entries: CashEntry[];
  bills: CashBillOption[];
  unrecorded: { disbursements: number; collections: number };
};
export type CashBookView = {
  date: string;
  accounts: CashAccountDay[];
  combined: { openingCash: number | null; expectedCash: number | null; countedCash: number | null; difference: number | null; totals: CashTotals };
};
export type CashBookAction =
  | { action: "opening"; operationId: string; date: string; amount: number }
  | { action: "entry"; operationId: string; date: string; kind: CashEntryKind; method: PaymentMethod; amount: number; principal?: number; interest?: number; discount?: number; billId?: string; note: string }
  | { action: "reverse"; operationId: string; date: string; entryId: string; note: string }
  | { action: "close"; operationId: string; date: string; countedCash: number; revision: string; note: string; acknowledgeUnrecorded: boolean };
