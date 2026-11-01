import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

export function isTamilPreviewStorage(): boolean {
  const configured = process.env.LOCAL_DATA_DIR;
  const expected = resolve(process.cwd(), "tmp", "tamil-website-demo");
  if (!configured || resolve(configured) !== expected) return false;
  try {
    return realpathSync(expected) === expected && readFileSync(resolve(expected, ".tamil-demo"), "utf8") === "synthetic-tamil-preview-v1";
  } catch { return false; }
}

export function assertTamilPreviewStorage() {
  if (!isTamilPreviewStorage()) throw new Error("Tamil preview requires its marked synthetic sample folder. Real ledger fallback is forbidden.");
}
