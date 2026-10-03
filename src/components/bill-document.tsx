"use client";

import { jsPDF } from "jspdf";
import { amountInWords, formatINR } from "@/lib/money";
import type { Bill } from "@/lib/types";

type Profile = { business_name: string; address: string; phone: string; logo_url?: string };
export function BillDocument({ bill, profile, onClose }: { bill: Bill; profile: Profile; onClose: () => void }) {
  function downloadPdf() {
    const pdf = new jsPDF({ unit: "mm", format: "a4" }); let y = 18;
    pdf.setFontSize(18); pdf.text(profile.business_name, 105, y, { align: "center" }); y += 7;
    pdf.setFontSize(10); pdf.text(profile.address, 105, y, { align: "center", maxWidth: 165 }); y += 6; pdf.text(`Phone: ${profile.phone}`, 105, y, { align: "center" }); y += 12;
    pdf.setFontSize(14); pdf.text("FINANCE BILL", 105, y, { align: "center" }); y += 9;
    pdf.setFontSize(10); pdf.text(`Bill No.: ${bill.billNumber}`, 15, y); pdf.text(`Date: ${bill.billDate}`, 150, y); y += 7;
    if (bill.deliveryNo || bill.deliveryDate) { pdf.text(`Delivery No.: ${bill.deliveryNo || "—"}     Delivery Date: ${bill.deliveryDate || "—"}`, 15, y); y += 7; }
    pdf.text(`Name: ${bill.customerName}`, 15, y); pdf.text(`Father's Name: ${bill.fatherName}`, 112, y); y += 7; pdf.text(`Address: ${bill.address}`, 15, y, { maxWidth: 175 }); y += 10; pdf.text(`Phone: ${bill.phone}${bill.governmentId ? `     ID: ${bill.governmentId}` : ""}`, 15, y); y += 9;
    pdf.setFillColor(235, 239, 245); pdf.rect(15, y, 180, 8, "F"); pdf.setFont("helvetica", "bold"); pdf.text("Particulars", 18, y + 5); pdf.text("Gram", 107, y + 5); pdf.text("Total Value", 130, y + 5); pdf.text("Amount", 170, y + 5); y += 8; pdf.setFont("helvetica", "normal");
    for (const item of bill.items) { pdf.text(item.particulars, 18, y + 6, { maxWidth: 84 }); pdf.text(String(item.grams), 107, y + 6); pdf.text(formatINR(item.assessedValue), 130, y + 6); pdf.text(formatINR(item.loanAmount), 170, y + 6); y += 9; }
    pdf.setFont("helvetica", "bold"); pdf.text(`Total assessed value: ${formatINR(bill.totalAssessedValue)}`, 15, y + 8); pdf.text(`Loan amount: ${formatINR(bill.totalLoanAmount)}`, 125, y + 8); y += 18; pdf.setFont("helvetica", "normal"); pdf.text(`Amount in words: ${amountInWords(bill.totalLoanAmount)}`, 15, y, { maxWidth: 175 }); y += 38;
    pdf.line(20, y, 78, y); pdf.line(132, y, 190, y); pdf.text("Business Signature", 32, y + 6); pdf.text("Customer Signature", 143, y + 6); pdf.save(`Bill-${bill.billNumber}.pdf`);
  }
  return <div className="modal-backdrop"><section className="bill-modal"><div className="modal-actions"><button className="secondary" onClick={onClose}>Close</button><button className="secondary" onClick={() => window.print()}>Print</button><button onClick={downloadPdf}>Download PDF</button></div><article className="print-bill"><header><h1>{profile.business_name}</h1><p>{profile.address} · {profile.phone}</p><h2>FINANCE BILL</h2></header><div className="bill-meta"><span>Bill No. <b>{bill.billNumber}</b></span><span>Date <b>{bill.billDate}</b></span></div>{(bill.deliveryNo || bill.deliveryDate) && <p>Delivery No. {bill.deliveryNo || "—"} &nbsp; Delivery Date {bill.deliveryDate || "—"}</p>}<section className="customer-box"><p><b>Name:</b> {bill.customerName}</p><p><b>Father&apos;s Name:</b> {bill.fatherName}</p><p><b>Address:</b> {bill.address}</p><p><b>Phone:</b> {bill.phone}{bill.governmentId && <> &nbsp; <b>ID:</b> {bill.governmentId}</>}</p></section><table className="print-table"><thead><tr><th>Particulars</th><th>Gram</th><th>Total Value</th><th>Amount</th></tr></thead><tbody>{bill.items.map((item, index) => <tr key={index}><td>{item.particulars}</td><td>{item.grams}</td><td>{formatINR(item.assessedValue)}</td><td>{formatINR(item.loanAmount)}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>Total</th><th>{formatINR(bill.totalAssessedValue)}</th><th>{formatINR(bill.totalLoanAmount)}</th></tr></tfoot></table><p className="words"><b>Amount in words:</b> {bill.amountInWords}</p><footer><div>Business Signature</div><div>Customer Signature</div></footer></article></section></div>;
}
