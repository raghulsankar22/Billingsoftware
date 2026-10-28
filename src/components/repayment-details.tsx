import { formatINR } from "@/lib/money";
import type { RepaymentSummary } from "@/lib/types";

export function RepaymentDetails({ repayment }: { repayment: RepaymentSummary }) {
  const money = (value: number | null) => value === null ? "—" : formatINR(value);
  return <section className="repayment-summary" aria-label="Delivery collection amounts">
    <h3>Amount to collect</h3>
    <p className="muted">{repayment.chargedMonths} additional interest month{repayment.chargedMonths === 1 ? "" : "s"}. {[...new Set(repayment.lines.filter(item => item.ratePercent !== null).map(item => `${item.metal}: ${item.ratePercent}% monthly`))].join(" · ")}</p>
    {repayment.missingMetal && <p className="overview-warning">Select Gold or Silver for each item to calculate the interest.</p>}
    <dl><div><dt>Principal</dt><dd>{money(repayment.principal)}</dd></div><div><dt>First-month interest charged at issue</dt><dd>{money(repayment.initialInterest)}</dd></div><div><dt>Interest to collect now</dt><dd>{money(repayment.interest)}</dd></div><div className="collection-total"><dt>Total to collect now</dt><dd>{money(repayment.total)}</dd></div></dl>
    <p className="muted collection-note">The first month&apos;s interest is assumed collected when the loan was issued and is excluded from the total above.</p>
  </section>;
}
