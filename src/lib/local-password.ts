import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const saltBytes = 16;
const keyBytes = 64;
const format = "scrypt-v1";

export function validateLocalPassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || password.length < 8 || password.length > 256 || Buffer.byteLength(password, "utf8") > 1024) {
    throw new Error("Choose a password between 8 and 256 characters.");
  }
}

export async function hashLocalPassword(password: string): Promise<string> {
  validateLocalPassword(password);
  const salt = randomBytes(saltBytes);
  const key = await derive(password, salt, keyBytes) as Buffer;
  return `${format}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyLocalPassword(password: unknown, stored: unknown): Promise<boolean> {
  if (typeof password !== "string" || password.length > 256 || Buffer.byteLength(password, "utf8") > 1024 || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== format || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const key = await derive(password, Buffer.from(parts[1], "hex"), keyBytes) as Buffer;
  return timingSafeEqual(key, Buffer.from(parts[2], "hex"));
}
