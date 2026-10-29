"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import type { Bill } from "@/lib/types";
import { billingToday } from "@/lib/business-updates";
import { calculateRepayment } from "@/lib/interest";
import { formatINR } from "@/lib/money";
import { api } from "./api";

export function MultipleDelivery({ accountSlot, onSaved, onReceipt, onOpen }: { accountSlot: AccountSlot; onSaved: () => void; onReceipt: (bill: Bill) => void; onOpen: (bill: Bill) => void }) {
  const [numbers, setNumbers] = useState("");
  const [bills, setBills] = useState<Bill[]>([]);
  const [date, setDate] = useState(billingToday);
  const [metals, setMetals] = useState<Record<string, ("Gold" | "Silver" | null)[]>>({});
  const [busy, setBusy] = useState<"lookup" | "save" | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const rows = useMemo(() => bills.map(bill => {
    try {
      const collection = saved && bill.deliverySummary ? bill.deliverySummary : calculateRepayment(bill.items.map((item, index) => ({ ...item, metal: item.metal ?? metals[bill.id]?.[index] ?? undefined })), bill.billDate, date);
      return { bill, collection, error: "" };
    } catch (failure) { return { bill, collection: null, error: failure instanceof Error ? failure.message : "Choose a valid delivery date." }; }
  }), [bills, date, metals, saved]);
  const complete = rows.length > 0 && rows.every(row => row.collection && !row.collection.missingMetal && row.collection.interest !== null && row.collection.total !== null);
  const sum = (field: "principal" | "interest" | "total" | "initialInterest") => rows.reduce((paise, row) => paise + Math.round(Number(row.collection?.[field] ?? (field === "principal" ? row.bill.totalLoanAmount : 0)) * 100), 0) / 100;
  const money = (value: number | null) => value === null ? "—" : formatINR(value);
  const minDate = bills.reduce((latest, bill) => bill.billDate > latest ? bill.billDate : latest, "");

  async function findBills(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    const parts = numbers.trim().split(/[,\s]+/).map(value => value.replace(/^#/, ""));
    if (!parts.length || parts.some(value => !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) >= 2147483647)) { setError("Enter bill numbers separated by commas, for example 1, 2, 3."); return; }
    const requested = [...new Set(parts.map(Number))];
    if (bills.length + requested.filter(number => !bills.some(bill => bill.billNumber === number)).length > 50) { setError("You can deliver up to 50 bills together."); return; }
    const current = ++generation.current; setBusy("lookup"); setError("");
    try {
      const results = await Promise.all(requested.map(number => api(`/api/delivery?billNumber=${number}`, accountSlot)));
      if (current !== generation.current) return;
      const found = results.map(result => result.bill as Bill);
      setBills(existing => [...existing, ...found.filter(bill => !existing.some(row => row.id === bill.id))]);
      setNumbers("");
    } catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : "Unable to find these bills."); }
    finally { if (current === generation.current) setBusy(null); }
  }
  async function save() {
    if (!complete || busy) return;
    const current = ++generation.current; setBusy("save"); setError(""); setWarnings([]);
    try {
      const result = await api("/api/delivery/batch", accountSlot, { method: "POST", body: JSON.stringify({ deliveryDate: date, deliveries: bills.map(bill => ({ billId: bill.id, itemMetals: bill.items.map((item, index) => item.metal ?? metals[bill.id]?.[index] ?? null) })) }) });
      if (current !== generation.current) return;
      setBills(result.bills); setWarnings(result.warnings ?? []); setSaved(true); onSaved();
    } catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : "Unable to save these deliveries."); }
    finally { if (current === generation.current) setBusy(null); }
  }
  function reset() { setBills([]); setNumbers(""); setDate(billingToday()); setMetals({}); setSaved(false); setWarnings([]); setError(""); }

  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">ACCOUNT {accountSlot} · MULTIPLE DELIVERY</p><h2>{saved ? "Deliveries saved" : "Deliver several bills together"}</h2><p className="muted">Each bill gets its own delivery number and receipt. Review the combined amount to collect below.</p></div>{saved && <button className="secondary" onClick={reset}>Start another delivery</button>}</div>
    {!saved && <form className="delivery-search" onSubmit={findBills}><label htmlFor="multiple-bill-numbers">Bill numbers<input id="multiple-bill-numbers" placeholder="e.g. 1, 2, 3" value={numbers} disabled={Boolean(busy)} onChange={event => setNumbers(event.target.value)} required /></label><button disabled={Boolean(busy)}>{busy === "lookup" ? "Finding…" : "Add bills"}</button></form>}
    <label className="overview-date">Delivery date<input type="date" value={date} min={minDate || undefined} disabled={Boolean(busy) || saved} onChange={event => { setDate(event.target.value); setError(""); }} required /></label>
    {error && <p className="error" role="alert">{error}</p>}
    {saved && <p className="excel-notice" role="status">{bills.length} delivery bill{bills.length === 1 ? "" : "s"} saved. Open each receipt below to print or download its PDF.</p>}
    {warnings.map((message, index) => <p className="overview-warning" key={index}>{message}</p>)}
    {rows.length > 0 ? <>
      <div className="item-table-wrap"><table className="history-table batch-delivery-table"><thead><tr><th>Bill / customer</th><th>Particulars</th><th className="batch-money">Principal</th><th className="batch-money">Interest to collect</th><th className="batch-money">Total to collect</th><th /></tr></thead><tbody>{rows.map(({ bill, collection, error: calculationError }) => <tr key={bill.id}>
        <td><b>#{bill.billNumber} · {bill.customerName}</b><small>{bill.billDate}{bill.status === "void" ? " · Voided" : ""}</small>{bill.deliveryNo && <small>Delivery #{bill.deliveryNo} · {bill.deliveryDate}{!saved && " · saving updates this delivery"}</small>}</td>
        <td>{bill.items.map((item, index) => <div className="batch-jewellery" key={index}>{item.metal ? `${item.metal}: ` : ""}{item.particulars}{!item.metal && !saved && <select aria-label={`Metal for bill ${bill.billNumber} item ${index + 1}`} value={metals[bill.id]?.[index] ?? ""} disabled={Boolean(busy)} onChange={event => {
          const chosen = event.target.value === "Gold" || event.target.value === "Silver" ? event.target.value : null;
          setMetals(previous => ({ ...previous, [bill.id]: bill.items.map((entry, itemIndex) => itemIndex === index ? chosen : previous[bill.id]?.[itemIndex] ?? entry.metal ?? null) }));
        }}><option value="">Choose metal</option><option value="Gold">Gold</option><option value="Silver">Silver</option></select>}</div>)}{calculationError && <p className="error">{calculationError}</p>}{collection?.missingMetal && <p className="error">Choose Gold or Silver to calculate interest.</p>}</td>
        <td className="batch-money">{formatINR(collection?.principal ?? bill.totalLoanAmount)}</td><td className="batch-money">{money(collection?.interest ?? null)}</td><td className="batch-money">{money(collection?.total ?? null)}</td>
        <td><div className="batch-actions"><button type="button" className="text-button" onClick={() => onOpen(bill)}>Open bill</button>{saved ? <button type="button" className="secondary" onClick={() => onReceipt(bill)}>Open receipt #{bill.deliveryNo}</button> : <button type="button" className="text-button danger-text" disabled={Boolean(busy)} onClick={() => setBills(current => current.filter(row => row.id !== bill.id))}>Remove bill #{bill.billNumber}</button>}</div></td>
      </tr>)}</tbody></table></div>
      <section className="repayment-summary" aria-label="Combined delivery amounts"><h3>{bills.length} bill{bills.length === 1 ? "" : "s"} · Combined amount to collect</h3><dl><div><dt>Principal</dt><dd>{formatINR(sum("principal"))}</dd></div><div><dt>First-month interest charged at issue</dt><dd>{money(complete ? sum("initialInterest") : null)}</dd></div><div><dt>Interest to collect now</dt><dd>{money(complete ? sum("interest") : null)}</dd></div><div className="collection-total"><dt>Total to collect now</dt><dd>{money(complete ? sum("total") : null)}</dd></div></dl><p className="muted collection-note">First-month interest is assumed collected when each loan was issued and is excluded from the total above.</p></section>
      {!saved && <button disabled={!complete || Boolean(busy)} onClick={() => void save()}>{busy === "save" ? "Saving deliveries…" : `Save ${bills.length} deliver${bills.length === 1 ? "y" : "ies"}`}</button>}
    </> : <p className="empty">Add one or more bill numbers to see the principal, interest and total.</p>}
  </section>;
}
