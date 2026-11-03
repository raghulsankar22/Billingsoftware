"use client";

import { useLanguage } from "./language-provider";
import { formatParticulars } from "@/lib/jewellery";

import { useMemo } from "react";
import type { Bill } from "@/lib/types";
import { jewelStock } from "@/lib/jewel-stock";
import { formatINR } from "@/lib/money";

const grams = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);

export function JewelInventory({ bills, metal, busy, error, onBill }: { bills: Bill[]; metal?: "Gold" | "Silver"; busy: boolean; error: string; onBill: (bill: Bill) => void }) {
  const { t } = useLanguage();
  const stock = useMemo(() => jewelStock(bills, metal), [bills, metal]);
  const gold = useMemo(() => jewelStock(bills, "Gold"), [bills]);
  const silver = useMemo(() => jewelStock(bills, "Silver"), [bills]);
  const title = metal ? `${t(metal)} ${t("jewellery")}` : "All jewellery";
  const pieces = stock.unknownQuantityRows ? stock.knownPieces ? `${stock.knownPieces}+` : "Not recorded" : String(stock.knownPieces);
  const missingWeights = stock.lines.filter(line => line.item.grams === null).length;

  if (error) return <p className="error" role="alert">{t(error)}</p>;
  if (busy) return <p className="muted" role="status">{t("Loading jewellery stock…")}</p>;
  return <>
    <p className="stock-scope">{t(title)} {t("· Undelivered loans · All dates")}</p>
    <div className="updates-summary stock-summary" aria-label={`${t(metal ?? "All jewellery")} ${t("stock totals")}`}>
      <div><span>{metal ? `${t(metal)} ${t("Loan amount")}` : t("Loan amount in stock")}</span><strong>{formatINR(stock.loanAmount)}</strong></div>
      {!metal && <><div><span>{t("Gold loan amount")}</span><strong>{formatINR(gold.loanAmount)}</strong></div><div><span>{t("Silver loan amount")}</span><strong>{formatINR(silver.loanAmount)}</strong></div></>}
      <div><span>{t("Total jewel stock (pieces)")}</span><strong>{t(pieces)}</strong><small>{stock.pledgeRows} {t("pledge lots")}{stock.unknownQuantityRows ? ` · ${stock.unknownQuantityRows} with incomplete quantities` : ""}</small></div>
      <div><span>{t("Total weight")}</span><strong>{grams(stock.grams)} {t("g")}</strong></div>
      <div><span>{t("Undelivered loan bills")}</span><strong>{stock.billCount}</strong></div>
    </div>
    {stock.unknownQuantityRows > 0 && <p className="overview-warning">{stock.unknownQuantityRows} {t("pledge")} {stock.unknownQuantityRows === 1 ? t("row has") : t("rows have")} {t("no complete quantity recorded. The piece total includes only rows with quantities such as “Ring 2, Studs 1”. Weight includes only recorded weights.")}</p>}
    {stock.unknownMetalRows > 0 && <p className="overview-warning">{stock.unknownMetalRows} {t("undelivered pledge")} {stock.unknownMetalRows === 1 ? t("row has") : t("rows have")} {t("no metal recorded. These appear under Jewels and are excluded from Gold and Silver totals.")}</p>}
    {missingWeights > 0 && <p className="overview-warning">{missingWeights} {t("imported pledge")} {missingWeights === 1 ? t("row has") : t("rows have")} {t("no weight recorded. Total weight includes only known weights.")}</p>}
    <div className="item-table-wrap"><table className="history-table"><thead><tr><th>{t("Bill")}</th><th>{t("Customer")}</th><th>{t("Metal")}</th><th>{t("Particulars")}</th><th>{t("Pieces")}</th><th>{t("Gram")}</th><th>{t("Loan amount")}</th><th /></tr></thead><tbody>
      {stock.lines.length ? stock.lines.map(line => <tr key={`${line.bill.id}-${line.index}`}><td><b>#{line.bill.billNumber}</b><small>{line.bill.billDate.split("-").reverse().join("/")}</small>{line.bill.status === "void" && <small>{t("Voided · Not delivered")}</small>}</td><td><b>{line.bill.customerName}</b>{line.bill.customerCode && <small>{line.bill.customerCode}</small>}{line.bill.phone && <small>{line.bill.phone}</small>}</td><td>{t(line.item.metal ?? "Not recorded")}</td><td>{formatParticulars(line.item.particulars)}</td><td>{line.quantity ?? t("Not recorded")}</td><td>{line.item.grams === null ? t("Not recorded") : grams(line.item.grams)}</td><td>{formatINR(line.item.loanAmount)}</td><td><button type="button" className="text-button" onClick={() => onBill(line.bill)}>{t("Open bill")}</button></td></tr>) : <tr><td colSpan={8} className="empty">{metal ? t(`No undelivered ${metal.toLowerCase()} jewellery.`) : t("No undelivered jewellery stock.")}</td></tr>}
    </tbody></table></div>
    <p className="muted collection-note">{t("Stock remains here until delivery is recorded. Each metal's amount and known weight are taken from its pledge rows; date filters in Activity do not limit this stock list.")}</p>
  </>;
}
