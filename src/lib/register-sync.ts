import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { buildReportRegister, loadReportBills } from "./excel-report";
import { syncBillToGoogleDrive, markBillVoidInGoogleDrive } from "./google-drive";
import { localStorageEnabled } from "./storage-mode";
import type { Bill } from "./types";
import { localDataDirectory } from "./local-database";

let queue: Promise<void> = Promise.resolve();
async function localRegister(profileId: string) {
  const next = queue.catch(() => {}).then(async () => {
    if (!/^[\w-]+$/.test(profileId)) throw new Error("Invalid register account.");
    const directory = path.join(localDataDirectory(), "registers");
    await fs.mkdir(directory, { recursive: true });
    const bytes = await buildReportRegister(await loadReportBills(profileId, { query: "" })).xlsx.writeBuffer();
    const target = path.join(directory, `${profileId}.xlsx`);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, Buffer.from(bytes)); await fs.rename(temporary, target); }
    finally { await fs.rm(temporary, { force: true }); }
  });
  queue = next;
  return next;
}
export async function syncBillToRegister(profileId: string, bill: Bill) {
  if (localStorageEnabled) return localRegister(profileId);
  return syncBillToGoogleDrive(profileId, bill);
}
export async function markBillVoidInRegister(profileId: string, number: number) {
  if (localStorageEnabled) return localRegister(profileId);
  return markBillVoidInGoogleDrive(profileId, number);
}
export async function syncAccountRegister(profileId: string) {
  if (localStorageEnabled) return localRegister(profileId);
  return markBillVoidInGoogleDrive(profileId, 0);
}
