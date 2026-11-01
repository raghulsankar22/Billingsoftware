import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

/** Local queue foundation. Call enqueue inside the same transaction as the data change. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue), z.record(jsonValue)]));
export const syncOperationSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid(),
  accountId: z.string().uuid(),
  entityId: z.string().uuid(),
  entityType: z.enum(["bill", "delivery", "customer", "profile"]),
  action: z.enum(["create", "update", "delete"]),
  occurredAt: z.string().datetime({ offset: true }),
  issuerEpoch: z.number().int().nonnegative().safe().optional(),
  // Revision seen by the device before an edit/delete. Server-side conflict
  // handling will require this before those operation types are enabled.
  baseOperationId: z.string().uuid().optional(),
  payload: z.record(jsonValue),
}).strict().refine(operation => operation.action !== "create" || !["bill", "delivery"].includes(operation.entityType) || operation.issuerEpoch !== undefined, { message: "Creating a bill or delivery requires the designated issuer epoch." });
export type SyncOperation = z.infer<typeof syncOperationSchema>;

export function canonicalSyncOperation(input: SyncOperation) {
  // A canonical payload makes repeated attempts comparable even when key order differs.
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a === b ? 0 : a < b ? -1 : 1).map(([key, item]) => [key, canonical(item)]));
    return value;
  }
  return JSON.stringify(canonical(input));
}

export function createSyncOutbox(database: DatabaseSync) {
  database.exec(`CREATE TABLE IF NOT EXISTS sync_outbox (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL,
    payload TEXT NOT NULL CHECK(json_valid(payload)),
    payload_hash TEXT NOT NULL,
    acknowledged_at TEXT
  );
  CREATE INDEX IF NOT EXISTS sync_outbox_pending ON sync_outbox(account_id, acknowledged_at, sequence);`);
  if (!database.prepare("PRAGMA table_info(sync_outbox)").all().some(column => column.name === "held_reason")) {
    database.exec("ALTER TABLE sync_outbox ADD COLUMN held_reason TEXT; ALTER TABLE sync_outbox ADD COLUMN held_at TEXT;");
  }
  return {
    enqueue(value: unknown) {
      const input = syncOperationSchema.parse(value);
      const payload = canonicalSyncOperation(input);
      const hash = createHash("sha256").update(payload).digest("hex");
      const inserted = database.prepare("INSERT INTO sync_outbox(operation_id,account_id,payload,payload_hash) VALUES(?,?,?,?) ON CONFLICT(operation_id) DO NOTHING").run(input.id, input.accountId, payload, hash);
      if (!inserted.changes) {
        const existing = database.prepare("SELECT account_id, payload_hash FROM sync_outbox WHERE operation_id=?").get(input.id);
        if (!existing || existing.account_id !== input.accountId || existing.payload_hash !== hash) throw new Error("A different sync operation already uses this ID.");
      }
    },
    /**
     * What can be sent now. A change waiting for review also pauses later changes
     * to the same bill and, because bill numbers must arrive in order, later new bills.
     */
    deliverable(accountId: string, limit = 100): SyncOperation[] {
      z.string().uuid().parse(accountId);
      z.number().int().min(1).max(500).parse(limit);
      return database.prepare(`SELECT payload FROM sync_outbox AS o WHERE o.account_id=? AND o.acknowledged_at IS NULL AND o.held_reason IS NULL
        AND NOT EXISTS (SELECT 1 FROM sync_outbox AS h WHERE h.account_id=o.account_id AND h.acknowledged_at IS NULL AND h.held_reason IS NOT NULL
          AND (json_extract(h.payload,'$.entityId')=json_extract(o.payload,'$.entityId')
            OR (json_extract(h.payload,'$.action')='create' AND json_extract(o.payload,'$.action')='create')))
        ORDER BY o.sequence LIMIT ?`).all(accountId, limit).map(row => syncOperationSchema.parse(JSON.parse(String(row.payload))));
    },
    hold(accountId: string, operationId: string, reason: string) {
      z.string().uuid().parse(accountId); z.string().uuid().parse(operationId);
      return Number(database.prepare("UPDATE sync_outbox SET held_reason=?,held_at=? WHERE account_id=? AND operation_id=? AND acknowledged_at IS NULL").run(z.string().min(1).max(500).parse(reason), new Date().toISOString(), accountId, operationId).changes) === 1;
    },
    /** The administrator's review list. */
    held(accountId: string) {
      z.string().uuid().parse(accountId);
      return database.prepare("SELECT payload,held_reason,held_at FROM sync_outbox WHERE account_id=? AND acknowledged_at IS NULL AND held_reason IS NOT NULL ORDER BY sequence").all(accountId)
        .map(row => ({ operation: syncOperationSchema.parse(JSON.parse(String(row.payload))), reason: String(row.held_reason), heldAt: String(row.held_at) }));
    },
    /** After review: send it again, or dismiss it once its outcome has been dealt with elsewhere. */
    resolve(accountId: string, operationId: string, decision: "retry" | "dismiss") {
      z.string().uuid().parse(accountId); z.string().uuid().parse(operationId);
      const sql = z.enum(["retry", "dismiss"]).parse(decision) === "retry"
        ? "UPDATE sync_outbox SET held_reason=NULL,held_at=NULL WHERE account_id=? AND operation_id=? AND acknowledged_at IS NULL AND held_reason IS NOT NULL"
        : "UPDATE sync_outbox SET acknowledged_at=? WHERE account_id=? AND operation_id=? AND acknowledged_at IS NULL AND held_reason IS NOT NULL";
      const parameters = decision === "retry" ? [accountId, operationId] : [new Date().toISOString(), accountId, operationId];
      return Number(database.prepare(sql).run(...parameters).changes) === 1;
    },
    /** Everything unacknowledged, including held changes: permission can't be released while any remain. */
    pending(accountId: string, limit = 100): SyncOperation[] {
      z.string().uuid().parse(accountId);
      z.number().int().min(1).max(500).parse(limit);
      return database.prepare("SELECT payload FROM sync_outbox WHERE account_id=? AND acknowledged_at IS NULL ORDER BY sequence LIMIT ?").all(accountId, limit).map(row => syncOperationSchema.parse(JSON.parse(String(row.payload))));
    },
    acknowledge(accountId: string, operationId: string) {
      z.string().uuid().parse(accountId); z.string().uuid().parse(operationId);
      // Only a confirmed server acknowledgement may call this; another account cannot acknowledge it.
      return Number(database.prepare("UPDATE sync_outbox SET acknowledged_at=? WHERE account_id=? AND operation_id=? AND acknowledged_at IS NULL").run(new Date().toISOString(), accountId, operationId).changes) === 1;
    },
  };
}
