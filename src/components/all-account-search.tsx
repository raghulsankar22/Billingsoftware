"use client";

import { useLanguage } from "./language-provider";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { AccountSlot } from "@/lib/account-url";
import type { Bill } from "@/lib/types";
import { isDelivered } from "@/lib/delivery-status";
import type { GlobalSearchResult } from "@/lib/global-search";
import { formatINR } from "@/lib/money";
import { api } from "./api";
import { BillDocument } from "./bill-document";
import { BillOverview } from "./bill-overview";

const pageSize = 50;
const displayDate = (value: string) => value.split("-").reverse().join("/");

export function AllAccountSearch({ accountSlot }: { accountSlot: AccountSlot }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<GlobalSearchResult | null>(null);
  const [overview, setOverview] = useState<Bill | null>(null);

  useEffect(() => {
    if (!submittedQuery) return;
    let active = true;
    setBusy(true); setError("");
    api(`/api/search?q=${encodeURIComponent(submittedQuery)}&page=${page}&pageSize=${pageSize}`, accountSlot)
      .then(response => {
        if (!active) return;
        setResults(response.results); setTotal(response.total); setHasMore(response.hasMore);
      })
      .catch(failure => { if (active) { setResults([]); setError(failure instanceof Error ? failure.message : "Unable to search bills."); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [accountSlot, submittedQuery, page, refresh]);

  function search(event: React.FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value) { setError("Enter a customer ID, name, address, phone or Aadhaar to search."); return; }
    setSubmittedQuery(value); setPage(1); setRefresh(value => value + 1); setSelected(null); setOverview(null);
  }

  return <>
    <section className="panel">
      <div className="section-heading"><div><h2>{t("Search")}</h2><p className="muted">{t("Find a customer's bills across all business accounts.")}</p></div><span className="search-scope-tag">{t("All accounts")}</span></div>
      <form className="all-account-search-form" onSubmit={search}><label>{t("Customer ID, name, address, phone or Aadhaar")}<input type="search" aria-label={t("Search all accounts")} placeholder={t("e.g. C000001, customer name, address or number")} value={query} maxLength={200} onChange={event => setQuery(event.target.value)} required /></label><button disabled={busy}>{busy ? t("Searching…") : t("Search all accounts")}</button></form>
      {error && <p className="error" role="alert">{t(error)}</p>}
      {submittedQuery && !error && <p className="search-result-summary" role="status">{busy ? t("Searching all business accounts…") : `${total} ${t("matching bills for")} “${submittedQuery}”`}</p>}
      <div className="item-table-wrap" aria-busy={busy}><table className="history-table all-account-results"><thead><tr><th>{t("Account")}</th><th>{t("Bill")}</th><th>{t("Customer")}</th><th>{t("Contact")}</th><th>{t("Address")}</th><th>{t("Particulars")}</th><th>{t("Loan amount")}</th><th>{t("Status")}</th><th /></tr></thead><tbody>
        {busy ? <tr><td colSpan={9} className="empty">{t("Searching all accounts…")}</td></tr> : error ? <tr><td colSpan={9} className="empty">{t("Search could not be completed.")}</td></tr> : results.length ? results.map(result => {
          const { bill } = result;
          const delivered = isDelivered(bill);
          const code = bill.customerCode || result.matchedCustomerCode;
          return <tr key={bill.id}><td><b>{result.profile.business_name}</b><small>{t("Account")} {result.accountSlot}</small></td><td><b>#{bill.billNumber}</b><small>{displayDate(bill.billDate)}</small></td><td><b>{bill.customerName}</b><small>{bill.fatherName}</small>{code && <small>{code}</small>}</td><td>{bill.phone || "—"}{bill.governmentId && <small>{t("ID ending")} {bill.governmentId.replace(/[\s-]/g, "").slice(-4)}</small>}</td><td className="customer-address">{bill.address}</td><td>{bill.items.map(item => `${item.metal ? `${t(item.metal)}: ` : ""}${item.particulars}`).join(", ")}</td><td>{formatINR(bill.totalLoanAmount)}</td><td>{bill.status === "void" ? t("Voided") : t("Issued")}<small className={delivered ? "delivery-status-complete" : undefined}>{delivered ? `${t("Delivered")}${bill.deliveryNo ? ` #${bill.deliveryNo}` : ""}` : t("Not delivered")}</small></td><td className="row-actions"><button type="button" className="text-button" onClick={() => setSelected(result)}>{t("Open bill")}</button><button type="button" className="text-button" onClick={() => setOverview(bill)}>{t("Overview")}</button></td></tr>;
        }) : <tr><td colSpan={9} className="empty">{submittedQuery ? t("No matching bills found in any account.") : t("Enter customer details above to search every account.")}</td></tr>}
      </tbody></table></div>
      {submittedQuery && !busy && !error && total > 0 && <div className="search-pagination"><span>{t("Showing")} {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} {t("of")} {total} {t("bills")}</span><div><button type="button" className="secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{t("Previous")}</button><span>{t("Page")} {page}</span><button type="button" className="secondary" disabled={!hasMore} onClick={() => setPage(value => value + 1)}>{t("Next")}</button></div></div>}
    </section>
    {selected && createPortal(<BillDocument key={`${selected.accountSlot}-${selected.bill.id}`} bill={selected.bill} profile={selected.profile} accountSlot={selected.accountSlot} onClose={() => setSelected(null)} />, document.body)}
    {overview && createPortal(<BillOverview key={overview.id} bill={overview} onClose={() => setOverview(null)} />, document.body)}
  </>;
}
