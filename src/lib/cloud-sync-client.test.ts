import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { createCloudSyncClient } from "./cloud-sync-client";
import { flushSyncBatch } from "./sync-flush";
import { createSyncOutbox, type SyncOperation } from "./sync-outbox";

function operation(): SyncOperation {
  return { id: randomUUID(), deviceId: randomUUID(), accountId: randomUUID(), entityId: randomUUID(), entityType: "bill", action: "create", occurredAt: "2026-11-01T12:00:00Z", issuerEpoch: 1,
    payload: { billNumber: 1, billDate: "2026-11-01", customerName: "Test Customer", fatherName: "Test Parent", address: "Test address", phone: "", businessSnapshot: { business_name: "Test", address: "Test Road", phone: "1234567890" }, items: [{ id: randomUUID(), metal: "Gold", particulars: "Ring 1", grams: 2, assessedValue: 11000, loanAmount: 10000 }] } };
}

it("sends a bill only to HTTPS with authenticated headers and acknowledges the matching receipt", async () => {
  const change = operation(), secret = randomBytes(32).toString("hex"), db = new DatabaseSync(":memory:");
  try {
    const outbox = createSyncOutbox(db); outbox.enqueue(change);
    const fetcher = vi.fn(async () => Response.json({ operationId: change.id, accepted: true, clockWarning: false, superseded: false }));
    const client = createCloudSyncClient({ baseUrl: "https://billing.example.test", accessToken: "test-token", deviceId: change.deviceId, deviceSecret: secret, fetcher: fetcher as unknown as typeof fetch });
    expect(await flushSyncBatch(outbox, client, change.accountId)).toEqual({ sent: 1, held: 0, hasMore: false, clockWarning: false });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://billing.example.test/api/cloud/sync/bills");
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({ authorization: "Bearer test-token", "x-billing-device-id": change.deviceId, "x-billing-device-secret": secret });
    expect(outbox.pending(change.accountId)).toEqual([]);
  } finally { db.close(); }
});

it("sets a change aside for review on conflicts and permanent refusals, showing the server's reason", async () => {
  const secret = randomBytes(32).toString("hex"), db = new DatabaseSync(":memory:");
  try {
    const outbox = createSyncOutbox(db);
    for (const [status, reason] of [[409, /manual review/], [422, /clock was ahead/], [400, /Invalid sync/], [413, /too large/]] as const) {
      const change = operation(); outbox.enqueue(change);
      const fetcher = vi.fn(async () => Response.json({ error: status === 422 ? "This device's clock was ahead" : status === 400 ? "Invalid sync operation." : "Sync operation is too large." }, { status }));
      const client = createCloudSyncClient({ baseUrl: "https://billing.example.test", accessToken: "test-token", deviceId: change.deviceId, deviceSecret: secret, fetcher: fetcher as unknown as typeof fetch });
      expect(await flushSyncBatch(outbox, client, change.accountId)).toMatchObject({ sent: 0, held: 1 });
      expect(outbox.held(change.accountId)[0].reason).toMatch(reason);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  } finally { db.close(); }
});

it("stops and retries later on an outage or refused sign-in, without setting the change aside", async () => {
  const change = operation(), secret = randomBytes(32).toString("hex"), db = new DatabaseSync(":memory:");
  try {
    const outbox = createSyncOutbox(db); outbox.enqueue(change);
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    const client = createCloudSyncClient({ baseUrl: "https://billing.example.test", accessToken: "test-token", deviceId: change.deviceId, deviceSecret: secret, fetcher: fetcher as unknown as typeof fetch });
    await expect(flushSyncBatch(outbox, client, change.accountId)).rejects.toThrow(/Changes remain/);
    fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(flushSyncBatch(outbox, client, change.accountId)).rejects.toThrow(/Sign in again/);
    expect(outbox.held(change.accountId)).toEqual([]);
    expect(outbox.deliverable(change.accountId)).toHaveLength(1);
  } finally { db.close(); }
});

it("keeps changes pending on wrong receipts and refuses unsafe server addresses", async () => {
  const change = operation(), secret = randomBytes(32).toString("hex"), db = new DatabaseSync(":memory:");
  try {
    const outbox = createSyncOutbox(db); outbox.enqueue(change);
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    const options = { baseUrl: "https://billing.example.test", accessToken: "test-token", deviceId: change.deviceId, deviceSecret: secret, fetcher: fetcher as unknown as typeof fetch };
    fetcher.mockResolvedValueOnce(Response.json({ operationId: randomUUID(), accepted: true, clockWarning: false, superseded: false }));
    await expect(flushSyncBatch(outbox, createCloudSyncClient(options), change.accountId)).rejects.toThrow(/invalid confirmation/);
    expect(outbox.pending(change.accountId)).toHaveLength(1);
    expect(() => createCloudSyncClient({ ...options, baseUrl: "http://billing.example.test" })).toThrow(/secure/);
    expect(() => createCloudSyncClient({ ...options, baseUrl: "https://user:pass@billing.example.test" })).toThrow(/secure/);
  } finally { db.close(); }
});
