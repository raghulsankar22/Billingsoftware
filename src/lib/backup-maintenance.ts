import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

type Gate = { active: number; locked: boolean; failed: boolean };
export class BackupMaintenanceError extends Error { }
const shared = globalThis as typeof globalThis & { __billingMaintenance?: Map<string, Gate>; __billingOperationContext?: AsyncLocalStorage<string> };
const gates = shared.__billingMaintenance ??= new Map<string, Gate>();
const context = shared.__billingOperationContext ??= new AsyncLocalStorage<string>();
const key = (root: string) => process.platform === "win32" ? resolve(root).toLowerCase() : resolve(root);
function gate(root: string) {
  const name = key(root);
  if (!gates.has(name)) gates.set(name, { active: 0, locked: false, failed: false });
  return gates.get(name)!;
}

export async function withBackupOperation<T>(root: string, action: () => Promise<T>): Promise<T> {
  const state = gate(root);
  if (state.locked || state.failed || existsSync(resolve(root, ".billing-maintenance.lock"))) throw new BackupMaintenanceError("Billing maintenance is in progress. If this follows an interrupted restore, administrator recovery is required before using the app.");
  state.active++;
  try { return await context.run(key(root), action); } finally { state.active--; }
}

export async function withBackupMaintenance<T>(root: string, action: () => Promise<T>): Promise<T> {
  const state = gate(root);
  const ownOperation = context.getStore() === key(root) ? 1 : 0;
  if (state.locked || state.failed || existsSync(resolve(root, ".billing-maintenance.lock")) || state.active > ownOperation) throw new Error("Other billing operations are active or recovery is incomplete. Wait for them to finish, or ask an administrator to recover an interrupted restore.");
  state.locked = true;
  try { return await action(); } finally { state.locked = false; }
}

export function preventOperationsAfterFailedRecovery(root: string) { gate(root).failed = true; }
