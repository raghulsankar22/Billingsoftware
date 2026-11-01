import type { Bill } from "./types";

/** Historical records may have only one of the two delivery identifiers. */
export function isDelivered(bill: Pick<Bill, "deliveryNo" | "deliveryDate" | "historicalDelivery">) {
  return bill.historicalDelivery === true || Boolean(bill.deliveryNo?.trim() && bill.deliveryDate?.trim());
}
