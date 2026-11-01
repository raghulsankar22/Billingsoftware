import { calculateRepayment } from "./interest";
import type { Bill, RepaymentSummary } from "./types";
import { isDelivered } from "./delivery-status";

export function deliveryBillHistory(bills: Bill[], search = ""): Bill[] {
  const query = search.trim().toLocaleLowerCase().replace(/^#/, "");
  return bills.filter(bill => {
    if (!isDelivered(bill)) return false;
    if (!query) return true;
    const [year, month, day] = (bill.deliveryDate ?? "").split("-");
    return [bill.deliveryNo, String(bill.billNumber), bill.deliveryDate, `${day}/${month}/${year}`, `${day}-${month}-${year}`, bill.customerName, bill.phone, ...bill.items.map(item => item.particulars)]
      .some(value => value?.toLocaleLowerCase().includes(query));
  }).sort((first, second) => (second.deliveryNo ?? "").localeCompare(first.deliveryNo ?? "", "en", { numeric: true }) || (second.deliveryDate ?? "").localeCompare(first.deliveryDate ?? "") || second.billNumber - first.billNumber);
}

export function deliveryCollection(bill: Bill): RepaymentSummary | null {
  if (bill.deliverySummary) return bill.deliverySummary;
  // An old register does not prove what interest was actually collected.
  if (bill.historicalDelivery) return null;
  if (!bill.deliveryDate) return null;
  try { return calculateRepayment(bill.items, bill.billDate, bill.deliveryDate); }
  catch { return null; }
}
