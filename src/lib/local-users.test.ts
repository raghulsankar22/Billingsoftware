import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalUsers } from "./local-users";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
it("assigns existing data to the first administrator and limits user creation and password resets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "billing-users-")); directories.push(directory);
  const users = createLocalUsers(directory);
  try {
    expect(users.needsSetup()).toBe(true);
    const owner = await users.create("owner", "password one");
    expect(owner).toMatchObject({ administrator: true, legacyData: true });
    await expect(users.create("father", "password two")).rejects.toThrow("Administrator");
    await expect(users.login("owner", "wrong password")).rejects.toThrow("incorrect");
    const admin = await users.login("OWNER", "password one");
    const father = await users.create("father", "password two", admin.token);
    expect(father).toMatchObject({ administrator: false, legacyData: false });
    const session = await users.login("father", "password two");
    expect(users.session(session.token)?.id).toBe(father.id);
    await expect(users.resetPassword(session.token, owner.id, "another password")).rejects.toThrow("Administrator");
    await users.resetPassword(admin.token, father.id, "new password");
    expect(users.session(session.token)).toBeNull();
    await expect(users.login("father", "password two")).rejects.toThrow("incorrect");
    expect((await users.login("father", "new password")).user.id).toBe(father.id);
    users.logout(admin.token); expect(users.session(admin.token)).toBeNull();
  } finally { users.close(); }
});
it("limits repeated incorrect sign-ins", async () => {
  const directory = mkdtempSync(join(tmpdir(), "billing-users-")); directories.push(directory);
  const users = createLocalUsers(directory);
  try {
    await users.create("owner", "password one");
    for (let i = 0; i < 5; i++) await expect(users.login("owner", "wrong password")).rejects.toThrow("incorrect");
    await expect(users.login("owner", "password one")).rejects.toThrow("Too many");
  } finally { users.close(); }
});
it("clears a user's lockout when an administrator resets their password", async () => {
  const directory = mkdtempSync(join(tmpdir(), "billing-users-")); directories.push(directory);
  const users = createLocalUsers(directory);
  try {
    await users.create("owner", "password one"); const admin = await users.login("owner", "password one");
    const father = await users.create("father", "password two", admin.token);
    for (let i = 0; i < 5; i++) await expect(users.login("father", "wrong password")).rejects.toThrow();
    await users.resetPassword(admin.token, father.id, "new password");
    expect((await users.login("father", "new password")).user.id).toBe(father.id);
  } finally { users.close(); }
});
it("requires the current password and invalidates every session after a user changes it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "billing-users-")); directories.push(directory);
  const users = createLocalUsers(directory);
  try {
    await users.create("owner", "password one"); const admin = await users.login("owner", "password one");
    const father = await users.create("father", "password two", admin.token);
    const first = await users.login("father", "password two"); const second = await users.login("father", "password two");
    await expect(users.changePassword(first.token, "wrong password", "new password")).rejects.toThrow("Current password is incorrect");
    expect(users.session(first.token)?.id).toBe(father.id);
    await expect(users.changePassword(first.token, "password two", "short")).rejects.toThrow("8 and 256");
    await users.changePassword(first.token, "password two", "new password");
    expect(users.session(first.token)).toBeNull(); expect(users.session(second.token)).toBeNull();
    expect(users.session(admin.token)?.administrator).toBe(true);
    await expect(users.login("father", "password two")).rejects.toThrow("incorrect");
    expect((await users.login("father", "new password")).user.id).toBe(father.id);
    await expect(users.changePassword(first.token, "new password", "another password")).rejects.toThrow("Sign in is required");
  } finally { users.close(); }
});

it("creates a user from the sign-in screen only with the administrator's password", async () => {
  const directory = mkdtempSync(join(tmpdir(), "billing-users-")); directories.push(directory);
  const users = createLocalUsers(directory);
  try {
    await users.create("owner", "password one");
    const admin = await users.login("owner", "password one");
    await users.create("staffer", "password two", admin.token);
    await expect(users.createWithAdminPassword("owner", "wrong password", "newuser", "password three")).rejects.toThrow("Administrator username or password");
    await expect(users.createWithAdminPassword("staffer", "password two", "newuser", "password three")).rejects.toThrow("Administrator username or password");
    await expect(users.createWithAdminPassword("nobody", "password one", "newuser", "password three")).rejects.toThrow("Administrator username or password");
    await expect(users.login("newuser", "password three")).rejects.toThrow("incorrect");
    await expect(users.createWithAdminPassword("owner", "password one", "NEWUSER", "short")).rejects.toThrow("between 8 and 256");
    const created = await users.createWithAdminPassword("OWNER", "password one", "newuser", "password three");
    expect(created).toMatchObject({ username: "newuser", administrator: false, legacyData: false });
    await expect(users.createWithAdminPassword("owner", "password one", "NewUser", "password four")).rejects.toThrow("already taken");
    expect((await users.login("newuser", "password three")).user.administrator).toBe(false);
  } finally { users.close(); }
});

it("locks the sign-in screen's create option after repeated wrong administrator passwords", async () => {
  const directory = mkdtempSync(join(tmpdir(), "billing-users-")); directories.push(directory);
  const users = createLocalUsers(directory);
  try {
    await users.create("owner", "password one");
    for (let attempt = 0; attempt < 5; attempt++) await expect(users.createWithAdminPassword("owner", "wrong password", "newuser", "password three")).rejects.toThrow("incorrect");
    await expect(users.createWithAdminPassword("owner", "password one", "newuser", "password three")).rejects.toThrow("Too many");
  } finally { users.close(); }
});
