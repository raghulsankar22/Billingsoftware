"use client";

import { useLanguage } from "./language-provider";
import { formatINR } from "@/lib/money";
import type { RepaymentSummary } from "@/lib/types";

export function RepaymentDetails({ repayment, forceEnglish = false }: { repayment: RepaymentSummary; forceEnglish?: boolean }) {
  const { t: interfaceText } = useLanguage();
  const t = forceEnglish ? (text: string) => text : interfaceText;
  const money = (value: number | null) => value === null ? "—" : formatINR(value);
  return <section className="repayment-summary" aria-label={t("Delivery collection amounts")}>
    <h3>{t("Amount to collect")}</h3>
    <p className="muted">{repayment.chargedMonths} {t("additional interest month")}{repayment.chargedMonths === 1 ? "" : t("s")}. {[...new Set(repayment.lines.filter(item => item.ratePercent !== null).map(item => `${t(item.metal ?? "Not recorded")}: ${item.ratePercent}% ${t("monthly")}`))].join(" · ")}</p>
    {repayment.missingMetal && <p className="overview-warning">{t("Select Gold or Silver for each item to calculate the interest.")}</p>}
    <dl><div><dt>{t("Principal")}</dt><dd>{money(repayment.principal)}</dd></div><div><dt>{t("Interest to collect now")}</dt><dd>{money(repayment.interest)}</dd></div><div className="collection-total"><dt>{t("Total to collect now")}</dt><dd>{money(repayment.total)}</dd></div></dl>
  </section>;
}
