"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { useLanguage } from "./language-provider";
import type { AccountSlot } from "@/lib/account-url";
import type { BillHistoryEntry } from "@/lib/bill-history-types";
import { formatINR } from "@/lib/money";

export function BillHistory({ accountSlot, refreshVersion, onClose }: { accountSlot: AccountSlot; refreshVersion: number; onClose: () => void }) {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<BillHistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [billNumber, setBillNumber] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true; setLoading(true); setError(""); setEntries([]);
    const query = new URLSearchParams({ offset: String(offset), ...(filter ? { billNumber: filter } : {}) });
    api("/api/bill-history?" + query, accountSlot).then(result => { if (current) { setEntries(result.entries); setTotal(result.total); } }).catch(failure => { if (current) setError(failure instanceof Error ? failure.message : "Unable to load bill history."); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [accountSlot, offset, filter, refreshVersion]);
  return <section className="panel" aria-label={t("Bill change history")}>
    <div className="section-heading"><h2>{t("Bill change history")}</h2><button type="button" className="secondary" onClick={onClose}>{t("Close")}</button></div>
    <p className="muted">{t("Read-only history starts with this update. Older changes cannot be reconstructed. Deleted bills remain in this history; bill numbers can be reused, so each entry also shows its record ID.")}</p>
    <form className="form-actions" onSubmit={event => { event.preventDefault(); setOffset(0); setFilter(billNumber); }}><label>{t("Bill number")}<input type="number" min="1" max="1000000000" value={billNumber} onChange={event => setBillNumber(event.target.value)} /></label><button type="submit">{t("Search history")}</button></form>
    {loading && <p role="status">{t("Loading history…")}</p>}{error && <p className="error" role="alert">{t(error)}</p>}
    {!loading && !error && <><div className="item-table-wrap"><table><thead><tr><th>{t("When / Who")}</th><th>{t("Bill")}</th><th>{t("Action / Reason")}</th><th>{t("Changes")}</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.sequence}><td>{new Date(entry.occurredAt).toLocaleString()}<br />{entry.actor}</td><td>{entry.billNumber ?? "—"}{entry.billId && <small className="history-record-id">{entry.billId}</small>}</td><td>{t(entry.action)}<br /><span className="muted">{t(entry.reason)}</span></td><td>{entry.changes.map(change => t(change)).join(", ") || "—"}{entry.previousLoan !== entry.loan && <div>{t("Loan amount")}: {entry.previousLoan === null ? "—" : formatINR(entry.previousLoan)} → {entry.loan === null ? "—" : formatINR(entry.loan)}</div>}</td></tr>)}</tbody></table></div>{entries.length === 0 && <p>{t("No changes recorded for this selection.")}</p>}<div className="form-actions"><button type="button" className="secondary" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>{t("Previous")}</button><span>{offset + (entries.length ? 1 : 0)}–{offset + entries.length} / {total}</span><button type="button" className="secondary" disabled={offset + entries.length >= total} onClick={() => setOffset(value => value + 50)}>{t("Next")}</button></div></>}
  </section>;
}
