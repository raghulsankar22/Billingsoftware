import { describe, expect, it } from "vitest";
import { hashLocalPassword, validateLocalPassword, verifyLocalPassword } from "./local-password";

describe("local password protection", () => {
  it("uses a different salt for each password and verifies the correct password", async () => {
    const first = await hashLocalPassword("example secure password");
    const second = await hashLocalPassword("example secure password");
    expect(first).not.toEqual(second);
    expect(first).not.toContain("example secure password");
    expect(await verifyLocalPassword("example secure password", first)).toBe(true);
    expect(await verifyLocalPassword("different password", first)).toBe(false);
  });
  it("rejects malformed hashes and excessive or invalid passwords", async () => {
    for (const value of ["", "short", "x".repeat(257), null]) expect(() => validateLocalPassword(value)).toThrow();
    expect(await verifyLocalPassword("password", "invalid")).toBe(false);
    expect(await verifyLocalPassword("x".repeat(257), "invalid")).toBe(false);
    expect(await verifyLocalPassword(null, null)).toBe(false);
  });
});
