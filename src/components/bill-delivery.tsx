"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import { formatINR } from "@/lib/money";
import type { Bill, BillReceiptStatus } from "@/lib/types";
import { BillReceiptSelect } from "./bill-receipt-select";
import { api } from "./api";
import { calculateRepayment } from "@/lib/interest";
import { RepaymentDetails } from "./repayment-details";
import { MultipleDelivery } from "./multiple-delivery";
import { DeliveredBillNotice } from "./delivered-bill-notice";
import { deliveryBillHistory } from "@/lib/delivery-history";
import { isDelivered } from "@/lib/delivery-status";

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

type DeliveryProps = { accountSlot: AccountSlot; onSaved: (bill: Bill) => void; onBatchSaved: () => void; onOpen: (bill: Bill) => void; onOverview: (bill: Bill) => void; onReceipt: (bill: Bill) => void };
export function BillDelivery(props: DeliveryProps) {
  const [mode, setMode] = useState<"single" | "multiple">("single");
  const [alreadyDelivered, setAlreadyDelivered] = useState<Bill[]>([]);
  return <><div className="delivery-mode" role="group" aria-label="Delivery mode"><button className={mode === "single" ? "active" : "secondary"} aria-pressed={mode === "single"} onClick={() => setMode("single")}>Single Delivery</button><button className={mode === "multiple" ? "active" : "secondary"} aria-pressed={mode === "multiple"} onClick={() => setMode("multiple")}>Multiple Delivery</button></div>{mode === "single" ? <SingleBillDelivery {...props} onAlreadyDelivered={setAlreadyDelivered} /> : <MultipleDelivery accountSlot={props.accountSlot} onSaved={props.onBatchSaved} onOpen={props.onOpen} onReceipt={props.onReceipt} onAlreadyDelivered={setAlreadyDelivered} />}{alreadyDelivered.length > 0 && <DeliveredBillNotice bills={alreadyDelivered} onClose={() => setAlreadyDelivered([])} />}</>;
}

