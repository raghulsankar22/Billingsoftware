import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const { createDeviceIdentityStore } = createRequire(import.meta.url)("../../desktop/device-identity.cjs");
function encryptedStorage() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value: string) { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv); const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
    decryptString(value: Buffer) { const decipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12), { authTagLength: 16 }); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8"); },
  };
}

it("stores a stable encrypted identity separately for each local user", () => {
  const directory = mkdtempSync(join(tmpdir(), "billing-device-")), storage = encryptedStorage();
  try {
    const user = randomUUID(), other = randomUUID(), store = createDeviceIdentityStore({ safeStorage: storage, dataDirectory: directory });
    const first = store.getOrCreate(user);
    expect(first.deviceId).toMatch(/^[0-9a-f-]{36}$/); expect(first.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(createDeviceIdentityStore({ safeStorage: storage, dataDirectory: directory }).getOrCreate(user)).toEqual(first);
    expect(store.getOrCreate(other).deviceId).not.toBe(first.deviceId);
    const bytes = readFileSync(join(directory, "sync-identities", `${user}.bin`));
    expect(bytes.includes(Buffer.from(first.secret))).toBe(false);
    expect(bytes.includes(Buffer.from(first.deviceId))).toBe(false);
    expect(() => store.getOrCreate("../other")).toThrow(/Invalid local user/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("does not replace an unreadable identity or use unavailable encryption", () => {
  const directory = mkdtempSync(join(tmpdir(), "billing-device-")), storage = encryptedStorage();
  try {
    const user = randomUUID(), store = createDeviceIdentityStore({ safeStorage: storage, dataDirectory: directory });
    store.getOrCreate(user);
    const filename = join(directory, "sync-identities", `${user}.bin`);
    writeFileSync(filename, "damaged identity");
    expect(() => store.getOrCreate(user)).toThrow(/Keep the existing file/);
    expect(readFileSync(filename, "utf8")).toBe("damaged identity");
    const unavailable = createDeviceIdentityStore({ safeStorage: { ...storage, isEncryptionAvailable: () => false }, dataDirectory: directory });
    expect(() => unavailable.getOrCreate(randomUUID())).toThrow(/Secure device storage/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
