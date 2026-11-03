import { backup, DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { completeBackupName, containedPath, createBackupPackage, packagePattern, verifyBackupPackage } from "./backup-package";
import { preventOperationsAfterFailedRecovery, withBackupMaintenance } from "./backup-maintenance";
import { closeLocalDatabasesUnderRoot } from "./local-database";
export { previewBackup, restoreInstallation } from "./backup-package";
export type { BackupPreview } from "./backup-package";

/** Owner-chosen folder (for example a USB drive) that receives a dated copy of the ledger. */
export const backupKeepCount = 30;
export const safetyCopyKeepCount = 5;
export const backupIntervalMs = 24 * 60 * 60 * 1000;
const settingsName = "backup-settings.json";
const filePattern = /^billing-backup-\d{4}-\d{2}-\d{2}-\d{6}\.sqlite$/;
const folderHelp = "Enter the full path of the backup folder, for example D:\\Billing Backups.";

export type BackupStatus = { folder: string | null; lastBackupAt: string | null; lastFile: string | null; lastError: string | null; due: boolean; copies: number };
type Settings = { folder: string | null; lastBackupAt: string | null; lastFile: string | null; lastError: string | null };
type Snapshotter = { snapshot: (target: string) => Promise<void> };
type Restorable = Snapshotter & { close: () => void };
export type BackupCopy = { file: string; takenAt: string; size: number };

function readSettings(directory: string): Settings {
  try {
    const value = JSON.parse(readFileSync(containedPath(directory, settingsName), "utf8"));
    const text = (field: unknown) => typeof field === "string" && field ? field : null;
    return { folder: text(value.folder), lastBackupAt: text(value.lastBackupAt), lastFile: text(value.lastFile), lastError: text(value.lastError) };
  } catch { return { folder: null, lastBackupAt: null, lastFile: null, lastError: null }; }
}
function writeSettings(directory: string, settings: Settings) {
  const target = containedPath(directory, settingsName);
  const temporary = containedPath(directory, settingsName + "." + randomUUID() + ".tmp");
  try {
    writeFileSync(temporary, JSON.stringify(settings, null, 2), { flag: "wx" });
    renameSync(temporary, target);
  } finally { rmSync(temporary, { force: true }); }
}
function copies(folder: string | null) {
  if (!folder) return [];
  try { return readdirSync(folder).filter(name => filePattern.test(name) || packagePattern.test(name)).sort(); } catch { return []; }
}
function stamp(now: Date) {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function backupStatus(directory: string, now = new Date()): BackupStatus {
  const settings = readSettings(directory);
  const last = settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : NaN;
  return { ...settings, due: Boolean(settings.folder) && (!Number.isFinite(last) || now.getTime() - last >= backupIntervalMs), copies: copies(settings.folder).length };
}

/** Resolves short Windows names, links and capital letters so two spellings of one folder compare equal. */
function canonical(path: string) {
  let existing = resolve(path); let rest = "";
  while (!existsSync(existing) && dirname(existing) !== existing) { rest = join(existing.slice(dirname(existing).length + 1), rest); existing = dirname(existing); }
  let real = existing;
  try { real = realpathSync.native(existing); } catch { /* keep the spelling we were given */ }
  const full = rest ? join(real, rest) : real;
  return process.platform === "win32" ? full.toLowerCase() : full;
}

/** Rejects folders inside the data folder (they would be lost with it) and folders that cannot be written. */
export function chooseBackupFolder(directory: string, requested: unknown) {
  if (typeof requested !== "string" || !requested.trim() || requested.length > 400 || !isAbsolute(requested.trim())) throw new Error(folderHelp);
  const folder = resolve(requested.trim());
  const inside = relative(canonical(directory), canonical(folder));
  if (!inside || (inside !== ".." && !inside.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) && !isAbsolute(inside))) throw new Error("Choose a folder outside the billing data folder, such as a USB drive or another disk.");
  try {
    mkdirSync(folder, { recursive: true });
    if (!statSync(folder).isDirectory()) throw new Error("not a folder");
    const probe = containedPath(folder, ".write-test-" + randomUUID());
    writeFileSync(probe, "ok", { flag: "wx" }); rmSync(probe);
  } catch { throw new Error("The billing app cannot write to that folder. Check the drive is connected and choose another folder."); }
  writeSettings(directory, { ...readSettings(directory), folder, lastError: null });
  return folder;
}

/** Backs up now, or only when a day has passed when `onlyIfDue` is set. The copy is verified before it counts. */
export async function runBackup(directory: string, db: Snapshotter, options: { onlyIfDue?: boolean; now?: Date } = {}): Promise<BackupStatus> {
  const now = options.now ?? new Date();
  const settings = readSettings(directory);
  if (!settings.folder) throw new Error("Choose a backup folder first.");
  if (options.onlyIfDue && !backupStatus(directory, now).due) return backupStatus(directory, now);
  const name = `billing-backup-${stamp(now)}.sqlite`;
  const partial = resolve(settings.folder, `${name}.partial`);
  try {
    if (!existsSync(settings.folder)) mkdirSync(settings.folder, { recursive: true });
    await db.snapshot(partial);
    // Turn the copy into one self-contained file (no -wal/-shm companions) before checking it.
    const check = new DatabaseSync(partial);
    try {
      check.exec("PRAGMA journal_mode=DELETE");
      const rows = check.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
      if (rows.length !== 1 || rows[0].integrity_check !== "ok") throw new Error("The backup copy failed its integrity check.");
    } finally { check.close(); }
    renameSync(partial, resolve(settings.folder, name));
    for (const old of copies(settings.folder).filter(name => filePattern.test(name)).slice(0, -backupKeepCount)) rmSync(containedPath(settings.folder, old), { force: true });
    writeSettings(directory, { ...settings, lastBackupAt: now.toISOString(), lastFile: name, lastError: null });
  } catch (error) {
    for (const leftover of [partial, `${partial}-wal`, `${partial}-shm`]) rmSync(leftover, { force: true });
    const reason = error instanceof Error && error.message.includes("integrity") ? error.message : "The backup could not be saved. Check the backup drive is connected and has free space.";
    writeSettings(directory, { ...settings, lastError: reason });
    throw new Error(reason);
  }
  return backupStatus(directory, now);
}

/** Newest first, so the owner picks from a dated list instead of typing file names. */
export function listBackups(directory: string): BackupCopy[] {
  const { folder } = readSettings(directory);
  if (!folder) return [];
  const result: BackupCopy[] = [];
  for (const file of copies(folder).reverse()) {
    if (packagePattern.test(file)) {
      try {
        const { manifest, preview } = verifyBackupPackage(containedPath(folder, file));
        result.push({ file, takenAt: preview.takenAt, size: manifest.files.reduce((total, entry) => total + entry.size, 0) });
      } catch { }
      continue;
    }
    const parts = /^billing-backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.sqlite$/.exec(file)!.slice(1).map(Number);
    const taken = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
    try { result.push({ file, takenAt: taken.toISOString(), size: statSync(resolve(folder, file)).size }); } catch { /* removed since listing */ }
  }
  return result;
}

export async function runCompleteBackup(directory: string, options: { onlyIfDue?: boolean; now?: Date } = {}): Promise<BackupStatus> {
  return withBackupMaintenance(directory, async () => {
    const now = options.now ?? new Date();
    const settings = readSettings(directory);
    if (!settings.folder) throw new Error("Choose a backup folder first.");
    if (options.onlyIfDue && !backupStatus(directory, now).due) return backupStatus(directory, now);
    chooseBackupFolder(directory, settings.folder);
    const name = completeBackupName(now);
    const partial = containedPath(settings.folder, name + ".partial");
    try {
      await createBackupPackage(directory, partial, now);
      renameSync(partial, containedPath(settings.folder, name));
      writeSettings(directory, { ...settings, lastBackupAt: now.toISOString(), lastFile: name, lastError: null });
      const complete = listBackups(directory).filter(copy => packagePattern.test(copy.file)).sort((first, second) => first.takenAt.localeCompare(second.takenAt));
      for (const old of complete.slice(0, -backupKeepCount)) rmSync(containedPath(settings.folder, old.file), { recursive: true });
    } catch (error) {
      if (existsSync(partial)) rmSync(containedPath(settings.folder, name + ".partial"), { recursive: true, force: true });
      const reason = error instanceof Error ? error.message : "The complete backup could not be saved.";
      writeSettings(directory, { ...settings, lastError: reason });
      throw new Error(reason);
    }
    return backupStatus(directory, now);
  });
}

function verifyLedger(path: string) {
  let check: DatabaseSync | null = null;
  try {
    check = new DatabaseSync(path, { readOnly: true });
    const rows = check.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
    const ledger = check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='records'").get() as { n: number };
    return rows.length === 1 && rows[0].integrity_check === "ok" && ledger.n === 1;
  } catch { return false; } finally { check?.close(); }
}

/**
 * Replaces the live ledger with a chosen backup. The backup is verified first and the current ledger
 * is copied to <data folder>/backups/before-restore-* so the restore itself can be undone.
 */
export async function restoreBackup(directory: string, db: Restorable, file: unknown, now = new Date()) {
  return withBackupMaintenance(directory, async () => {
    if (existsSync(join(directory, "users.sqlite"))) throw new Error("Use administrator installation recovery to restore an installation with local users.");
    const { folder } = readSettings(directory);
    if (!folder) throw new Error("Choose a backup folder first.");
    if (typeof file !== "string" || !filePattern.test(file)) throw new Error("Choose one of the listed backups.");
    const source = containedPath(folder, file);
    if (!existsSync(source)) throw new Error("That backup is no longer in the backup folder. Check the drive is connected.");
    if (!verifyLedger(source)) throw new Error("That backup file is damaged and was not restored. Your current bills were not changed.");
    const safety = containedPath(directory, "backups");
    mkdirSync(safety, { recursive: true });
    const safetyName = "before-restore-" + stamp(now) + ".sqlite";
    await db.snapshot(containedPath(safety, safetyName));
    const normalize = new DatabaseSync(containedPath(safety, safetyName));
    try { normalize.exec("PRAGMA journal_mode=DELETE"); } finally { normalize.close(); }
    if (!verifyLedger(containedPath(safety, safetyName))) throw new Error("The safety backup failed verification. Your bills were not changed.");
    const transaction = containedPath(directory, ".legacy-restore-" + randomUUID());
    mkdirSync(transaction);
    const staged = containedPath(transaction, "billing.sqlite");
    const moved: string[] = [];
    let installed = false;
    let rollbackFailed = false;
    try {
      const snapshotSource = new DatabaseSync(source, { readOnly: true });
      try { await backup(snapshotSource, staged); } finally { snapshotSource.close(); }
      const snapshot = new DatabaseSync(staged);
      try { snapshot.exec("PRAGMA journal_mode=DELETE"); } finally { snapshot.close(); }
      if (!verifyLedger(staged)) throw new Error("The staged backup is damaged.");
      db.close(); closeLocalDatabasesUnderRoot(directory);
      for (const name of ["billing.sqlite", "billing.sqlite-wal", "billing.sqlite-shm"]) {
        const live = containedPath(directory, name);
        if (existsSync(live)) { renameSync(live, containedPath(transaction, "original-" + name)); moved.push(name); }
      }
      renameSync(staged, containedPath(directory, "billing.sqlite")); installed = true;
    } catch (error) {
      try {
        if (installed) rmSync(containedPath(directory, "billing.sqlite"));
        for (const name of moved.reverse()) renameSync(containedPath(transaction, "original-" + name), containedPath(directory, name));
      } catch {
        rollbackFailed = true;
        preventOperationsAfterFailedRecovery(directory);
        throw new Error("Rollback failed. Stop using this installation and keep the safety backup and .legacy-restore folder for administrator recovery.");
      }
      throw new Error("The backup could not be restored and was rolled back. Your bills were not changed.", { cause: error });
    } finally { if (!rollbackFailed) rmSync(containedPath(directory, relative(directory, transaction)), { recursive: true, force: true }); }
    const old = readdirSync(safety).filter(name => /^before-restore-.*\.sqlite$/.test(name)).sort();
    for (const name of old.slice(0, -safetyCopyKeepCount)) rmSync(containedPath(safety, name), { force: true });
    return { restored: file, safetyCopy: safetyName };
  });
}
