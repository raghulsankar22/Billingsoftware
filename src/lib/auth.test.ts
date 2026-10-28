import { describe, expect, it } from "vitest";
import { assertOwnerEmail, requireUser } from "./auth";

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

describe("local billing request origin", () => {
  it("accepts the browser's loopback origin when Next.js reports localhost", async () => {
    const request = new Request("http://localhost:3115/api/profile", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3115", "sec-fetch-site": "same-origin" },
    });
    await expect(requireUser(request)).resolves.toMatchObject({ id: "local-owner" });
  });

  it("rejects a non-local or different-port origin", async () => {
    for (const origin of ["https://unrelated.example", "http://127.0.0.1:3116"]) {
      const request = new Request("http://localhost:3115/api/profile", { method: "POST", headers: { origin } });
      await expect(requireUser(request)).rejects.toThrow("Open billing directly on this computer.");
    }
  });
});
