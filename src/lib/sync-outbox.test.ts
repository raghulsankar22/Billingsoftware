import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { createSyncOutbox, type SyncOperation } from "./sync-outbox";

it("keeps pending offline changes across restarts and isolates acknowledgements by account", () => {
  const directory = mkdtempSync(join(tmpdir(), "billing-sync-"));
  const filename = join(directory, "ledger.sqlite");
  let db = new DatabaseSync(filename);
  try {
    const accountId = randomUUID(), otherAccount = randomUUID();
    const operation: SyncOperation = { id: randomUUID(), deviceId: randomUUID(), accountId, entityId: randomUUID(), entityType: "bill", action: "update", occurredAt: "2026-10-30T12:00:00Z", payload: { name: "Private", amount: 10000 } };
    let queue = createSyncOutbox(db);
    queue.enqueue(operation); queue.enqueue({ ...operation, payload: { amount: 10000, name: "Private" } });
    expect(() => queue.enqueue({ ...operation, payload: { amount: 1 } })).toThrow(/different sync operation/);
    expect(queue.pending(accountId)).toHaveLength(1);
    expect(queue.acknowledge(otherAccount, operation.id)).toBe(false);
    db.close(); db = new DatabaseSync(filename); queue = createSyncOutbox(db);
    expect(queue.pending(accountId)).toEqual([operation]);
    expect(queue.acknowledge(accountId, operation.id)).toBe(true);
    expect(queue.acknowledge(accountId, operation.id)).toBe(false);
    expect(queue.pending(accountId)).toEqual([]);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

it("rolls back a queued change with the associated ledger transaction", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const queue = createSyncOutbox(db);
    const accountId = randomUUID();
    db.exec("BEGIN IMMEDIATE");
    queue.enqueue({ id: randomUUID(), deviceId: randomUUID(), accountId, entityId: randomUUID(), entityType: "bill", action: "delete", occurredAt: "2026-10-30T12:00:00Z", payload: {} });
    db.exec("ROLLBACK");
    expect(queue.pending(accountId)).toEqual([]);
  } finally { db.close(); }
});

it("requires an issuer epoch when creating bill and delivery numbers", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const queue = createSyncOutbox(db);
    const base = { id: randomUUID(), deviceId: randomUUID(), accountId: randomUUID(), entityId: randomUUID(), entityType: "bill" as const, action: "create" as const, occurredAt: "2026-10-30T12:00:00Z", payload: {} };
    expect(() => queue.enqueue(base)).toThrow(/issuer epoch/);
    queue.enqueue({ ...base, issuerEpoch: 1 });
    expect(queue.pending(base.accountId)[0].issuerEpoch).toBe(1);
  } finally { db.close(); }
});
