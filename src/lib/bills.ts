import type { Bill, BillInput } from "./types";
import { amountInWords } from "./money";

export function toBill(row: Record<string, unknown>): Bill {
  const items = Array.isArray(row.items) ? row.items : [];
  const totalLoanAmount = Number(row.total_loan_amount ?? 0);
  return {
    id: String(row.id),
    billNumber: Number(row.bill_number),
    status: String(row.status) as Bill["status"],
    deliveryNo: String(row.delivery_no ?? ""),
    deliveryDate: String(row.delivery_date ?? ""),
    billDate: String(row.bill_date),
    customerName: String(row.customer_name),
    fatherName: String(row.father_name),
    address: String(row.address),
    phone: String(row.phone),
    governmentId: String(row.government_id ?? ""),
    items: items.map((item) => {
      const source = item as Record<string, unknown>;
      return { particulars: String(source.particulars), grams: Number(source.grams), assessedValue: Number(source.assessed_value), loanAmount: Number(source.loan_amount) };
    }),
    totalAssessedValue: Number(row.total_assessed_value ?? 0),
    totalLoanAmount,
    amountInWords: amountInWords(totalLoanAmount),
    excelSyncStatus: String(row.excel_sync_status ?? "pending") as Bill["excelSyncStatus"],
    excelSyncError: row.excel_sync_error ? String(row.excel_sync_error) : undefined,
    replacementForId: row.replacement_for_id ? String(row.replacement_for_id) : undefined,
    createdAt: String(row.created_at),
  };
}

export function totals(input: BillInput) {
  return input.items.reduce((sum, item) => ({ assessedValue: sum.assessedValue + Number(item.assessedValue), loanAmount: sum.loanAmount + Number(item.loanAmount) }), { assessedValue: 0, loanAmount: 0 });
}
