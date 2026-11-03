import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, POST } from "./route";
import { POST as BACKUP, PUT as CHOOSE } from "../backup/route";
import { chooseBackupFolder, runCompleteBackup } from "../../../lib/backups";
import { closeLocalDatabasesUnderRoot, createLocalDatabase } from "../../../lib/local-database";
import { createLocalUsers } from "../../../lib/local-users";
import { withBackupMaintenance } from "../../../lib/backup-maintenance";

const mode = vi.hoisted(() => ({ local: true }));
vi.mock("../../../lib/storage-mode", () => ({ get localStorageEnabled() { return mode.local; } }));
vi.mock("../../../lib/auth", () => ({ requireUser: async () => ({ id: "local-owner" }) }));
let root: string, folder: string, ownerToken: string, memberToken: string, file: string;
const originalRoot = process.env.LOCAL_DATA_DIR, originalMode = process.env.BILLING_MULTI_USER;
const request = (method: string, token = ownerToken, body?: unknown, query = "") => new Request("http://localhost:3100/api/backup-restore" + query, { method, headers: { cookie: "billing_session=" + token, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "billing-backup-api-")); folder = mkdtempSync(join(tmpdir(), "billing-backup-drive-"));
  process.env.LOCAL_DATA_DIR = root; process.env.BILLING_MULTI_USER = "1";
  const users = createLocalUsers(root);
  try {
    await users.create("owner", "owner password"); ownerToken = (await users.login("owner", "owner password")).token;
    await users.create("member", "member password", ownerToken); memberToken = (await users.login("member", "member password")).token;
  } finally { users.close(); }
  createLocalDatabase(root).jewellery.add("Saved ledger"); chooseBackupFolder(root, folder);
  file = (await runCompleteBackup(root)).lastFile!;
});
afterEach(() => {
  closeLocalDatabasesUnderRoot(root); rmSync(root, { recursive: true, force: true }); rmSync(folder, { recursive: true, force: true });
  if (originalRoot === undefined) delete process.env.LOCAL_DATA_DIR; else process.env.LOCAL_DATA_DIR = originalRoot;
  if (originalMode === undefined) delete process.env.BILLING_MULTI_USER; else process.env.BILLING_MULTI_USER = originalMode;
  mode.local = true;
});
describe("whole-install backup API", () => {
  it("requires a local administrator for previews, restores and backup destination changes", async () => {
    expect((await GET(request("GET", ""))).status).toBe(401);
    expect((await GET(request("GET", memberToken))).status).toBe(403);
    expect((await POST(request("POST", memberToken, { file, currentPassword: "member password" }))).status).toBe(403);
    expect((await CHOOSE(request("PUT", memberToken, { folder }))).status).toBe(403);
    const crossSite = request("GET"); crossSite.headers.set("origin", "https://evil.example");
    expect((await GET(crossSite)).status).toBe(403);
    expect((await GET(request("GET"))).headers.get("cache-control")).toBe("no-store");
    const response = await GET(request("GET", ownerToken, undefined, "?file=" + encodeURIComponent(file)));
    expect(response.status).toBe(200);
    expect((await response.json()).preview).toMatchObject({ format: "complete", userCount: 2, ledgerCount: 1 });
  });
  it("requires the current password and clears the browser cookie and every saved session after recovery", async () => {
    expect((await POST(request("POST", ownerToken, { file, currentPassword: "wrong" }))).status).toBe(400);
    const response = await POST(request("POST", ownerToken, { file, currentPassword: "owner password" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/billing_session=;.*Max-Age=0/i);
    expect(await response.json()).toMatchObject({ signOut: true, restartRequired: true });
    expect((await GET(request("GET"))).status).toBe(401);
  });
  it("allows due checks for signed-in members, blocks operations during maintenance, and refuses cloud use", async () => {
    expect((await BACKUP(request("POST", memberToken, { auto: true }))).status).toBe(200);
    await withBackupMaintenance(root, async () => {
      expect((await BACKUP(request("POST", ownerToken, {}))).status).toBe(503);
    });
    const before = readdirSync(folder);
    mode.local = false;
    expect((await BACKUP(request("POST", ownerToken, {}))).status).toBe(400);
    expect((await POST(request("POST", ownerToken, { file, currentPassword: "owner password" }))).status).toBe(400);
    expect(readdirSync(folder)).toEqual(before);
  });
});
