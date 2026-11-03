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
  bill: Bill; profile: BusinessSnapshot; delivery: boolean; onClose: () => void; onEnglish?: () => void;
}) {
  const [bilingual, setBilingual] = useState(true);
  const label = (english: string, tamil: string) => bilingual ? english + " / " + tamil : tamil;
  const pair = (english: string, tamil: string) => bilingual ? <span className="bilingual-value"><span lang="en">{english}</span><span lang="ta">{tamil}</span></span> : tamil;
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
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>மூடு</button>{onEnglish && <button type="button" className="secondary" onClick={onEnglish}>English bill / PDF</button>}<label className="bill-print-language">Print language / அச்சு மொழி<select value={bilingual ? "bilingual" : "tamil"} disabled={printing} onChange={event => setBilingual(event.target.value === "bilingual")}><option value="bilingual">English + தமிழ்</option><option value="tamil">தமிழ் மட்டும் / Tamil only</option></select></label><button type="button" disabled={!reviewed || !complete || printing} onClick={print}>{bilingual ? "Print English + Tamil / PDF" : "தமிழில் அச்சிடு / PDF"}</button></div>
    <section className="tamil-bill-review panel" aria-label="தமிழ் ரசீதைச் சரிபார்க்கவும்">
      <h2>{bilingual ? "English + Tamil bill / இருமொழி ரசீது" : "தமிழ் ரசீதைச் சரிபார்க்கவும்"}</h2><p lang="en">English records stay unchanged. Edit the Tamil spelling below, confirm it, then print or save as PDF. Offline suggestions are phonetic, not full translation.</p>
      <p>முதலில் காட்டப்படுவது இணையமில்லா உச்சரிப்பு உதவி மட்டுமே; முழுமையான மொழிபெயர்ப்பு அல்ல. பெயர் மற்றும் முகவரியின் எழுத்துகளைத் திருத்தவும். Google பொத்தான் ஒப்புதல் பெற்ற பிறகே இணையத்தைப் பயன்படுத்தும்.</p>
      <p>இந்தத் திருத்தங்கள் இந்த ரசீதை அச்சிட மட்டுமே. மூடியதும் மறைந்துவிடும். ஆங்கிலப் பதிவுகள், Excel மற்றும் சேமித்த PDF மாறாது. சட்ட நிபந்தனைகளும் தொகை எழுத்துகளும் அசல் ஆங்கிலத்தில் இருக்கும்.</p>
      <div className="tamil-bill-fields">{fields.map(([key, label, original]) => <div key={key}><label htmlFor={id + key}>{label}</label><small lang="en">{original || "Not recorded"}</small><textarea id={id + key} maxLength={2000} value={draft[key] ?? ""} onChange={event => { setDraft({ ...draft, [key]: event.target.value }); setReviewed(false); }} />{googleFields[key] && <GoogleTranslateButton text={original} field={googleFields[key]} source="en" target="ta" disabled={printing} onTranslated={value => { setDraft(current => ({ ...current, [key]: value })); setReviewed(false); setGoogleUsed(true); }} />}</div>)}</div>
      <label className="tamil-bill-confirm"><input type="checkbox" checked={reviewed} disabled={!complete} onChange={event => setReviewed(event.target.checked)} /> தமிழ் எழுத்துகளையும் ஆங்கில மூல விவரங்களையும் சரிபார்த்தேன்.</label>
      <p>PDF பெற அச்சு சாளரத்தில் “Save as PDF” என்பதைத் தேர்ந்தெடுக்கவும். / Select “Save as PDF” in the print dialog.</p>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
    <p className="tamil-print-blocked">தமிழ் ரசீதை முதலில் சரிபார்க்கவும். / Review and confirm the Tamil bill before printing.</p>
    <article className="print-bill tamil-print-bill">
      <header className="bill-document-header"><img className="bill-header-logo" src="/business-logo.jpg" alt="நிறுவனச் சின்னம்" />{license && <p className="bill-license-number">{label("License No.", "உரிம எண்")}: {license}</p>}<h1>{pair(business.business_name, draft.businessName)}</h1><p>{pair(business.address, draft.businessAddress)}</p><h2>{delivery ? label("DELIVERY BILL", "நகை திருப்பி வழங்கிய ரசீது") : label("FINANCE BILL", "அடகு ரசீது")}</h2></header>
      {!delivery && bill.status === "void" && <p className="bill-void-label">{label("VOIDED", "ரத்து செய்யப்பட்டது")}</p>}
      {bill.historicalImport && <p>{label("Imported historical record · Original physical bill not included", "பழைய பதிவேட்டிலிருந்து இறக்குமதி செய்யப்பட்டது · அசல் ரசீது இணைக்கப்படவில்லை")}</p>}
      <div className="bill-meta"><span>{delivery ? label("Delivery No.", "வழங்கல் எண்") : label("Bill No.", "ரசீது எண்")} <b>{delivery ? bill.deliveryNo : bill.billNumber}</b></span><span>{label("Date", "தேதி")} <b>{delivery ? bill.deliveryDate : bill.billDate}</b></span></div>
      {delivery ? <p>{label("Original Bill No.", "அசல் ரசீது எண்")} {bill.billNumber} · {label("Bill Date", "ரசீது தேதி")} {bill.billDate}{bill.status === "void" && label(" · Original bill voided; delivery recorded", " · அசல் ரசீது ரத்து செய்யப்பட்டது; வழங்கல் பதிவு உள்ளது")}</p> : (bill.deliveryNo || bill.deliveryDate) && <p>{label("Delivery No.", "வழங்கல் எண்")} {bill.deliveryNo || "—"} · {label("Delivery Date", "வழங்கிய தேதி")} {bill.deliveryDate || "—"}</p>}
      {delivery && <><p><b>{label("Receipt status", "ரசீது நிலை")}:</b> {bill.deliveryBillReceiptStatus ? pair(billReceiptLabels[bill.deliveryBillReceiptStatus], tamilBillText(billReceiptLabels[bill.deliveryBillReceiptStatus])) : notRecorded}</p><p><b>{label("Jewellery taken by", "நகையைப் பெற்றவர்")}:</b> {bill.deliveryCollectedByName && bill.deliveryCollectedByRelation ? <>{pair(bill.deliveryCollectedByName, draft.collector)} ({pair(collectedByRelationLabels[bill.deliveryCollectedByRelation], tamilBillText(collectedByRelationLabels[bill.deliveryCollectedByRelation]))})</> : notRecorded}</p></>}
      <section className="customer-box"><p><b>{label("Name", "பெயர்")}:</b> {pair(bill.customerName, draft.customerName)}</p><p><b>{label("Father’s Name / Husband’s Name", "தந்தை / கணவர் பெயர்")}:</b> {pair(bill.fatherName || (bill.historicalImport ? "Not recorded" : ""), draft.fatherName || (bill.historicalImport ? notRecorded : ""))}</p><p><b>{label("Address", "முகவரி")}:</b> {pair(bill.address, draft.address)}</p>{(bill.phone || bill.governmentId) && <p>{bill.phone && <><b>{label("Phone", "தொலைபேசி")}:</b> {bill.phone}</>}{bill.governmentId && <> · <b>{label("ID", "அடையாள எண்")}:</b> {bill.governmentId}</>}</p>}</section>
      <table className="print-table"><thead><tr><th>{label("Metal", "உலோகம்")}</th><th>{label("Particulars", "நகை விவரம்")}</th>{hasRemarks && <th>{label("Remarks", "குறிப்புகள்")}</th>}<th>{label("Grams", "கிராம்")}</th><th>{label("Assessed value", "மதிப்பீடு")}</th><th>{label("Amount", "தொகை")}</th></tr></thead><tbody>{bill.items.map((item, index) => <tr key={index}><td>{pair(item.metal ?? "", tamilBillText(item.metal ?? ""))}</td><td>{pair(item.particulars, draft["particulars-" + index])}</td>{hasRemarks && <td className="print-remarks">{pair(item.remarks ?? "", draft["remarks-" + index])}</td>}<td>{recordedGrams(item.grams)}</td><td>{recordedINR(item.assessedValue)}</td><td>{formatINR(item.loanAmount)}</td></tr>)}</tbody><tfoot><tr><th colSpan={hasRemarks ? 4 : 3}>{label("Total", "மொத்தம்")}</th><th>{recordedINR(bill.totalAssessedValue)}</th><th>{formatINR(bill.totalLoanAmount)}</th></tr></tfoot></table>
      {repayment && <section className="repayment-summary"><h3>{label("Amount to collect", "வசூலிக்க வேண்டிய தொகை")}</h3><p>{repayment.chargedMonths} கூடுதல் வட்டி மாதங்கள் · {[...new Set(repayment.lines.filter(item => item.ratePercent !== null).map(item => tamilBillText(item.metal ?? "") + ": " + item.ratePercent + "% மாதாந்திரம்"))].join(" · ")}</p>{repayment.missingMetal && <p>வட்டி கணக்கிட ஒவ்வொரு நகைக்கும் தங்கம் அல்லது வெள்ளி தேர்ந்தெடுக்கப்பட வேண்டும்.</p>}<dl><div><dt>{label("Principal", "அசல்")}</dt><dd>{formatINR(repayment.principal)}</dd></div><div><dt>{label("Interest", "வட்டி")}</dt><dd>{repayment.interest === null ? "—" : formatINR(repayment.interest)}</dd></div><div><dt>{label("Total collection", "மொத்த வசூல்")}</dt><dd>{repayment.total === null ? "—" : formatINR(repayment.total)}</dd></div></dl></section>}
      <p className="words"><b>{label("Amount in words (English)", "தொகை எழுத்தில் (ஆங்கிலம்)")}:</b> <span lang="en">{repayment?.total !== undefined && repayment.total !== null ? amountInWords(repayment.total) : bill.amountInWords}</span></p>
      <footer><div>{label("Business signature", "நிறுவனத்தின் கையொப்பம்")}</div><div>{label("Customer signature", "வாடிக்கையாளரின் கையொப்பம்")}</div></footer>
      {googleUsed && <p className="google-bill-attribution">Google Translate பரிந்துரைகளைக் கொண்டு சரிபார்க்கப்பட்ட தமிழ் நகல். <a href="https://translate.google.com/" target="_blank" rel="noreferrer">Powered by Google Translate</a></p>}
      {!delivery && <BillConditions />}
    </article>
  </section></div>;
}
