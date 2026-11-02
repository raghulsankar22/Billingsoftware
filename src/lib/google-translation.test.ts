import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleTranslationLimiter, parseGoogleTranslationInput, readTranslationJson, translateWithGoogle } from "./google-translation";
import { splitTranslationText, type GoogleTranslationInput } from "./google-translation-input";

const input: GoogleTranslationInput = { field: "customerName", text: "Kumar", source: "en", target: "ta", consent: true };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Google translation boundary", () => {
  it("requires explicit consent and only permits the approved fields and language pair", () => {
    expect(parseGoogleTranslationInput(input)).toEqual(input);
    for (const invalid of [{ ...input, consent: false }, { ...input, target: "en" }, { ...input, field: "phone" }, { ...input, source: "fr" }, { ...input, text: "" }, { ...input, text: "a".repeat(121) }, { ...input, text: "குமார்" }, { ...input, phone: "9876543210" }]) expect(() => parseGoogleTranslationInput(invalid)).toThrow();
    expect(parseGoogleTranslationInput({ ...input, field: "address", text: "a".repeat(500) }).text).toHaveLength(500);
  });
  it("bounds the body even when content-length is missing or false", async () => {
    await expect(readTranslationJson(new Request("http://localhost", { method: "POST", body: "a".repeat(8193) }), 8192)).rejects.toMatchObject({ status: 413 });
    await expect(readTranslationJson(new Request("http://localhost", { method: "POST", body: "{" }), 8192)).rejects.toMatchObject({ code: "invalid" });
  });
  it("uses the official server-side API and keeps numbers and identifiers out of Google", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: { translations: [{ translatedText: "சென்னை தெரு" }] } }));
    vi.stubGlobal("fetch", fetch);
    const address = "12 Chennai Street ID-42 9876543210 ₹2.5";
    expect(await translateWithGoogle({ ...input, field: "address", text: address }, "unit-test-key")).toBe("12 சென்னை தெரு ID-42 9876543210 ₹2.5");
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://translation.googleapis.com/language/translate/v2");
    expect(url).not.toContain("unit-test-key");
    expect(options.headers["x-goog-api-key"]).toBe("unit-test-key");
    expect(JSON.parse(options.body)).toEqual({ q: [" Chennai Street "], source: "en", target: "ta", format: "text", model: "nmt" });
    expect(options).toMatchObject({ redirect: "error", cache: "no-store" });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it("supports reverse suggestions and encoded quotes without altering the source", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: { translations: [{ translatedText: "O&#39;Neil" }] } }));
    vi.stubGlobal("fetch", fetch);
    const original = "குமார்";
    expect(await translateWithGoogle({ ...input, text: original, source: "ta", target: "en" }, "test-key")).toBe("O'Neil");
    expect(original).toBe("குமார்");
  });
  it("rejects numeric corruption, unresolved Tamil, missing, oversized or malformed output", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const text of ["குமார்", "Kumar123", "", "a".repeat(2001)]) {
      fetch.mockResolvedValueOnce(Response.json({ data: { translations: [{ translatedText: text }] } }));
      await expect(translateWithGoogle({ ...input, text: "குமார்", source: "ta", target: "en" }, "test-key")).rejects.toMatchObject({ code: "invalidResult" });
    }
    for (const payload of [{}, { data: { translations: [] } }]) {
      fetch.mockResolvedValueOnce(Response.json(payload));
      await expect(translateWithGoogle(input, "test-key")).rejects.toMatchObject({ code: "invalidResult" });
    }
  });
  it("treats malformed or oversized provider bodies as provider failures", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("{bad-json")).mockResolvedValueOnce(new Response("a".repeat(32769)));
    vi.stubGlobal("fetch", fetch);
    for (let index = 0; index < 2; index++) await expect(translateWithGoogle(input, "test-key")).rejects.toMatchObject({ code: "invalidResult", status: 502 });
  });
  it("does not retry, expose provider error bodies, or translate number-only input", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("secret provider detail", { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect(translateWithGoogle(input, "private-key")).rejects.toMatchObject({ code: "unavailable", status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(translateWithGoogle({ ...input, text: "9876543210" }, "test-key")).rejects.toMatchObject({ code: "invalid" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(splitTranslationText("12A ID-42 1234-5678").indices).toEqual([]);
  });
  it("handles offline and timeout failures without exposing private error text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private request details")));
    await expect(translateWithGoogle(input, "private-key")).rejects.toMatchObject({ code: "unavailable" });
  });
  it("limits each user and the whole process without storing customer text", () => {
    const limiter = new GoogleTranslationLimiter();
    for (let index = 0; index < 20; index++) expect(limiter.allow("user-a", 0)).toBe(true);
    expect(limiter.allow("user-a", 0)).toBe(false);
    for (const user of ["user-b", "user-c"]) for (let index = 0; index < 20; index++) expect(limiter.allow(user, 0)).toBe(true);
    expect(limiter.allow("user-d", 0)).toBe(false);
    expect(limiter.allow("user-a", 60000)).toBe(true);
  });
});
