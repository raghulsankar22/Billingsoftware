import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { createLocalIssuerStore } from "./sync-local-issuer";
import { createSyncOutbox } from "./sync-outbox";

it("stops offline issuance durably before release and waits for pending changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "billing-issuer-"));
  const filename = join(directory, "billing.sqlite"); let db = new DatabaseSync(filename);
  try {
    const profile = randomUUID(), device = randomUUID(), operationId = randomUUID();
    db.exec("CREATE TABLE records(id TEXT, table_name TEXT, body TEXT)");
    db.prepare("INSERT INTO records(id,table_name,body) VALUES(?,?,?)").run(profile, "business_profiles", JSON.stringify({ id: profile, next_bill_number: 1, next_delivery_number: 1 }));
    let store = createLocalIssuerStore(db); let outbox = createSyncOutbox(db);
    expect(() => store.saveAssignment(profile, device, 1, { nextBillNumber: 2, nextDeliveryNumber: 1 })).toThrow(/numbers differ/);
    expect(store.read(profile)).toBeNull();
    store.saveAssignment(profile, device, 1, { nextBillNumber: 1, nextDeliveryNumber: 1 });
    outbox.enqueue({ id: operationId, deviceId: device, accountId: profile, entityId: randomUUID(), entityType: "bill", action: "update", occurredAt: "2026-11-01T12:00:00Z", payload: {} });
    expect(store.canIssue(profile, device, 1)).toBe(true);
    store.beginRelease(profile, device, 1);
    expect(store.canIssue(profile, device, 1)).toBe(false);
    expect(store.readyForRelease(profile, device, 1)).toBe(false);
    db.close(); db = new DatabaseSync(filename); store = createLocalIssuerStore(db); outbox = createSyncOutbox(db);
    expect(store.canIssue(profile, device, 1)).toBe(false);
    expect(() => store.saveAssignment(profile, device, 1, { nextBillNumber: 1, nextDeliveryNumber: 1 })).toThrow(/released/);
    expect(() => store.finishRelease(profile, device, 1, 2)).toThrow(/pending/);
    outbox.acknowledge(profile, operationId);
    expect(store.readyForRelease(profile, device, 1)).toBe(true);
    expect(() => store.finishRelease(profile, device, 1, 3)).toThrow(/confirmation/);
    expect(store.finishRelease(profile, device, 1, 2)).toMatchObject({ state: "unassigned", epoch: 2 });
    expect(store.finishRelease(profile, device, 1, 2)).toMatchObject({ state: "unassigned", epoch: 2 });
    expect(store.canIssue(profile, device, 1)).toBe(false);
    expect(() => store.saveAssignment(profile, device, 1, { nextBillNumber: 1, nextDeliveryNumber: 1 })).toThrow(/released/);
    expect(store.saveAssignment(profile, device, 3, { nextBillNumber: 1, nextDeliveryNumber: 1 })).toMatchObject({ state: "assigned", epoch: 3 });
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
