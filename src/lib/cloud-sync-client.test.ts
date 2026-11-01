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
    expect(await flushSyncBatch(outbox, client, change.accountId)).toEqual({ sent: 1, hasMore: false, clockWarning: false });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://billing.example.test/api/cloud/sync/bills");
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({ authorization: "Bearer test-token", "x-billing-device-id": change.deviceId, "x-billing-device-secret": secret });
    expect(outbox.pending(change.accountId)).toEqual([]);
  } finally { db.close(); }
});

it("keeps changes pending on conflicts, wrong receipts and unsafe server addresses", async () => {
  const change = operation(), secret = randomBytes(32).toString("hex"), db = new DatabaseSync(":memory:");
  try {
    const outbox = createSyncOutbox(db); outbox.enqueue(change);
    const fetcher = vi.fn(async () => new Response(null, { status: 409 }));
    const options = { baseUrl: "https://billing.example.test", accessToken: "test-token", deviceId: change.deviceId, deviceSecret: secret, fetcher: fetcher as unknown as typeof fetch };
    await expect(flushSyncBatch(outbox, createCloudSyncClient(options), change.accountId)).rejects.toThrow(/manual review/);
    expect(outbox.pending(change.accountId)).toHaveLength(1);
    fetcher.mockResolvedValueOnce(Response.json({ operationId: randomUUID(), accepted: true, clockWarning: false, superseded: false }));
    await expect(flushSyncBatch(outbox, createCloudSyncClient(options), change.accountId)).rejects.toThrow(/invalid confirmation/);
    expect(outbox.pending(change.accountId)).toHaveLength(1);
    expect(() => createCloudSyncClient({ ...options, baseUrl: "http://billing.example.test" })).toThrow(/secure/);
    expect(() => createCloudSyncClient({ ...options, baseUrl: "https://user:pass@billing.example.test" })).toThrow(/secure/);
  } finally { db.close(); }
});
