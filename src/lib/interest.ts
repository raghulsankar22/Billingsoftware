import type { BillItemInput, RepaymentSummary } from "./types";

function calendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose a valid return date.");
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error("Choose a valid return date.");
  return new Date(timestamp);
}

function monthlyAnniversary(start: Date, months: number): Date {
  const anniversary = new Date(start.getTime());
  anniversary.setUTCDate(1);
  anniversary.setUTCMonth(anniversary.getUTCMonth() + months);
  const monthEnd = new Date(anniversary.getTime());
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  monthEnd.setUTCDate(0);
  anniversary.setUTCDate(Math.min(start.getUTCDate(), monthEnd.getUTCDate()));
  return anniversary;
}

export function interestRateBasisPoints(item: BillItemInput, goldPrincipalPaise = Math.round(item.loanAmount * 100)): number | null {
  if (item.metal === "Silver") return 300;
  if (item.metal === "Gold") return goldPrincipalPaise > 500_000 ? 200 : 250;
  return null;
}

function interestPaise(principalPaise: number, rateBasisPoints: number, months: number): number {
  return Number((BigInt(principalPaise) * BigInt(rateBasisPoints) * BigInt(months) + 5_000n) / 10_000n);
}

export function calculateRepayment(items: BillItemInput[], billDate: string, returnDate: string): RepaymentSummary {
  const start = calendarDate(billDate);
  const end = calendarDate(returnDate);
  if (end.getTime() < start.getTime()) throw new Error("Return date cannot be before the bill date.");
  const monthsApart = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  const chargedMonths = monthsApart === 0 ? 0 : Math.max(0, monthsApart - 1 + Number(end.getTime() > monthlyAnniversary(start, monthsApart).getTime()));
  const goldPrincipalPaise = items.filter((item) => item.metal === "Gold").reduce((sum, item) => sum + Math.round(item.loanAmount * 100), 0);
  const lines = items.map((item) => {
    const rateBasisPoints = interestRateBasisPoints(item, goldPrincipalPaise);
    const principalPaise = Math.round(item.loanAmount * 100);
    const additionalInterestPaise = rateBasisPoints === null ? null : interestPaise(principalPaise, rateBasisPoints, chargedMonths);
    const firstMonthInterestPaise = rateBasisPoints === null ? null : interestPaise(principalPaise, rateBasisPoints, 1);
    return {
      metal: item.metal,
      particulars: item.particulars,
      principal: principalPaise / 100,
      ratePercent: rateBasisPoints === null ? null : rateBasisPoints / 100,
      initialInterest: firstMonthInterestPaise === null ? null : firstMonthInterestPaise / 100,
      interest: additionalInterestPaise === null ? null : additionalInterestPaise / 100,
      total: additionalInterestPaise === null ? null : (principalPaise + additionalInterestPaise) / 100,
    };
  });
  const principalPaise = lines.reduce((sum, line) => sum + Math.round(line.principal * 100), 0);
  const missingMetal = lines.some((line) => line.ratePercent === null);
  const initialInterestPaise = missingMetal ? null : lines.reduce((sum, line) => sum + Math.round((line.initialInterest ?? 0) * 100), 0);
  const totalAdditionalInterestPaise = missingMetal ? null : lines.reduce((sum, line) => sum + Math.round((line.interest ?? 0) * 100), 0);
  return {
    chargedMonths,
    lines,
    principal: principalPaise / 100,
    initialInterest: initialInterestPaise === null ? null : initialInterestPaise / 100,
    interest: totalAdditionalInterestPaise === null ? null : totalAdditionalInterestPaise / 100,
    total: totalAdditionalInterestPaise === null ? null : (principalPaise + totalAdditionalInterestPaise) / 100,
    missingMetal,
  };
}
