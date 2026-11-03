import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupStatus, chooseBackupFolder, listBackups, runCompleteBackup } from "./backups";
import { completeBackupName, createBackupPackage, previewBackup, restoreInstallation, verifyBackupPackage } from "./backup-package";
import { closeLocalDatabasesUnderRoot, createLocalDatabase } from "./local-database";
import { createLocalUsers } from "./local-users";
import { withBackupMaintenance, withBackupOperation } from "./backup-maintenance";

const temporary: string[] = [];
const temp = () => { const root = mkdtempSync(join(tmpdir(), "billing-complete-test-")); temporary.push(root); return root; };
afterEach(() => {
  for (const root of temporary.splice(0)) { closeLocalDatabasesUnderRoot(root); rmSync(root, { recursive: true, force: true }); }
});
async function installation() {
  const root = temp();
  const folder = temp();
  const users = createLocalUsers(root);
  let owner, other, second;
  try {
    await users.create("owner", "owner password");
    owner = await users.login("owner", "owner password");
    other = await users.create("other", "other password", owner.token);
    second = await users.login("other", "other password");
    await users.create("unused", "unused password", owner.token);
  } finally { users.close(); }
  const database = createLocalDatabase(root);
  const otherRoot = join(root, "users", other.id);
  const otherDatabase = createLocalDatabase(otherRoot);
  database.jewellery.add("Before backup");
  otherDatabase.jewellery.add("Other business");
  const seed = new DatabaseSync(join(root, "billing.sqlite"));
  seed.prepare("INSERT INTO records VALUES(?,?,?)").run("business_profiles", "business", JSON.stringify({ business_name: "Owner business", owner_id: "local-owner", account_slot: 1 }));
  seed.prepare("INSERT INTO records VALUES(?,?,?)").run("bills", "bill", JSON.stringify({ profile_id: "business", bill_number: 1 }));
  seed.close();
  database.customers.save(1, { name: "Saved Customer", fatherName: "Parent", address: "123 Customer Street", phone: "9876543210", aadhaar: "" });
  mkdirSync(join(otherRoot, "bill-pdfs"));
  writeFileSync(join(otherRoot, "bill-pdfs", "saved.pdf"), "saved document");
  mkdirSync(join(root, "registers"));
  writeFileSync(join(root, "registers", "All Accounts.xlsx"), "saved register");
  writeFileSync(join(root, "settings.json"), JSON.stringify({ theme: "dark" }));
  writeFileSync(join(root, "unrelated.txt"), "leave me alone");
  writeFileSync(join(root, "unrelated.json"), "leave this JSON alone");
  mkdirSync(join(root, "backups"));
  writeFileSync(join(root, "backups", "recursive.sqlite"), "do not include");
  chooseBackupFolder(root, folder);
  return { root, folder, database, otherDatabase, otherRoot, owner, second };
}
async function savedInstallation() {
  const data = await installation();
  const status = await runCompleteBackup(data.root);
  return { ...data, file: status.lastFile! };
}
function refreshHash(packageRoot: string, name: string) {
  const manifestPath = join(packageRoot, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = manifest.files.find((file: { path: string }) => file.path === name);
  const bytes = readFileSync(join(packageRoot, name));
  entry.size = bytes.length; entry.sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(manifestPath, JSON.stringify(manifest));
}

describe("complete installation packages", () => {
  it("captures every existing user's active WAL database, logins, settings and documents without backups or unrelated files", async () => {
    const data = await savedInstallation();
    const { manifest, preview } = verifyBackupPackage(join(data.folder, data.file));
    expect(manifest.files.map(entry => entry.path)).toContain("users.sqlite");
    expect(manifest.files.map(entry => entry.path)).toContain("users/" + data.second.user.id + "/billing.sqlite");
    expect(manifest.files.map(entry => entry.path)).toContain("users/" + data.second.user.id + "/bill-pdfs/saved.pdf");
    expect(manifest.files.map(entry => entry.path)).toContain("registers/All Accounts.xlsx");
    expect(manifest.files.some(entry => /-wal$|-shm$|recursive|unrelated/.test(entry.path))).toBe(false);
    expect(preview).toMatchObject({ format: "complete", userCount: 3, ledgerCount: 2, billCount: 1, customerCount: 1, businesses: ["Owner business"] });
    const snapshot = new DatabaseSync(join(data.folder, data.file, "billing.sqlite"), { readOnly: true });
    try { expect(snapshot.prepare("SELECT 1 FROM jewellery_items WHERE name=?").get("Before backup")).toBeTruthy(); }
    finally { snapshot.close(); }
    expect(listBackups(data.root).map(copy => copy.file)).toEqual([data.file]);
    const status = await runCompleteBackup(data.root, { onlyIfDue: true });
    expect(status.lastFile).toBe(data.file);
  });

  it("rejects tampering, unsafe manifest paths, missing files, extra files and checksum-valid corrupt SQLite", async () => {
    const data = await savedInstallation();
    const packageRoot = join(data.folder, data.file);
    const setting = join(packageRoot, "settings.json");
    const original = readFileSync(setting);
    writeFileSync(setting, "tampered");
    expect(() => verifyBackupPackage(packageRoot)).toThrow(/damaged or unsafe/);
    writeFileSync(setting, original);
    const manifestPath = join(packageRoot, "manifest.json");
    const originalManifest = readFileSync(manifestPath);
    const manifest = JSON.parse(originalManifest.toString());
    manifest.files[0].path = "../outside.sqlite";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => verifyBackupPackage(packageRoot)).toThrow(/damaged or unsafe/);
    writeFileSync(manifestPath, originalManifest);
    rmSync(setting);
    expect(() => verifyBackupPackage(packageRoot)).toThrow(/damaged or unsafe/);
    writeFileSync(setting, original);
    writeFileSync(join(packageRoot, "extra.txt"), "extra");
    expect(() => verifyBackupPackage(packageRoot)).toThrow(/damaged or unsafe/);
    rmSync(join(packageRoot, "extra.txt"));
    writeFileSync(join(packageRoot, "billing.sqlite"), "not sqlite"); refreshHash(packageRoot, "billing.sqlite");
    expect(() => verifyBackupPackage(packageRoot)).toThrow(/damaged or unsafe/);
  });

  it("does not change billing data or create a safety copy on failed verification, non-admin or incorrect password", async () => {
    const data = await savedInstallation();
    data.database.jewellery.add("Current data");
    await expect(restoreInstallation(data.root, data.folder, data.file, { token: data.second.token, password: "other password" })).rejects.toThrow(/Administrator/);
    await expect(restoreInstallation(data.root, data.folder, data.file, { token: data.owner.token, password: "wrong password" })).rejects.toThrow(/Current password/);
    writeFileSync(join(data.folder, data.file, "settings.json"), "tampered");
    await expect(restoreInstallation(data.root, data.folder, data.file, { token: data.owner.token, password: "owner password" })).rejects.toThrow(/damaged or unsafe/);
    expect(data.database.jewellery.list()).toContain("Current data");
    expect(readdirSync(join(data.root, "backups"))).toEqual(["recursive.sqlite"]);
  });

  it("restores all ledgers and documents, removes post-backup owned data, preserves unrelated files, invalidates restored sessions and keeps a full safety package", async () => {
    const data = await savedInstallation();
    data.database.jewellery.add("After backup");
    writeFileSync(join(data.otherRoot, "bill-pdfs", "saved.pdf"), "changed document");
    writeFileSync(join(data.otherRoot, "bill-pdfs", "new.pdf"), "new document");
    writeFileSync(join(data.root, "settings.json"), "changed settings");
    const result = await restoreInstallation(data.root, data.folder, data.file, { token: data.owner.token, password: "owner password" });
    expect(result).toMatchObject({ signOut: true, restartRequired: true });
    const restored = createLocalDatabase(data.root);
    expect(restored.jewellery.list()).toContain("Before backup");
    expect(restored.jewellery.list()).not.toContain("After backup");
    expect(readFileSync(join(data.otherRoot, "bill-pdfs", "saved.pdf"), "utf8")).toBe("saved document");
    expect(existsSync(join(data.otherRoot, "bill-pdfs", "new.pdf"))).toBe(false);
    expect(readFileSync(join(data.root, "unrelated.txt"), "utf8")).toBe("leave me alone");
    expect(readFileSync(join(data.root, "unrelated.json"), "utf8")).toBe("leave this JSON alone");
    const users = createLocalUsers(data.root);
    try {
      expect(users.session(data.owner.token)).toBeNull(); expect(users.session(data.second.token)).toBeNull();
      expect((await users.login("owner", "owner password")).user.administrator).toBe(true);
    } finally { users.close(); }
    const safety = verifyBackupPackage(join(data.root, "backups", result.safetyCopy));
    expect(safety.preview.userCount).toBe(3);
    expect(existsSync(join(data.root, ".billing-maintenance.lock"))).toBe(false);
  });

  it("rolls back every replaced or removed file on a partial apply failure", async () => {
    const data = await savedInstallation();
    data.database.jewellery.add("Keep current data");
    writeFileSync(join(data.root, "settings.json"), "keep settings");
    let count = 0;
    await expect(restoreInstallation(data.root, data.folder, data.file, { token: data.owner.token, password: "owner password" }, { afterApply: () => { if (++count === 3) throw new Error("simulated disk failure"); } })).rejects.toThrow(/rolled back/);
    expect(createLocalDatabase(data.root).jewellery.list()).toContain("Keep current data");
    expect(readFileSync(join(data.root, "settings.json"), "utf8")).toBe("keep settings");
    expect(readFileSync(join(data.otherRoot, "bill-pdfs", "saved.pdf"), "utf8")).toBe("saved document");
    expect(existsSync(join(data.root, ".billing-maintenance.lock"))).toBe(false);
    expect(readdirSync(join(data.root, "backups")).filter(name => name.endsWith(".billing-backup"))).toHaveLength(1);
  });

  it("requires the current administrator password while restoring older passwords without reviving any old session", async () => {
    const data = await savedInstallation();
    let currentToken: string;
    const users = createLocalUsers(data.root);
    try {
      await users.changePassword(data.owner.token, "owner password", "new owner password");
      currentToken = (await users.login("owner", "new owner password")).token;
    } finally { users.close(); }
    await restoreInstallation(data.root, data.folder, data.file, { token: currentToken!, password: "new owner password" });
    const restored = createLocalUsers(data.root);
    try {
      expect(restored.session(currentToken!)).toBeNull(); expect(restored.session(data.owner.token)).toBeNull();
      await expect(restored.login("owner", "new owner password")).rejects.toThrow(/incorrect/);
      expect((await restored.login("owner", "owner password")).user.administrator).toBe(true);
    } finally { restored.close(); }
  });

  it("keeps thirty verified complete backups and five complete safety copies without removing foreign directories", async () => {
    const data = await installation();
    const safetyRoot = join(data.root, "backups");
    const oldest = completeBackupName(new Date("2026-01-01T00:00:00Z"));
    await createBackupPackage(data.root, join(data.folder, oldest), new Date("2026-01-01T00:00:00Z"));
    for (let index = 1; index < 31; index++) {
      const date = new Date(Date.parse("2026-01-01T00:00:00Z") + index * 86400000);
      await createBackupPackage(data.root, join(data.folder, completeBackupName(date)), date);
    }
    const foreign = completeBackupName(new Date("2025-01-01T00:00:00Z"));
    mkdirSync(join(data.folder, foreign)); writeFileSync(join(data.folder, foreign, "foreign.txt"), "do not delete");
    const status = await runCompleteBackup(data.root, { now: new Date("2026-11-03T09:00:00Z") });
    expect(listBackups(data.root)).toHaveLength(30);
    expect(existsSync(join(data.folder, oldest))).toBe(false);
    expect(readFileSync(join(data.folder, foreign, "foreign.txt"), "utf8")).toBe("do not delete");
    for (let index = 0; index < 6; index++) await createBackupPackage(data.root, join(safetyRoot, "before-restore-" + randomUUID() + ".billing-backup"), new Date(2026, 0, index + 1));
    await restoreInstallation(data.root, data.folder, status.lastFile, { token: data.owner.token, password: "owner password" });
    expect(readdirSync(safetyRoot).filter(name => name.endsWith(".billing-backup"))).toHaveLength(5);
    expect(readFileSync(join(safetyRoot, "recursive.sqlite"), "utf8")).toBe("do not include");
  }, 30000);

  it("fails closed for active requests, external SQLite writers, incomplete recovery and sync-managed ledgers", async () => {
    const data = await savedInstallation();
    let finish!: () => void;
    const operation = withBackupOperation(data.root, () => new Promise<void>(resolve => { finish = resolve; }));
    await expect(restoreInstallation(data.root, data.folder, data.file, { token: data.owner.token, password: "owner password" })).rejects.toThrow(/operations are active/);
    finish(); await operation;
    await withBackupMaintenance(data.root, async () => {
      await expect(withBackupOperation(data.root, async () => undefined)).rejects.toThrow(/maintenance/);
    });
    const writer = new DatabaseSync(join(data.root, "billing.sqlite"));
    try {
      writer.exec("BEGIN IMMEDIATE");
      await expect(restoreInstallation(data.root, data.folder, data.file, { token: data.owner.token, password: "owner password" })).rejects.toThrow(/database writer/);
      writer.exec("ROLLBACK");
      writer.exec("INSERT INTO sync_local_issuers VALUES('business','device',1,'assigned')");
    } finally { writer.close(); }
    await expect(restoreInstallation(data.root, data.folder, data.file, { token: data.owner.token, password: "owner password" })).rejects.toThrow(/sync-managed/);
    writeFileSync(join(data.root, ".billing-maintenance.lock"), "interrupted");
    await expect(withBackupOperation(data.root, async () => undefined)).rejects.toThrow(/administrator recovery/);
  });

  it("refuses unsafe symlinks without reading or deleting their targets", async () => {
    const data = await installation();
    const outside = temp();
    writeFileSync(join(outside, "private.pdf"), "private");
    symlinkSync(outside, join(data.otherRoot, "bill-pdfs", "external"), process.platform === "win32" ? "junction" : "dir");
    await expect(runCompleteBackup(data.root)).rejects.toThrow(/damaged or unsafe/);
    expect(readFileSync(join(outside, "private.pdf"), "utf8")).toBe("private");
    expect(readdirSync(data.folder)).toEqual([]);
  });

  it("previews and restores legacy single-ledger backups with a complete safety backup and administrator password", async () => {
    const data = await installation();
    const file = "billing-backup-2026-11-03-090000.sqlite";
    const target = join(data.folder, file);
    await data.database.snapshot(target);
    const normalize = new DatabaseSync(target); normalize.exec("PRAGMA journal_mode=DELETE"); normalize.close();
    data.database.jewellery.add("After legacy backup");
    expect(previewBackup(data.folder, file)).toMatchObject({ format: "legacy", userCount: 0, billCount: 1 });
    const result = await restoreInstallation(data.root, data.folder, file, { token: data.owner.token, password: "owner password" });
    expect(createLocalDatabase(data.root).jewellery.list()).not.toContain("After legacy backup");
    expect(createLocalDatabase(data.otherRoot).jewellery.list()).toContain("Other business");
    expect(verifyBackupPackage(join(data.root, "backups", result.safetyCopy)).preview.ledgerCount).toBe(2);
    const users = createLocalUsers(data.root); try { expect(users.session(data.owner.token)).toBeNull(); } finally { users.close(); }
  });

  it("uses unique packages for same-second backups and refuses sibling traversal selections", async () => {
    const data = await installation();
    expect(completeBackupName(new Date(2026, 10, 3, 9))).not.toBe(completeBackupName(new Date(2026, 10, 3, 9)));
    for (const file of ["../billing.sqlite", "C:\\billing.sqlite", "unknown", null]) expect(() => previewBackup(data.folder, file)).toThrow(/listed backups/);
    const target = join(data.folder, completeBackupName());
    await createBackupPackage(data.root, target);
    expect(backupStatus(data.root).copies).toBe(1);
  });

  it("snapshots committed legacy WAL changes instead of copying only the main SQLite file", async () => {
    const data = await installation();
    const file = "billing-backup-2026-11-03-090001.sqlite";
    await data.database.snapshot(join(data.folder, file));
    const activeBackup = new DatabaseSync(join(data.folder, file));
    try {
      activeBackup.exec("PRAGMA journal_mode=WAL");
      activeBackup.prepare("INSERT INTO jewellery_items VALUES(?,?)").run("legacy wal", "Legacy WAL");
      await restoreInstallation(data.root, data.folder, file, { token: data.owner.token, password: "owner password" });
      expect(createLocalDatabase(data.root).jewellery.list()).toContain("Legacy WAL");
    } finally { activeBackup.close(); }
  });
});
