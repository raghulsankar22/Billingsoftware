"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import { lostBillDeliveries } from "@/lib/lost-bill";
import { formatINR } from "@/lib/money";
import { collectedByText, type Bill } from "@/lib/types";
import { api } from "./api";
import { useLanguage } from "./language-provider";
import { LostBillDeclaration, type DeclarationProfile } from "./lost-bill-declaration";

/** Every delivery where the customer had lost the bill, with its signed declaration. */
export function CustomerBillLost({ accountSlot, profile, onReceipt, onOriginal }: { accountSlot: AccountSlot; profile: DeclarationProfile; onReceipt: (bill: Bill) => void; onOriginal: (bill: Bill) => void }) {
  const { t } = useLanguage();
  const [bills, setBills] = useState<Bill[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [printing, setPrinting] = useState<Bill | null>(null);
  const [printed, setPrinted] = useState<Set<string>>(() => new Set());
  const [marking, setMarking] = useState("");
  const [notice, setNotice] = useState("");

  async function markSigned(bill: Bill) {
    if (marking || !window.confirm(`${t("Has the customer signed the printed lost bill declaration?")}\n${t("Bill #")}${bill.billNumber} · ${bill.customerName}`)) return;
    setMarking(bill.id); setError(""); setNotice("");
    try {
      const result = await api(`/api/bills/${bill.id}/lost-bill-declaration`, accountSlot, { method: "POST" });
      setBills(current => current.map(entry => entry.id === bill.id ? result.bill : entry));
      setNotice(result.warnings?.[0] ?? `Bill #${bill.billNumber} marked as signed.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to mark the declaration as signed."); }
    finally { setMarking(""); }
  }
  useEffect(() => {
    let active = true;
    setBusy(true); setError("");
    api("/api/bills", accountSlot).then(result => { if (active) setBills(result.bills ?? []); })
      .catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Unable to load bills."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [accountSlot, refresh]);
  const lost = useMemo(() => lostBillDeliveries(bills, query), [bills, query]);

  return <section className="panel">
    <div className="section-heading history-heading"><div><p className="eyebrow">{t("ACCOUNT")} {accountSlot} · {t("Customer Bill Lost")}</p><h2>{t("Customer Bill Lost")}</h2><p className="muted">{t("Jewellery returned without the bill. Print the declaration again at any time.")} {t("For an older delivery with no signature recorded, print the declaration, get it signed, then click Mark as signed.")}</p></div>
      <div className="delivery-history-controls"><label className="search"><span className="sr-only">{t("Search lost bills")}</span><input placeholder={t("Delivery no., bill no., name, mobile or date")} value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label><button className="secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{busy ? t("Loading…") : t("Refresh")}</button></div>
    </div>
    {error && <p className="error" role="alert">{t(error)}</p>}
    {notice && <p className="excel-notice" role="status">{t(notice)}</p>}
    <div className="item-table-wrap"><table className="history-table"><thead><tr><th>{t("Delivery No.")}</th><th>{t("Delivery Date")}</th><th>{t("Bill No.")}</th><th>{t("Customer")}</th><th>{t("Taken by")}</th><th>{t("Loan amount")}</th><th>{t("Declaration")}</th><th /></tr></thead>
      <tbody>{lost.map(bill => <tr key={bill.id}>
        <td>{bill.deliveryNo ? `#${bill.deliveryNo}` : t("Not recorded")}</td>
        <td>{bill.deliveryDate || t("Not recorded")}</td>
        <td>#{bill.billNumber}{bill.status === "void" && <small>{t("Original bill voided")}</small>}</td>
        <td><b>{bill.customerName}</b>{bill.phone && <small>{bill.phone}</small>}</td>
        <td>{collectedByText(bill) || t("Not recorded")}</td>
        <td>{formatINR(bill.totalLoanAmount)}</td>
        <td>{bill.lostBillDeclaredAt ? <><b>{t("Signed")}</b><small>{bill.lostBillDeclaredAt.slice(0, 10)}</small></> : <><span className="muted">{bill.historicalDelivery ? t("From old register") : t("Not signed yet")}</span><button type="button" className="text-button" disabled={Boolean(marking) || !printed.has(bill.id)} title={printed.has(bill.id) ? undefined : t("Print the declaration first.")} onClick={() => void markSigned(bill)}>{marking === bill.id ? t("Saving…") : t("Mark as signed")}</button></>}</td>
        <td className="row-actions"><button className="text-button" onClick={() => setPrinting(bill)}>{t("Print declaration")}</button>{bill.deliveryNo && bill.deliveryDate && <button className="text-button" onClick={() => onReceipt(bill)}>{t("Delivery bill")}</button>}<button className="text-button" onClick={() => onOriginal(bill)}>{t("Original bill")}</button></td>
      </tr>)}{!lost.length && <tr><td colSpan={8} className="empty">{busy ? t("Loading…") : query ? t("No lost bills match your search.") : t("No customer has lost a bill yet.")}</td></tr>}</tbody>
    </table></div>
    {printing && <LostBillDeclaration bills={[printing]} profile={profile} onClose={() => setPrinting(null)} onPrinted={() => setPrinted(current => new Set(current).add(printing.id))} />}
  </section>;
}
