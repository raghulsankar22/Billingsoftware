import { describe, expect, it } from "vitest";
import { accountSlot } from "./accounts";

describe("business account selection", () => {
  it("keeps old links on account 1 and selects all three permanent slots", () => {
    expect(accountSlot(new Request("https://billing.test/api/bills"))).toBe(1);
    for (const slot of [1, 2, 3]) {
      expect(accountSlot(new Request(`https://billing.test/api/bills?account=${slot}`))).toBe(slot);
    }
  });
  it("rejects malformed or out-of-range account selectors", () => {
    for (const value of ["0", "4", "-1", "1.5", "01", "", "owner", "1,2"]) {
      expect(() => accountSlot(new Request(`https://billing.test/api/bills?account=${encodeURIComponent(value)}`))).toThrow("Choose account");
    }
  });
});
