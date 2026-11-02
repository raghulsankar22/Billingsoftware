"use client";

import { useId, useState } from "react";
import { billLicenseNumber } from "@/lib/business-license";
import { createTamilBillDraft, tamilBillText } from "@/lib/tamil-bill-presentation";
import { calculateRepayment } from "@/lib/interest";
import { amountInWords, formatINR, recordedGrams, recordedINR } from "@/lib/money";
import { billReceiptLabels, collectedByRelationLabels, type Bill, type BusinessSnapshot } from "@/lib/types";
import { BillConditions } from "./bill-conditions";
import { GoogleTranslateButton } from "./google-translate-button";
import type { GoogleTranslationField } from "../lib/google-translation-input";

export function TamilBillDocument({ bill, profile, delivery, onClose, onEnglish }: {
  bill: Bill; profile: BusinessSnapshot; delivery: boolean; onClose: () => void; onEnglish: () => void;
}) {
  const business = bill.businessSnapshot ?? profile;
  const [draft, setDraft] = useState(() => createTamilBillDraft(bill, business));
  const [reviewed, setReviewed] = useState(false);
  const [googleUsed, setGoogleUsed] = useState(false);
  const id = useId();
  const googleFields: Record<string, GoogleTranslationField | undefined> = { customerName: "customerName", fatherName: "fatherName", address: "address" };
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);
  const license = billLicenseNumber(bill, profile);
  const hasRemarks = bill.items.some(item => Boolean(item.remarks?.trim()));
  const repayment = delivery && bill.deliveryDate ? bill.deliverySummary ?? (bill.historicalDelivery ? null : calculateRepayment(bill.items, bill.billDate, bill.deliveryDate)) : null;
  const notRecorded = "பதிவு செய்யப்படவில்லை";
  const fields = [
    ["businessName", "நிறுவனத்தின் பெயர்", business.business_name], ["businessAddress", "நிறுவனத்தின் முகவரி", business.address],
    ["customerName", "பெயர்", bill.customerName], ["fatherName", "தந்தையின் பெயர்", bill.fatherName], ["address", "முகவரி", bill.address],
    ...(delivery && bill.deliveryCollectedByName ? [["collector", "நகையைப் பெற்றவர்", bill.deliveryCollectedByName]] : []),
    ...bill.items.flatMap((item, index) => [["particulars-" + index, "நகை விவரம் " + (index + 1), item.particulars], ...(item.remarks ? [["remarks-" + index, "குறிப்புகள் " + (index + 1), item.remarks]] : [])]),
  ];
  const complete = fields.every(([key, , original]) => !original.trim() || Boolean(draft[key]?.trim()));
  async function print() {
    if (!reviewed || !complete || printing) return;
    setPrinting(true);
    setError("");
    try {
      await Promise.all([document.fonts.load('12px BillTamil'), document.fonts.load('bold 12px BillTamil')]);
      await document.fonts.ready;
      if (!document.fonts.check('12px BillTamil')) throw new Error("font");
      window.print();
    } catch {
      setError("தமிழ் எழுத்துரு ஏற்றப்படவில்லை. மீண்டும் முயற்சிக்கவும். / Tamil font could not load; try again.");
    } finally { setPrinting(false); }
  }
  return <div className="modal-backdrop"><section className={"bill-modal tamil-bill-modal" + (reviewed && complete ? " tamil-bill-reviewed" : "")} lang="ta">
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>மூடு</button><button type="button" className="secondary" onClick={onEnglish}>English bill / PDF</button><button type="button" disabled={!reviewed || !complete || printing} onClick={print}>தமிழில் அச்சிடு / PDF</button></div>
    <section className="tamil-bill-review panel" aria-label="தமிழ் ரசீதைச் சரிபார்க்கவும்">
      <h2>தமிழ் ரசீதைச் சரிபார்க்கவும்</h2>
      <p>முதலில் காட்டப்படுவது இணையமில்லா உச்சரிப்பு உதவி மட்டுமே; முழுமையான மொழிபெயர்ப்பு அல்ல. பெயர் மற்றும் முகவரியின் எழுத்துகளைத் திருத்தவும். Google பொத்தான் ஒப்புதல் பெற்ற பிறகே இணையத்தைப் பயன்படுத்தும்.</p>
      <p>இந்தத் திருத்தங்கள் இந்த ரசீதை அச்சிட மட்டுமே. மூடியதும் மறைந்துவிடும். ஆங்கிலப் பதிவுகள், Excel மற்றும் சேமித்த PDF மாறாது. சட்ட நிபந்தனைகளும் தொகை எழுத்துகளும் அசல் ஆங்கிலத்தில் இருக்கும்.</p>
      <div className="tamil-bill-fields">{fields.map(([key, label, original]) => <div key={key}><label htmlFor={id + key}>{label}</label><small lang="en">{original || "Not recorded"}</small><textarea id={id + key} maxLength={2000} value={draft[key] ?? ""} onChange={event => { setDraft({ ...draft, [key]: event.target.value }); setReviewed(false); }} />{googleFields[key] && <GoogleTranslateButton text={original} field={googleFields[key]} source="en" target="ta" disabled={printing} onTranslated={value => { setDraft(current => ({ ...current, [key]: value })); setReviewed(false); setGoogleUsed(true); }} />}</div>)}</div>
      <label className="tamil-bill-confirm"><input type="checkbox" checked={reviewed} disabled={!complete} onChange={event => setReviewed(event.target.checked)} /> தமிழ் எழுத்துகளையும் ஆங்கில மூல விவரங்களையும் சரிபார்த்தேன்.</label>
      <p>PDF பெற அச்சு சாளரத்தில் “Save as PDF” என்பதைத் தேர்ந்தெடுக்கவும். / Select “Save as PDF” in the print dialog.</p>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
    <p className="tamil-print-blocked">தமிழ் ரசீதை முதலில் சரிபார்க்கவும். / Review and confirm the Tamil bill before printing.</p>
    <article className="print-bill tamil-print-bill">
      <header className="bill-document-header"><img className="bill-header-logo" src="/business-logo.jpg" alt="நிறுவனச் சின்னம்" />{license && <p className="bill-license-number">உரிம எண்: {license}</p>}<h1>{draft.businessName}</h1><p>{draft.businessAddress} · {business.phone}</p><h2>{delivery ? "நகை திருப்பி வழங்கிய ரசீது" : "அடகு ரசீது"}</h2></header>
      {!delivery && bill.status === "void" && <p className="bill-void-label">ரத்து செய்யப்பட்டது</p>}
      {bill.historicalImport && <p>பழைய பதிவேட்டிலிருந்து இறக்குமதி செய்யப்பட்டது · அசல் ரசீது இணைக்கப்படவில்லை</p>}
      <div className="bill-meta"><span>{delivery ? "வழங்கல் எண்" : "ரசீது எண்"} <b>{delivery ? bill.deliveryNo : bill.billNumber}</b></span><span>தேதி <b>{delivery ? bill.deliveryDate : bill.billDate}</b></span></div>
      {delivery ? <p>அசல் ரசீது எண் {bill.billNumber} · ரசீது தேதி {bill.billDate}{bill.status === "void" && " · அசல் ரசீது ரத்து செய்யப்பட்டது; வழங்கல் பதிவு உள்ளது"}</p> : (bill.deliveryNo || bill.deliveryDate) && <p>வழங்கல் எண் {bill.deliveryNo || "—"} · வழங்கிய தேதி {bill.deliveryDate || "—"}</p>}
      {delivery && <><p><b>ரசீது நிலை:</b> {bill.deliveryBillReceiptStatus ? tamilBillText(billReceiptLabels[bill.deliveryBillReceiptStatus]) : notRecorded}</p><p><b>நகையைப் பெற்றவர்:</b> {bill.deliveryCollectedByName && bill.deliveryCollectedByRelation ? <>{draft.collector} ({tamilBillText(collectedByRelationLabels[bill.deliveryCollectedByRelation])})</> : notRecorded}</p></>}
      <section className="customer-box"><p><b>பெயர்:</b> {draft.customerName}</p><p><b>தந்தையின் பெயர்:</b> {draft.fatherName || (bill.historicalImport ? notRecorded : "")}</p><p><b>முகவரி:</b> {draft.address}</p>{(bill.phone || bill.governmentId) && <p>{bill.phone && <><b>தொலைபேசி:</b> {bill.phone}</>}{bill.governmentId && <> · <b>அடையாள எண்:</b> {bill.governmentId}</>}</p>}</section>
      <table className="print-table"><thead><tr><th>உலோகம்</th><th>நகை விவரம்</th>{hasRemarks && <th>குறிப்புகள்</th>}<th>கிராம்</th><th>மதிப்பீடு</th><th>தொகை</th></tr></thead><tbody>{bill.items.map((item, index) => <tr key={index}><td>{tamilBillText(item.metal ?? "")}</td><td>{draft["particulars-" + index]}</td>{hasRemarks && <td className="print-remarks">{draft["remarks-" + index]}</td>}<td>{recordedGrams(item.grams)}</td><td>{recordedINR(item.assessedValue)}</td><td>{formatINR(item.loanAmount)}</td></tr>)}</tbody><tfoot><tr><th colSpan={hasRemarks ? 4 : 3}>மொத்தம்</th><th>{recordedINR(bill.totalAssessedValue)}</th><th>{formatINR(bill.totalLoanAmount)}</th></tr></tfoot></table>
      {repayment && <section className="repayment-summary"><h3>வசூலிக்க வேண்டிய தொகை</h3><p>{repayment.chargedMonths} கூடுதல் வட்டி மாதங்கள் · {[...new Set(repayment.lines.filter(item => item.ratePercent !== null).map(item => tamilBillText(item.metal ?? "") + ": " + item.ratePercent + "% மாதாந்திரம்"))].join(" · ")}</p>{repayment.missingMetal && <p>வட்டி கணக்கிட ஒவ்வொரு நகைக்கும் தங்கம் அல்லது வெள்ளி தேர்ந்தெடுக்கப்பட வேண்டும்.</p>}<dl><div><dt>அசல்</dt><dd>{formatINR(repayment.principal)}</dd></div><div><dt>வட்டி</dt><dd>{repayment.interest === null ? "—" : formatINR(repayment.interest)}</dd></div><div><dt>மொத்த வசூல்</dt><dd>{repayment.total === null ? "—" : formatINR(repayment.total)}</dd></div></dl></section>}
      <p className="words"><b>தொகை எழுத்தில் (ஆங்கிலம்):</b> <span lang="en">{repayment?.total !== undefined && repayment.total !== null ? amountInWords(repayment.total) : bill.amountInWords}</span></p>
      <footer><div>நிறுவனத்தின் கையொப்பம்</div><div>வாடிக்கையாளரின் கையொப்பம்</div></footer>
      {googleUsed && <p className="google-bill-attribution">Google Translate பரிந்துரைகளைக் கொண்டு சரிபார்க்கப்பட்ட தமிழ் நகல். <a href="https://translate.google.com/" target="_blank" rel="noreferrer">Powered by Google Translate</a></p>}
      {!delivery && <BillConditions />}
    </article>
  </section></div>;
}
