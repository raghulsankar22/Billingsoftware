import { describe, expect, it } from "vitest";
import { assertOwnerEmail } from "./auth";

describe("owner-only access", () => {
  it("rejects unconfigured owner access", () => {
    expect(() => assertOwnerEmail("owner@example.com", undefined)).toThrow("not configured");
  });
  it("rejects a different signed-in email", () => {
    expect(() => assertOwnerEmail("other@example.com", "owner@example.com")).toThrow("not authorized");
  });
  it("accepts the configured owner without case sensitivity", () => {
    expect(() => assertOwnerEmail("Owner@Example.com", " owner@example.com ")).not.toThrow();
  });
});
