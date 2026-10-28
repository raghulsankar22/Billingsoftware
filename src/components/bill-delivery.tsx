"use client";

import { useEffect, useRef, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import { formatINR } from "@/lib/money";
import type { Bill } from "@/lib/types";
import { api } from "./api";

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function BillDelivery({ accountSlot, onSaved, onOpen, onOverview }: { accountSlot: AccountSlot; onSaved: (bill: Bill) => void; onOpen: (bill: Bill) => void; onOverview: (bill: Bill) => void }) {
  const [billNumber, setBillNumber] = useState("");
  const [bill, setBill] = useState<Bill | null>(null);
  const [deliveryNo, setDeliveryNo] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(today);
  const [busy, setBusy] = useState<"lookup" | "save" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);

  async function findBill(event: React.FormEvent) {
    event.preventDefault();
    const request = ++generation.current;
    setBusy("lookup"); setError(""); setMessage(""); setWarnings([]); setBill(null);
    try {
      const { bill: found } = await api(`/api/delivery?billNumber=${encodeURIComponent(billNumber.trim())}`, accountSlot);
      if (request !== generation.current) return;
      setBill(found);
      setDeliveryNo(found.deliveryNo ?? "");
      setDeliveryDate(found.deliveryDate || (today() < found.billDate ? found.billDate : today()));
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : "Unable to find this bill.");
    } finally {
      if (request === generation.current) setBusy(null);
    }
  }

  async function saveDelivery(event: React.FormEvent) {
    event.preventDefault();
    if (!bill) return;
    const request = ++generation.current;
    setBusy("save"); setError(""); setMessage(""); setWarnings([]);
    try {
      const result = await api(`/api/bills/${bill.id}/delivery`, accountSlot, { method: "PATCH", body: JSON.stringify({ deliveryNo, deliveryDate }) });
      if (request !== generation.current) return;
      setBill(result.bill);
      setDeliveryNo(result.bill.deliveryNo);
      setDeliveryDate(result.bill.deliveryDate);
      setWarnings(result.warnings ?? []);
      setMessage(result.warnings?.length ? `Delivery saved for bill #${bill.billNumber}.` : `Delivery saved for bill #${bill.billNumber}. Excel and PDF updated.`);
      onSaved(result.bill);
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : "Unable to save delivery.");
    } finally {
      if (request === generation.current) setBusy(null);
    }
  }

  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">ACCOUNT {accountSlot} · DELIVERY</p><h2>Find a bill for delivery</h2><p className="muted">Enter the bill number to review the customer and pledged items.</p></div></div>
    <form className="delivery-search" onSubmit={findBill}>
      <label htmlFor="delivery-bill-number">Bill number<input id="delivery-bill-number" inputMode="numeric" value={billNumber} placeholder="e.g. 1" disabled={Boolean(busy)} onChange={(event) => { setBillNumber(event.target.value); setBill(null); setError(""); setMessage(""); setWarnings([]); }} required /></label>
      <button disabled={Boolean(busy)}>{busy === "lookup" ? "Finding…" : "Find bill"}</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="excel-notice delivery-notice" role="status">{message}</p>}
    {warnings.map((warning) => <p className="overview-warning" key={warning}>{warning}</p>)}
    {bill && <div className="delivery-details">
      <div className="section-heading"><div><h2>Bill #{bill.billNumber} · {bill.customerName}</h2><p className="muted">Bill date: {bill.billDate}</p></div><span className="pill">{bill.status === "void" ? bill.deliveryNo && bill.deliveryDate ? "Voided · Delivered" : "Voided" : bill.deliveryNo && bill.deliveryDate ? "Delivered" : "Awaiting delivery"}</span></div>
      <div className="delivery-customer"><p><b>Father&apos;s name:</b> {bill.fatherName}</p><p><b>Address:</b> {bill.address}</p>{bill.phone && <p><b>Mobile:</b> {bill.phone}</p>}<p><b>Loan amount:</b> {formatINR(bill.totalLoanAmount)}</p></div>
      <div className="item-table-wrap"><table className="history-table"><thead><tr><th>Metal</th><th>Particulars</th><th>Gram</th><th>Assessed value</th><th>Loan amount</th></tr></thead><tbody>{bill.items.map((item, index) => <tr key={index}><td>{item.metal ?? "—"}</td><td>{item.particulars}</td><td>{item.grams}</td><td>{formatINR(item.assessedValue)}</td><td>{formatINR(item.loanAmount)}</td></tr>)}</tbody></table></div>
      <div className="delivery-bill-actions"><button type="button" className="secondary" onClick={() => onOpen(bill)}>Open bill</button><button type="button" className="secondary" onClick={() => onOverview(bill)}>Repayment overview</button></div>
      <form className="delivery-entry" onSubmit={saveDelivery}>
        <div className="form-grid"><label>Delivery bill number<input value={deliveryNo} maxLength={60} disabled={Boolean(busy)} onChange={(event) => { setDeliveryNo(event.target.value); setMessage(""); }} required /></label><label>Delivery bill date<input type="date" min={bill.billDate} value={deliveryDate} disabled={Boolean(busy)} onChange={(event) => { setDeliveryDate(event.target.value); setMessage(""); }} required /></label></div>
        <button disabled={Boolean(busy)}>{busy === "save" ? "Saving…" : bill.deliveryNo && bill.deliveryDate ? "Update delivery" : "Save delivery"}</button>
      </form>
    </div>}
  </section>;
}
