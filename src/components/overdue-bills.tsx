"use client";

import { useLanguage } from "./language-provider";
import { formatParticulars } from "@/lib/jewellery";

import { useEffect, useMemo, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import { withAccountSlot } from "@/lib/account-url";
import type { Bill } from "@/lib/types";
import { billingToday } from "@/lib/business-updates";
import { pendingBillHistory, overduePeriod } from "@/lib/overdue";
import { mergeNoticeBills, noticePeriod, type NoticeStage } from "@/lib/notices";
import { isDelivered } from "@/lib/delivery-status";
import { localStorageEnabled } from "@/lib/storage-mode";
import { formatINR } from "@/lib/money";
import { api, requestHeaders } from "./api";
import { NoticeLetters, type LetterProfile } from "./notice-letters";
import { noticeGraceDays, noticeLastDate } from "@/lib/notice-messages";

const displayDate = (value: string) => value.split("-").reverse().join("/");

type PendingBillsProps = { accountSlot: AccountSlot; onOpen: (bill: Bill) => void; onOverview: (bill: Bill) => void; onDelete?: (bill: Bill) => void; deletingBillId?: string | null; listVersion?: number };

export function OverdueBills(props: PendingBillsProps) {
  return <PendingBills {...props} mode="overdue" />; }
export function NoticeBills(props: PendingBillsProps & { profile: LetterProfile }) {
  return <PendingBills {...props} mode="notice" />; }

function PendingBills({ accountSlot, onOpen, onOverview, onDelete, deletingBillId, listVersion = 0, mode, profile }: PendingBillsProps & { mode: "overdue" | "notice"; profile?: LetterProfile }) {
  const { t } = useLanguage();
  const notice = mode === "notice";
  const [stage, setStage] = useState<NoticeStage>(1);
  const title = notice ? `Notice ${stage}` : "Overdue";
  const [today, setToday] = useState(billingToday);
  const [month, setMonth] = useState(() => billingToday().slice(0, 7));
  const [bills, setBills] = useState<Bill[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [letters, setLetters] = useState<{ today: string; lastDate: string } | null>(null);
  // Bills the owner added by hand, for example one that was missed last month (Notice tab only).
  const canAdd = notice && localStorageEnabled;
  const [added, setAdded] = useState<Bill[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addResults, setAddResults] = useState<Bill[] | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState("");
  const [addNotice, setAddNotice] = useState("");
  const range = useMemo(() => { try { return notice ? noticePeriod(month, stage) : overduePeriod(today); } catch { return null; } }, [month, notice, stage, today]);

  useEffect(() => {
    if (!range) { setBills([]); setBusy(false); setError(""); return; }
    let active = true;
    setBusy(true); setError("");
    api(`/api/bills?from=${range.from}&to=${range.to}`, accountSlot)
      .then(result => { if (active) setBills(result.bills ?? []); })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Unable to load pending bills."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [accountSlot, range, refresh, listVersion]);

  const natural = useMemo(() => range ? pendingBillHistory(bills, range, query) : [], [bills, query, range]);
  const pending = useMemo(() => canAdd ? mergeNoticeBills(natural, added, query) : natural, [added, canAdd, natural, query]);
  // Only bills that are not already in the month's own list can be taken off by hand.
  const addedOnly = useMemo(() => { const own = new Set(natural.map(bill => bill.id)); return new Set(added.filter(bill => !own.has(bill.id)).map(bill => bill.id)); }, [added, natural]);

  useEffect(() => {
    if (!canAdd || !range) { setAdded([]); return; }
    let active = true;
    api(`/api/notice-additions?month=${month}&notice=${stage}`, accountSlot)
      .then(result => { if (active) setAdded(result.bills ?? []); })
      .catch(() => { if (active) setAdded([]); });
    return () => { active = false; };
  }, [accountSlot, canAdd, month, range, stage, refresh, listVersion]);

  async function changeAdded(method: "POST" | "DELETE", bill: Bill) {
    setAddBusy(true); setAddError(""); setAddNotice("");
    try {
      const result = await api("/api/notice-additions", accountSlot, { method, body: JSON.stringify({ month, notice: String(stage), billId: bill.id }) });
      setAdded(result.bills ?? []);
      if (method === "POST") {
        setAddNotice(`#${bill.billNumber}`);
        setAddResults(current => { const left = current?.filter(item => item.id !== bill.id) ?? []; return left.length ? left : null; });
      }
    } catch (failure) { setAddError(failure instanceof Error ? failure.message : "Unable to change the notice list."); }
    finally { setAddBusy(false); }
  }
  async function searchToAdd(event: React.FormEvent) {
    event.preventDefault();
    const search = addQuery.trim();
    if (!search) { setAddResults(null); return; }
    setAddBusy(true); setAddError("");
    try {
      const result = await api(`/api/bills?q=${encodeURIComponent(search)}`, accountSlot);
      const listed = new Set(pending.map(bill => bill.id));
      // Only undelivered bills can be sent a notice, and bills already in the list are left out.
      setAddResults(((result.bills ?? []) as Bill[]).filter(bill => !isDelivered(bill) && !listed.has(bill.id)).slice(0, 12));
    } catch (failure) { setAddError(failure instanceof Error ? failure.message : "Unable to search bills."); }
    finally { setAddBusy(false); }
  }
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
    <div className="section-heading"><div><p className="eyebrow">{t("ACCOUNT")} {accountSlot} {t("· PENDING DELIVERY")}</p><h2>{notice ? t("Notice") : t(title)}</h2><p className="muted">{notice ? t("Notice 1 lists the same month last year. Notice 2 lists the month before it. Only bills without a completed delivery are included.") : t("Undelivered bills more than 365 days old, across all months and years.")}</p></div><button type="button" className="secondary" disabled={busy || !range || exporting} onClick={() => { setToday(billingToday()); setRefresh(value => value + 1); }}>{busy ? t("Loading…") : t("Refresh")}</button></div>
    {notice && <><div className="updates-period" role="tablist" aria-label={t("Notice stages")} onKeyDown={event => {
      if (exporting || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 1 : event.key === "End" ? 2 : stage === 1 ? 2 : 1;
      setStage(next); setExportError("");
      event.currentTarget.querySelector<HTMLButtonElement>(`#notice-tab-${next}`)?.focus();
    }}>{([1, 2] as const).map(value => <button key={value} id={`notice-tab-${value}`} role="tab" tabIndex={stage === value ? 0 : -1} aria-selected={stage === value} aria-controls="notice-content" className={stage === value ? "active" : "secondary"} disabled={exporting} onClick={() => { setStage(value); setExportError(""); }}>{t(`Notice ${value}`)}</button>)}</div><div className="notice-actions"><h3>{t(title)}</h3><button type="button" className="secondary" disabled={busy || !range || Boolean(error) || exporting} onClick={() => void downloadNotice()}>{exporting ? t("Downloading…") : `${t("Download Excel")} · ${t(title)}`}</button>{profile && <button type="button" className="secondary" disabled={busy || !range || Boolean(error) || exporting || !pending.length} onClick={() => { const today = billingToday(); setLetters({ today, lastDate: noticeLastDate(today) }); }}>{`${t("Print letters")} · ${t(title)}`}</button>}</div>{stage === 2 && <p className="muted">{t("The last date on Notice 2 letters and messages is")} {displayDate(noticeLastDate(billingToday()))} ({noticeGraceDays} {t("days from today")}).</p>}</>}
    <div id={notice ? "notice-content" : undefined} role={notice ? "tabpanel" : undefined} aria-labelledby={notice ? `notice-tab-${stage}` : undefined}>
    <div className="overdue-controls">{notice && <label>{t("Review month")}<input type="month" aria-label={`${t(notice ? "Notice" : "Overdue")} ${t("review month")}`} min="0002-01" max="9999-12" disabled={exporting} value={month} onChange={event => { setMonth(event.target.value); setExportError(""); }} /></label>}<label className="overdue-search">{t("Filter")} {notice ? t("notice") : t("overdue")} {t("bills")}<input type="search" placeholder={t("Bill no., customer ID, name, address or phone")} value={query} maxLength={200} disabled={exporting} onChange={event => setQuery(event.target.value)} /></label></div>
    {range ? <p className="updates-range">{t("Bill dates:")} {displayDate(range.from)} – {displayDate(range.to)}</p> : <p className="error" role="alert">{t("Choose a valid review month.")}</p>}
    {error && <p className="error" role="alert">{t(error)}</p>}
    {exportError && <p className="error" role="alert">{t(exportError)}</p>}
    {canAdd && range && <div className="notice-add">
      <div className="backup-actions"><button type="button" className="secondary" aria-expanded={addOpen} onClick={() => { setAddOpen(open => !open); setAddError(""); }}>{addOpen ? t("Close add bill") : t("Add a bill to this notice")}</button>{added.length > 0 && <span className="muted">{t("Bills added by hand:")} {added.length}</span>}</div>
      {addOpen && <>
        <p className="muted">{t("Use this for a bill you forgot to send a notice for. Search by bill number, customer or phone, then press Add. The bill itself is not changed, and it leaves this list when it is delivered.")}</p>
        <form className="backup-folder" onSubmit={event => void searchToAdd(event)}>
          <label>{t("Find a bill")}<input value={addQuery} placeholder={t("Bill number, customer or phone")} maxLength={200} disabled={addBusy} onChange={event => setAddQuery(event.target.value)} /></label>
          <button disabled={addBusy || !addQuery.trim()}>{addBusy ? t("Searching…") : t("Search")}</button>
        </form>
        {addError && <p className="error" role="alert">{t(addError)}</p>}
        {addNotice && <p className="notice" role="status">{t("Added to this list:")} {addNotice}</p>}
        {addResults && (addResults.length === 0 ? <p className="muted">{t("No undelivered bills found that are not already in this list.")}</p> :
          <ul className="notice-add-results">{addResults.map(bill => <li key={bill.id}>
            <span><b>#{bill.billNumber}</b> · {displayDate(bill.billDate)} · {bill.customerName} · {formatINR(bill.totalLoanAmount)}</span>
            <button type="button" disabled={addBusy} onClick={() => void changeAdded("POST", bill)}>{t("Add")}</button>
          </li>)}</ul>)}
      </>}
    </div>}
    {range && !busy && !error && <div className="updates-summary overdue-summary"><div><span>{t("Pending bills")}</span><strong>{pending.length}</strong></div><div><span>{t("Pending loan principal")}</span><strong>{formatINR(principal)}</strong></div></div>}
    <div className="item-table-wrap" aria-busy={busy}><table className="history-table"><thead><tr><th>{t("Bill")}</th><th>{t("Bill date")}</th><th>{t("Customer")}</th><th>{t("Address")}</th><th>{t("Particulars")}</th><th>{t("Loan amount")}</th><th /></tr></thead><tbody>
      {busy ? <tr><td colSpan={7} className="empty">{t("Loading")} {title.toLowerCase()} {t("bills…")}</td></tr> : error ? <tr><td colSpan={7} className="empty">{t(title)} {t("bills could not be loaded.")}</td></tr> : !range ? <tr><td colSpan={7} className="empty">{t("Select a review month above.")}</td></tr> : pending.length ? pending.map(bill => <tr key={bill.id}>
        <td><b>#{bill.billNumber}</b><small>{bill.status === "void" ? t("Voided · Pending delivery") : t("Pending delivery")}</small>{addedOnly.has(bill.id) && <small className="notice-added-badge">{t("Added by hand")}</small>}</td><td>{displayDate(bill.billDate)}</td><td><b>{bill.customerName}</b>{bill.customerCode && <small>{bill.customerCode}</small>}<small>{bill.fatherName}</small>{bill.phone && <small>{bill.phone}</small>}</td><td className="customer-address">{bill.address}</td><td>{bill.items.map(item => `${item.metal ? `${t(item.metal)}: ` : ""}${formatParticulars(item.particulars)}`).join(", ")}</td><td>{formatINR(bill.totalLoanAmount)}</td><td className="row-actions"><button type="button" className="text-button" onClick={() => onOpen(bill)}>{t("Open")}</button><button type="button" className="text-button" onClick={() => onOverview(bill)}>{t("Overview")}</button>{addedOnly.has(bill.id) && <button type="button" className="text-button" disabled={addBusy} onClick={() => void changeAdded("DELETE", bill)}>{t("Remove from list")}</button>}{onDelete && <button type="button" className="text-button danger-text" disabled={Boolean(deletingBillId)} onClick={() => onDelete(bill)}>{deletingBillId === bill.id ? t("Deleting…") : t("Delete")}</button>}</td>
      </tr>) : <tr><td colSpan={7} className="empty">{query ? t("No pending bills match your filter.") : notice ? t(`No pending bills for ${title} in this review month.`) : t("No undelivered bills are more than 365 days old.")}</td></tr>}
    </tbody></table></div>
    <p className="muted collection-note">{t("Saving a delivery number and delivery date removes a bill from this list. Voiding a bill alone does not mark it as delivered.")}</p>
    {onDelete && <p className="muted collection-note">{t("Delete permanently removes a bill. If a bill was delivered but not recorded, save its delivery in the Delivery tab instead, so the delivery record is kept.")}</p>}
    </div>
    {notice && profile && letters && <NoticeLetters bills={pending} stage={stage} profile={profile} today={letters.today} lastDate={letters.lastDate} onClose={() => setLetters(null)} />}
  </section>;
}
