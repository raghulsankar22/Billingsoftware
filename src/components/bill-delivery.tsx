"use client";

import { useLanguage } from "./language-provider";
import { formatParticulars } from "@/lib/jewellery";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountSlot } from "@/lib/account-url";
import { formatINR, recordedGrams, recordedINR } from "@/lib/money";
import { collectedByComplete, type Bill, type BillReceiptStatus, type CollectedBy } from "@/lib/types";
import { BillReceiptSelect } from "./bill-receipt-select";
import { CollectedByFields } from "./collected-by-fields";
import { api } from "./api";
import { calculateRepayment } from "@/lib/interest";
import { RepaymentDetails } from "./repayment-details";
import { MultipleDelivery } from "./multiple-delivery";
import { CancelDelivery } from "./cancel-delivery";
import { DeliveredBillNotice } from "./delivered-bill-notice";
import { deliveryBillHistory } from "@/lib/delivery-history";
import { isDelivered } from "@/lib/delivery-status";
import { LostBillConfirm } from "./lost-bill-confirm";
import { LostBillDeclaration, type DeclarationProfile } from "./lost-bill-declaration";

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

type DeliveryProps = { accountSlot: AccountSlot; profile: DeclarationProfile; onSaved: (bill: Bill) => void; onBatchSaved: () => void; onOpen: (bill: Bill) => void; onOverview: (bill: Bill) => void; onReceipt: (bill: Bill) => void };
export function BillDelivery(props: DeliveryProps) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<"single" | "multiple" | "cancel">("single");
  const [alreadyDelivered, setAlreadyDelivered] = useState<Bill[]>([]);
  return <><div className="delivery-mode" role="group" aria-label={t("Delivery mode")}><button className={mode === "single" ? "active" : "secondary"} aria-pressed={mode === "single"} onClick={() => setMode("single")}>{t("Single Delivery")}</button><button className={mode === "multiple" ? "active" : "secondary"} aria-pressed={mode === "multiple"} onClick={() => setMode("multiple")}>{t("Multiple Delivery")}</button><button className={mode === "cancel" ? "active" : "secondary"} aria-pressed={mode === "cancel"} onClick={() => setMode("cancel")}>{t("Cancel delivery bill")}</button></div>{mode === "cancel" ? <CancelDelivery accountSlot={props.accountSlot} onSaved={props.onBatchSaved} onReceipt={props.onReceipt} /> : mode === "single" ? <SingleBillDelivery {...props} onAlreadyDelivered={setAlreadyDelivered} /> : <MultipleDelivery accountSlot={props.accountSlot} profile={props.profile} onSaved={props.onBatchSaved} onOpen={props.onOpen} onReceipt={props.onReceipt} onAlreadyDelivered={setAlreadyDelivered} />}{alreadyDelivered.length > 0 && <DeliveredBillNotice bills={alreadyDelivered} onClose={() => setAlreadyDelivered([])} />}</>;
}

