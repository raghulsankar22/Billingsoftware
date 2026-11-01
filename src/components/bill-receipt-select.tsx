"use client";

import { useLanguage } from "./language-provider";

import { billReceiptLabels, type BillReceiptStatus } from "@/lib/types";

export function BillReceiptSelect({ billNumber, value, onChange, disabled }: { billNumber: number; value: BillReceiptStatus | ""; onChange: (value: BillReceiptStatus | "") => void; disabled: boolean }) {
  const { t } = useLanguage();
  return <label className="bill-receipt-field">{t("Delivery remarks")} <span className="muted">{t("(required)")}</span>
    <select aria-label={`${t("Bill receipt status for bill")} ${billNumber}`} value={value} required disabled={disabled} onChange={event => onChange(event.target.value === "has_bill" || event.target.value === "lost_bill" ? event.target.value : "")}>
      <option value="">{t("Choose bill status")}</option>
      {Object.entries(billReceiptLabels).map(([status, label]) => <option key={status} value={status}>{t(label)}</option>)}
    </select>
  </label>;
}
