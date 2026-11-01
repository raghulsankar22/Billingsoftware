"use client";

import { useRef, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import { formatINR } from "@/lib/money";
import { billReceiptLabels, collectedByText, type Bill } from "@/lib/types";
import { api } from "./api";
import { useLanguage } from "./language-provider";

export function CancelDelivery({ accountSlot, onSaved, onReceipt }: { accountSlot: AccountSlot; onSaved: () => void; onReceipt: (bill: Bill) => void }) {
  const { t } = useLanguage();
  const [billNumber, setBillNumber] = useState("");
  const [bill, setBill] = useState<Bill | null>(null);
  const [busy, setBusy] = useState<"lookup" | "cancel" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const generation = useRef(0);

  async function findBill(event: React.FormEvent) {
    event.preventDefault();
    const request = ++generation.current;
    setBusy("lookup"); setError(""); setMessage(""); setWarnings([]); setBill(null);
    try {
      const { bill: found } = await api(`/api/delivery?billNumber=${encodeURIComponent(billNumber.trim())}`, accountSlot);
      if (request === generation.current) setBill(found);
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : "Unable to find this bill.");
    } finally {
      if (request === generation.current) setBusy(null);
    }
  }

  async function cancelDelivery() {
    if (!bill || busy) return;
    if (!window.confirm(`${t("Cancel this delivery bill?")}\n${t("Bill #")}${bill.billNumber} · ${bill.customerName}\n${t("Delivery No.")} ${bill.deliveryNo || "-"}\n\n${t("The bill goes back to awaiting delivery. Its delivery number isn't used again.")}`)) return;
    const request = ++generation.current;
    setBusy("cancel"); setError(""); setMessage(""); setWarnings([]);
    try {
      const result = await api(`/api/bills/${bill.id}/delivery`, accountSlot, { method: "DELETE" });
      if (request !== generation.current) return;
      setBill(result.bill); setWarnings(result.warnings ?? []);
      setMessage(`Delivery cancelled for bill #${bill.billNumber}. It is awaiting delivery again.`);
      onSaved();
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : "Unable to cancel this delivery.");
    } finally {
      if (request === generation.current) setBusy(null);
    }
  }

  const delivered = Boolean(bill && (bill.deliveryNo || bill.deliveryDate));
  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">{t("ACCOUNT")} {accountSlot} · {t("Cancel delivery bill")}</p><h2>{t("Cancel a delivery bill")}</h2><p className="muted">{t("Enter the bill number to review its delivery before cancelling.")}</p></div></div>
    <form className="delivery-search" onSubmit={findBill}>
      <label htmlFor="cancel-delivery-bill-number">{t("Bill number")}<input id="cancel-delivery-bill-number" inputMode="numeric" value={billNumber} placeholder={t("e.g. 1")} disabled={Boolean(busy)} onChange={event => { setBillNumber(event.target.value); setBill(null); setError(""); setMessage(""); setWarnings([]); }} required /></label>
      <button disabled={Boolean(busy)}>{busy === "lookup" ? t("Finding…") : t("Find bill")}</button>
    </form>
    {error && <p className="error" role="alert">{t(error)}</p>}
    {message && <p className="excel-notice delivery-notice" role="status">{t(message)}</p>}
    {warnings.map(warning => <p className="overview-warning" key={warning}>{t(warning)}</p>)}
    {bill && <div className="delivery-details">
      <h2>{t("Bill #")}{bill.billNumber} · {bill.customerName}</h2>
      {delivered ? <div className="delivery-customer">
        <p><b>{t("Delivery No.")}:</b> {bill.deliveryNo || t("Not recorded")}</p>
        <p><b>{t("Delivery Date")}:</b> {bill.deliveryDate || t("Not recorded")}</p>
        <p><b>{t("Delivery remarks")}:</b> {bill.deliveryBillReceiptStatus ? t(billReceiptLabels[bill.deliveryBillReceiptStatus]) : t("Not recorded")}</p>
        <p><b>{t("Taken by")}:</b> {collectedByText(bill) || t("Not recorded")}</p>
        <p><b>{t("Loan amount")}:</b> {formatINR(bill.totalLoanAmount)}</p>
      </div> : !message && <p className="muted">{t("This bill has no delivery to cancel.")}</p>}
      {bill.historicalDelivery && delivered && <p className="overview-warning">{t("This delivery came from your old register, so it can't be cancelled here. Use Edit bill to correct it.")}</p>}
      {delivered && !bill.historicalDelivery && <div className="delivery-bill-actions">
        {bill.deliveryNo && bill.deliveryDate && <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => onReceipt(bill)}>{t("View delivery bill")}</button>}
        <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => void cancelDelivery()}>{busy === "cancel" ? t("Please wait…") : t("Cancel delivery bill")}</button>
      </div>}
      {bill.cancelledDeliveries?.map((entry, index) => <p className="muted" key={index}>{t("Cancelled earlier")}: {t("Delivery No.")} {entry.deliveryNo || "-"} · {entry.deliveryDate || "-"}</p>)}
    </div>}
  </section>;
}
