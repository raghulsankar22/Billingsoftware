"use client";

import { useMemo } from "react";
import type { Bill } from "@/lib/types";
import { jewelStock } from "@/lib/jewel-stock";
import { formatINR } from "@/lib/money";

const grams = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);

export function JewelInventory({ bills, metal, busy, error, onBill }: { bills: Bill[]; metal?: "Gold" | "Silver"; busy: boolean; error: string; onBill: (bill: Bill) => void }) {
  const stock = useMemo(() => jewelStock(bills, metal), [bills, metal]);
  const gold = useMemo(() => jewelStock(bills, "Gold"), [bills]);
  const silver = useMemo(() => jewelStock(bills, "Silver"), [bills]);
  const title = metal ? `${metal} jewellery` : "All jewellery";
  const pieces = stock.unknownQuantityRows ? stock.knownPieces ? `${stock.knownPieces}+` : "Not recorded" : String(stock.knownPieces);
  const missingWeights = stock.lines.filter(line => line.item.grams === null).length;

  if (error) return <p className="error" role="alert">{error}</p>;
  if (busy) return <p className="muted" role="status">Loading jewellery stock…</p>;
  return <>
    <p className="stock-scope">{title} · Undelivered loans · All dates</p>
    <div className="updates-summary stock-summary" aria-label={`${metal ?? "All jewellery"} stock totals`}>
      <div><span>{metal ? `${metal} loan amount` : "Loan amount in stock"}</span><strong>{formatINR(stock.loanAmount)}</strong></div>
      {!metal && <><div><span>Gold loan amount</span><strong>{formatINR(gold.loanAmount)}</strong></div><div><span>Silver loan amount</span><strong>{formatINR(silver.loanAmount)}</strong></div></>}
      <div><span>Total jewel stock (pieces)</span><strong>{pieces}</strong><small>{stock.pledgeRows} pledge lots{stock.unknownQuantityRows ? ` · ${stock.unknownQuantityRows} with incomplete quantities` : ""}</small></div>
      <div><span>Total weight</span><strong>{grams(stock.grams)} g</strong></div>
      <div><span>Undelivered loan bills</span><strong>{stock.billCount}</strong></div>
    </div>
    {stock.unknownQuantityRows > 0 && <p className="overview-warning">{stock.unknownQuantityRows} pledge {stock.unknownQuantityRows === 1 ? "row has" : "rows have"} no complete quantity recorded. The piece total includes only rows with quantities such as “Ring 2, Studs 1”. Weight includes only recorded weights.</p>}
    {stock.unknownMetalRows > 0 && <p className="overview-warning">{stock.unknownMetalRows} undelivered pledge {stock.unknownMetalRows === 1 ? "row has" : "rows have"} no metal recorded. These appear under Jewels and are excluded from Gold and Silver totals.</p>}
    {missingWeights > 0 && <p className="overview-warning">{missingWeights} imported pledge {missingWeights === 1 ? "row has" : "rows have"} no weight recorded. Total weight includes only known weights.</p>}
    <div className="item-table-wrap"><table className="history-table"><thead><tr><th>Bill</th><th>Customer</th><th>Metal</th><th>Particulars</th><th>Pieces</th><th>Gram</th><th>Loan amount</th><th /></tr></thead><tbody>
      {stock.lines.length ? stock.lines.map(line => <tr key={`${line.bill.id}-${line.index}`}><td><b>#{line.bill.billNumber}</b><small>{line.bill.billDate.split("-").reverse().join("/")}</small>{line.bill.status === "void" && <small>Voided · Not delivered</small>}</td><td><b>{line.bill.customerName}</b>{line.bill.customerCode && <small>{line.bill.customerCode}</small>}{line.bill.phone && <small>{line.bill.phone}</small>}</td><td>{line.item.metal ?? "Not recorded"}</td><td>{line.item.particulars}</td><td>{line.quantity ?? "Not recorded"}</td><td>{line.item.grams === null ? "Not recorded" : grams(line.item.grams)}</td><td>{formatINR(line.item.loanAmount)}</td><td><button type="button" className="text-button" onClick={() => onBill(line.bill)}>Open bill</button></td></tr>) : <tr><td colSpan={8} className="empty">{metal ? `No undelivered ${metal.toLowerCase()} jewellery.` : "No undelivered jewellery stock."}</td></tr>}
    </tbody></table></div>
    <p className="muted collection-note">Stock remains here until delivery is recorded. Each metal&apos;s amount and known weight are taken from its pledge rows; date filters in Activity do not limit this stock list.</p>
  </>;
}
