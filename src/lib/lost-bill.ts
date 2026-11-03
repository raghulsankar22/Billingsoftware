import { deliveryBillHistory } from "./delivery-history";
import type { Bill } from "./types";

/** The owner's own words, printed on every lost bill declaration. */
export const lostBillTamilStatement = "சீட்டு தொலைந்துவிட்டதால், சீட்டைக் கொடுக்காமல் நகையைப் பெற்றுக் கொண்டேன்.";

/** Delivered bills where the customer had lost the bill, newest delivery first. */
export function lostBillDeliveries(bills: Bill[], search = ""): Bill[] {
  return deliveryBillHistory(bills, search).filter(bill => bill.deliveryBillReceiptStatus === "lost_bill");
}

/** Shows only the last four characters of an Aadhaar or other ID on paper. */
export function maskedId(value?: string): string {
  const compact = (value ?? "").replace(/\s+/g, "");
  if (!compact) return "";
  return compact.length <= 4 ? compact : `${"X".repeat(Math.min(compact.length - 4, 8))}${compact.slice(-4)}`;
}

/** One declaration page per customer; bills for the same person share a page. */
export function declarationGroups(bills: Bill[]): Bill[][] {
  const groups = new Map<string, Bill[]>();
  for (const bill of bills) {
    const key = bill.customerId || `${bill.customerName.trim().toLocaleLowerCase()}|${bill.phone.trim()}`;
    groups.set(key, [...(groups.get(key) ?? []), bill]);
  }
  return [...groups.values()];
}
