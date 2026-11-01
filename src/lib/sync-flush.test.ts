import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { createSyncOutbox, type SyncOperation } from "./sync-outbox";
import { flushSyncBatch } from "./sync-flush";

it("keeps a change pending after a lost reply and retries it using the same operation ID", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const outbox = createSyncOutbox(db), accountId = randomUUID();
    const operation: SyncOperation = { id: randomUUID(), deviceId: randomUUID(), accountId, entityId: randomUUID(), entityType: "bill", action: "update", occurredAt: "2026-10-30T12:00:00Z", payload: { amount: 10000 } };
    outbox.enqueue(operation);
    const saved = new Set<string>(); let attempts = 0;
    const server = { submit: async (change: SyncOperation) => { saved.add(change.id); if (++attempts === 1) throw new Error("Connection lost after save"); return { operationId: change.id, accepted: true }; } };
    await expect(flushSyncBatch(outbox, server, accountId)).rejects.toThrow(/Connection lost/);
    expect(outbox.pending(accountId)).toHaveLength(1);
    expect(await flushSyncBatch(outbox, server, accountId)).toEqual({ sent: 1, hasMore: false, clockWarning: false });
    expect(saved.size).toBe(1);
  } finally { db.close(); }
});

it("does not discard a change when the server returns the wrong acknowledgement", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const outbox = createSyncOutbox(db), accountId = randomUUID();
    outbox.enqueue({ id: randomUUID(), deviceId: randomUUID(), accountId, entityId: randomUUID(), entityType: "bill", action: "delete", occurredAt: "2026-10-30T12:00:00Z", payload: {} });
    await expect(flushSyncBatch(outbox, { submit: async () => ({ operationId: randomUUID(), accepted: true }) }, accountId)).rejects.toThrow(/correct sync operation/);
    expect(outbox.pending(accountId)).toHaveLength(1);
  } finally { db.close(); }
});

it("reports a server clock warning while acknowledging a successful change", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const outbox = createSyncOutbox(db), accountId = randomUUID(), id = randomUUID();
    outbox.enqueue({ id, deviceId: randomUUID(), accountId, entityId: randomUUID(), entityType: "bill", action: "update", occurredAt: "2026-11-01T12:00:00Z", payload: {} });
    expect(await flushSyncBatch(outbox, { submit: async () => ({ operationId: id, accepted: true, clockWarning: true }) }, accountId)).toEqual({ sent: 1, hasMore: false, clockWarning: true });
  } finally { db.close(); }
});

it("reports a clock warning even if a later change fails to sync", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const outbox = createSyncOutbox(db), accountId = randomUUID(), deviceId = randomUUID();
    const first = randomUUID(), second = randomUUID();
    for (const id of [first, second]) outbox.enqueue({ id, deviceId, accountId, entityId: randomUUID(), entityType: "bill", action: "update", occurredAt: "2026-11-01T12:00:00Z", payload: {} });
    let warnings = 0;
    const server = { submit: async (operation: SyncOperation) => { if (operation.id === second) throw new Error("Connection lost"); return { operationId: first, accepted: true, clockWarning: true }; } };
    await expect(flushSyncBatch(outbox, server, accountId, 100, () => warnings++)).rejects.toThrow(/Connection lost/);
    expect(warnings).toBe(1);
    expect(outbox.pending(accountId).map(operation => operation.id)).toEqual([second]);
  } finally { db.close(); }
});

it("keeps a superseded edit pending until the winning version can be reconciled", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const outbox = createSyncOutbox(db), accountId = randomUUID(), id = randomUUID();
    outbox.enqueue({ id, deviceId: randomUUID(), accountId, entityId: randomUUID(), entityType: "bill", action: "update", baseOperationId: randomUUID(), occurredAt: "2026-11-01T12:00:00Z", payload: {} });
    await expect(flushSyncBatch(outbox, { submit: async () => ({ operationId: id, accepted: true, superseded: true }) }, accountId)).rejects.toThrow(/reconciled/);
    expect(outbox.pending(accountId)).toHaveLength(1);
  } finally { db.close(); }
});
