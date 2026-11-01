"use client";

import { useLanguage } from "./language-provider";

import { useEffect, useMemo, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import { withAccountSlot } from "@/lib/account-url";
import type { Bill } from "@/lib/types";
import { billingToday } from "@/lib/business-updates";
import { pendingBillHistory, overduePeriod } from "@/lib/overdue";
import { noticePeriod, type NoticeStage } from "@/lib/notices";
import { formatINR } from "@/lib/money";
import { api, requestHeaders } from "./api";

const displayDate = (value: string) => value.split("-").reverse().join("/");

type PendingBillsProps = { accountSlot: AccountSlot; onOpen: (bill: Bill) => void; onOverview: (bill: Bill) => void };

export function OverdueBills(props: PendingBillsProps) {
  return <PendingBills {...props} mode="overdue" />; }
export function NoticeBills(props: PendingBillsProps) {
  return <PendingBills {...props} mode="notice" />; }

function PendingBills({ accountSlot, onOpen, onOverview, mode }: PendingBillsProps & { mode: "overdue" | "notice" }) {
  const { t } = useLanguage();
  const notice = mode === "notice";
  const [stage, setStage] = useState<NoticeStage>(1);
  const title = notice ? `Notice ${stage}` : "Overdue";
  const [month, setMonth] = useState(() => billingToday().slice(0, 7));
  const [bills, setBills] = useState<Bill[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const range = useMemo(() => { try { return notice ? noticePeriod(month, stage) : overduePeriod(month); } catch { return null; } }, [month, notice, stage]);

  useEffect(() => {
    if (!range) { setBills([]); setBusy(false); setError(""); return; }
    let active = true;
    setBusy(true); setError("");
    api(`/api/bills?from=${range.from}&to=${range.to}`, accountSlot)
      .then(result => { if (active) setBills(result.bills ?? []); })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Unable to load pending bills."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [accountSlot, range, refresh]);

  const pending = useMemo(() => range ? pendingBillHistory(bills, range, query) : [], [bills, query, range]);
  const principal = pending.reduce((sum, bill) => sum + Math.round(bill.totalLoanAmount * 100), 0) / 100;

  async function downloadNotice() {
    if (!range || exporting) return;
    setExporting(true); setExportError("");
    try {
      const parameters = new URLSearchParams({ month, notice: String(stage), q: query });
      const response = await fetch(withAccountSlot(`/api/reports/notices?${parameters}`, accountSlot), { headers: await requestHeaders() });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || "Unable to download notice Excel."); }
      const link = document.createElement("a");
      const url = URL.createObjectURL(await response.blob());
      link.href = url; link.download = `Notice-${stage}-Account-${accountSlot}-${month}.xlsx`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (failure) { setExportError(failure instanceof Error ? failure.message : "Unable to download notice Excel."); }
    finally { setExporting(false); }
  }

  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">{t("ACCOUNT")} {accountSlot} {t("· PENDING DELIVERY")}</p><h2>{notice ? t("Notice") : t(title)}</h2><p className="muted">{notice ? t("Notice 1 lists the same month last year. Notice 2 lists the month before it. Only bills without a completed delivery are included.") : t("Bills from the same month one year earlier that still have no completed delivery.")}</p></div><button type="button" className="secondary" disabled={busy || !range || exporting} onClick={() => setRefresh(value => value + 1)}>{busy ? t("Loading…") : t("Refresh")}</button></div>
    {notice && <><div className="updates-period" role="tablist" aria-label={t("Notice stages")} onKeyDown={event => {
      if (exporting || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 1 : event.key === "End" ? 2 : stage === 1 ? 2 : 1;
      setStage(next); setExportError("");
      event.currentTarget.querySelector<HTMLButtonElement>(`#notice-tab-${next}`)?.focus();
    }}>{([1, 2] as const).map(value => <button key={value} id={`notice-tab-${value}`} role="tab" tabIndex={stage === value ? 0 : -1} aria-selected={stage === value} aria-controls="notice-content" className={stage === value ? "active" : "secondary"} disabled={exporting} onClick={() => { setStage(value); setExportError(""); }}>{t(`Notice ${value}`)}</button>)}</div><div className="notice-actions"><h3>{t(title)}</h3><button type="button" className="secondary" disabled={busy || !range || Boolean(error) || exporting} onClick={() => void downloadNotice()}>{exporting ? t("Downloading…") : `${t("Download Excel")} · ${t(title)}`}</button></div></>}
    <div id={notice ? "notice-content" : undefined} role={notice ? "tabpanel" : undefined} aria-labelledby={notice ? `notice-tab-${stage}` : undefined}>
    <div className="overdue-controls"><label>{t("Review month")}<input type="month" aria-label={`${t(notice ? "Notice" : "Overdue")} ${t("review month")}`} min="0002-01" max="9999-12" disabled={exporting} value={month} onChange={event => { setMonth(event.target.value); setExportError(""); }} /></label><label className="overdue-search">{t("Filter")} {notice ? t("notice") : t("overdue")} {t("bills")}<input type="search" placeholder={t("Bill no., customer ID, name, address or phone")} value={query} maxLength={200} disabled={exporting} onChange={event => setQuery(event.target.value)} /></label></div>
    {range ? <p className="updates-range">{t("Bill dates:")} {displayDate(range.from)} – {displayDate(range.to)}</p> : <p className="error" role="alert">{t("Choose a valid review month.")}</p>}
    {error && <p className="error" role="alert">{t(error)}</p>}
    {exportError && <p className="error" role="alert">{t(exportError)}</p>}
    {range && !busy && !error && <div className="updates-summary overdue-summary"><div><span>{t("Pending bills")}</span><strong>{pending.length}</strong></div><div><span>{t("Pending loan principal")}</span><strong>{formatINR(principal)}</strong></div></div>}
    <div className="item-table-wrap" aria-busy={busy}><table className="history-table"><thead><tr><th>{t("Bill")}</th><th>{t("Bill date")}</th><th>{t("Customer")}</th><th>{t("Address")}</th><th>{t("Particulars")}</th><th>{t("Loan amount")}</th><th /></tr></thead><tbody>
      {busy ? <tr><td colSpan={7} className="empty">{t("Loading")} {title.toLowerCase()} {t("bills…")}</td></tr> : error ? <tr><td colSpan={7} className="empty">{t(title)} {t("bills could not be loaded.")}</td></tr> : !range ? <tr><td colSpan={7} className="empty">{t("Select a review month above.")}</td></tr> : pending.length ? pending.map(bill => <tr key={bill.id}>
        <td><b>#{bill.billNumber}</b><small>{bill.status === "void" ? t("Voided · Pending delivery") : t("Pending delivery")}</small></td><td>{displayDate(bill.billDate)}</td><td><b>{bill.customerName}</b>{bill.customerCode && <small>{bill.customerCode}</small>}<small>{bill.fatherName}</small>{bill.phone && <small>{bill.phone}</small>}</td><td className="customer-address">{bill.address}</td><td>{bill.items.map(item => `${item.metal ? `${t(item.metal)}: ` : ""}${item.particulars}`).join(", ")}</td><td>{formatINR(bill.totalLoanAmount)}</td><td className="row-actions"><button type="button" className="text-button" onClick={() => onOpen(bill)}>{t("Open")}</button><button type="button" className="text-button" onClick={() => onOverview(bill)}>{t("Overview")}</button></td>
      </tr>) : <tr><td colSpan={7} className="empty">{query ? t("No pending bills match your filter in this month.") : notice ? t(`No pending bills for ${title} in this review month.`) : t("No pending bills from this month last year.")}</td></tr>}
    </tbody></table></div>
    <p className="muted collection-note">{t("Saving a delivery number and delivery date removes a bill from this list. Voiding a bill alone does not mark it as delivered.")}</p>
    </div>
  </section>;
}
