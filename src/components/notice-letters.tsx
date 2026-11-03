"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { billLicenseNumber } from "@/lib/business-license";
import { recordedGrams } from "@/lib/money";
import { formatParticulars } from "@/lib/jewellery";
import { displayDate, noticeLetterGroups, noticeMessages } from "@/lib/notice-messages";
import type { NoticeStage } from "@/lib/notices";
import type { Bill } from "@/lib/types";

export type LetterProfile = { business_name: string; address: string; license_number?: string | null };

export function NoticeLetterPage({ bills, stage, profile, today, lastDate }: { bills: Bill[]; stage: NoticeStage; profile: LetterProfile; today: string; lastDate: string }) {
  const first = bills[0];
  const licenseNumber = billLicenseNumber({}, profile);
  const message = noticeMessages(bills, stage, profile, lastDate);
  return <article className="print-bill notice-letter">
    <header className="bill-document-header"><img className="bill-header-logo" src="/business-logo.jpg" alt="Business logo" />{licenseNumber && <p className="bill-license-number">License No.: {licenseNumber}</p>}<h1>{profile.business_name}</h1><p>{profile.address}</p>
      <h2>{stage === 1 ? "NOTICE 1" : "NOTICE 2 · FINAL NOTICE"}</h2><p className="notice-letter-tamil-title" lang="ta">{stage === 1 ? "அறிவிப்பு 1" : "அறிவிப்பு 2 · இறுதி அறிவிப்பு"}</p></header>
    <div className="bill-meta"><span>Date <b>{displayDate(today)}</b></span>{stage === 2 && <span>Last date <b>{displayDate(lastDate)}</b></span>}</div>
    <section className="customer-box notice-letter-to"><p><b>To,</b></p><p><b>{first.customerName}</b>{first.customerCode && <> &nbsp; ({first.customerCode})</>}</p>{first.fatherName && <p>Father&apos;s Name / Husband&apos;s Name: {first.fatherName}</p>}<p>{first.address}</p>{first.phone && <p>Phone: {first.phone}</p>}</section>
    <table className="print-table"><thead><tr><th>Bill No.</th><th>Bill Date</th><th>Jewellery</th><th>Gram</th></tr></thead>
      <tbody>{bills.flatMap(bill => bill.items.map((item, index) => <tr key={`${bill.id}-${index}`}>{index === 0 && <><td rowSpan={bill.items.length}>{bill.billNumber}</td><td rowSpan={bill.items.length}>{displayDate(bill.billDate)}</td></>}<td>{item.metal ? `${item.metal}: ` : ""}{formatParticulars(item.particulars)}</td><td>{recordedGrams(item.grams)}</td></tr>))}</tbody>
    </table>
    <section className="notice-letter-message"><p>{message.english}</p><p className="notice-letter-tamil" lang="ta">{message.tamil}</p></section>
    <footer className="notice-letter-sign"><div>For {profile.business_name}<br /><br /><br />Authorised Signature</div></footer>
  </article>;
}

export function NoticeLetters({ bills, stage, profile, today, lastDate, onClose }: { bills: Bill[]; stage: NoticeStage; profile: LetterProfile; today: string; lastDate: string; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  if (!mounted) return null;
  const groups = noticeLetterGroups(bills);
  return createPortal(<div className="modal-backdrop notice-letters-print"><section className="bill-modal" role="dialog" aria-modal="true" aria-label={`Notice ${stage} letters`}>
    <div className="modal-actions"><span className="notice-letter-count">{groups.length} letter{groups.length === 1 ? "" : "s"} · Notice {stage}</span><button className="secondary" onClick={onClose}>Close</button><button disabled={!groups.length} onClick={async () => { await document.fonts.load('12px BillTamil'); await document.fonts.ready; window.print(); }}>Print letters</button></div>
    {groups.map(group => <NoticeLetterPage key={group[0].id} bills={group} stage={stage} profile={profile} today={today} lastDate={lastDate} />)}
  </section></div>, document.body);
}
