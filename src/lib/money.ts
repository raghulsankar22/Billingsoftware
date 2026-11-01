import type { BillItemInput } from "./types";

const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowThousand(value: number): string {
  const parts: string[] = [];
  if (value >= 100) parts.push(`${ones[Math.floor(value / 100)]} Hundred`);
  const remainder = value % 100;
  if (remainder >= 20) parts.push(`${tens[Math.floor(remainder / 10)]}${remainder % 10 ? ` ${ones[remainder % 10]}` : ""}`);
  else if (remainder) parts.push(ones[remainder]);
  return parts.join(" ");
}

export function amountInWords(value: number): string {
  const rounded = Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);
  if (rupees === 0 && paise === 0) return "Rupees Zero Only";
  const groups: Array<[number, string]> = [
    [10_000_000, "Crore"],
    [100_000, "Lakh"],
    [1_000, "Thousand"],
  ];
  let remaining = rupees;
  const parts: string[] = [];
  for (const [unit, name] of groups) {
    const count = Math.floor(remaining / unit);
    if (count) parts.push(`${belowThousand(count)} ${name}`);
    remaining %= unit;
  }
  if (remaining) parts.push(belowThousand(remaining));
  const suffix = paise ? ` and ${belowThousand(paise)} Paise` : "";
  return `Rupees ${parts.join(" ") || "Zero"}${suffix} Only`;
}

export const formatINR = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(value || 0);

export const excelINRFormat = '"₹" #,##0.00';

/** Loan plus ten percent, rounded to the nearest paise using whole-paise input. */
export function assessedValueForLoan(loan: number): number {
  if (!Number.isFinite(loan) || loan <= 0) return 0;
  const paise = Math.round(loan * 100);
  return Math.round(paise * 110 / 100) / 100;
}

export const notRecorded = "Not recorded";
export const recordedGrams = (value: number | null | undefined) => value == null ? notRecorded : String(value);
export const recordedINR = (value: number | null | undefined) => value == null ? notRecorded : formatINR(value);

export function itemSummary(items: BillItemInput[]): string {
  return items.map((item) => `${item.metal ? `${item.metal}: ` : ""}${item.particulars} (${item.grams == null ? "weight not recorded" : `${item.grams || 0} g`})${item.remarks?.trim() ? ` [Remarks: ${item.remarks.trim()}]` : ""}`).join(", ");
}
