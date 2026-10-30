"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import type { Bill } from "@/lib/types";
import { billingPeriod, billingToday, businessUpdates, type UpdatePeriod } from "@/lib/business-updates";
import { formatINR } from "@/lib/money";
import { api } from "./api";
import { JewelInventory } from "./jewel-inventory";

const labels: Record<UpdatePeriod, string> = { yesterday: "Yesterday", daily: "Today", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
const periods = ["yesterday", "daily", "weekly", "monthly", "yearly"] as const;
const displayDate = (value: string) => value.split("-").reverse().join("/");

export function BusinessUpdates({ accountSlot, onBill, onDelivery, onExportExcel, onRefreshExcel, isRefreshingExcel }: { accountSlot: AccountSlot; onBill: (bill: Bill) => void; onDelivery: (bill: Bill) => void; onExportExcel: () => void; onRefreshExcel: () => void; isRefreshingExcel: boolean }) {
  const [section, setSection] = useState<"activity" | "jewels" | "gold" | "silver">("activity");
  const [mode, setMode] = useState<UpdatePeriod>("daily");
  const [date, setDate] = useState(billingToday);
  const [year, setYear] = useState(() => date.slice(0, 4));
  const [bills, setBills] = useState<Bill[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true); setError("");
    api("/api/bills", accountSlot).then(result => { if (active) setBills(result.bills ?? []); })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Unable to load dashboard."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [accountSlot, refresh]);
  const range = useMemo(() => {
    if (mode === "yearly" && (!/^\d{1,4}$/.test(year) || Number(year) <= 0)) return null;
    const anchor = mode === "yesterday" ? billingToday()
      : mode === "yearly" ? `${year.padStart(4, "0")}-01-01`
      : date;
    try { return billingPeriod(mode, anchor); } catch { return null; }
  }, [mode, date, year, refresh]);
  const report = useMemo(() => range ? businessUpdates(bills, range) : null, [bills, range]);
  const selectPeriod = (period: UpdatePeriod) => {
    setMode(period);
    if (period === "daily" || period === "yesterday") {
      const today = billingToday();
      setDate(today);
      setYear(today.slice(0, 4));
    }
  };
  const changeDate = (value: string) => {
    const nextDate = value ? mode === "monthly" ? `${value}-01` : value : "";
    setDate(nextDate);
    if (nextDate) setYear(nextDate.slice(0, 4));
  };

  return <section className="panel">
    <div className="section-heading dashboard-heading"><div><p className="eyebrow">ACCOUNT {accountSlot}</p><h2>Dashboard</h2><p className="dashboard-period">{section === "activity" ? `${labels[mode]} overview` : "Jewellery held against undelivered loans"}</p></div><div className="dashboard-actions"><button className="secondary" onClick={onExportExcel}>Download Excel</button><button className="secondary" disabled={isRefreshingExcel} onClick={onRefreshExcel}>{isRefreshingExcel ? "Refreshing Excel…" : "Refresh Excel"}</button><button className="secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{busy ? "Loading…" : "Refresh"}</button></div></div>
    <div className="dashboard-sections" role="group" aria-label="Dashboard sections">{(["activity", "jewels", "gold", "silver"] as const).map(tab => <button type="button" key={tab} className={section === tab ? "active" : "secondary"} aria-pressed={section === tab} onClick={() => setSection(tab)}>{tab === "activity" ? "Activity" : tab === "jewels" ? "Jewels" : tab === "gold" ? "Gold" : "Silver"}</button>)}</div>
    {section === "activity" ? <>
    <p className="muted">Yesterday follows India’s calendar date. Choose a date to inspect a day, week, or month, or select a calendar year.</p>
    <div className="updates-controls"><div className="updates-period" role="group" aria-label="Dashboard period">{periods.map(period => <button key={period} className={mode === period ? "active" : "secondary"} aria-pressed={mode === period} onClick={() => selectPeriod(period)}>{labels[period]}</button>)}</div>
      {mode !== "yesterday" && <label>{mode === "monthly" ? "Month" : mode === "weekly" ? "Date in week" : mode === "yearly" ? "Year" : "Date"}<input
        type={mode === "monthly" ? "month" : mode === "yearly" ? "number" : "date"}
        min={mode === "yearly" ? "1" : undefined}
        max={mode === "yearly" ? "9999" : undefined}
        step={mode === "yearly" ? "1" : undefined}
        value={mode === "monthly" ? date.slice(0, 7) : mode === "yearly" ? year : date}
        onChange={event => {
          if (mode === "yearly") {
            const nextYear = event.target.value;
            setYear(nextYear);
            if (/^\d{1,4}$/.test(nextYear) && Number(nextYear) > 0) setDate(`${nextYear.padStart(4, "0")}-01-01`);
          } else changeDate(event.target.value);
        }}
      /></label>}
    </div>
    {range ? <p className="updates-range">Date range: {displayDate(range.from)}{range.to !== range.from && <> – {displayDate(range.to)}</>}</p> : <p className="error">Choose a valid date or year.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {busy && <p className="muted" role="status">Loading business activity…</p>}
    {report && !busy && !error && <>
      <div className="updates-summary" aria-label="Period totals">
        <div><span>Loan bills recorded</span><strong>{report.loans.length}</strong><small>Active: {report.activeLoans.length} · Voided: {report.voidedLoans.length}</small></div><div><span>Recorded loan amount</span><strong>{formatINR(report.recordedLoanAmount)}</strong><small>Active: {formatINR(report.loanAmount)}<br />Voided: {formatINR(report.voidedLoanAmount)}</small></div><div><span>Delivery bills</span><strong>{report.deliveries.length}</strong></div>
        <div><span>Delivery principal</span><strong>{formatINR(report.deliveryPrincipal)}</strong></div><div><span>Delivery interest</span><strong>{formatINR(report.deliveryInterest)}</strong></div><div><span>Delivery total to collect</span><strong>{formatINR(report.deliveryTotal)}</strong></div>
      </div>
      {report.incompleteDeliveries > 0 && <p className="overview-warning">{report.incompleteDeliveries} delivery bill(s) have incomplete interest details. Unknown interest and repayment totals are excluded from the summary.</p>}
      <p className="muted collection-note">All dated loan bills are shown, including voided bills. Recorded loan amounts include this history; active and voided subtotals are shown separately. Delivery totals use the saved delivery-date calculation and include deliveries for voided bills. These are bill totals, not payment confirmations.</p>
      <h3>Loan bills recorded</h3>
      <div className="item-table-wrap"><table className="history-table dashboard-loan-table">
        <thead><tr><th>Date</th><th>Bill number</th><th>Customer name</th><th>Customer address</th><th>Metal</th><th>Particulars</th><th>Status</th><th>Loan amount</th><th /></tr></thead>
        <tbody>{report.loans.map(bill => <tr key={bill.id} className={bill.status === "void" ? "void-row" : ""}>
          <td>{displayDate(bill.billDate)}</td>
          <td>#{bill.billNumber}</td>
          <td>{bill.customerName}</td>
          <td className="dashboard-loan-address">{bill.address}</td>
          <td>{[...new Set(bill.items.map(item => item.metal ?? "Not set"))].join(", ") || "—"}</td>
          <td className="dashboard-loan-particulars">{bill.items.map((item, index) => <div key={index}>{item.particulars}</div>)}</td>
          <td>{bill.status === "void" ? "Voided" : "Issued"}{bill.deliveryNo && bill.deliveryDate && <small>Delivered</small>}</td>
          <td>{formatINR(bill.totalLoanAmount)}</td>
          <td><button className="text-button" onClick={() => onBill(bill)}>Open</button></td>
        </tr>)}{!report.loans.length && <tr><td colSpan={9} className="empty">{busy ? "Loading…" : "No loan bills recorded in this period."}</td></tr>}</tbody>
      </table></div>
      <h3>Delivery bills</h3><div className="item-table-wrap"><table className="history-table"><thead><tr><th>Delivery Date</th><th>Delivery No.</th><th>Bill No.</th><th>Customer</th><th>Principal</th><th>Interest</th><th>Total to collect</th><th /></tr></thead><tbody>{report.deliveries.map(({ bill, collection }) => <tr key={bill.id}><td>{displayDate(bill.deliveryDate!)}</td><td>#{bill.deliveryNo}</td><td>#{bill.billNumber}{bill.status === "void" && <small>Original bill voided</small>}</td><td>{bill.customerName}</td><td>{formatINR(collection?.principal ?? bill.totalLoanAmount)}</td><td>{collection?.interest == null ? "—" : formatINR(collection.interest)}</td><td>{collection?.total == null ? "—" : formatINR(collection.total)}</td><td><button className="text-button" onClick={() => onDelivery(bill)}>Open</button></td></tr>)}{!report.deliveries.length && <tr><td colSpan={8} className="empty">{busy ? "Loading…" : "No delivery bills in this period."}</td></tr>}</tbody></table></div>
    </>}
    </> : <JewelInventory bills={bills} metal={section === "gold" ? "Gold" : section === "silver" ? "Silver" : undefined} busy={busy} error={error} onBill={onBill} />}
  </section>;
}
