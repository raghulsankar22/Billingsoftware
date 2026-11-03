import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GET, POST } from "./route";
import { closeLocalDatabasesUnderRoot, createLocalDatabase } from "../../../lib/local-database";
import { createLocalUsers } from "../../../lib/local-users";
import { withBackupMaintenance } from "../../../lib/backup-maintenance";

const mode = vi.hoisted(() => ({ local: true }));
vi.mock("../../../lib/storage-mode", () => ({ get localStorageEnabled() { return mode.local; } }));
let root: string, ownerToken: string, memberToken: string;
const originalRoot = process.env.LOCAL_DATA_DIR, originalMode = process.env.BILLING_MULTI_USER;
const request = (method = "GET", body?: unknown, query = "", token = ownerToken) => new Request("http://127.0.0.1:3110/api/cashbook" + query, { method, headers: { cookie: "billing_session=" + token, "content-type": "application/json", origin: "http://127.0.0.1:3110" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const opening = () => ({ action: "opening", operationId: randomUUID(), date: "2026-10-01", amount: 1000 });
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "billing-cash-api-")); process.env.LOCAL_DATA_DIR = root; process.env.BILLING_MULTI_USER = "1";
  const users = createLocalUsers(root);
  try {
    await users.create("owner", "sample owner password"); ownerToken = (await users.login("owner", "sample owner password")).token;
    const member = await users.create("member", "sample member password", ownerToken); memberToken = (await users.login("member", "sample member password")).token;
    for (const [directory, name] of [[root, "Owner only"], [join(root, "users", member.id), "Member only"]]) {
      const database = createLocalDatabase(directory);
      expect((await database.rpc("save_business_profile", { p_owner_id: "local-owner", p_profile: { businessName: name, address: "123 Sample Street", phone: "1234567890", accountSlot: 1, nextBillNumber: 1 } })).error).toBeNull();
    }
  } finally { users.close(); }
});
afterEach(() => {
  closeLocalDatabasesUnderRoot(root); rmSync(root, { recursive: true, force: true });
  if (originalRoot === undefined) delete process.env.LOCAL_DATA_DIR; else process.env.LOCAL_DATA_DIR = originalRoot;
  if (originalMode === undefined) delete process.env.BILLING_MULTI_USER; else process.env.BILLING_MULTI_USER = originalMode;
  mode.local = true;
});
describe("authenticated local cashbook API", () => {
  it("requires sign-in and the same local origin", async () => {
    expect((await GET(request("GET", undefined, "", ""))).status).toBe(401);
    expect((await POST(request("POST", opening(), "", ""))).status).toBe(401);
    const crossSite = request(); crossSite.headers.set("origin", "https://evil.example"); expect((await GET(crossSite)).status).toBe(403);
    process.env.BILLING_MULTI_USER = "0";
    expect((await GET(crossSite)).status).toBe(400);
    expect((await GET(new Request("http://example.com/api/cashbook"))).status).toBe(400);
  });
  it("keeps user ledgers isolated, even in the combined report", async () => {
    const response = await POST(request("POST", opening())); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const owner = await (await GET(request("GET", undefined, "?all=1&date=2026-10-03"))).json();
    const member = await (await GET(request("GET", undefined, "?all=1&date=2026-10-03", memberToken))).json();
    expect(owner.accounts).toHaveLength(1); expect(owner.accounts[0]).toMatchObject({ businessName: "Owner only", openingCash: 1000 });
    expect(member.accounts).toHaveLength(1); expect(member.accounts[0]).toMatchObject({ businessName: "Member only", openingCash: null });
  });
  it("enforces strict inputs, combined read-only mode and duplicate protection", async () => {
    for (const query of ["?account=0", "?account=9999", "?date=2026-02-30", "?all=yes"]) expect((await GET(request("GET", undefined, query))).status).toBe(400);
    expect((await POST(request("POST", opening(), "?all=1"))).status).toBe(400);
    expect((await POST(request("POST", { ...opening(), surprise: true }))).status).toBe(400);
    const body = opening(); expect((await POST(request("POST", body))).status).toBe(200); expect((await POST(request("POST", body))).status).toBe(200);
    const changed = await POST(request("POST", { ...body, amount: 2 })); expect(changed.status).toBe(400); expect((await changed.json()).error).toContain("different money request");
    const malformed = new Request("http://127.0.0.1:3110/api/cashbook", { method: "POST", headers: { cookie: "billing_session=" + ownerToken }, body: "{" }); expect((await POST(malformed)).status).toBe(400);
  });
  it("respects backup maintenance and rejects cloud operation", async () => {
    await withBackupMaintenance(root, async () => { expect((await GET(request())).status).toBe(503); expect((await POST(request("POST", opening()))).status).toBe(503); });
    mode.local = false; expect((await GET(request())).status).toBe(501); expect((await POST(request("POST", opening()))).status).toBe(501);
  });
  it("reports stale closing revisions as conflicts without saving a closing", async () => {
    await POST(request("POST", opening()));
    const initial = await (await GET(request("GET", undefined, "?date=2026-10-03"))).json();
    await POST(request("POST", { action: "entry", operationId: randomUUID(), date: "2026-10-03", kind: "expense", method: "cash", amount: 10, note: "Another window" }));
    const response = await POST(request("POST", { action: "close", operationId: randomUUID(), date: "2026-10-03", countedCash: 1000, note: "", revision: initial.accounts[0].revision, acknowledgeUnrecorded: true }));
    expect(response.status).toBe(409); expect((await response.json()).error).toContain("Refresh");
    const current = await (await GET(request("GET", undefined, "?date=2026-10-03"))).json();
    expect(current.accounts[0]).toMatchObject({ expectedCash: 990, closed: false, countedCash: null });
  });
});
