import type { Bill } from "./types";

/** Historical records may have only one of the two delivery identifiers. */
/** Above this, a value is almost certainly a phone number or date typed into the wrong column. */
export const maxSequenceDeliveryNumber = 9_999_999;

/** The delivery number to count when choosing the next one, or null if it should not affect numbering. */
export function sequenceDeliveryNumber(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number <= maxSequenceDeliveryNumber ? number : null;
}

export function isDelivered(bill: Pick<Bill, "deliveryNo" | "deliveryDate" | "historicalDelivery">) {
  return bill.historicalDelivery === true || Boolean(bill.deliveryNo?.trim() && bill.deliveryDate?.trim());
}
