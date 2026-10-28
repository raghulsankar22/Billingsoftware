"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import type { Bill } from "@/lib/types";
import { deliveryBillHistory, deliveryCollection } from "@/lib/delivery-history";
import { formatINR } from "@/lib/money";
import { api } from "./api";

export function DeliveryBills({ accountSlot, onOpen, onOriginal }: { accountSlot: AccountSlot; onOpen: (bill: Bill) => void; onOriginal: (bill: Bill) => void }) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true); setError("");
    api("/api/bills", accountSlot).then(result => { if (active) setBills(result.bills ?? []); })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Unable to load delivery bills."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [accountSlot, refresh]);
  const deliveries = useMemo(() => deliveryBillHistory(bills, query), [bills, query]);

  return <section className="panel">
    <div className="section-heading history-heading"><div><p className="eyebrow">ACCOUNT {accountSlot} · DELIVERY HISTORY</p><h2>Delivery Bills</h2><p className="muted">Saved delivery receipts, including deliveries for voided bills.</p></div>
      <div className="delivery-history-controls"><label className="search"><span className="sr-only">Search delivery bills</span><input placeholder="Delivery no., bill no., name, mobile or date" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label><button className="secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{busy ? "Loading…" : "Refresh"}</button></div>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="item-table-wrap"><table className="history-table"><thead><tr><th>Delivery No.</th><th>Delivery Date</th><th>Bill No.</th><th>Customer</th><th>Principal</th><th>Interest</th><th>Total to collect</th><th /></tr></thead>
      <tbody>{deliveries.map(bill => { const collection = deliveryCollection(bill); return <tr key={bill.id}>
        <td>#{bill.deliveryNo}</td><td>{bill.deliveryDate}</td><td>#{bill.billNumber}{bill.status === "void" && <small>Original bill voided</small>}</td>
        <td><b>{bill.customerName}</b>{bill.phone && <small>{bill.phone}</small>}</td><td>{formatINR(collection?.principal ?? bill.totalLoanAmount)}</td><td>{collection?.interest == null ? "—" : formatINR(collection.interest)}</td><td>{collection?.total == null ? "—" : formatINR(collection.total)}</td>
        <td className="row-actions"><button className="text-button" onClick={() => onOpen(bill)}>Open</button><button className="text-button" onClick={() => onOriginal(bill)}>Original bill</button></td>
      </tr>; })}{!deliveries.length && <tr><td colSpan={8} className="empty">{busy ? "Loading delivery bills…" : query ? "No delivery bills match your search." : "No delivery bills recorded yet."}</td></tr>}</tbody>
    </table></div>
    <p className="muted collection-note">Amounts are for the saved delivery date. First-month interest charged at issue is excluded from the total to collect.</p>
  </section>;
}
