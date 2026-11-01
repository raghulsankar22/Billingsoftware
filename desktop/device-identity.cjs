const { randomBytes, randomUUID } = require('node:crypto');
const { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Persist one encrypted identity per local user. Call only from trusted desktop code. */
function createDeviceIdentityStore({ safeStorage, dataDirectory }) {
  function ensureEncryption() {
    if (!safeStorage.isEncryptionAvailable() || (typeof safeStorage.getSelectedStorageBackend === 'function' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw new Error('Secure device storage is unavailable on this computer.');
    }
  }
  function parse(bytes) {
    let identity;
    try { identity = JSON.parse(safeStorage.decryptString(bytes)); }
    catch { throw new Error('Unable to read this device identity. Keep the existing file for recovery.'); }
    if (!identity || identity.version !== 1 || typeof identity.deviceId !== 'string' || !uuid.test(identity.deviceId) || typeof identity.secret !== 'string' || !/^[0-9a-f]{64}$/.test(identity.secret)) {
      throw new Error('The device identity is invalid. Keep the existing file for recovery.');
    }
    return { deviceId: identity.deviceId, secret: identity.secret };
  }
  return {
    getOrCreate(localUserId) {
      if (typeof localUserId !== 'string' || !uuid.test(localUserId)) throw new Error('Invalid local user.');
      ensureEncryption();
      const directory = path.join(path.resolve(dataDirectory), 'sync-identities');
      mkdirSync(directory, { recursive: true });
      const filename = path.join(directory, `${localUserId.toLowerCase()}.bin`);
      if (existsSync(filename)) return parse(readFileSync(filename));
      const identity = { version: 1, deviceId: randomUUID(), secret: randomBytes(32).toString('hex') };
      const encrypted = safeStorage.encryptString(JSON.stringify(identity));
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) throw new Error('Unable to securely save the device identity.');
      const temporary = path.join(directory, `.${randomUUID()}.tmp`);
      try {
        const fd = openSync(temporary, 'wx', 0o600);
        try { writeFileSync(fd, encrypted); fsyncSync(fd); } finally { closeSync(fd); }
        try { linkSync(temporary, filename); }
        catch (error) { if (error.code !== 'EEXIST') throw error; return parse(readFileSync(filename)); }
        return { deviceId: identity.deviceId, secret: identity.secret };
      } finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    },
  };
}

module.exports = { createDeviceIdentityStore };
