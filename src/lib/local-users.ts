import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { hashLocalPassword, verifyLocalPassword } from "./local-password";

export type LocalUser = { id: string; username: string; administrator: boolean; legacyData: boolean };
const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
function username(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}$/.test(value.trim())) throw new Error("Username must be 3–40 letters, numbers, dots, underscores or hyphens.");
  return value.trim();
}

/** Separate authentication database; no billing records or plaintext passwords are stored here. */
export function createLocalUsers(directory: string) {
  const root = resolve(directory); mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(join(root, "users.sqlite"));
  db.exec(`PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL, administrator INTEGER NOT NULL, legacy_data INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS login_attempts (username TEXT PRIMARY KEY COLLATE NOCASE, failures INTEGER NOT NULL, locked_until INTEGER NOT NULL);`);
  const rowToUser = (row: any): LocalUser => ({ id: String(row.id), username: String(row.username), administrator: Boolean(row.administrator), legacyData: Boolean(row.legacy_data) });
  const active = (token: unknown): LocalUser | null => {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = db.prepare("SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?").get(tokenHash(token), Date.now());
    return row ? rowToUser(row) : null;
  };
  const requireAdmin = (token: unknown) => { const user = active(token); if (!user?.administrator) throw new Error("Administrator sign-in is required."); return user; };
  return {
    needsSetup: () => Number(db.prepare("SELECT count(*) AS n FROM users").get()?.n) === 0,
    async create(name: unknown, password: unknown, adminToken?: string) {
      const nameValue = username(name);
      const hash = await hashLocalPassword(password as string);
      db.exec("BEGIN IMMEDIATE");
      try {
        const first = Number(db.prepare("SELECT count(*) AS n FROM users").get()?.n) === 0;
        if (!first) requireAdmin(adminToken);
        const id = randomUUID();
        db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(id, nameValue, hash, first ? 1 : 0, first ? 1 : 0, new Date().toISOString());
        db.exec("COMMIT");
        return { id, username: nameValue, administrator: first, legacyData: first };
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    async login(name: unknown, password: unknown) {
      const nameValue = username(name);
      const attempts = db.prepare("SELECT locked_until FROM login_attempts WHERE username=? COLLATE NOCASE").get(nameValue);
      if (Number(attempts?.locked_until ?? 0) > Date.now()) throw new Error("Too many sign-in attempts. Try again in five minutes.");
      const row = db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").get(nameValue) as any;
      const dummy = `scrypt-v1$${"0".repeat(32)}$${"0".repeat(128)}`;
      const matches = await verifyLocalPassword(password, row?.password_hash ?? dummy);
      if (!row || !matches) {
        db.prepare(`INSERT INTO login_attempts(username,failures,locked_until) VALUES(?,1,0)
          ON CONFLICT(username) DO UPDATE SET failures=CASE WHEN locked_until>0 AND locked_until<=? THEN 1 ELSE failures+1 END,
          locked_until=CASE WHEN locked_until>0 AND locked_until<=? THEN 0 WHEN failures+1>=5 THEN ? ELSE locked_until END`).run(nameValue, Date.now(), Date.now(), Date.now()+5*60*1000);
        throw new Error("Username or password is incorrect.");
      }
      const token = randomBytes(32).toString("hex");
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = db.prepare("SELECT password_hash FROM users WHERE id=?").get(row.id);
        if (!current || current.password_hash !== row.password_hash) throw new Error("Username or password is incorrect.");
        db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
        db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(tokenHash(token), row.id, Date.now() + sessionLifetimeMs);
        db.prepare("DELETE FROM login_attempts WHERE username=? COLLATE NOCASE").run(nameValue);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return { token, user: rowToUser(row) };
    },
    session: active,
    logout(token: string) { db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token)); },
    list(adminToken: string) { requireAdmin(adminToken); return db.prepare("SELECT * FROM users ORDER BY created_at,id").all().map(rowToUser); },
    async resetPassword(adminToken: string, userId: string, password: string) {
      requireAdmin(adminToken);
      const hash = await hashLocalPassword(password);
      db.exec("BEGIN IMMEDIATE");
      try {
        requireAdmin(adminToken);
        if (!db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash, userId).changes) throw new Error("User not found.");
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
        db.prepare("DELETE FROM login_attempts WHERE username=(SELECT username FROM users WHERE id=?)").run(userId);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    close() { db.close(); },
  };
}
