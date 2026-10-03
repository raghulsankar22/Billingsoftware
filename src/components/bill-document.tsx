"use client";

import { useState } from "react";
import { formatINR } from "@/lib/money";
import { createBrowserSupabase } from "@/lib/supabase";
import type { Bill } from "@/lib/types";

type Profile = { business_name: string; address: string; phone: string; logo_url?: string | null };
type SnapshottedBill = Bill & { businessSnapshot?: Profile };

export function BillDocument({ bill, profile, onClose }: { bill: SnapshottedBill; profile: Profile; onClose: () => void }) {
  const [error, setError] = useState("");
  const business = bill.businessSnapshot ?? profile;

  async function downloadPdf() {
    setError("");
    try {
      const { data } = await createBrowserSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch(`/api/bills/${bill.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Unable to download PDF.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `Bill-${bill.billNumber}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to download PDF.");
    }
  }

  return <div className="modal-backdrop"><section className="bill-modal">
    <div className="modal-actions"><button className="secondary" onClick={onClose}>Close</button><button className="secondary" onClick={() => window.print()}>Print</button><button onClick={downloadPdf}>Download PDF</button></div>
    {error && <p className="error">{error}</p>}
    <article className="print-bill"><header><h1>{business.business_name}</h1><p>{business.address} · {business.phone}</p><h2>FINANCE BILL</h2></header>
      <div className="bill-meta"><span>Bill No. <b>{bill.billNumber}</b></span><span>Date <b>{bill.billDate}</b></span></div>
      {(bill.deliveryNo || bill.deliveryDate) && <p>Delivery No. {bill.deliveryNo || "—"} &nbsp; Delivery Date {bill.deliveryDate || "—"}</p>}
      <section className="customer-box"><p><b>Name:</b> {bill.customerName}</p><p><b>Father&apos;s Name:</b> {bill.fatherName}</p><p><b>Address:</b> {bill.address}</p><p><b>Phone:</b> {bill.phone}{bill.governmentId && <> &nbsp; <b>ID:</b> {bill.governmentId}</>}</p></section>
      <table className="print-table"><thead><tr><th>Particulars</th><th>Gram</th><th>Total Value</th><th>Amount</th></tr></thead><tbody>{bill.items.map((item, index) => <tr key={index}><td>{item.particulars}</td><td>{item.grams}</td><td>{formatINR(item.assessedValue)}</td><td>{formatINR(item.loanAmount)}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>Total</th><th>{formatINR(bill.totalAssessedValue)}</th><th>{formatINR(bill.totalLoanAmount)}</th></tr></tfoot></table>
      <p className="words"><b>Amount in words:</b> {bill.amountInWords}</p><footer><div>Business Signature</div><div>Customer Signature</div></footer>
    </article>
  </section></div>;
}
