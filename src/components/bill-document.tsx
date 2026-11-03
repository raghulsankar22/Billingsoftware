"use client";

import { useState } from "react";
import { withAccountSlot, type AccountSlot } from "@/lib/account-url";
import { amountInWords, formatINR, recordedGrams, recordedINR } from "@/lib/money";
import { calculateRepayment } from "@/lib/interest";
import { RepaymentDetails } from "./repayment-details";
import { requestHeaders } from "./api";
import { billReceiptLabels, collectedByText, type Bill } from "@/lib/types";
import { BillConditions } from "./bill-conditions";
import { billLicenseNumber } from "@/lib/business-license";
import { formatParticulars } from "@/lib/jewellery";

type Profile = { business_name: string; address: string; phone: string; logo_url?: string | null; license_number?: string | null };
type SnapshottedBill = Bill & { businessSnapshot?: Profile };

export function BillDocument({ bill, profile, accountSlot, onClose, documentType = "finance", previewOnly = false }: { bill: SnapshottedBill; profile: Profile; accountSlot: AccountSlot; onClose: () => void; documentType?: "finance" | "delivery"; previewOnly?: boolean }) {
  const [error, setError] = useState("");
  const business = bill.businessSnapshot ?? profile;
  const licenseNumber = billLicenseNumber(bill, profile);
  const delivery = documentType === "delivery";
  const hasRemarks = bill.items.some(item => Boolean(item.remarks?.trim()));
  const repayment = delivery && bill.deliveryDate ? bill.deliverySummary ?? (bill.historicalDelivery ? null : calculateRepayment(bill.items, bill.billDate, bill.deliveryDate)) : null;

  async function printBill() {
    setError("");
    try {
      await document.fonts.load('12px BillTamil', 'மோதிரம்');
      await document.fonts.ready;
      window.print();
    } catch {
      setError("Unable to load the Tamil print font. Please reopen the bill and try again.");
    }
  }

  async function downloadPdf() {
    setError("");
    try {
      const response = await fetch(withAccountSlot(`/api/bills/${bill.id}/${delivery ? "delivery/pdf" : "pdf"}`, accountSlot), { headers: await requestHeaders() });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Unable to download PDF.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = delivery ? `Delivery-${bill.deliveryNo}-Bill-${bill.billNumber}.pdf` : `Bill-${bill.billNumber}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to download PDF.");
    }
  }


  return <div className="modal-backdrop"><section className="bill-modal">
    <div className="modal-actions"><button className="secondary" onClick={onClose}>Close</button><button className="secondary" onClick={printBill}>Print</button>{!previewOnly && <button onClick={downloadPdf}>Download PDF</button>}</div>
    {error && <p className="error">{error}</p>}
    <article className="print-bill"><header className="bill-document-header"><img className="bill-header-logo" src="/business-logo.jpg" alt="Business logo" />{licenseNumber && <p className="bill-license-number">License No.: {licenseNumber}</p>}<h1>{business.business_name}</h1><p>{business.address}</p><h2>{delivery ? "DELIVERY BILL" : "FINANCE BILL"}</h2></header>
      {!delivery && bill.status === "void" && <p className="bill-void-label">VOIDED</p>}
      {bill.historicalImport && <p>Imported historical record · Original physical bill not included</p>}
      <div className="bill-meta"><span>{delivery ? "Delivery No." : "Bill No."} <b>{delivery ? bill.deliveryNo : bill.billNumber}</b></span><span>Date <b>{delivery ? bill.deliveryDate : bill.billDate}</b></span></div>
      {delivery ? <p>Original Bill No. {bill.billNumber} &nbsp; Bill Date {bill.billDate}{bill.status === "void" && <> · Original bill voided; delivery recorded</>}</p> : (bill.deliveryNo || bill.deliveryDate) && <p>Delivery No. {bill.deliveryNo || "—"} &nbsp; Delivery Date {bill.deliveryDate || "—"}</p>}
      {delivery && <p><b>Delivery remarks:</b> {bill.deliveryBillReceiptStatus ? billReceiptLabels[bill.deliveryBillReceiptStatus] : "Not recorded"}</p>}
      {delivery && <p><b>Jewellery taken by:</b> {collectedByText(bill) || "Not recorded"}</p>}
      <section className="customer-box"><p><b>Name:</b> {bill.customerName}</p><p><b>Father&apos;s Name / Husband&apos;s Name:</b> {bill.fatherName || (bill.historicalImport ? "Not recorded" : "")}</p><p><b>Address:</b> {bill.address}</p>{(bill.phone || bill.governmentId) && <p>{bill.phone && <><b>Phone:</b> {bill.phone}</>}{bill.governmentId && <> &nbsp; <b>ID:</b> {bill.governmentId}</>}</p>}</section>
      <table className="print-table"><thead><tr><th>Metal</th><th>Particulars</th>{hasRemarks && <th>Remarks</th>}<th>Gram</th><th>Total Value</th><th>Amount</th></tr></thead><tbody>{bill.items.map((item, index) => <tr key={index}><td>{item.metal ?? ""}</td><td className="print-particulars">{formatParticulars(item.particulars)}</td>{hasRemarks && <td className="print-remarks">{item.remarks ?? ""}</td>}<td>{recordedGrams(item.grams)}</td><td>{recordedINR(item.assessedValue)}</td><td>{formatINR(item.loanAmount)}</td></tr>)}</tbody><tfoot><tr><th colSpan={hasRemarks ? 4 : 3}>Total</th><th>{recordedINR(bill.totalAssessedValue)}</th><th>{formatINR(bill.totalLoanAmount)}</th></tr></tfoot></table>
      {repayment && <RepaymentDetails repayment={repayment} forceEnglish />}
      <p className="words"><b>Amount in words:</b> {repayment?.total !== undefined && repayment.total !== null ? amountInWords(repayment.total) : bill.amountInWords}</p><footer><div>Business Signature</div><div>Customer Signature</div></footer>
      {!delivery && <BillConditions />}
    </article>
  </section></div>;
}
