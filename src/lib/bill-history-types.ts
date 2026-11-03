export const changeReasons = { correction: "Entry correction", customer_request: "Customer requested correction", duplicate: "Duplicate entry", delivery_correction: "Delivery correction", other: "Other correction" } as const;
export type ChangeReason = keyof typeof changeReasons;
export type BillHistoryEntry = { sequence: number; billId: string | null; billNumber: number | null; action: string; occurredAt: string; actor: string; reason: string; changes: string[]; previousLoan: number | null; loan: number | null };
