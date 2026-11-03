import { backup, DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, openSync, closeSync, readdirSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { closeLocalDatabasesUnderRoot } from "./local-database";
import { createLocalUsers } from "./local-users";
import { createBillAudit } from "./bill-audit";
import { preventOperationsAfterFailedRecovery, withBackupMaintenance } from "./backup-maintenance";

export const packagePattern = /^billing-backup-\d{4}-\d{2}-\d{2}-\d{6}-[a-f0-9]{8}\.billing-backup$/;
export const legacyPattern = /^billing-backup-\d{4}-\d{2}-\d{2}-\d{6}\.sqlite$/;
export type BackupPreview = { format: "complete" | "legacy"; takenAt: string; businesses: string[]; userCount: number; billCount: number; customerCount: number; ledgerCount: number };
type Entry = { path: string; size: number; sha256: string };
type Manifest = { format: "finance-billing-complete"; version: 1; takenAt: string; files: Entry[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const documentFolders = new Set(["bill-pdfs", "registers", "documents", "settings", "sync-identities"]);
const settingFiles = new Set(["backup-settings.json", "settings.json"]);
function digest(path: string) {
  const descriptor = openSync(path, "r");
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally { closeSync(descriptor); }
}
const failure = () => new Error("That backup is damaged or unsafe. Your current data was not changed.");

export function containedPath(root: string, name: string) {
  const target = resolve(root, name);
  const delta = relative(resolve(root), target);
  if (!delta || delta === ".." || delta.startsWith(".." + sep) || isAbsolute(delta)) throw failure();
  let current = resolve(root);
  if (lstatSync(current).isSymbolicLink()) throw failure();
  for (const part of delta.split(sep)) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) throw failure(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return target;
}

function allowed(name: string) {
  if (name.includes("\\") || name.includes(":") || name.split("/").some(part => !part || part === "." || part === ".." || /[<>"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part))) return false;
  const parts = name.split("/");
  if (parts[0] === "users") {
    if (!uuid.test(parts[1] ?? "")) return false;
    parts.splice(0, 2);
  }
  if (parts.length === 1) return parts[0] === "billing.sqlite" || name === "users.sqlite" || settingFiles.has(parts[0]);
  return documentFolders.has(parts[0]) && !parts.some(part => /(?:^backups?$|\.billing-backup$|\.sqlite(?:-wal|-shm)?$|\.partial$)/i.test(part));
}

function inventory(root: string) {
  const result: string[] = [];
  const walkDocuments = (name: string) => {
    if (!allowed(name) && name.split("/").some(part => /(?:^backups?$|\.billing-backup$|\.partial$)/i.test(part))) return;
    const path = containedPath(root, name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) throw failure();
    if (info.isDirectory()) for (const child of readdirSync(path)) walkDocuments(name + "/" + child);
    else if (info.isFile() && allowed(name)) result.push(name);
    else if (!info.isFile()) throw failure();
  };
  const ledgerFolder = (prefix: string) => {
    const location = prefix ? containedPath(root, prefix) : root;
    for (const name of readdirSync(location)) {
      const owned = prefix ? prefix + "/" + name : name;
      if (name === "billing.sqlite" || (!prefix && name === "users.sqlite") || settingFiles.has(name)) {
        const path = containedPath(root, owned);
        if (!lstatSync(path).isFile()) throw failure();
        result.push(owned);
      } else if (documentFolders.has(name)) walkDocuments(owned);
    }
  };
  ledgerFolder("");
  if (existsSync(join(root, "users"))) {
    const users = containedPath(root, "users");
    for (const name of readdirSync(users)) {
      if (!uuid.test(name)) continue;
      const path = containedPath(root, "users/" + name);
      if (!lstatSync(path).isDirectory()) throw failure();
      ledgerFolder("users/" + name);
    }
  }
  return result.sort();
}

function inspectDatabase(path: string, users: boolean) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw failure();
    if (database.prepare("PRAGMA foreign_key_check").all().length) throw failure();
    const table = (name: string) => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    if (users) {
      if (!table("users") || !table("sessions") || !table("login_attempts")) throw failure();
      const accounts = database.prepare("SELECT id,username,password_hash,administrator,legacy_data,created_at FROM users").all();
      database.prepare("SELECT token_hash,user_id,expires_at FROM sessions LIMIT 0").all();
      database.prepare("SELECT username,failures,locked_until FROM login_attempts LIMIT 0").all();
      if (accounts.some(account => !uuid.test(String(account.id))) || !accounts.some(account => account.administrator === 1)) throw failure();
      return { users: accounts, businesses: [] as string[], bills: 0, customers: 0, syncManaged: false };
    }
    if (!table("records")) throw failure();
    const businesses = database.prepare("SELECT json_extract(body,'$.business_name') AS name FROM records WHERE table_name='business_profiles'").all().map(row => String(row.name ?? "Unnamed business"));
    const bills = Number(database.prepare("SELECT count(*) AS total FROM records WHERE table_name='bills'").get()?.total ?? 0);
    const customers = table("customers") ? Number(database.prepare("SELECT count(*) AS total FROM customers").get()?.total ?? 0) : 0;
    const syncManaged = ["sync_local_issuers", "sync_local_issuer", "sync_outbox", "sync_local_bill_heads", "sync_local_requests", "sync_local_edit_requests"].some(name => table(name) && Number(database.prepare('SELECT count(*) AS total FROM "' + name + '"').get()?.total) > 0);
    return { users: [], businesses, bills, customers, syncManaged };
  } finally { database.close(); }
}

function assertNotSyncManaged(root: string) {
  if (inventory(root).some(name => name.split("/").includes("sync-identities"))) throw new Error("This installation contains sync device credentials. Restore is blocked until an administrator completes sync recovery.");
  for (const name of inventory(root).filter(name => name.endsWith("billing.sqlite"))) {
    if (inspectDatabase(containedPath(root, name), false).syncManaged) throw new Error("This installation is sync-managed. Restore is blocked to avoid replaying old changes or duplicate bill numbers.");
  }
}

function assertNoDatabaseWriter(root: string) {
  for (const name of inventory(root).filter(name => name.endsWith(".sqlite"))) {
    const database = new DatabaseSync(containedPath(root, name));
    try { database.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE; ROLLBACK"); }
    catch { throw new Error("Another database writer is active. Close other billing programs and try again."); }
    finally { database.close(); }
  }
}

function pruneSafetyCopies(root: string) {
  const copies = readdirSync(root).filter(name => /^before-restore-[0-9a-f-]{36}\.billing-backup$/.test(name)).flatMap(name => {
    try { return [{ name, date: verifyBackupPackage(containedPath(root, name)).preview.takenAt }]; } catch { return []; }
  }).sort((first, second) => first.date.localeCompare(second.date));
  for (const copy of copies.slice(0, -5)) rmSync(containedPath(root, copy.name), { recursive: true });
}

export async function createBackupPackage(root: string, destination: string, now = new Date()) {
  const files = inventory(root);
  if (!files.some(name => name.endsWith(".sqlite"))) throw new Error("No billing database was found to back up.");
  mkdirSync(destination, { recursive: false });
  const entries: Entry[] = [];
  for (const name of files) {
    const source = containedPath(root, name);
    const target = containedPath(destination, name);
    mkdirSync(dirname(target), { recursive: true });
    if (name.endsWith(".sqlite")) {
      const database = new DatabaseSync(source, { readOnly: true });
      try { await backup(database, target); } finally { database.close(); }
      const snapshot = new DatabaseSync(target);
      try { snapshot.exec("PRAGMA journal_mode=DELETE"); } finally { snapshot.close(); }
      inspectDatabase(target, name === "users.sqlite");
    } else copyFileSync(source, target);
    entries.push({ path: name, size: lstatSync(target).size, sha256: digest(target) });
  }
  const manifest: Manifest = { format: "finance-billing-complete", version: 1, takenAt: now.toISOString(), files: entries };
  writeFileSync(join(destination, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
  verifyBackupPackage(destination);
  return manifest;
}

export function verifyBackupPackage(directory: string): { manifest: Manifest; preview: BackupPreview } {
  try {
    const manifestPath = containedPath(directory, "manifest.json");
    if (lstatSync(manifestPath).size > 16 * 1024 * 1024) throw failure();
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    if (manifest.format !== "finance-billing-complete" || manifest.version !== 1 || !Number.isFinite(Date.parse(manifest.takenAt)) || !Array.isArray(manifest.files) || manifest.files.length > 100000) throw failure();
    const seen = new Set<string>();
    const preview: BackupPreview = { format: "complete", takenAt: manifest.takenAt, businesses: [], userCount: 0, billCount: 0, customerCount: 0, ledgerCount: 0 };
    for (const entry of manifest.files) {
      if (typeof entry.path !== "string" || !allowed(entry.path) || seen.has(entry.path.toLowerCase()) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw failure();
      seen.add(entry.path.toLowerCase());
      const path = containedPath(directory, entry.path);
      if (!lstatSync(path).isFile() || lstatSync(path).size !== entry.size || digest(path) !== entry.sha256) throw failure();
      if (entry.path.endsWith(".sqlite")) {
        const info = inspectDatabase(path, entry.path === "users.sqlite");
        if (entry.path === "users.sqlite") preview.userCount = info.users.length;
        else { preview.ledgerCount++; preview.businesses.push(...info.businesses); preview.billCount += info.bills; preview.customerCount += info.customers; }
      }
    }
    if (!preview.ledgerCount && !seen.has("users.sqlite")) throw failure();
    const walk = (name: string) => {
      const path = containedPath(directory, name);
      if (lstatSync(path).isDirectory()) for (const child of readdirSync(path)) walk(name + "/" + child);
      else if (name !== "manifest.json" && !seen.has(name.toLowerCase())) throw failure();
    };
    for (const name of readdirSync(directory)) walk(name);
    return { manifest, preview };
  } catch { throw failure(); }
}

export function selectedBackup(folder: string, file: unknown) {
  if (typeof file !== "string" || (!packagePattern.test(file) && !legacyPattern.test(file))) throw new Error("Choose one of the listed backups.");
  const path = containedPath(folder, file);
  if (!existsSync(path)) throw new Error("That backup is no longer in the backup folder.");
  return path;
}

export function previewBackup(folder: string, file: unknown): BackupPreview {
  const path = selectedBackup(folder, file);
  if (typeof file === "string" && packagePattern.test(file)) return verifyBackupPackage(path).preview;
  try {
    const info = inspectDatabase(path, false);
    const parts = /^billing-backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.sqlite$/.exec(String(file))!.slice(1).map(Number);
    const takenAt = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]).toISOString();
    return { format: "legacy", takenAt, businesses: info.businesses, userCount: 0, billCount: info.bills, customerCount: info.customers, ledgerCount: 1 };
  } catch { throw failure(); }
}

export function completeBackupName(now = new Date()) {
  const date = now.toISOString().replace(/[:T]/g, "").replace(/(\d{4}-\d{2}-\d{2})(\d{6}).*/, "$1-$2");
  return "billing-backup-" + date + "-" + randomUUID().slice(0, 8) + ".billing-backup";
}

export async function restoreInstallation(root: string, folder: string, file: unknown, credentials: { token: unknown; password: unknown }, options: { now?: Date; afterApply?: (path: string) => void } = {}) {
  return withBackupMaintenance(root, async () => {
    if (!existsSync(containedPath(root, "users.sqlite"))) throw new Error("Administrator sign-in is required.");
    const authentication = createLocalUsers(root);
    let recoveryActor = "Administrator";
    try { recoveryActor = (await authentication.reauthenticateAdministrator(credentials.token, credentials.password)).username; } finally { authentication.close(); }
    const source = selectedBackup(folder, file);
    const preview = previewBackup(folder, file);
    assertNotSyncManaged(root);
    if (preview.format === "complete") assertNotSyncManaged(source);
    else if (inspectDatabase(source, false).syncManaged) throw new Error("This legacy backup is sync-managed and cannot be restored safely.");
    assertNoDatabaseWriter(root);
    const safetyRoot = containedPath(root, "backups");
    mkdirSync(safetyRoot, { recursive: true });
    const safetyCopy = "before-restore-" + randomUUID() + ".billing-backup";
    const transaction = containedPath(root, ".billing-restore-" + randomUUID());
    const marker = containedPath(root, ".billing-maintenance.lock");
    const lock = openSync(marker, "wx");
    closeSync(lock);
    let rollbackFailed = false;
    try {
      await createBackupPackage(root, containedPath(safetyRoot, safetyCopy), options.now);
      writeFileSync(marker, JSON.stringify({ safetyCopy: join(safetyRoot, safetyCopy), transaction, status: "restore-in-progress" }));
      mkdirSync(transaction);
      const stage = join(transaction, "staged");
      const originals = join(transaction, "originals");
      mkdirSync(stage); mkdirSync(originals);
      const entries = preview.format === "complete" ? verifyBackupPackage(source).manifest.files.map(entry => entry.path) : ["billing.sqlite"];
      for (const name of entries) {
        const target = containedPath(stage, name);
        mkdirSync(dirname(target), { recursive: true });
        if (preview.format === "complete") copyFileSync(containedPath(source, name), target);
        else {
          const database = new DatabaseSync(source, { readOnly: true });
          try { await backup(database, target); } finally { database.close(); }
          const snapshot = new DatabaseSync(target);
          try { snapshot.exec("PRAGMA journal_mode=DELETE"); } finally { snapshot.close(); }
        }
      }
      if (preview.format === "complete") {
        copyFileSync(join(source, "manifest.json"), join(stage, "manifest.json"));
        verifyBackupPackage(stage);
        rmSync(join(stage, "manifest.json"));
      } else inspectDatabase(join(stage, "billing.sqlite"), false);
      if (entries.includes("users.sqlite")) {
        const users = new DatabaseSync(join(stage, "users.sqlite"));
        try { users.exec("DELETE FROM sessions; PRAGMA journal_mode=DELETE"); } finally { users.close(); }
      }
      closeLocalDatabasesUnderRoot(root);
      assertNoDatabaseWriter(root);
      const managed = preview.format === "complete" ? inventory(root) : ["billing.sqlite"];
      const affected = [...new Set([...managed, ...entries])];
      if (!entries.includes("users.sqlite") && existsSync(join(root, "users.sqlite"))) {
        const users = new DatabaseSync(join(root, "users.sqlite"));
        try { users.exec("DELETE FROM sessions"); } finally { users.close(); }
      }
      const moved: string[] = [];
      const installed: string[] = [];
      try {
        for (const name of affected) {
          const live = containedPath(root, name);
          for (const candidate of name.endsWith(".sqlite") ? [name, name + "-wal", name + "-shm"] : [name]) {
            const path = containedPath(root, candidate);
            if (!existsSync(path)) continue;
            const saved = containedPath(originals, candidate);
            mkdirSync(dirname(saved), { recursive: true });
            renameSync(path, saved); moved.push(candidate);
          }
          if (entries.includes(name)) {
            mkdirSync(dirname(live), { recursive: true });
            renameSync(containedPath(stage, name), live); installed.push(name);
            options.afterApply?.(name);
          }
        }
        for (const name of entries.filter(name => name === "billing.sqlite" || name.endsWith("/billing.sqlite"))) {
          const ledger = new DatabaseSync(containedPath(root, name));
          try { createBillAudit(ledger).restored(recoveryActor); } finally { ledger.close(); }
        }
      } catch (error) {
        try {
          for (const name of installed.reverse()) rmSync(containedPath(root, name));
          for (const name of moved.reverse()) {
            const target = containedPath(root, name);
            mkdirSync(dirname(target), { recursive: true });
            renameSync(containedPath(originals, name), target);
          }
        } catch {
          rollbackFailed = true;
          preventOperationsAfterFailedRecovery(root);
          throw new Error("Recovery could not roll back completely. Stop using this installation. Keep the backups and .billing-restore folder for administrator recovery.");
        }
        throw new Error("Restore failed and was rolled back. The complete safety backup is kept in " + join(safetyRoot, safetyCopy), { cause: error });
      }
      try { pruneSafetyCopies(safetyRoot); } catch { }
      return { restored: file, safetyCopy, signOut: true, restartRequired: true, preview };
    } finally {
      if (!rollbackFailed) {
        if (existsSync(transaction)) rmSync(containedPath(root, relative(root, transaction)), { recursive: true, force: true });
        rmSync(marker, { force: true });
      }
    }
  });
}
