import { afterEach, describe, expect, it, vi } from "vitest";
import { accountSlot } from "./accounts";

const mode = vi.hoisted(() => ({ local: true }));
vi.mock("./storage-mode", () => ({ get localStorageEnabled() { return mode.local; } }));
afterEach(() => { mode.local = true; vi.unstubAllEnvs(); });

describe("business account selection", () => {
  it("keeps old links on account 1 and selects original and added local accounts", () => {
    expect(accountSlot(new Request("https://billing.test/api/bills"))).toBe(1);
    for (const slot of [1, 2, 3, 4, 5, 2_147_483_646]) {
      expect(accountSlot(new Request(`https://billing.test/api/bills?account=${slot}`))).toBe(slot);
    }
  });
  it("rejects malformed or out-of-range account selectors", () => {
    for (const value of ["0", "2147483647", "9007199254740993", "-1", "1.5", "01", "", "owner", "1,2", "1e2", " 4 ", "Infinity"]) {
      expect(() => accountSlot(new Request(`https://billing.test/api/bills?account=${encodeURIComponent(value)}`))).toThrow("Choose a valid business account");
    }
  });

  it("keeps the existing three-account constraint in cloud mode", () => {
    mode.local = false;
    expect(accountSlot(new Request("https://billing.test/api/bills?account=3"))).toBe(3);
    expect(() => accountSlot(new Request("https://billing.test/api/bills?account=4"))).toThrow("Choose a valid business account");
  });
  it("accepts added cloud accounts only when the new cloud mode is enabled", () => {
    mode.local = false; vi.stubEnv("BILLING_CLOUD_MULTIUSER", "1");
    expect(accountSlot(new Request("https://billing.test/api/bills?account=4"))).toBe(4);
  });
});
