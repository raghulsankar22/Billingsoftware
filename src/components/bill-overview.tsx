"use client";

import { useMemo, useState } from "react";
import { calculateRepayment } from "@/lib/interest";
import { formatINR } from "@/lib/money";
import type { Bill } from "@/lib/types";

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function BillOverview({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const [returnDate, setReturnDate] = useState(() => {
    if (bill.deliveryNo && bill.deliveryDate) return bill.deliveryDate;
    const current = today();
    return current < bill.billDate ? bill.billDate : current;
  });
  const result = useMemo(() => {
    if (bill.historicalDelivery && !bill.deliverySummary) return { repayment: null, error: "This historical bill was delivered. The interest actually collected was not recorded in the Excel file." };
    try { return { repayment: calculateRepayment(bill.items, bill.billDate, returnDate), error: "" }; }
    catch (error) { return { repayment: null, error: error instanceof Error ? error.message : "Unable to calculate interest." }; }
  }, [bill, returnDate]);

  return <div className="modal-backdrop" role="presentation">
    <section className="overview-modal" role="dialog" aria-modal="true" aria-labelledby="overview-title">
      <div className="overview-heading"><div><p className="eyebrow">BILL #{bill.billNumber}</p><h2 id="overview-title">Repayment overview</h2><p>{bill.customerName} · Bill date {bill.billDate}</p></div><button className="secondary" onClick={onClose}>Close</button></div>
      {bill.status === "void" && <p className="overview-warning">This bill was voided. The figures below are for reference only, not an active amount due.</p>}
      <label className="overview-date">Return date<input type="date" min={bill.billDate} value={returnDate} onChange={(event) => setReturnDate(event.target.value)} /></label>
      {result.error && <p className="error" role="alert">{result.error}</p>}
      {result.repayment && <>
        <p className="overview-method">{result.repayment.chargedMonths} additional interest month{result.repayment.chargedMonths === 1 ? "" : "s"} charged. Interest is charged on the day after each monthly anniversary. Combined Gold loan over ₹5,000: 2%; Gold up to ₹5,000: 2.5%; Silver: 3% at any amount.</p>
        {result.repayment.missingMetal && <p className="overview-warning">One or more older items have no Gold/Silver selection. {bill.status === "issued" ? "Choose a metal by editing the bill before using this total." : "This voided bill cannot be recalculated accurately."}</p>}
        <div className="item-table-wrap"><table className="overview-table"><thead><tr><th>Item</th><th>Metal</th><th>Principal</th><th>Monthly rate</th><th>Extra interest</th><th>To repay</th></tr></thead><tbody>{result.repayment.lines.map((line, index) => <tr key={index}><td>{line.particulars}</td><td>{line.metal ?? "Not set"}</td><td>{formatINR(line.principal)}</td><td>{line.ratePercent === null ? "—" : `${line.ratePercent}%`}</td><td>{line.interest === null ? "—" : formatINR(line.interest)}</td><td>{line.total === null ? "—" : formatINR(line.total)}</td></tr>)}</tbody></table></div>
        <div className="overview-totals"><div><span>Principal to repay</span><strong>{formatINR(result.repayment.principal)}</strong></div><div><span>Additional interest</span><strong>{result.repayment.interest === null ? "—" : formatINR(result.repayment.interest)}</strong></div><div className="overview-grand"><span>Total to repay</span><strong>{result.repayment.total === null ? "—" : formatINR(result.repayment.total)}</strong></div></div>
      </>}
    </section>
  </div>;
}