function SingleBillDelivery({ accountSlot, profile, onSaved, onOpen, onOverview, onReceipt, onAlreadyDelivered }: DeliveryProps & { onAlreadyDelivered: (bills: Bill[]) => void }) {
  const { t } = useLanguage();
  const [billNumber, setBillNumber] = useState("");
  const [bill, setBill] = useState<Bill | null>(null);
  const [deliveryNo, setDeliveryNo] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(today);
  const [billReceiptStatus, setBillReceiptStatus] = useState<BillReceiptStatus | "">("");
  const [collectedBy, setCollectedBy] = useState<CollectedBy>({ relation: "", name: "" });
  const [busy, setBusy] = useState<"lookup" | "save" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [itemMetals, setItemMetals] = useState<("Gold" | "Silver" | null)[]>([]);
  const [declaration, setDeclaration] = useState({ open: false, printed: false, signed: false });
  const lostBill = billReceiptStatus === "lost_bill";
  /** The printed paper shows these details, so changing one needs a fresh printout. */
  const resetDeclaration = () => setDeclaration({ open: false, printed: false, signed: false });
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  const collection = useMemo(() => {
    // The old register doesn't show what interest was collected, so none is calculated.
    if (!bill || !deliveryDate || bill.historicalDelivery) return { repayment: null, error: "" };
    try {
      return { repayment: calculateRepayment(bill.items.map((item, index) => ({ ...item, metal: item.metal ?? itemMetals[index] ?? undefined })), bill.billDate, deliveryDate), error: "" };
    } catch (failure) {
      return { repayment: null, error: failure instanceof Error ? failure.message : "Unable to calculate interest." };
    }
  }, [bill, deliveryDate, itemMetals]);

  async function findBill(event: React.FormEvent) {
    event.preventDefault();
    const request = ++generation.current;
    setBusy("lookup"); setError(""); setMessage(""); setWarnings([]); setBill(null); setBillReceiptStatus(""); setCollectedBy({ relation: "", name: "" }); resetDeclaration();
    try {
      const { bill: found, nextDeliveryNumber } = await api(`/api/delivery?billNumber=${encodeURIComponent(billNumber.trim())}`, accountSlot);
      if (request !== generation.current) return;
      setBill(found);
      setBillReceiptStatus(found.deliveryBillReceiptStatus ?? "");
      if (found.lostBillDeclaredAt) setDeclaration({ open: false, printed: true, signed: true });
      setCollectedBy({ relation: found.deliveryCollectedByRelation ?? "", name: found.deliveryCollectedByRelation === "self" ? "" : found.deliveryCollectedByName ?? "" });
      setDeliveryNo(found.deliveryNo || String(nextDeliveryNumber));
      setItemMetals(found.items.map((item: Bill["items"][number]) => item.metal ?? null));
      setDeliveryDate(found.deliveryDate || (found.historicalDelivery ? "" : today() < found.billDate ? found.billDate : today()));
      const delivered = deliveryBillHistory([found]);
      if (delivered.length) onAlreadyDelivered(delivered);
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : "Unable to find this bill.");
    } finally {
      if (request === generation.current) setBusy(null);
    }
  }

  async function saveDelivery(event: React.FormEvent) {
    event.preventDefault();
    if (!bill) return;
    if (!billReceiptStatus) { setError("Choose whether the customer has the bill or lost the bill."); return; }
    if (!collectedByComplete(collectedBy)) { setError(collectedBy.relation ? "Enter the name of the person taking the jewellery." : "Choose who is taking the jewellery."); return; }
    if (lostBill && !declaration.signed) { setError("Print the lost bill declaration and tick that the customer has signed it."); return; }
    if (bill.historicalDelivery ? !deliveryDate : !collection.repayment || collection.repayment.missingMetal) { setError(bill.historicalDelivery ? "Choose the delivery date." :collection.error || "Choose Gold or Silver for each item to calculate interest."); return; }
    const request = ++generation.current;
    setBusy("save"); setError(""); setMessage(""); setWarnings([]);
    try {
      const result = await api(`/api/bills/${bill.id}/delivery`, accountSlot, { method: "PATCH", body: JSON.stringify({ deliveryDate, itemMetals, billReceiptStatus, ...(lostBill ? { lostBillDeclarationSigned: declaration.signed } : {}), collectedByRelation: collectedBy.relation, ...(collectedBy.relation === "self" ? {} : { collectedByName: collectedBy.name }) }) });
      if (request !== generation.current) return;
      setBill(result.bill);
      setDeliveryNo(result.bill.deliveryNo);
      setDeliveryDate(result.bill.deliveryDate);
      setBillReceiptStatus(result.bill.deliveryBillReceiptStatus ?? "");
      setWarnings(result.warnings ?? []);
      setMessage(result.warnings?.length ? `Delivery saved for bill #${bill.billNumber}.` : `Delivery saved for bill #${bill.billNumber}. Excel and PDF updated.`);
      onSaved(result.bill);
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : "Unable to save delivery.");
    } finally {
      if (request === generation.current) setBusy(null);
    }
  }

  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">{t("ACCOUNT")} {accountSlot} {t("· DELIVERY")}</p><h2>{t("Find a bill for delivery")}</h2><p className="muted">{t("Enter the bill number to review the customer and pledged items.")}</p></div></div>
    <form className="delivery-search" onSubmit={findBill}>
      <label htmlFor="delivery-bill-number">{t("Bill number")}<input id="delivery-bill-number" inputMode="numeric" value={billNumber} placeholder={t("e.g. 1")} disabled={Boolean(busy)} onChange={(event) => { setBillNumber(event.target.value); setBill(null); setError(""); setMessage(""); setWarnings([]); }} required /></label>
      <button disabled={Boolean(busy)}>{busy === "lookup" ? t("Finding…") : t("Find bill")}</button>
    </form>
    {error && <p className="error" role="alert">{t(error)}</p>}
    {message && <p className="excel-notice delivery-notice" role="status">{t(message)}</p>}
    {warnings.map((warning) => <p className="overview-warning" key={warning}>{t(warning)}</p>)}
    {bill && <div className="delivery-details">
      <div className="section-heading"><div><h2>{t("Bill #")}{bill.billNumber} · {bill.customerName}</h2><p className="muted">{t("Bill date:")} {bill.billDate}</p></div><span className="pill">{bill.status === "void" ? isDelivered(bill) ? t("Voided · Delivered") : t("Voided") : isDelivered(bill) ? t("Delivered") : t("Awaiting delivery")}</span></div>
      <div className="delivery-customer"><p><b>{t("Father's name / Husband's name:")}</b> {bill.fatherName || (bill.historicalImport ? "Not recorded" : "")}</p><p><b>{t("Address:")}</b> {bill.address}</p>{bill.phone && <p><b>{t("Mobile:")}</b> {bill.phone}</p>}<p><b>{t("Loan amount:")}</b> {formatINR(bill.totalLoanAmount)}</p></div>
      <div className="item-table-wrap"><table className="history-table"><thead><tr><th>{t("Metal")}</th><th>{t("Particulars")}</th><th>{t("Gram")}</th><th>{t("Assessed value")}</th><th>{t("Principal")}</th><th>{t("Monthly rate")}</th><th>{t("Interest to collect")}</th></tr></thead><tbody>{bill.items.map((item, index) => <tr key={index}><td>{(item.metal ? t(item.metal) : null) ?? <select aria-label={t(`Metal for item ${index + 1}`)} value={itemMetals[index] ?? ""} disabled={Boolean(busy)} onChange={(event) => { const metal = event.target.value; setItemMetals(current => current.map((choice, itemIndex) => itemIndex === index ? metal === "Gold" || metal === "Silver" ? metal : null : choice)); setMessage(""); }}><option value="">{t("Choose metal")}</option><option value="Gold">{t("Gold")}</option><option value="Silver">{t("Silver")}</option></select>}</td><td>{formatParticulars(item.particulars)}</td><td>{recordedGrams(item.grams)}</td><td>{recordedINR(item.assessedValue)}</td><td>{formatINR(item.loanAmount)}</td><td>{collection.repayment?.lines[index].ratePercent == null ? "—" : `${collection.repayment.lines[index].ratePercent}%`}</td><td>{collection.repayment?.lines[index].interest == null ? "—" : formatINR(collection.repayment.lines[index].interest!)}</td></tr>)}</tbody></table></div>
      <div className="delivery-bill-actions"><button type="button" className="secondary" onClick={() => onOpen(bill)}>{t("Open bill")}</button><button type="button" className="secondary" onClick={() => onOverview(bill)}>{t("Repayment overview")}</button>{bill.deliveryNo && bill.deliveryDate && <button type="button" className="secondary" onClick={() => onReceipt(bill)}>{t("View delivery bill")}</button>}</div>
      {bill.historicalDelivery && <p className="overview-warning">{t("This delivery came from your old register.")} {bill.deliveryNo && bill.deliveryDate ? t("It is complete and can't be changed here; use Edit bill to correct it.") : t("Add only what is missing. No interest will be calculated, because the register doesn't show what was collected.")}</p>}
      {!(bill.historicalDelivery && bill.deliveryNo && bill.deliveryDate) && <form className="delivery-entry" onSubmit={saveDelivery}>
        <BillReceiptSelect billNumber={bill.billNumber} value={billReceiptStatus} disabled={Boolean(busy)} onChange={value => { setBillReceiptStatus(value); resetDeclaration(); setMessage(""); setError(""); }} />
        <CollectedByFields value={collectedBy} customerName={bill.customerName} disabled={Boolean(busy)} onChange={value => { setCollectedBy(value); resetDeclaration(); setMessage(""); setError(""); }} />
        <div className="form-grid"><label>{t("Delivery bill number (automatic)")}<input value={deliveryNo} readOnly /></label><label>{t("Delivery bill date")}<input type="date" min={bill.billDate} value={deliveryDate} disabled={Boolean(busy) || Boolean(bill.historicalDelivery && bill.deliveryDate)} onChange={(event) => { setDeliveryDate(event.target.value); resetDeclaration(); setMessage(""); }} required /></label></div>
        {lostBill && <LostBillConfirm printed={declaration.printed} signed={declaration.signed} disabled={Boolean(busy)} onPrint={() => { if (!collectedByComplete(collectedBy)) { setError(collectedBy.relation ? "Enter the name of the person taking the jewellery." : "Choose who is taking the jewellery."); return; } setError(""); setDeclaration(current => ({ ...current, open: true, printed: true })); }} onSigned={signed => { setDeclaration(current => ({ ...current, signed })); setError(""); }} />}
        {collection.error && <p className="error" role="alert">{t(collection.error)}</p>}
        {collection.repayment && <RepaymentDetails repayment={collection.repayment} />}
        <button disabled={Boolean(busy) || (lostBill && !declaration.signed)}>{busy === "save" ? t("Saving…") : bill.deliveryNo && bill.deliveryDate ? t("Update delivery") : t("Save delivery")}</button>
      </form>}
    </div>}
    {bill && declaration.open && <LostBillDeclaration bills={[bill]} profile={profile} pending={{ deliveryDate, collectedBy, deliveryNumbers: { [bill.id]: deliveryNo } }} onClose={() => setDeclaration(current => ({ ...current, open: false }))} />}
  </section>;
}
