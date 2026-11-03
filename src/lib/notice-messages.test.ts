import { describe, expect, it } from "vitest";
import { noticeLastDate, noticeLetterGroups, noticeMessages } from "./notice-messages";

const business = { business_name: "Sample Finance" };
const bill = (billNumber: number, billDate: string, customerName = "Kumar Raman") => ({ billNumber, billDate, customerName });

describe("notice messages", () => {
  it("gives customers 20 days, across month and year ends", () => {
    expect(noticeLastDate("2026-11-02")).toBe("2026-11-22");
    expect(noticeLastDate("2026-12-20")).toBe("2027-01-09");
    expect(noticeLastDate("2028-02-15")).toBe("2028-03-06");
    expect(() => noticeLastDate("not a date")).toThrow();
  });
  it("uses the approved Notice 1 wording", () => {
    expect(noticeMessages([bill(4, "2025-11-05")], 1, business, "2026-11-22")).toEqual({
      english: "Dear Kumar Raman, your jewellery pledged at Sample Finance under Bill No. 4 dated 05/11/2025 has completed one year. Kindly come soon, pay the amount and take back your jewellery. – Sample Finance",
      tamil: "அன்புள்ள Kumar Raman, 05/11/2025 அன்று Sample Finance-ல் சீட்டு எண் 4 மூலம் அடகு வைத்த உங்கள் நகை ஒரு வருடம் நிறைவடைந்துவிட்டது. தயவுசெய்து விரைவில் வந்து தொகையைச் செலுத்தி உங்கள் நகையைத் திரும்பப் பெற்றுக் கொள்ளவும். – Sample Finance",
    });
  });
  it("uses the approved Notice 2 wording with the last date", () => {
    expect(noticeMessages([bill(4, "2025-10-05")], 2, business, "2026-11-22")).toEqual({
      english: "Dear Kumar Raman, this is the second and final notice. Your jewellery pledged at Sample Finance under Bill No. 4 dated 05/10/2025 has passed one year and one month. If it is not taken back by 22/11/2026, it will be sent for auction as per rules. Kindly come soon, pay the amount and take back your jewellery. – Sample Finance",
      tamil: "அன்புள்ள Kumar Raman, இது இரண்டாவது மற்றும் இறுதி அறிவிப்பு. 05/10/2025 அன்று Sample Finance-ல் சீட்டு எண் 4 மூலம் அடகு வைத்த உங்கள் நகை ஒரு வருடம் ஒரு மாதம் கடந்துவிட்டது. 22/11/2026-க்குள் நகையைத் திரும்பப் பெறாவிட்டால், விதிகளின்படி ஏலத்திற்கு அனுப்பப்படும். தயவுசெய்து விரைவில் வந்து தொகையைச் செலுத்தி நகையைப் பெற்றுக் கொள்ளவும். – Sample Finance",
    });
  });
  it("lists every bill when one customer has several", () => {
    const message = noticeMessages([bill(4, "2025-11-05"), bill(9, "2025-11-20")], 1, business, "2026-11-22");
    expect(message.english).toContain("under Bill No. 4 dated 05/11/2025 and Bill No. 9 dated 20/11/2025 has completed one year");
    expect(message.tamil).toContain("Sample Finance-ல் சீட்டு எண் 4 (05/11/2025), சீட்டு எண் 9 (20/11/2025) மூலம்");
  });
  it("puts each customer's bills on one letter", () => {
    const rows = [
      { id: "a", customerId: "c1", customerName: "Kumar", phone: "1" },
      { id: "b", customerName: "Selvi", phone: "2" },
      { id: "c", customerId: "c1", customerName: "Kumar", phone: "1" },
    ];
    expect(noticeLetterGroups(rows).map(group => group.map(row => row.id))).toEqual([["a", "c"], ["b"]]);
  });
});
