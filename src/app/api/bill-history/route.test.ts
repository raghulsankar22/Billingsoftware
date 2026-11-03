import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "./route";
import { closeLocalDatabasesUnderRoot, createLocalDatabase, localDataDirectory, localOwnerId } from "../../../lib/local-database";
import { createLocalUsers } from "../../../lib/local-users";
import { runAsLocalUser } from "../../../lib/local-session-context";

vi.mock("../../../lib/storage-mode", () => ({ localStorageEnabled: true }));
vi.mock("../../../lib/auth", () => ({ requireUser: async () => ({ id: "local-owner" }) }));
const originalRoot = process.env.LOCAL_DATA_DIR, originalMode = process.env.BILLING_MULTI_USER;
let root: string, ownerToken: string, memberToken: string, deletedId: string;
const request = (query = "", token = ownerToken) => new Request("http://localhost:3100/api/bill-history" + query, { headers: { cookie: "billing_session=" + token } });
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "billing-history-api-"));
  process.env.LOCAL_DATA_DIR = root; process.env.BILLING_MULTI_USER = "1";
  const users = createLocalUsers(root);
  try {
    await users.create("owner", "owner password"); const owner = await users.login("owner", "owner password"); ownerToken = owner.token;
    await users.create("member", "member password", ownerToken); const member = await users.login("member", "member password"); memberToken = member.token;
    for (const token of [ownerToken, memberToken]) {
      const user = users.session(token)!;
      await runAsLocalUser(user, async () => {
        const db = createLocalDatabase(localDataDirectory());
        for (const accountSlot of [1, 2]) {
          expect((await db.rpc("save_business_profile", { p_owner_id: localOwnerId, p_profile: { accountSlot, businessName: "Sample", address: "Sample Street", phone: "1234567890" } })).error).toBeNull();
          const result = await db.rpc("create_bill", { p_owner_id: localOwnerId, p_bill: { accountSlot, billDate: "2026-01-01", customerName: "Private Name", fatherName: "Private Parent", address: "Private Street", phone: "9876543210", items: [{ metal: "Gold", particulars: "Private Ring", grams: 1, loanAmount: 100, assessedValue: 110 }] } });
          expect(result.error).toBeNull();
          if (token === ownerToken && accountSlot === 1) { deletedId = result.data.id; expect((await db.rpc("delete_bill", { p_owner_id: localOwnerId, p_bill_id: deletedId })).error).toBeNull(); }
        }
      });
    }
  } finally { users.close(); }
});
afterEach(() => {
  closeLocalDatabasesUnderRoot(root); rmSync(root, { recursive: true, force: true });
  if (originalRoot === undefined) delete process.env.LOCAL_DATA_DIR; else process.env.LOCAL_DATA_DIR = originalRoot;
  if (originalMode === undefined) delete process.env.BILLING_MULTI_USER; else process.env.BILLING_MULTI_USER = originalMode;
});
describe("authenticated read-only bill history", () => {
  it("refuses unauthenticated and cross-site reads", async () => {
    expect((await GET(request("", ""))).status).toBe(401);
    const crossSite = request(); crossSite.headers.set("origin", "https://evil.example");
    expect((await GET(crossSite)).status).toBe(403);
  });
  it("isolates users and accounts, retaining deleted identities without personal details", async () => {
    const response = await GET(request("?account=1")); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const history = await response.json(); expect(history.total).toBe(2); expect(history.entries[0]).toMatchObject({ action: "Deleted", billId: deletedId, actor: "owner" });
    for (const text of ["Private Name", "Private Parent", "Private Street", "9876543210", "Private Ring"]) expect(JSON.stringify(history)).not.toContain(text);
    expect((await (await GET(request("?account=2"))).json()).total).toBe(1);
    expect((await (await GET(request("?account=1", memberToken))).json()).total).toBe(1);
    expect((await (await GET(request("?account=1&billId=" + deletedId, memberToken))).json()).total).toBe(0);
    expect((await (await GET(request("?billId=" + deletedId))).json()).total).toBe(2);
    expect((await (await GET(request("?offset=50"))).json()).entries).toEqual([]);
  });
  it("rejects invalid filters and account numbers", async () => {
    for (const query of ["?offset=-1", "?offset=1.2", "?billId=not-an-id", "?billNumber=0", "?billNumber=1e20", "?account=0"]) expect((await GET(request(query))).status).toBe(400);
  });
});
