import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestGoogleTranslation } from "./google-translate-request";
import type { GoogleTranslationInput } from "../lib/google-translation-input";

const mocks = vi.hoisted(() => ({ requestHeaders: vi.fn() }));
vi.mock("./api", () => ({ requestHeaders: mocks.requestHeaders }));
const input: GoogleTranslationInput = { field: "customerName", text: "Kumar", source: "en", target: "ta", consent: true };
const result = { text: "குமார்", source: "en", target: "ta", provider: "Google Translate" };
beforeEach(() => { mocks.requestHeaders.mockResolvedValue({ Authorization: "test-session" }); });
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("Google translation client requests", () => {
  it("posts one explicitly consented field with the existing authentication helper", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(result)); vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    expect(await requestGoogleTranslation(input, controller.signal)).toBe("குமார்");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("/api/translation/google");
    expect(JSON.parse(options.body)).toEqual(input);
    expect(options.headers).toEqual({ Authorization: "test-session", "content-type": "application/json" });
    expect(options.signal).toBe(controller.signal);
  });
  it("prevents requests without a session or after cancellation", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    mocks.requestHeaders.mockRejectedValueOnce(new Error("session expired"));
    await expect(requestGoogleTranslation(input, new AbortController().signal)).rejects.toMatchObject({ code: "unauthenticated" });
    const controller = new AbortController(); controller.abort();
    await expect(requestGoogleTranslation(input, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("discards a late result after the field has changed or unmounted", async () => {
    let finish: (response: Response) => void = () => { throw new Error("request not started"); };
    const fetch = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const pending = requestGoogleTranslation(input, controller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort(); finish(Response.json(result));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  it("rejects an incorrect direction, malformed result or unknown provider", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const invalid of [{ ...result, target: "en" }, { ...result, provider: "unexpected" }, { ...result, text: "" }]) {
      fetch.mockResolvedValueOnce(Response.json(invalid));
      await expect(requestGoogleTranslation(input, new AbortController().signal)).rejects.toMatchObject({ code: "invalidResult" });
    }
  });
  it("shows configuration and sign-in errors without retrying or exposing server details", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ code: "notConfigured", error: "private detail" }, { status: 503 })).mockResolvedValueOnce(Response.json({ error: "Sign in required" }, { status: 401 })); vi.stubGlobal("fetch", fetch);
    await expect(requestGoogleTranslation(input, new AbortController().signal)).rejects.toMatchObject({ code: "notConfigured" });
    await expect(requestGoogleTranslation(input, new AbortController().signal)).rejects.toMatchObject({ code: "unauthenticated" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
