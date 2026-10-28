"use client";

import { useState } from "react";
import { withAccountSlot, type AccountSlot } from "@/lib/account-url";
import { amountInWords, formatINR } from "@/lib/money";
import { calculateRepayment } from "@/lib/interest";
import { RepaymentDetails } from "./repayment-details";
import { requestHeaders } from "./api";
import type { Bill } from "@/lib/types";

type Profile = { business_name: string; address: string; phone: string; logo_url?: string | null };
type SnapshottedBill = Bill & { businessSnapshot?: Profile };

export function BillDocument({ bill, profile, accountSlot, onClose, documentType = "finance" }: { bill: SnapshottedBill; profile: Profile; accountSlot: AccountSlot; onClose: () => void; documentType?: "finance" | "delivery" }) {
  const [error, setError] = useState("");
  const business = bill.businessSnapshot ?? profile;
  const delivery = documentType === "delivery";
  const repayment = delivery && bill.deliveryDate ? bill.deliverySummary ?? calculateRepayment(bill.items, bill.billDate, bill.deliveryDate) : null;

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
    <div className="modal-actions"><button className="secondary" onClick={onClose}>Close</button><button className="secondary" onClick={() => window.print()}>Print</button><button onClick={downloadPdf}>Download PDF</button></div>
    {error && <p className="error">{error}</p>}
    <article className="print-bill"><header><h1>{business.business_name}</h1><p>{business.address} · {business.phone}</p><h2>{delivery ? "DELIVERY BILL" : "FINANCE BILL"}</h2></header>
      <div className="bill-meta"><span>{delivery ? "Delivery No." : "Bill No."} <b>{delivery ? bill.deliveryNo : bill.billNumber}</b></span><span>Date <b>{delivery ? bill.deliveryDate : bill.billDate}</b></span></div>
      {delivery ? <p>Original Bill No. {bill.billNumber} &nbsp; Bill Date {bill.billDate}{bill.status === "void" && <> · Original bill voided; delivery recorded</>}</p> : (bill.deliveryNo || bill.deliveryDate) && <p>Delivery No. {bill.deliveryNo || "—"} &nbsp; Delivery Date {bill.deliveryDate || "—"}</p>}
      <section className="customer-box"><p><b>Name:</b> {bill.customerName}</p><p><b>Father&apos;s Name:</b> {bill.fatherName}</p><p><b>Address:</b> {bill.address}</p>{(bill.phone || bill.governmentId) && <p>{bill.phone && <><b>Phone:</b> {bill.phone}</>}{bill.governmentId && <> &nbsp; <b>ID:</b> {bill.governmentId}</>}</p>}</section>
      <table className="print-table"><thead><tr><th>Metal</th><th>Particulars</th><th>Gram</th><th>Total Value</th><th>Amount</th></tr></thead><tbody>{bill.items.map((item, index) => <tr key={index}><td>{item.metal ?? ""}</td><td>{item.particulars}</td><td>{item.grams}</td><td>{formatINR(item.assessedValue)}</td><td>{formatINR(item.loanAmount)}</td></tr>)}</tbody><tfoot><tr><th colSpan={3}>Total</th><th>{formatINR(bill.totalAssessedValue)}</th><th>{formatINR(bill.totalLoanAmount)}</th></tr></tfoot></table>
      {repayment && <RepaymentDetails repayment={repayment} />}
      <p className="words"><b>Amount in words:</b> {repayment?.total !== undefined && repayment.total !== null ? amountInWords(repayment.total) : bill.amountInWords}</p><footer><div>Business Signature</div><div>Customer Signature</div></footer>
      {!delivery && <section className="bill-conditions" aria-label="Conditions"><img src="/bill-conditions.jpeg" alt="Original English and Tamil pledge conditions, redemption period, holidays and working hours, reproduced unchanged from the supplied document." /></section>}
    </article>
  </section></div>;
}
