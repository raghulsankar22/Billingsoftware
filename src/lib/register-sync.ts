import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { buildReportRegister, loadReportBills } from "./excel-report";
import { syncBillToGoogleDrive, markBillVoidInGoogleDrive } from "./google-drive";
import { localStorageEnabled } from "./storage-mode";
import type { Bill } from "./types";
import { localDataDirectory } from "./local-database";
import { buildAllAccountRegister, loadAccountReports } from "./all-account-register";

let queue: Promise<void> = Promise.resolve();

async function saveRegister(target: string, bytes: Buffer) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, bytes); await fs.rename(temporary, target); }
  finally { await fs.rm(temporary, { force: true }); }
}

async function localRegister(profileId: string) {
  const next = queue.catch(() => {}).then(async () => {
    if (!/^[\w-]+$/.test(profileId)) throw new Error("Invalid register account.");
    const directory = path.join(localDataDirectory(), "registers");
    const bytes = await buildReportRegister(await loadReportBills(profileId, { query: "" })).xlsx.writeBuffer();
    const target = path.join(directory, `${profileId}.xlsx`);
    await saveRegister(target, Buffer.from(bytes));
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

export async function syncAllAccountRegisters(ownerId: string) {
  if (!localStorageEnabled) throw new Error("All-account Excel refresh is available only in local billing.");
  const target = path.join(localDataDirectory(), "registers", "All Accounts.xlsx");
  const next = queue.catch(() => {}).then(async () => {
    const reports = await loadAccountReports(ownerId);
    const bytes = await buildAllAccountRegister(reports).xlsx.writeBuffer();
    for (const report of reports) {
      const register = await buildReportRegister(report.bills).xlsx.writeBuffer();
      await saveRegister(path.join(path.dirname(target), `${report.profileId}.xlsx`), Buffer.from(register));
    }
    await saveRegister(target, Buffer.from(bytes));
  });
  queue = next;
  await next;
  return target;
}
