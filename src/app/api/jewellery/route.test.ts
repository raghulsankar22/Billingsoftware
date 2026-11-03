import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalDatabase, localOwnerId } from "../../../lib/local-database";
import { DELETE, GET, PATCH, POST } from "./route";

const mocks = vi.hoisted(() => ({ local: true, requireUser: vi.fn(), directory: "" }));
vi.mock("@/lib/storage-mode", () => ({ get localStorageEnabled() { return mocks.local; } }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/local-database", async () => {
  const actual = await import("../../../lib/local-database");
  return { ...actual, createLocalDatabase: () => actual.createLocalDatabase(mocks.directory) };
});
let database: ReturnType<typeof createLocalDatabase>;
const request = (method: string, body?: unknown, account = 1) => new Request("http://localhost/api/jewellery?account=" + account, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
beforeEach(() => {
  mocks.directory = mkdtempSync(join(tmpdir(), "billing-jewellery-api-"));
  mocks.requireUser.mockResolvedValue({ id: localOwnerId });
  database = createLocalDatabase(mocks.directory);
});
afterEach(() => { database.close(); rmSync(mocks.directory, { recursive: true, force: true }); mocks.local = true; vi.resetAllMocks(); });

describe("jewellery management API", () => {
  it("adds, edits and removes names shared across business accounts", async () => {
    expect((await POST(request("POST", { name: "Test Pendant" }))).status).toBe(200);
    expect((await PATCH(request("PATCH", { originalName: "Test Pendant", name: "Updated Pendant" }))).status).toBe(200);
    const loaded = await GET(request("GET", undefined, 2));
    expect(loaded.headers.get("cache-control")).toBe("no-store");
    expect((await loaded.json()).items).toContain("Updated Pendant");
    expect((await DELETE(request("DELETE", { name: "Updated Pendant" }, 2))).status).toBe(200);
    expect((await (await GET(request("GET"))).json()).items).not.toContain("Updated Pendant");
    expect((await DELETE(request("DELETE", { name: "Ring" }))).status).toBe(200);
    expect((await (await GET(request("GET"))).json()).items).not.toContain("Ring");
  });
  it("refuses duplicate and invalid changes without deleting the original", async () => {
    for (const input of [{ originalName: "Ring", name: "Chain" }, { originalName: "Ring", name: "" }, { name: "Wrong Payload" }]) {
      expect((await PATCH(request("PATCH", input))).status).toBe(400);
    }
    expect((await DELETE(request("DELETE", { name: "" }))).status).toBe(400);
    expect(database.jewellery.list()).toContain("Ring");
  });
  it("requires authentication and local storage for catalogue changes", async () => {
    mocks.requireUser.mockRejectedValue(new Error("Please sign in."));
    expect((await PATCH(request("PATCH", { originalName: "Ring", name: "Changed Ring" }))).status).toBe(400);
    expect((await DELETE(request("DELETE", { name: "Ring" }))).status).toBe(400);
    mocks.requireUser.mockResolvedValue({ id: localOwnerId }); mocks.local = false;
    expect((await DELETE(request("DELETE", { name: "Ring" }))).status).toBe(400);
    expect(database.jewellery.list()).toContain("Ring");
  });
});