function SingleBillDelivery({ accountSlot, onSaved, onOpen, onOverview, onReceipt, onAlreadyDelivered }: DeliveryProps & { onAlreadyDelivered: (bills: Bill[]) => void }) {
  const [billNumber, setBillNumber] = useState("");
  const [bill, setBill] = useState<Bill | null>(null);
  const [deliveryNo, setDeliveryNo] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(today);
  const [billReceiptStatus, setBillReceiptStatus] = useState<BillReceiptStatus | "">("");
  const [busy, setBusy] = useState<"lookup" | "save" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [itemMetals, setItemMetals] = useState<("Gold" | "Silver" | null)[]>([]);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  const collection = useMemo(() => {
    if (!bill || !deliveryDate) return { repayment: null, error: "" };
    try {
      return { repayment: calculateRepayment(bill.items.map((item, index) => ({ ...item, metal: item.metal ?? itemMetals[index] ?? undefined })), bill.billDate, deliveryDate), error: "" };
    } catch (failure) {
      return { repayment: null, error: failure instanceof Error ? failure.message : "Unable to calculate interest." };
    }
  }, [bill, deliveryDate, itemMetals]);

  async function findBill(event: React.FormEvent) {
    event.preventDefault();
    const request = ++generation.current;
    setBusy("lookup"); setError(""); setMessage(""); setWarnings([]); setBill(null); setBillReceiptStatus("");
    try {
      const { bill: found, nextDeliveryNumber } = await api(`/api/delivery?billNumber=${encodeURIComponent(billNumber.trim())}`, accountSlot);
      if (request !== generation.current) return;
      setBill(found);
      setBillReceiptStatus(found.deliveryBillReceiptStatus ?? "");
      setDeliveryNo(found.deliveryNo || String(nextDeliveryNumber));
      setItemMetals(found.items.map((item: Bill["items"][number]) => item.metal ?? null));
      setDeliveryDate(found.deliveryDate || (today() < found.billDate ? found.billDate : today()));
      const delivered = deliveryBillHistory([found]);
      if (delivered.length) onAlreadyDelivered(delivered);
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : "Unable to find this bill.");
    } finally {
      if (request === generation.current) setBusy(null);
    }
  }

  async function saveDelivery(event: React.FormEvent) {
    event.preventDefault();
    if (!bill) return;
    if (!billReceiptStatus) { setError("Choose whether the customer has the bill or lost the bill."); return; }
    if (!collection.repayment || collection.repayment.missingMetal) { setError(collection.error || "Choose Gold or Silver for each item to calculate interest."); return; }
    const request = ++generation.current;
    setBusy("save"); setError(""); setMessage(""); setWarnings([]);
    try {
      const result = await api(`/api/bills/${bill.id}/delivery`, accountSlot, { method: "PATCH", body: JSON.stringify({ deliveryDate, itemMetals, billReceiptStatus }) });
      if (request !== generation.current) return;
      setBill(result.bill);
      setDeliveryNo(result.bill.deliveryNo);
      setDeliveryDate(result.bill.deliveryDate);
      setBillReceiptStatus(result.bill.deliveryBillReceiptStatus ?? "");
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
      <div className="section-heading"><div><h2>Bill #{bill.billNumber} · {bill.customerName}</h2><p className="muted">Bill date: {bill.billDate}</p></div><span className="pill">{bill.status === "void" ? isDelivered(bill) ? "Voided · Delivered" : "Voided" : isDelivered(bill) ? "Delivered" : "Awaiting delivery"}</span></div>
      <div className="delivery-customer"><p><b>Father&apos;s name:</b> {bill.fatherName}</p><p><b>Address:</b> {bill.address}</p>{bill.phone && <p><b>Mobile:</b> {bill.phone}</p>}<p><b>Loan amount:</b> {formatINR(bill.totalLoanAmount)}</p></div>
      <div className="item-table-wrap"><table className="history-table"><thead><tr><th>Metal</th><th>Particulars</th><th>Gram</th><th>Assessed value</th><th>Principal</th><th>Monthly rate</th><th>Interest to collect</th></tr></thead><tbody>{bill.items.map((item, index) => <tr key={index}><td>{item.metal ?? <select aria-label={`Metal for item ${index + 1}`} value={itemMetals[index] ?? ""} disabled={Boolean(busy)} onChange={(event) => { const metal = event.target.value; setItemMetals(current => current.map((choice, itemIndex) => itemIndex === index ? metal === "Gold" || metal === "Silver" ? metal : null : choice)); setMessage(""); }}><option value="">Choose metal</option><option value="Gold">Gold</option><option value="Silver">Silver</option></select>}</td><td>{item.particulars}</td><td>{item.grams}</td><td>{formatINR(item.assessedValue)}</td><td>{formatINR(item.loanAmount)}</td><td>{collection.repayment?.lines[index].ratePercent == null ? "—" : `${collection.repayment.lines[index].ratePercent}%`}</td><td>{collection.repayment?.lines[index].interest == null ? "—" : formatINR(collection.repayment.lines[index].interest!)}</td></tr>)}</tbody></table></div>
      <div className="delivery-bill-actions"><button type="button" className="secondary" onClick={() => onOpen(bill)}>Open bill</button><button type="button" className="secondary" onClick={() => onOverview(bill)}>Repayment overview</button>{bill.deliveryNo && bill.deliveryDate && <button type="button" className="secondary" onClick={() => onReceipt(bill)}>View delivery bill</button>}</div>
      <form className="delivery-entry" onSubmit={saveDelivery}>
        <BillReceiptSelect billNumber={bill.billNumber} value={billReceiptStatus} disabled={Boolean(busy)} onChange={value => { setBillReceiptStatus(value); setMessage(""); setError(""); }} />
        <div className="form-grid"><label>Delivery bill number (automatic)<input value={deliveryNo} readOnly /></label><label>Delivery bill date<input type="date" min={bill.billDate} value={deliveryDate} disabled={Boolean(busy)} onChange={(event) => { setDeliveryDate(event.target.value); setMessage(""); }} required /></label></div>
        {collection.error && <p className="error" role="alert">{collection.error}</p>}
        {collection.repayment && <RepaymentDetails repayment={collection.repayment} />}
        <button disabled={Boolean(busy)}>{busy === "save" ? "Saving…" : bill.deliveryNo && bill.deliveryDate ? "Update delivery" : "Save delivery"}</button>
      </form>
    </div>}
  </section>;
}
