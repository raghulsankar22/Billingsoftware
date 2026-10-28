import { calculateRepayment } from "./interest";
import type { Bill, RepaymentSummary } from "./types";

export function deliveryBillHistory(bills: Bill[], search = ""): Bill[] {
  const query = search.trim().toLocaleLowerCase().replace(/^#/, "");
  return bills.filter(bill => {
    if (!bill.deliveryNo?.trim() || !bill.deliveryDate) return false;
    if (!query) return true;
    const [year, month, day] = bill.deliveryDate.split("-");
    return [bill.deliveryNo, String(bill.billNumber), bill.deliveryDate, `${day}/${month}/${year}`, `${day}-${month}-${year}`, bill.customerName, bill.phone, ...bill.items.map(item => item.particulars)]
      .some(value => value?.toLocaleLowerCase().includes(query));
  }).sort((first, second) => second.deliveryNo!.localeCompare(first.deliveryNo!, "en", { numeric: true }) || second.deliveryDate!.localeCompare(first.deliveryDate!) || second.billNumber - first.billNumber);
}

export function deliveryCollection(bill: Bill): RepaymentSummary | null {
  if (bill.deliverySummary) return bill.deliverySummary;
  if (!bill.deliveryDate) return null;
  try { return calculateRepayment(bill.items, bill.billDate, bill.deliveryDate); }
  catch { return null; }
}
