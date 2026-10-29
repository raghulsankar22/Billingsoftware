import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalDatabase, localOwnerId } from "../../../lib/local-database";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ local: true, directory: "", requireUser: vi.fn() }));
vi.mock("@/lib/storage-mode", () => ({ get localStorageEnabled() { return mocks.local; } }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/global-search", async () => import("../../../lib/global-search"));
vi.mock("@/lib/local-database", async () => {
  const actual = await import("../../../lib/local-database");
  return { ...actual, createLocalDatabase: () => actual.createLocalDatabase(mocks.directory) };
});
let db: ReturnType<typeof createLocalDatabase>;
const request = (params: Record<string, string> = {}) => new Request(`http://localhost:3100/api/search?${new URLSearchParams({ q: "Customer", ...params })}`);
beforeEach(async () => {
  mocks.directory = mkdtempSync(join(tmpdir(), "billing-search-api-"));
  db = createLocalDatabase(mocks.directory);
  mocks.requireUser.mockResolvedValue({ id: localOwnerId });
  for (const accountSlot of [1, 4]) {
    expect((await db.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { businessName: `Finance ${accountSlot}`, address: "123 Business Street", phone: "1234567890", accountSlot } })).error).toBeNull();
    expect((await db.rpc("create_bill", { p_owner_id: localOwnerId, p_bill: { accountSlot, billDate: "2026-10-01", customerName: "Test Customer", fatherName: "Parent", address: "123 Customer Street", phone: "9876543210", items: [{ metal: "Gold", particulars: "Ring", grams: 1, assessedValue: 200, loanAmount: 100 }] } })).error).toBeNull();
  }
});
afterEach(() => { db.close(); rmSync(mocks.directory, { recursive: true, force: true }); mocks.local = true; vi.resetAllMocks(); });

describe("global search API", () => {
  it("returns all-account results and pagination while ignoring the current account parameter", async () => {
    const response = await GET(request({ account: "1" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ total: 2, page: 1, pageSize: 50, hasMore: false });
    expect(body.results.map((result: { accountSlot: number }) => result.accountSlot)).toEqual([1, 4]);
    const page = await GET(request({ account: "invalid", page: "2", pageSize: "1" }));
    expect(await page.json()).toMatchObject({ total: 2, page: 2, pageSize: 1, hasMore: false, results: [{ accountSlot: 4 }] });
  });
  it("rejects auth and cross-origin failures, foreign owners and hosted mode without caching", async () => {
    for (const message of ["Sign in is required.", "Open billing directly on this computer."]) {
      mocks.requireUser.mockRejectedValue(new Error(message));
      const response = await GET(request());
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: message });
    }
    mocks.requireUser.mockResolvedValue({ id: "foreign-owner" });
    expect(await (await GET(request())).json()).toEqual({ error: "Invalid local owner." });
    mocks.local = false;
    const response = await GET(request());
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "All-account search is available in offline billing." });
  });
  it("rejects invalid search inputs and does not cache any error", async () => {
    const invalidInputs: Record<string, string>[] = [{ q: "" }, { q: "x".repeat(201) }, { page: "0" }, { pageSize: "101" }];
    for (const params of invalidInputs) {
      const response = await GET(request(params));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.json()).error).toBeTruthy();
    }
  });
});
