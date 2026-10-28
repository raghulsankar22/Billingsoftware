import { describe, expect, it } from "vitest";
import { withAccountSlot } from "./account-url";

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
});
