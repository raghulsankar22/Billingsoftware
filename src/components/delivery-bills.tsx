"use client";

import { useLanguage } from "./language-provider";

import { useEffect, useMemo, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import { billReceiptLabels, collectedByRelationLabels, type Bill } from "@/lib/types";
import { deliveryBillHistory, deliveryCollection } from "@/lib/delivery-history";
import { formatINR } from "@/lib/money";
import { api } from "./api";

export function DeliveryBills({ accountSlot, onOpen, onOriginal }: { accountSlot: AccountSlot; onOpen: (bill: Bill) => void; onOriginal: (bill: Bill) => void }) {
  const { t } = useLanguage();
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
    <div className="section-heading history-heading"><div><p className="eyebrow">{t("ACCOUNT")} {accountSlot} {t("· DELIVERY HISTORY")}</p><h2>{t("Delivery Bills")}</h2><p className="muted">{t("Saved delivery receipts, including deliveries for voided bills.")}</p></div>
      <div className="delivery-history-controls"><label className="search"><span className="sr-only">{t("Search delivery bills")}</span><input placeholder={t("Delivery no., bill no., name, mobile or date")} value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label><button className="secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{busy ? t("Loading…") : t("Refresh")}</button></div>
    </div>
    {error && <p className="error" role="alert">{t(error)}</p>}
    <div className="item-table-wrap"><table className="history-table"><thead><tr><th>{t("Delivery No.")}</th><th>{t("Delivery Date")}</th><th>{t("Bill No.")}</th><th>{t("Customer")}</th><th>{t("Delivery remarks")}</th><th>{t("Taken by")}</th><th>{t("Principal")}</th><th>{t("Interest")}</th><th>{t("Total to collect")}</th><th /></tr></thead>
      <tbody>{deliveries.map(bill => { const collection = deliveryCollection(bill); return <tr key={bill.id}>
        <td>{bill.deliveryNo ? `#${bill.deliveryNo}` : t("Not recorded")}</td><td>{bill.deliveryDate || t("Not recorded")}</td><td>#{bill.billNumber}{bill.status === "void" && <small>{t("Original bill voided")}</small>}</td>
        <td><b>{bill.customerName}</b>{bill.phone && <small>{bill.phone}</small>}</td><td>{bill.deliveryBillReceiptStatus ? t(billReceiptLabels[bill.deliveryBillReceiptStatus]) : t("Not recorded")}</td><td>{bill.deliveryCollectedByName && bill.deliveryCollectedByRelation ? <><b>{bill.deliveryCollectedByName}</b><small>{t(collectedByRelationLabels[bill.deliveryCollectedByRelation])}</small></> : t("Not recorded")}</td><td>{formatINR(collection?.principal ?? bill.totalLoanAmount)}</td><td>{collection?.interest == null ? "—" : formatINR(collection.interest)}</td><td>{collection?.total == null ? "—" : formatINR(collection.total)}</td>
        <td className="row-actions">{bill.deliveryNo && bill.deliveryDate && <button className="text-button" onClick={() => onOpen(bill)}>{t("Open")}</button>}<button className="text-button" onClick={() => onOriginal(bill)}>{t("Original bill")}</button></td>
      </tr>; })}{!deliveries.length && <tr><td colSpan={10} className="empty">{busy ? t("Loading delivery bills…") : query ? t("No delivery bills match your search.") : t("No delivery bills recorded yet.")}</td></tr>}</tbody>
    </table></div>
    <p className="muted collection-note">{t("Amounts are for the saved delivery date.")}</p>
  </section>;
}
