import type { SyncOperation } from "./sync-outbox";

/** The server refused this change for a reason retrying won't fix: a person has to look at it. */
export class SyncReviewError extends Error {
  constructor(message: string) { super(message); this.name = "SyncReviewError"; }
}

type Outbox = {
  deliverable: (accountId: string, limit?: number) => SyncOperation[];
  acknowledge: (accountId: string, operationId: string) => boolean;
  hold: (accountId: string, operationId: string, reason: string) => boolean;
};
type Server = { submit: (operation: SyncOperation) => Promise<{ operationId: string; accepted: boolean; clockWarning?: boolean; superseded?: boolean }> };

/**
 * Deliver one bounded batch. The server must authenticate and deduplicate by
 * operation ID in the same transaction as its ledger write. A failed or lost
 * response stops the batch and leaves the operation pending for retry. A change
 * needing review is set aside with its reason so other bills can keep syncing.
 */
export async function flushSyncBatch(outbox: Outbox, server: Server, accountId: string, limit = 100, onClockWarning?: () => void) {
  let sent = 0;
  let held = 0;
  let clockWarning = false;
  const hold = (operation: SyncOperation, reason: string) => {
    if (!outbox.hold(accountId, operation.id, reason)) throw new Error("Unable to set the change aside for review.");
    held++;
  };
  // Asked one at a time because holding a change also pauses what depends on it.
  for (let attempt = 0; attempt < limit; attempt++) {
    const [operation] = outbox.deliverable(accountId, 1);
    if (!operation) break;
    let result;
    try { result = await server.submit(operation); }
    catch (error) {
      if (!(error instanceof SyncReviewError)) throw error;
      hold(operation, error.message);
      continue;
    }
    if (!result.accepted || result.operationId !== operation.id) throw new Error("The server did not confirm the correct sync operation.");
    if (result.clockWarning === true && !clockWarning) { clockWarning = true; onClockWarning?.(); }
    // The server keeps the losing edit in its history, but this device's copy
    // still differs, so never clear it without someone reviewing it.
    if (result.superseded) { hold(operation, "A newer version of this bill exists on the server."); continue; }
    if (!outbox.acknowledge(accountId, operation.id)) throw new Error("Unable to mark the confirmed operation as synced.");
    sent++;
  }
  return { sent, held, hasMore: outbox.deliverable(accountId, 1).length > 0, clockWarning };
}
