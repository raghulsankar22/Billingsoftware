import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupIntervalMs, backupKeepCount, backupStatus, chooseBackupFolder, listBackups, restoreBackup, runBackup, safetyCopyKeepCount } from "./backups";
import { createLocalDatabase } from "./local-database";

const made: string[] = [];
const opened: ReturnType<typeof createLocalDatabase>[] = [];
const temp = (prefix: string) => { const directory = mkdtempSync(join(tmpdir(), prefix)); made.push(directory); return directory; };
afterEach(() => { for (const db of opened.splice(0)) { try { db.close(); } catch { /* a restore already closed it */ } } for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function ledger() { const directory = temp("billing-data-"); const db = createLocalDatabase(directory); opened.push(db); return { directory, db }; }

describe("backups", () => {
  it("has nothing due until a folder is chosen", () => {
    const { directory } = ledger();
    expect(backupStatus(directory)).toMatchObject({ folder: null, due: false, copies: 0 });
  });

  it("copies the ledger to the chosen folder and verifies the copy opens", async () => {
    const { directory, db } = ledger(); const folder = temp("billing-usb-");
    chooseBackupFolder(directory, folder);
    const status = await runBackup(directory, db, { now: new Date(2026, 10, 3, 18, 10, 5) });
    expect(status.lastFile).toBe("billing-backup-2026-11-03-181005.sqlite");
    expect(status).toMatchObject({ copies: 1, due: false, lastError: null });
    const copy = new DatabaseSync(join(folder, status.lastFile!), { readOnly: true });
    expect(copy.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='records'").get()).toEqual({ n: 1 });
    copy.close();
    expect(readdirSync(folder).some(name => name.endsWith(".partial"))).toBe(false);
  });

  it("backs up automatically only once a day", async () => {
    const { directory, db } = ledger(); const folder = temp("billing-usb-");
    chooseBackupFolder(directory, folder);
    const first = new Date(2026, 10, 3, 9, 0, 0);
    await runBackup(directory, db, { onlyIfDue: true, now: first });
    await runBackup(directory, db, { onlyIfDue: true, now: new Date(first.getTime() + 60 * 60 * 1000) });
    expect(readdirSync(folder)).toHaveLength(1);
    const next = new Date(first.getTime() + backupIntervalMs);
    expect(backupStatus(directory, next).due).toBe(true);
    await runBackup(directory, db, { onlyIfDue: true, now: next });
    expect(readdirSync(folder)).toHaveLength(2);
  });

  it("keeps only the newest thirty copies and never touches other files", async () => {
    const { directory, db } = ledger(); const folder = temp("billing-usb-");
    chooseBackupFolder(directory, folder);
    writeFileSync(join(folder, "holiday-photos.txt"), "keep me");
    for (let day = 0; day < backupKeepCount + 3; day++) await runBackup(directory, db, { now: new Date(2026, 0, 1 + day, 9) });
    const files = readdirSync(folder);
    expect(files.filter(name => name.endsWith(".sqlite"))).toHaveLength(backupKeepCount);
    expect(files).toContain("holiday-photos.txt");
    expect(files).not.toContain("billing-backup-2026-01-01-090000.sqlite");
  });

  it("refuses unusable folders and reports a failed backup without losing the last good one", async () => {
    const { directory, db } = ledger(); const folder = temp("billing-usb-");
    expect(() => chooseBackupFolder(directory, "")).toThrow(/full path/);
    expect(() => chooseBackupFolder(directory, "relative/folder")).toThrow(/full path/);
    expect(() => chooseBackupFolder(directory, join(directory, "backups"))).toThrow(/outside the billing data folder/);
    expect(() => chooseBackupFolder(directory, directory)).toThrow(/outside the billing data folder/);
    // A different spelling of the same folder (capital letters on Windows, a folder that does not exist yet) is still inside it.
    if (process.platform === "win32") expect(() => chooseBackupFolder(directory, join(directory.toUpperCase(), "Backups"))).toThrow(/outside the billing data folder/);
    expect(() => chooseBackupFolder(directory, join(directory, "new", "deeper"))).toThrow(/outside the billing data folder/);
    await expect(runBackup(directory, db)).rejects.toThrow(/Choose a backup folder/);
    chooseBackupFolder(directory, folder);
    const good = await runBackup(directory, db, { now: new Date(2026, 10, 3, 9) });
    await expect(runBackup(directory, { snapshot: async () => { throw new Error("disk removed"); } }, { now: new Date(2026, 10, 4, 9) })).rejects.toThrow(/could not be saved/);
    const after = backupStatus(directory, new Date(2026, 10, 4, 9));
    expect(after.lastFile).toBe(good.lastFile);
    expect(after.lastError).toMatch(/could not be saved/);
    expect(after.due).toBe(true);
  });
});

describe("restoring a backup", () => {
  const names = (db: ReturnType<typeof createLocalDatabase>) => db.jewellery.list() as string[];

  it("brings back the backed-up bills and keeps the replaced ones as a safety copy", async () => {
    const { directory, db } = ledger(); const folder = temp("billing-usb-");
    chooseBackupFolder(directory, folder);
    db.jewellery.add("Zzz Before Backup");
    const status = await runBackup(directory, db, { now: new Date(2026, 10, 3, 9) });
    db.jewellery.add("Zzz After Backup");
    expect(names(db)).toContain("Zzz After Backup");

    const listed = listBackups(directory);
    expect(listed.map(copy => copy.file)).toEqual([status.lastFile]);
    const result = await restoreBackup(directory, db, status.lastFile, new Date(2026, 10, 3, 18));

    const reopened = createLocalDatabase(directory); opened.push(reopened);
    expect(names(reopened)).toContain("Zzz Before Backup");
    expect(names(reopened)).not.toContain("Zzz After Backup");
    const safety = new DatabaseSync(join(directory, "backups", result.safetyCopy), { readOnly: true });
    expect(safety.prepare("SELECT count(*) AS n FROM jewellery_items WHERE name='Zzz After Backup'").get()).toEqual({ n: 1 });
    safety.close();
    expect(readdirSync(directory).filter(name => name.endsWith(".restoring") || name.endsWith("-wal") && name !== "billing.sqlite-wal")).toEqual([]);
    // The restored ledger is a normal working ledger: new work still saves.
    reopened.jewellery.add("Zzz Later");
    expect(names(reopened)).toContain("Zzz Later");
  });

  it("refuses unknown, missing and damaged backups without touching current bills", async () => {
    const { directory, db } = ledger(); const folder = temp("billing-usb-");
    await expect(restoreBackup(directory, db, "billing-backup-2026-11-03-090000.sqlite")).rejects.toThrow(/Choose a backup folder/);
    chooseBackupFolder(directory, folder);
    db.jewellery.add("Zzz Keep Me");
    for (const bad of ["../billing.sqlite", "C:\\x.sqlite", "notes.txt", undefined, 5]) await expect(restoreBackup(directory, db, bad)).rejects.toThrow(/Choose one of the listed backups/);
    await expect(restoreBackup(directory, db, "billing-backup-2026-11-03-090000.sqlite")).rejects.toThrow(/no longer in the backup folder/);
    writeFileSync(join(folder, "billing-backup-2026-11-03-090000.sqlite"), "this is not a database");
    await expect(restoreBackup(directory, db, "billing-backup-2026-11-03-090000.sqlite")).rejects.toThrow(/damaged/);
    const other = new DatabaseSync(join(folder, "billing-backup-2026-11-03-100000.sqlite")); other.exec("CREATE TABLE unrelated(x)"); other.close();
    await expect(restoreBackup(directory, db, "billing-backup-2026-11-03-100000.sqlite")).rejects.toThrow(/damaged/);
    expect(names(db)).toContain("Zzz Keep Me");
    expect(existsSync(join(directory, "backups"))).toBe(false);
  });

  it("keeps only the five newest safety copies", async () => {
    const { directory, db } = ledger(); const folder = temp("billing-usb-");
    chooseBackupFolder(directory, folder);
    const status = await runBackup(directory, db, { now: new Date(2026, 10, 3, 9) });
    for (let minute = 0; minute < safetyCopyKeepCount + 2; minute++) {
      await restoreBackup(directory, createLocalDatabase(directory), status.lastFile, new Date(2026, 10, 3, 10, minute));
    }
    const kept = readdirSync(join(directory, "backups")).filter(name => name.startsWith("before-restore"));
    expect(kept).toHaveLength(safetyCopyKeepCount);
    expect(kept).not.toContain("before-restore-2026-11-03-100000.sqlite");
    opened.push(createLocalDatabase(directory));
  });
});
