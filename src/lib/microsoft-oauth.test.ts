import crypto from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { beginMicrosoftConnection, exchangeMicrosoftCode, readMicrosoftConnection } from "./microsoft-oauth";

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-encryption-key-32-characters-long"); vi.stubEnv("MICROSOFT_CLIENT_ID", "client"); vi.stubEnv("MICROSOFT_CLIENT_SECRET", "secret"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3100/");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("binds OAuth state to the browser cookie and exchanges with matching PKCE", async () => {
  const connection = beginMicrosoftConnection("owner", "http://localhost:3100");
  const params = new URL(connection.url).searchParams;
  const payload = readMicrosoftConnection(connection.cookie, params.get("state"));
  expect(params.get("redirect_uri")).toBe("http://localhost:3100/api/onedrive/callback");
  expect(params.get("code_challenge")).toBe(crypto.createHash("sha256").update(payload.verifier).digest("base64url"));
  expect(() => readMicrosoftConnection(undefined, params.get("state"))).toThrow(/browser/);
  expect(() => readMicrosoftConnection(connection.cookie, "different-state")).toThrow(/invalid/);
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    expect((init.body as URLSearchParams).get("code_verifier")).toBe(payload.verifier);
    expect((init.body as URLSearchParams).get("redirect_uri")).toBe(params.get("redirect_uri"));
    return Response.json({ refresh_token: "refresh" });
  });
  vi.stubGlobal("fetch", fetcher);
  expect(await exchangeMicrosoftCode("code", payload)).toBe("refresh");
});

it("rejects expired connection requests", () => {
  vi.useFakeTimers(); const connection = beginMicrosoftConnection("owner", "http://localhost:3100");
  vi.advanceTimersByTime(600_001);
  expect(() => readMicrosoftConnection(connection.cookie, new URL(connection.url).searchParams.get("state"))).toThrow(/expired/);
});
