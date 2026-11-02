import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
let clock = 0;
let temporary = "";
const payload = { text: "Kumar", field: "customerName", source: "en", target: "ta", consent: true };
function request(body: unknown = payload, contentType = "application/json") {
  return new Request("http://127.0.0.1:3103/api/translation/google", { method: "POST", headers: { "content-type": contentType }, body: JSON.stringify(body) });
}

beforeEach(() => {
  clock += 60001; vi.spyOn(Date, "now").mockReturnValue(clock);
  vi.stubEnv("BILLING_MULTI_USER", "0"); vi.stubEnv("BILLING_GOOGLE_TRANSLATION", "1"); vi.stubEnv("GOOGLE_TRANSLATION_API_KEY", "unit-test-private-key");
  mocks.requireUser.mockResolvedValue({ id: "test-user" });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ data: { translations: [{ translatedText: "குமார்" }] } })));
});
afterEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetAllMocks();
  if (temporary) { rmSync(temporary, { recursive: true, force: true }); temporary = ""; }
});

describe("authenticated Google translation endpoint", () => {
  it("returns only the translated text and direction, with no-store", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ text: "குமார்", source: "en", target: "ta", provider: "Google Translate" });
  });
  it("fails closed when disabled or no key is configured", async () => {
    for (const [setting, value] of [["BILLING_GOOGLE_TRANSLATION", "0"], ["GOOGLE_TRANSLATION_API_KEY", ""]]) {
      vi.stubEnv("BILLING_GOOGLE_TRANSLATION", "1"); vi.stubEnv("GOOGLE_TRANSLATION_API_KEY", "test-key"); vi.stubEnv(setting, value);
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect((await response.json()).code).toBe("notConfigured");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not contact Google for an unauthenticated request", async () => {
    mocks.requireUser.mockRejectedValue(new Error("private auth details"));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("unauthenticated");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires the real local session wrapper and rejects cross-site requests", async () => {
    temporary = mkdtempSync(join(tmpdir(), "google-translation-auth-"));
    vi.stubEnv("LOCAL_DATA_DIR", temporary); vi.stubEnv("BILLING_MULTI_USER", "1");
    const unsigned = await POST(request());
    expect(unsigned.status).toBe(401);
    const foreign = new Request("http://127.0.0.1:3103/api/translation/google", { method: "POST", headers: { origin: "https://attacker.invalid" }, body: JSON.stringify(payload) });
    expect((await POST(foreign)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects missing consent, forbidden fields, extra data and incorrect content types", async () => {
    for (const body of [{ ...payload, consent: false }, { ...payload, field: "governmentId" }, { ...payload, phone: "9876543210" }, { ...payload, text: "a".repeat(501) }]) expect((await POST(request(body))).status).toBe(400);
    expect((await POST(request(payload, "text/plain"))).status).toBe(400);
    expect((await POST(request(payload, "application/json-invalid"))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds streamed input and rate-limits paid provider calls", async () => {
    expect((await POST(request({ ...payload, text: "a".repeat(9000) }))).status).toBe(413);
    for (let index = 0; index < 20; index++) expect((await POST(request())).status).toBe(200);
    const limited = await POST(request());
    expect(limited.status).toBe(429);
    expect((await limited.json()).code).toBe("rateLimited");
    expect(fetch).toHaveBeenCalledTimes(20);
  });
  it("never returns upstream error details or the private key", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("private provider text unit-test-private-key"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/unit-test-private-key|private provider text/);
  });
});
