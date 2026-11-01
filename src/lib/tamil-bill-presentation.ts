import { translate } from "./language";
import { suggestTamil } from "./tamil-transliteration";
import type { Bill, BusinessSnapshot } from "./types";

export function tamilBillText(value: string): string {
  const translated = translate("ta", value);
  return translated === value ? suggestTamil(value) : translated;
}

export function createTamilBillDraft(bill: Bill, business: BusinessSnapshot): Record<string, string> {
  const draft: Record<string, string> = {
    businessName: tamilBillText(business.business_name), businessAddress: tamilBillText(business.address),
    customerName: tamilBillText(bill.customerName), fatherName: tamilBillText(bill.fatherName), address: tamilBillText(bill.address),
    collector: tamilBillText(bill.deliveryCollectedByName ?? ""),
  };
  bill.items.forEach((item, index) => {
    draft["particulars-" + index] = tamilBillText(item.particulars);
    draft["remarks-" + index] = tamilBillText(item.remarks ?? "");
  });
  return draft;
}
