import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

export function isCashBookPreviewStorage(): boolean {
  const configured = process.env.LOCAL_DATA_DIR;
  const expected = resolve(process.cwd(), "tmp", "cashbook-website-demo");
  if (!configured || resolve(configured) !== expected) return false;
  try { return realpathSync(expected) === expected && readFileSync(resolve(expected, ".cashbook-demo"), "utf8") === "synthetic-cashbook-preview-v1"; }
  catch { return false; }
}

export function assertCashBookPreviewStorage() {
  if (!isCashBookPreviewStorage()) throw new Error("Cash-book preview requires its marked synthetic sample folder. Real ledger fallback is forbidden.");
}

