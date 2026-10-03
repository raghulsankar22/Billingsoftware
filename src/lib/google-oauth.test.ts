import crypto from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { beginGoogleConnection, driveWorkbookName, exchangeGoogleCode, googleConfigured, readGoogleConnection } from "./google-oauth";

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-encryption-key-32-characters-long"); vi.stubEnv("GOOGLE_CLIENT_ID", "client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3100/");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("binds OAuth state to the browser cookie and exchanges with matching PKCE", async () => {
  const connection = beginGoogleConnection("owner", "http://localhost:3100", "00000000-0000-0000-0000-000000000002", 2);
  const params = new URL(connection.url).searchParams;
  expect(new URL(connection.url).origin).toBe("https://accounts.google.com");
  expect(params.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
  expect(params.get("access_type")).toBe("offline");
  expect(params.get("prompt")).toContain("consent");
  const payload = readGoogleConnection(connection.cookie, params.get("state"));
  expect(payload.profileId).toBe("00000000-0000-0000-0000-000000000002");
  expect(payload.accountSlot).toBe(2);
  expect(payload.ownerId).toBe("owner");
  expect(params.get("redirect_uri")).toBe("http://localhost:3100/api/google-drive/callback");
  expect(params.get("code_challenge")).toBe(crypto.createHash("sha256").update(payload.verifier).digest("base64url"));
  expect(() => readGoogleConnection(undefined, params.get("state"))).toThrow(/browser/);
  expect(() => readGoogleConnection(connection.cookie, "different-state")).toThrow(/invalid/);
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    expect(_url).toBe("https://oauth2.googleapis.com/token");
    expect((init.body as URLSearchParams).get("code_verifier")).toBe(payload.verifier);
    expect((init.body as URLSearchParams).get("redirect_uri")).toBe(params.get("redirect_uri"));
    return Response.json({ refresh_token: "refresh" });
  });
  vi.stubGlobal("fetch", fetcher);
  expect(await exchangeGoogleCode("code", payload)).toBe("refresh");
});

it("rejects tampered cookies and requests without Google credentials", () => {
  const connection = beginGoogleConnection("owner", "http://localhost:3100", "00000000-0000-0000-0000-000000000002", 2);
  expect(() => readGoogleConnection(`${connection.cookie}tampered`, new URL(connection.url).searchParams.get("state"))).toThrow(/invalid/);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
  expect(googleConfigured()).toBe(false);
  expect(() => beginGoogleConnection("owner", "http://localhost:3100", "00000000-0000-0000-0000-000000000002", 2)).toThrow(/Configure Google/);
});

it("rejects denied token exchanges and tokens without offline access", async () => {
  const connection = beginGoogleConnection("owner", "http://localhost:3100", "00000000-0000-0000-0000-000000000002", 2);
  const payload = readGoogleConnection(connection.cookie, new URL(connection.url).searchParams.get("state"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 400 })));
  await expect(exchangeGoogleCode("code", payload)).rejects.toThrow(/could not complete/);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ access_token: "access" })));
  await expect(exchangeGoogleCode("code", payload)).rejects.toThrow(/offline access/);
});

it("rejects expired connection requests", () => {
  vi.useFakeTimers(); const connection = beginGoogleConnection("owner", "http://localhost:3100", "00000000-0000-0000-0000-000000000002", 2);
  vi.advanceTimersByTime(600_001);
  expect(() => readGoogleConnection(connection.cookie, new URL(connection.url).searchParams.get("state"))).toThrow(/expired/);
});

it("gives each account a distinct safe workbook name", () => {
  const names = [1, 2, 3].map(slot => driveWorkbookName(slot, 'Example / <Business>'));
  expect(new Set(names).size).toBe(3);
  for (const name of names) { expect(name.endsWith(".xlsx")).toBe(true); expect(name).not.toMatch(/[<>/\\]/); }
});
it("rejects invalid account bindings", () => {
  for (const slot of [0, 4, 1.5]) {
    const connection = beginGoogleConnection("owner", "http://localhost:3100", "00000000-0000-0000-0000-000000000002", slot);
    expect(() => readGoogleConnection(connection.cookie, new URL(connection.url).searchParams.get("state"))).toThrow(/account is invalid/);
  }
});

