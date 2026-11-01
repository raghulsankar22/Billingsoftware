import type { SyncOperation } from "./sync-outbox";

type Outbox = {
  pending: (accountId: string, limit?: number) => SyncOperation[];
  acknowledge: (accountId: string, operationId: string) => boolean;
};
type Server = { submit: (operation: SyncOperation) => Promise<{ operationId: string; accepted: boolean; clockWarning?: boolean; superseded?: boolean }> };

/**
 * Deliver one bounded batch. The server must authenticate and deduplicate by
 * operation ID in the same transaction as its ledger write. A failed or lost
 * response leaves the operation pending for retry.
 */
export async function flushSyncBatch(outbox: Outbox, server: Server, accountId: string, limit = 100, onClockWarning?: () => void) {
  const operations = outbox.pending(accountId, limit);
  let sent = 0;
  let clockWarning = false;
  for (const operation of operations) {
    const result = await server.submit(operation);
    if (!result.accepted || result.operationId !== operation.id) throw new Error("The server did not confirm the correct sync operation.");
    if (result.clockWarning === true && !clockWarning) { clockWarning = true; onClockWarning?.(); }
    // Never discard a losing edit until the newer server version has been
    // downloaded and safely reconciled with any later local changes.
    if (result.superseded) throw new Error("A newer bill version must be reconciled before this change can be cleared.");
    if (!outbox.acknowledge(accountId, operation.id)) throw new Error("Unable to mark the confirmed operation as synced.");
    sent++;
  }
  return { sent, hasMore: outbox.pending(accountId, 1).length > 0, clockWarning };
}
