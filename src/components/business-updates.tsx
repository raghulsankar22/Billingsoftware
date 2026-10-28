"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import type { Bill } from "@/lib/types";
import { billingPeriod, billingToday, businessUpdates, type UpdatePeriod } from "@/lib/business-updates";
import { formatINR } from "@/lib/money";
import { api } from "./api";

const labels = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
const displayDate = (value: string) => value.split("-").reverse().join("/");

export function BusinessUpdates({ accountSlot, onBill, onDelivery }: { accountSlot: AccountSlot; onBill: (bill: Bill) => void; onDelivery: (bill: Bill) => void }) {
  const [mode, setMode] = useState<UpdatePeriod>("daily");
  const [date, setDate] = useState(billingToday);
  const [bills, setBills] = useState<Bill[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true); setError("");
    api("/api/bills", accountSlot).then(result => { if (active) setBills(result.bills ?? []); })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Unable to load business updates."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [accountSlot, refresh]);
  const range = useMemo(() => { try { return billingPeriod(mode, date); } catch { return null; } }, [mode, date]);
  const report = useMemo(() => range ? businessUpdates(bills, range) : null, [bills, range]);

  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">ACCOUNT {accountSlot} · BUSINESS ACTIVITY</p><h2>{labels[mode]} update</h2><p className="muted">Daily, Monday–Sunday weekly, and calendar-month summaries in one place.</p></div><button className="secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{busy ? "Loading…" : "Refresh"}</button></div>
    <div className="updates-controls"><div className="updates-period" role="group" aria-label="Update period">{(["daily", "weekly", "monthly"] as const).map(period => <button key={period} className={mode === period ? "active" : "secondary"} aria-pressed={mode === period} onClick={() => setMode(period)}>{labels[period]}</button>)}</div>
      <label>{mode === "monthly" ? "Month" : mode === "weekly" ? "Date in week" : "Date"}<input type={mode === "monthly" ? "month" : "date"} value={mode === "monthly" ? date.slice(0, 7) : date} onChange={event => setDate(event.target.value ? mode === "monthly" ? `${event.target.value}-01` : event.target.value : "")} /></label>
    </div>
    {range ? <p className="updates-range">{displayDate(range.from)}{range.to !== range.from && <> – {displayDate(range.to)}</>}</p> : <p className="error">Choose a valid date.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {busy && <p className="muted" role="status">Loading business activity…</p>}
    {report && !busy && !error && <>
      <div className="updates-summary" aria-label="Period totals">
        <div><span>Loan bills issued</span><strong>{report.loans.length}</strong></div><div><span>Loan amount given</span><strong>{formatINR(report.loanAmount)}</strong></div><div><span>Delivery bills</span><strong>{report.deliveries.length}</strong></div>
        <div><span>Delivery principal</span><strong>{formatINR(report.deliveryPrincipal)}</strong></div><div><span>Delivery interest</span><strong>{formatINR(report.deliveryInterest)}</strong></div><div><span>Delivery total to collect</span><strong>{formatINR(report.deliveryTotal)}</strong></div>
      </div>
      {report.incompleteDeliveries > 0 && <p className="overview-warning">{report.incompleteDeliveries} delivery bill(s) have incomplete interest details. Unknown interest and repayment totals are excluded from the summary.</p>}
      <p className="muted collection-note">Loan totals exclude voided bills. Delivery totals include recorded deliveries for voided bills and use the saved delivery-date calculation. These are bill totals, not payment confirmations; first-month interest charged at issue is excluded from delivery totals.</p>
      <h3>Loan bills issued</h3><div className="item-table-wrap"><table className="history-table"><thead><tr><th>Date</th><th>Bill No.</th><th>Customer</th><th>Loan amount</th><th /></tr></thead><tbody>{report.loans.map(bill => <tr key={bill.id}><td>{displayDate(bill.billDate)}</td><td>#{bill.billNumber}</td><td>{bill.customerName}</td><td>{formatINR(bill.totalLoanAmount)}</td><td><button className="text-button" onClick={() => onBill(bill)}>Open</button></td></tr>)}{!report.loans.length && <tr><td colSpan={5} className="empty">{busy ? "Loading…" : "No loan bills issued in this period."}</td></tr>}</tbody></table></div>
      <h3>Delivery bills</h3><div className="item-table-wrap"><table className="history-table"><thead><tr><th>Delivery Date</th><th>Delivery No.</th><th>Bill No.</th><th>Customer</th><th>Principal</th><th>Interest</th><th>Total to collect</th><th /></tr></thead><tbody>{report.deliveries.map(({ bill, collection }) => <tr key={bill.id}><td>{displayDate(bill.deliveryDate!)}</td><td>#{bill.deliveryNo}</td><td>#{bill.billNumber}{bill.status === "void" && <small>Original bill voided</small>}</td><td>{bill.customerName}</td><td>{formatINR(collection?.principal ?? bill.totalLoanAmount)}</td><td>{collection?.interest == null ? "—" : formatINR(collection.interest)}</td><td>{collection?.total == null ? "—" : formatINR(collection.total)}</td><td><button className="text-button" onClick={() => onDelivery(bill)}>Open</button></td></tr>)}{!report.deliveries.length && <tr><td colSpan={8} className="empty">{busy ? "Loading…" : "No delivery bills in this period."}</td></tr>}</tbody></table></div>
    </>}
  </section>;
}
