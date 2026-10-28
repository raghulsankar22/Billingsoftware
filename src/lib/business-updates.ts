import { deliveryBillHistory, deliveryCollection } from "./delivery-history";
import type { Bill } from "./types";

export type UpdatePeriod = "daily" | "weekly" | "monthly";
export type PeriodRange = { from: string; to: string };

export function billingToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function billingPeriod(period: UpdatePeriod, anchor: string): PeriodRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) throw new Error("Choose a valid date.");
  const date = new Date(`${anchor}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== anchor) throw new Error("Choose a valid date.");
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  if (period === "daily") return { from: anchor, to: anchor };
  if (period === "weekly") {
    const monday = new Date(date);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    return { from: iso(monday), to: iso(sunday) };
  }
  const end = new Date(date);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { from: `${anchor.slice(0, 7)}-01`, to: iso(end) };
}

export function businessUpdates(bills: Bill[], range: PeriodRange) {
  const within = (date?: string) => Boolean(date && date >= range.from && date <= range.to);
  const loans = bills.filter(bill => bill.status !== "void" && within(bill.billDate)).sort((first, second) => second.billDate.localeCompare(first.billDate) || second.billNumber - first.billNumber);
  const deliveries = deliveryBillHistory(bills).filter(bill => within(bill.deliveryDate)).map(bill => ({ bill, collection: deliveryCollection(bill) }));
  // Sum integer paise to avoid accumulating floating-point rounding errors.
  const sum = (values: number[]) => values.reduce((total, value) => total + Math.round(value * 100), 0) / 100;
  return {
    loans,
    deliveries,
    loanAmount: sum(loans.map(bill => bill.totalLoanAmount)),
    deliveryPrincipal: sum(deliveries.map(({ bill, collection }) => collection?.principal ?? bill.totalLoanAmount)),
    deliveryInterest: sum(deliveries.flatMap(({ collection }) => collection?.interest == null ? [] : [collection.interest])),
    deliveryTotal: sum(deliveries.flatMap(({ collection }) => collection?.total == null ? [] : [collection.total])),
    incompleteDeliveries: deliveries.filter(({ collection }) => collection?.interest == null || collection.total == null).length,
  };
}
