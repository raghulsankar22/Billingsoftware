"use client";

import { createPortal } from "react-dom";
import { formatParticulars } from "@/lib/jewellery";
import { useEffect, useState } from "react";
import { formatINR, recordedGrams } from "@/lib/money";
import { billLicenseNumber } from "@/lib/business-license";
import { declarationGroups, lostBillTamilStatement, maskedId } from "@/lib/lost-bill";
import { collectedByRelationLabels, type Bill, type CollectedBy } from "@/lib/types";

export type DeclarationProfile = { business_name: string; address: string; phone: string; logo_url?: string | null; license_number?: string | null };
type Profile = DeclarationProfile;
/** Details typed on the delivery screen that aren't saved yet. */
export type PendingDeclaration = { deliveryDate: string; collectedBy: CollectedBy; deliveryNumbers?: Record<string, string> };

function collector(bill: Bill, pending?: PendingDeclaration) {
  if (pending) {
    const { relation, name } = pending.collectedBy;
    if (!relation) return null;
    return relation === "self" ? { self: true, name: bill.customerName, relation: "Customer" } : { self: false, name: name.trim(), relation: collectedByRelationLabels[relation] };
  }
  if (!bill.deliveryCollectedByRelation) return null;
  return bill.deliveryCollectedByRelation === "self"
    ? { self: true, name: bill.customerName, relation: "Customer" }
    : { self: false, name: bill.deliveryCollectedByName ?? "", relation: collectedByRelationLabels[bill.deliveryCollectedByRelation] };
}

export function DeclarationPage({ bills, profile, pending }: { bills: Bill[]; profile: Profile; pending?: PendingDeclaration }) {
  const first = bills[0];
  const business = first.businessSnapshot ?? profile;
  const licenseNumber = billLicenseNumber(first, profile);
  const date = pending?.deliveryDate || first.deliveryDate || "";
  const deliveryNumber = (bill: Bill) => pending?.deliveryNumbers?.[bill.id] || bill.deliveryNo || "";
  const deliveryNumbers = bills.map(deliveryNumber).filter(Boolean);
  const takenBy = collector(first, pending);
  const total = bills.reduce((paise, bill) => paise + Math.round(bill.totalLoanAmount * 100), 0) / 100;
  const billNumbers = bills.map(bill => `#${bill.billNumber}`).join(", ");
  const plural = bills.length > 1;
  const id = maskedId(first.governmentId);

  return <article className="print-bill lost-bill-declaration">
    <header className="bill-document-header"><img className="bill-header-logo" src="/business-logo.jpg" alt="Business logo" />{licenseNumber && <p className="bill-license-number">License No.: {licenseNumber}</p>}<h1>{business.business_name}</h1><p>{business.address}</p><h2>LOST BILL DECLARATION</h2></header>
    <div className="bill-meta"><span>Date <b>{date || "____________"}</b></span><span>Delivery No. <b>{deliveryNumbers.length ? deliveryNumbers.join(", ") : "____________"}</b></span></div>
    <section className="customer-box"><p><b>Name:</b> {first.customerName}</p><p><b>Father&apos;s Name / Husband&apos;s Name:</b> {first.fatherName || "Not recorded"}</p><p><b>Address:</b> {first.address}</p>{(first.phone || id) && <p>{first.phone && <><b>Phone:</b> {first.phone}</>}{id && <> &nbsp; <b>ID:</b> {id}</>}</p>}</section>
    <table className="print-table"><thead><tr><th>Bill No.</th><th>Bill Date</th><th>Delivery No.</th><th>Jewellery</th><th>Gram</th><th>Amount</th></tr></thead>
      <tbody>{bills.flatMap(bill => bill.items.map((item, index) => <tr key={`${bill.id}-${index}`}>{index === 0 && <><td rowSpan={bill.items.length}>{bill.billNumber}</td><td rowSpan={bill.items.length}>{bill.billDate}</td><td rowSpan={bill.items.length}>{deliveryNumber(bill) || "—"}</td></>}<td className="print-particulars">{item.metal ? `${item.metal}: ` : ""}{formatParticulars(item.particulars)}</td><td>{recordedGrams(item.grams)}</td><td>{formatINR(item.loanAmount)}</td></tr>))}</tbody>
      <tfoot><tr><th colSpan={5}>Total loan amount</th><th>{formatINR(total)}</th></tr></tfoot>
    </table>
    <p><b>Jewellery taken by:</b> {takenBy ? `${takenBy.name} (${takenBy.relation})` : "____________________"}</p>
    <section className="declaration-statement">
      <p>I, <b>{first.customerName}</b>, declare that I have lost the original pledge bill{plural ? "s" : ""} No. <b>{billNumbers}</b> listed above. I have received all the jewellery listed above in full, without returning the bill{plural ? "s" : ""}. If the original bill{plural ? "s are" : " is"} found later, {plural ? "they are" : "it is"} cancelled and I will return {plural ? "them" : "it"} to the shop. I take full responsibility if anyone else makes a claim using {plural ? "those bills" : "that bill"}.</p>
      {takenBy && !takenBy.self && <p>The jewellery was handed over to <b>{takenBy.name}</b> ({takenBy.relation}) on my behalf.</p>}
      <p className="declaration-tamil" lang="ta">{lostBillTamilStatement}</p>
    </section>
    <section className="declaration-signatures">
      <div className="signature-box"><span>Customer Signature</span></div>
      <div className="signature-box thumb-box"><span>Thumb Impression</span></div>
      {takenBy && !takenBy.self && <div className="signature-box"><span>Signature of {takenBy.name} ({takenBy.relation})</span></div>}
      <div className="signature-box witness-box"><p>Witness Name: ______________________</p><p>Address: ______________________</p><span>Witness Signature</span></div>
      <div className="signature-box"><span>Business Signature</span></div>
    </section>
    <p className="declaration-place">Place: ______________________ &nbsp;&nbsp; Date: {date || "____________"}</p>
  </article>;
}

/** A printable page the customer signs when taking jewellery back without the bill. */
export function LostBillDeclaration({ bills, profile, pending, onClose, onPrinted }: { bills: Bill[]; profile: Profile; pending?: PendingDeclaration; onClose: () => void; onPrinted?: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  if (!mounted || !bills.length) return null;
  // Rendered beside the page, because printing hides the main content area.
  return createPortal(<div className="modal-backdrop lost-bill-print"><section className="bill-modal" role="dialog" aria-modal="true" aria-label="Lost bill declaration">
    <div className="modal-actions"><button className="secondary" onClick={onClose}>Close</button><button onClick={async () => { await document.fonts.load('12px BillTamil', lostBillTamilStatement); await document.fonts.ready; window.print(); onPrinted?.(); }}>Print declaration</button></div>
    {declarationGroups(bills).map(group => <DeclarationPage key={group[0].id} bills={group} profile={profile} pending={pending} />)}
  </section></div>, document.body);
}
