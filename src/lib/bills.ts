import type { Bill, BillInput, BusinessSnapshot } from "./types";
import { collectedByRelationLabels, type CollectedByRelation } from "./types";
import { amountInWords } from "./money";

export function toBill(row: Record<string, unknown>): Bill {
  const items = Array.isArray(row.items) ? [...row.items].sort((left, right) => Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0)) : [];
  const totalLoanAmount = Number(row.total_loan_amount ?? 0);
  return {
    id: String(row.id),
    customerId: row.customer_id ? String(row.customer_id) : undefined,
    customerCode: row.customer_code ? String(row.customer_code) : undefined,
    profileId: row.profile_id ? String(row.profile_id) : undefined,
    billNumber: Number(row.bill_number),
    status: String(row.status) as Bill["status"],
    deliveryNo: String(row.delivery_no ?? ""),
    deliveryDate: String(row.delivery_date ?? ""),
    historicalDelivery: row.historical_delivery === true,
    historicalMissingDetails: row.historical_missing_details === true,
    historicalImport: row.historical_import === true,
    deliveryBillReceiptStatus: row.delivery_bill_receipt_status === "has_bill" || row.delivery_bill_receipt_status === "lost_bill" ? row.delivery_bill_receipt_status : undefined,
    deliveryCollectedByName: row.delivery_collected_by_name ? String(row.delivery_collected_by_name) : undefined,
    deliveryCollectedByRelation: typeof row.delivery_collected_by_relation === "string" && row.delivery_collected_by_relation in collectedByRelationLabels ? row.delivery_collected_by_relation as CollectedByRelation : undefined,
    cancelledDeliveries: Array.isArray(row.cancelled_deliveries) ? row.cancelled_deliveries.map((entry: { delivery_no?: unknown; delivery_date?: unknown; cancelled_at?: unknown }) => ({ deliveryNo: String(entry.delivery_no ?? ""), deliveryDate: String(entry.delivery_date ?? ""), cancelledAt: String(entry.cancelled_at ?? "") })) : undefined,
    deliverySummary: row.delivery_summary && typeof row.delivery_summary === "object" && "lines" in row.delivery_summary && Array.isArray(row.delivery_summary.lines) ? row.delivery_summary as Bill["deliverySummary"] : undefined,
    billDate: String(row.bill_date),
    customerName: String(row.customer_name),
    fatherName: String(row.father_name ?? ""),
    address: String(row.address),
    phone: String(row.phone ?? ""),
    governmentId: String(row.government_id ?? ""),
    items: items.map((item) => {
      const source = item as Record<string, unknown>;
      return { metal: source.metal === "Gold" || source.metal === "Silver" ? source.metal : undefined, particulars: String(source.particulars), remarks: typeof source.remarks === "string" ? source.remarks : undefined, grams: source.grams == null ? null : Number(source.grams), assessedValue: source.assessed_value == null ? null : Number(source.assessed_value), loanAmount: Number(source.loan_amount) };
    }),
    totalAssessedValue: row.total_assessed_value == null ? null : Number(row.total_assessed_value),
    totalLoanAmount,
    amountInWords: amountInWords(totalLoanAmount),
    excelSyncStatus: String(row.excel_sync_status ?? "pending") as Bill["excelSyncStatus"],
    excelSyncError: row.excel_sync_error ? String(row.excel_sync_error) : undefined,
    replacementForId: row.replacement_for_id ? String(row.replacement_for_id) : undefined,
    createdAt: String(row.created_at),
    businessSnapshot: row.business_snapshot && typeof row.business_snapshot === "object" && "business_name" in row.business_snapshot ? row.business_snapshot as BusinessSnapshot : undefined,
  };
}

export function totals(input: BillInput) {
  const paise = input.items.reduce((sum, item) => ({ assessedValue: sum.assessedValue + Math.round(Number(item.assessedValue) * 100), loanAmount: sum.loanAmount + Math.round(Number(item.loanAmount) * 100) }), { assessedValue: 0, loanAmount: 0 });
  return { assessedValue: paise.assessedValue / 100, loanAmount: paise.loanAmount / 100 };
}
