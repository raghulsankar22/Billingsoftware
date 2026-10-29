import { describe, expect, it } from "vitest";
import { accountSlots, isAccountSlot, withAccountSlot } from "./account-url";

describe("withAccountSlot", () => {
  it("adds the selected account to a path", () => {
    expect(withAccountSlot("/api/profile", 2)).toBe("/api/profile?account=2");
  });

  it("preserves search filters and replaces an earlier account", () => {
    expect(withAccountSlot("/api/bills?q=Ravi&account=1", 3)).toBe("/api/bills?q=Ravi&account=3");
  });

  it("preserves a hash fragment", () => {
    expect(withAccountSlot("/api/reports/excel?year=2026#download", 1)).toBe("/api/reports/excel?year=2026&account=1#download");
  });

  it("selects added accounts and rejects invalid IDs", () => {
    expect(withAccountSlot("/api/bills?q=Ravi", 4)).toBe("/api/bills?q=Ravi&account=4");
    expect(withAccountSlot("/api/profile", 5)).toBe("/api/profile?account=5");
    for (const value of [0, -1, 1.5, NaN, Infinity, 2_147_483_647]) {
      expect(() => withAccountSlot("/api/profile", value)).toThrow("Choose a valid business account");
    }
  });
});

describe("business account IDs", () => {
  it("requires bounded positive integers", () => {
    for (const value of [1, 4, 5, 2_147_483_646]) expect(isAccountSlot(value)).toBe(true);
    for (const value of [undefined, null, "4", true, [], {}, 0, -1, 1.1, Infinity, NaN, 2_147_483_647]) expect(isAccountSlot(value)).toBe(false);
  });

  it("keeps unset original slots and appends sorted unique saved extra accounts", () => {
    expect(accountSlots([])).toEqual([1, 2, 3]);
    expect(accountSlots([{ account_slot: 5 }, { account_slot: 2 }, { account_slot: 4 }, { account_slot: 5 }, { account_slot: 0 }, { account_slot: "6" }])).toEqual([1, 2, 3, 4, 5]);
  });
});
