"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import type { Bill } from "@/lib/types";
import { billingToday } from "@/lib/business-updates";
import { overdueBillHistory, overduePeriod } from "@/lib/overdue";
import { formatINR } from "@/lib/money";
import { api } from "./api";

const displayDate = (value: string) => value.split("-").reverse().join("/");

export function OverdueBills({ accountSlot, onOpen, onOverview }: { accountSlot: AccountSlot; onOpen: (bill: Bill) => void; onOverview: (bill: Bill) => void }) {
  const [month, setMonth] = useState(() => billingToday().slice(0, 7));
  const [bills, setBills] = useState<Bill[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const range = useMemo(() => { try { return overduePeriod(month); } catch { return null; } }, [month]);

  useEffect(() => {
    if (!range) { setBills([]); setBusy(false); setError(""); return; }
    let active = true;
    setBusy(true); setError("");
    api(`/api/bills?from=${range.from}&to=${range.to}`, accountSlot)
      .then(result => { if (active) setBills(result.bills ?? []); })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Unable to load overdue bills."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [accountSlot, range, refresh]);

  const pending = useMemo(() => range ? overdueBillHistory(bills, month, query) : [], [bills, month, query, range]);
  const principal = pending.reduce((sum, bill) => sum + Math.round(bill.totalLoanAmount * 100), 0) / 100;

  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">ACCOUNT {accountSlot} · PENDING DELIVERY</p><h2>Overdue</h2><p className="muted">Bills from the same month one year earlier that still have no completed delivery.</p></div><button type="button" className="secondary" disabled={busy || !range} onClick={() => setRefresh(value => value + 1)}>{busy ? "Loading…" : "Refresh"}</button></div>
    <div className="overdue-controls"><label>Review month<input type="month" aria-label="Overdue review month" min="0002-01" max="9999-12" value={month} onChange={event => setMonth(event.target.value)} /></label><label className="overdue-search">Filter overdue bills<input type="search" placeholder="Bill no., customer ID, name, address or phone" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label></div>
    {range ? <p className="updates-range">Bill dates: {displayDate(range.from)} – {displayDate(range.to)}</p> : <p className="error" role="alert">Choose a valid review month.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {range && !busy && !error && <div className="updates-summary overdue-summary"><div><span>Pending bills</span><strong>{pending.length}</strong></div><div><span>Pending loan principal</span><strong>{formatINR(principal)}</strong></div></div>}
    <div className="item-table-wrap" aria-busy={busy}><table className="history-table"><thead><tr><th>Bill</th><th>Bill date</th><th>Customer</th><th>Address</th><th>Particulars</th><th>Loan amount</th><th /></tr></thead><tbody>
      {busy ? <tr><td colSpan={7} className="empty">Loading overdue bills…</td></tr> : error ? <tr><td colSpan={7} className="empty">Overdue bills could not be loaded.</td></tr> : !range ? <tr><td colSpan={7} className="empty">Select a review month above.</td></tr> : pending.length ? pending.map(bill => <tr key={bill.id}>
        <td><b>#{bill.billNumber}</b><small>{bill.status === "void" ? "Voided · Pending delivery" : "Pending delivery"}</small></td><td>{displayDate(bill.billDate)}</td><td><b>{bill.customerName}</b>{bill.customerCode && <small>{bill.customerCode}</small>}<small>{bill.fatherName}</small>{bill.phone && <small>{bill.phone}</small>}</td><td className="customer-address">{bill.address}</td><td>{bill.items.map(item => `${item.metal ? `${item.metal}: ` : ""}${item.particulars}`).join(", ")}</td><td>{formatINR(bill.totalLoanAmount)}</td><td className="row-actions"><button type="button" className="text-button" onClick={() => onOpen(bill)}>Open</button><button type="button" className="text-button" onClick={() => onOverview(bill)}>Overview</button></td>
      </tr>) : <tr><td colSpan={7} className="empty">{query ? "No pending bills match your filter in this month." : "No pending bills from this month last year."}</td></tr>}
    </tbody></table></div>
    <p className="muted collection-note">Saving a delivery number and delivery date removes a bill from this list. Voiding a bill alone does not mark it as delivered.</p>
  </section>;
}
