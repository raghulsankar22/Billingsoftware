import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { createSyncOutbox, type SyncOperation } from "./sync-outbox";
import { flushSyncBatch, SyncReviewError } from "./sync-flush";

function withOutbox(run: (outbox: ReturnType<typeof createSyncOutbox>) => Promise<void>) {
  return async () => {
    const db = new DatabaseSync(":memory:");
    try { await run(createSyncOutbox(db)); } finally { db.close(); }
  };
}
const change = (accountId: string, overrides: Partial<SyncOperation> = {}): SyncOperation => ({ id: randomUUID(), deviceId: randomUUID(), accountId, entityId: randomUUID(), entityType: "bill", action: "update", occurredAt: "2026-11-01T12:00:00Z", payload: {}, ...overrides });
const accept = async (operation: SyncOperation) => ({ operationId: operation.id, accepted: true });

it("keeps a change pending after a lost reply and retries it using the same operation ID", withOutbox(async outbox => {
  const accountId = randomUUID();
  outbox.enqueue(change(accountId, { payload: { amount: 10000 } }));
  const saved = new Set<string>(); let attempts = 0;
  const server = { submit: async (operation: SyncOperation) => { saved.add(operation.id); if (++attempts === 1) throw new Error("Connection lost after save"); return accept(operation); } };
  await expect(flushSyncBatch(outbox, server, accountId)).rejects.toThrow(/Connection lost/);
  expect(outbox.pending(accountId)).toHaveLength(1);
  expect(outbox.held(accountId)).toEqual([]);
  expect(await flushSyncBatch(outbox, server, accountId)).toEqual({ sent: 1, held: 0, hasMore: false, clockWarning: false });
  expect(saved.size).toBe(1);
}));

it("does not discard a change when the server returns the wrong acknowledgement", withOutbox(async outbox => {
  const accountId = randomUUID();
  outbox.enqueue(change(accountId, { action: "delete" }));
  await expect(flushSyncBatch(outbox, { submit: async () => ({ operationId: randomUUID(), accepted: true }) }, accountId)).rejects.toThrow(/correct sync operation/);
  expect(outbox.pending(accountId)).toHaveLength(1);
}));

it("reports a server clock warning while acknowledging a successful change", withOutbox(async outbox => {
  const accountId = randomUUID(), operation = change(accountId);
  outbox.enqueue(operation);
  expect(await flushSyncBatch(outbox, { submit: async () => ({ operationId: operation.id, accepted: true, clockWarning: true }) }, accountId)).toEqual({ sent: 1, held: 0, hasMore: false, clockWarning: true });
}));

it("reports a clock warning even if a later change fails to sync", withOutbox(async outbox => {
  const accountId = randomUUID(), first = change(accountId), second = change(accountId);
  outbox.enqueue(first); outbox.enqueue(second);
  let warnings = 0;
  const server = { submit: async (operation: SyncOperation) => { if (operation.id === second.id) throw new Error("Connection lost"); return { operationId: first.id, accepted: true, clockWarning: true }; } };
  await expect(flushSyncBatch(outbox, server, accountId, 100, () => warnings++)).rejects.toThrow(/Connection lost/);
  expect(warnings).toBe(1);
  expect(outbox.pending(accountId).map(operation => operation.id)).toEqual([second.id]);
}));

it("sets a superseded edit aside for review, keeps it, and lets other bills sync", withOutbox(async outbox => {
  const accountId = randomUUID(), losing = change(accountId, { baseOperationId: randomUUID() }), other = change(accountId);
  outbox.enqueue(losing); outbox.enqueue(other);
  const server = { submit: async (operation: SyncOperation) => ({ operationId: operation.id, accepted: true, superseded: operation.id === losing.id }) };
  expect(await flushSyncBatch(outbox, server, accountId)).toEqual({ sent: 1, held: 1, hasMore: false, clockWarning: false });
  expect(outbox.pending(accountId).map(operation => operation.id)).toEqual([losing.id]);
  expect(outbox.held(accountId)).toMatchObject([{ operation: { id: losing.id }, reason: expect.stringContaining("newer version") }]);
}));

it("pauses later changes to a bill under review but not other bills", withOutbox(async outbox => {
  const accountId = randomUUID(), entityId = randomUUID();
  const refused = change(accountId, { entityId }), laterSameBill = change(accountId, { entityId }), otherBill = change(accountId);
  [refused, laterSameBill, otherBill].forEach(operation => outbox.enqueue(operation));
  const sent: string[] = [];
  const server = { submit: async (operation: SyncOperation) => { sent.push(operation.id); if (operation.id === refused.id) throw new SyncReviewError("Needs a look"); return accept(operation); } };
  expect(await flushSyncBatch(outbox, server, accountId)).toEqual({ sent: 1, held: 1, hasMore: false, clockWarning: false });
  expect(sent).toEqual([refused.id, otherBill.id]);
  expect(outbox.pending(accountId).map(operation => operation.id)).toEqual([refused.id, laterSameBill.id]);
}));

it("pauses later new bills behind a refused new bill, because numbers must arrive in order", withOutbox(async outbox => {
  const accountId = randomUUID();
  const firstBill = change(accountId, { action: "create", issuerEpoch: 1 }), secondBill = change(accountId, { action: "create", issuerEpoch: 1 }), edit = change(accountId);
  [firstBill, secondBill, edit].forEach(operation => outbox.enqueue(operation));
  const server = { submit: async (operation: SyncOperation) => { if (operation.id === firstBill.id) throw new SyncReviewError("Needs a look"); return accept(operation); } };
  expect(await flushSyncBatch(outbox, server, accountId)).toMatchObject({ sent: 1, held: 1 });
  expect(outbox.deliverable(accountId)).toEqual([]);
  expect(outbox.pending(accountId).map(operation => operation.id)).toEqual([firstBill.id, secondBill.id]);
}));

it("sends a reviewed change again on retry, or clears it on dismiss", withOutbox(async outbox => {
  const accountId = randomUUID(), retried = change(accountId), dismissed = change(accountId);
  outbox.enqueue(retried); outbox.enqueue(dismissed);
  await flushSyncBatch(outbox, { submit: async () => { throw new SyncReviewError("Needs a look"); } }, accountId);
  expect(outbox.held(accountId)).toHaveLength(2);
  expect(outbox.resolve(randomUUID(), retried.id, "retry")).toBe(false);
  expect(outbox.resolve(accountId, retried.id, "retry")).toBe(true);
  expect(outbox.resolve(accountId, dismissed.id, "dismiss")).toBe(true);
  expect(outbox.resolve(accountId, dismissed.id, "dismiss")).toBe(false);
  expect(outbox.held(accountId)).toEqual([]);
  expect(await flushSyncBatch(outbox, { submit: accept }, accountId)).toMatchObject({ sent: 1, held: 0 });
  expect(outbox.pending(accountId)).toEqual([]);
}));

it("adds the review columns to a queue from an earlier version", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE sync_outbox (sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL, acknowledged_at TEXT)");
    const outbox = createSyncOutbox(db), accountId = randomUUID();
    createSyncOutbox(db);
    outbox.enqueue(change(accountId));
    expect(outbox.deliverable(accountId)).toHaveLength(1);
  } finally { db.close(); }
});
