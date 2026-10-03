import crypto from "node:crypto";

function key() {
  const value = process.env.TOKEN_ENCRYPTION_KEY;
  if (!value || value.length < 32) throw new Error("TOKEN_ENCRYPTION_KEY must be at least 32 characters.");
  return crypto.createHash("sha256").update(value).digest();
}

export function encrypt(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decrypt(value: string) {
  const [ivText, tagText, encryptedText] = value.split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}

export function signState(value: string) {
  return `${Buffer.from(value).toString("base64url")}.${crypto.createHmac("sha256", key()).update(value).digest("base64url")}`;
}

export function readSignedState(value: string) {
  const [encoded, signature] = value.split(".");
  const decoded = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = crypto.createHmac("sha256", key()).update(decoded).digest("base64url");
  if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("Invalid Microsoft connection state.");
  return decoded;
}
