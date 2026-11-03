import type { NoticeStage } from "./notices";
import type { Bill } from "./types";

export const noticeGraceDays = 20;

export type NoticeBusiness = { business_name: string };
type NoticeBill = Pick<Bill, "billNumber" | "billDate" | "customerName">;

export const displayDate = (value: string) => value.split("-").reverse().join("/");

export function noticeLastDate(today: string): string {
  const date = new Date(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) throw new Error("Choose a valid date.");
  date.setUTCDate(date.getUTCDate() + noticeGraceDays);
  return date.toISOString().slice(0, 10);
}

export function noticeMessages(bills: readonly NoticeBill[], stage: NoticeStage, business: NoticeBusiness, lastDate: string) {
  if (!bills.length) throw new Error("Choose at least one bill.");
  const name = bills[0].customerName;
  const shop = business.business_name.trim();
  const single = bills.length === 1;
  const englishBills = single
    ? `Bill No. ${bills[0].billNumber} dated ${displayDate(bills[0].billDate)}`
    : bills.map(bill => `Bill No. ${bill.billNumber} dated ${displayDate(bill.billDate)}`).join(" and ");
  const tamilBills = single
    ? `${displayDate(bills[0].billDate)} அன்று ${shop}-ல் சீட்டு எண் ${bills[0].billNumber} மூலம்`
    : `${shop}-ல் ${bills.map(bill => `சீட்டு எண் ${bill.billNumber} (${displayDate(bill.billDate)})`).join(", ")} மூலம்`;
  const last = displayDate(lastDate);
  if (stage === 1) return {
    english: `Dear ${name}, your jewellery pledged at ${shop} under ${englishBills} has completed one year. Kindly come soon, pay the amount and take back your jewellery. – ${shop}`,
    tamil: `அன்புள்ள ${name}, ${tamilBills} அடகு வைத்த உங்கள் நகை ஒரு வருடம் நிறைவடைந்துவிட்டது. தயவுசெய்து விரைவில் வந்து தொகையைச் செலுத்தி உங்கள் நகையைத் திரும்பப் பெற்றுக் கொள்ளவும். – ${shop}`,
  };
  return {
    english: `Dear ${name}, this is the second and final notice. Your jewellery pledged at ${shop} under ${englishBills} has passed one year and one month. If it is not taken back by ${last}, it will be sent for auction as per rules. Kindly come soon, pay the amount and take back your jewellery. – ${shop}`,
    tamil: `அன்புள்ள ${name}, இது இரண்டாவது மற்றும் இறுதி அறிவிப்பு. ${tamilBills} அடகு வைத்த உங்கள் நகை ஒரு வருடம் ஒரு மாதம் கடந்துவிட்டது. ${last}-க்குள் நகையைத் திரும்பப் பெறாவிட்டால், விதிகளின்படி ஏலத்திற்கு அனுப்பப்படும். தயவுசெய்து விரைவில் வந்து தொகையைச் செலுத்தி நகையைப் பெற்றுக் கொள்ளவும். – ${shop}`,
  };
}

export function noticeLetterGroups<T extends Pick<Bill, "id" | "customerId" | "customerName" | "phone">>(bills: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const bill of bills) {
    const key = bill.customerId || `${bill.customerName.trim().toLocaleLowerCase()}|${bill.phone.trim()}`;
    groups.set(key, [...(groups.get(key) ?? []), bill]);
  }
  return [...groups.values()];
}
