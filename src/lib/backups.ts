import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

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
    const value = JSON.parse(readFileSync(resolve(directory, settingsName), "utf8"));
    const text = (field: unknown) => typeof field === "string" && field ? field : null;
    return { folder: text(value.folder), lastBackupAt: text(value.lastBackupAt), lastFile: text(value.lastFile), lastError: text(value.lastError) };
  } catch { return { folder: null, lastBackupAt: null, lastFile: null, lastError: null }; }
}
function writeSettings(directory: string, settings: Settings) {
  const target = resolve(directory, settingsName);
  writeFileSync(`${target}.tmp`, JSON.stringify(settings, null, 2));
  renameSync(`${target}.tmp`, target);
}
function copies(folder: string | null) {
  if (!folder) return [];
  try { return readdirSync(folder).filter(name => filePattern.test(name)).sort(); } catch { return []; }
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
  if (!inside || (!inside.startsWith("..") && !isAbsolute(inside))) throw new Error("Choose a folder outside the billing data folder, such as a USB drive or another disk.");
  try {
    mkdirSync(folder, { recursive: true });
    if (!statSync(folder).isDirectory()) throw new Error("not a folder");
    const probe = resolve(folder, `.write-test-${process.pid}`);
    writeFileSync(probe, "ok"); rmSync(probe);
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
    for (const old of copies(settings.folder).slice(0, -backupKeepCount)) rmSync(resolve(settings.folder, old), { force: true });
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
    const parts = /^billing-backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.sqlite$/.exec(file)!.slice(1).map(Number);
    const taken = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
    try { result.push({ file, takenAt: taken.toISOString(), size: statSync(resolve(folder, file)).size }); } catch { /* removed since listing */ }
  }
  return result;
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
  const { folder } = readSettings(directory);
  if (!folder) throw new Error("Choose a backup folder first.");
  if (typeof file !== "string" || !filePattern.test(file)) throw new Error("Choose one of the listed backups.");
  const source = resolve(folder, file);
  if (!existsSync(source)) throw new Error("That backup is no longer in the backup folder. Check the drive is connected.");
  if (!verifyLedger(source)) throw new Error("That backup file is damaged and was not restored. Your current bills were not changed.");
  const safety = resolve(directory, "backups");
  mkdirSync(safety, { recursive: true });
  const safetyName = `before-restore-${stamp(now)}.sqlite`;
  await db.snapshot(resolve(safety, safetyName));
  const live = resolve(directory, "billing.sqlite");
  const staged = `${live}.restoring`;
  try {
    copyFileSync(source, staged);
    db.close();
    // A leftover write-ahead log would otherwise be replayed into the restored ledger.
    for (const extra of [`${live}-wal`, `${live}-shm`]) rmSync(extra, { force: true });
    renameSync(staged, live);
  } catch {
    rmSync(staged, { force: true });
    throw new Error("The backup could not be restored. Close other copies of the billing app and try again. Your bills were not changed.");
  }
  const old = readdirSync(safety).filter(name => /^before-restore-.*\.sqlite$/.test(name)).sort();
  for (const name of old.slice(0, -safetyCopyKeepCount)) rmSync(resolve(safety, name), { force: true });
  return { restored: file, safetyCopy: safetyName };
}
