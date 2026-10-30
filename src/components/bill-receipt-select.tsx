"use client";

import { billReceiptLabels, type BillReceiptStatus } from "@/lib/types";

export function BillReceiptSelect({ billNumber, value, onChange, disabled }: { billNumber: number; value: BillReceiptStatus | ""; onChange: (value: BillReceiptStatus | "") => void; disabled: boolean }) {
  return <label className="bill-receipt-field">Delivery remarks <span className="muted">(required)</span>
    <select aria-label={`Bill receipt status for bill ${billNumber}`} value={value} required disabled={disabled} onChange={event => onChange(event.target.value === "has_bill" || event.target.value === "lost_bill" ? event.target.value : "")}>
      <option value="">Choose bill status</option>
      {Object.entries(billReceiptLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
    </select>
  </label>;
}
