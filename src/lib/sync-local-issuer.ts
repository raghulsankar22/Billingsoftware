import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { createSyncOutbox } from "./sync-outbox";

const uuid = z.string().uuid();
const epochValue = z.number().int().nonnegative().safe();
type LocalIssuer = { profileId: string; deviceId: string | null; epoch: number; state: "assigned" | "releasing" | "unassigned" };
type Counters = { nextBillNumber: number; nextDeliveryNumber: number };
const countersSchema = z.object({ nextBillNumber: z.number().int().min(1).max(2147483647), nextDeliveryNumber: z.number().int().min(1).max(2147483647) }).strict();

/**
 * A durable local release barrier. The billing write must check canIssue in
 * the same SQLite transaction as number allocation and outbox insertion.
 */
export function createLocalIssuerStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS sync_local_issuers (
    profile_id TEXT PRIMARY KEY,
    device_id TEXT,
    epoch INTEGER NOT NULL CHECK(epoch>=0),
    state TEXT NOT NULL CHECK(state IN ('assigned','releasing','unassigned')),
    CHECK((state='unassigned' AND device_id IS NULL) OR (state IN ('assigned','releasing') AND device_id IS NOT NULL))
  )`);
  const outbox = createSyncOutbox(db);
  const read = (profileId: string): LocalIssuer | null => {
    const row = db.prepare("SELECT profile_id,device_id,epoch,state FROM sync_local_issuers WHERE profile_id=?").get(profileId);
    return row ? { profileId: String(row.profile_id), deviceId: row.device_id == null ? null : String(row.device_id), epoch: Number(row.epoch), state: row.state as LocalIssuer["state"] } : null;
  };
  const transact = <T>(action: () => T) => {
    db.exec("BEGIN IMMEDIATE");
    try { const result = action(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const validate = (profileId: string, deviceId: string, epoch: number) => { uuid.parse(profileId); uuid.parse(deviceId); epochValue.parse(epoch); };
  return {
    read,
    saveAssignment(profileId: string, deviceId: string, epoch: number, serverCounters: Counters) {
      validate(profileId, deviceId, epoch);
      const remote = countersSchema.parse(serverCounters);
      return transact(() => {
        const current = read(profileId);
        if (current?.state === "assigned" && current.deviceId === deviceId && current.epoch === epoch) return current;
        if (current && (current.state !== "unassigned" || epoch <= current.epoch)) throw new Error("Existing offline permission must be released before accepting a new assignment.");
        const profileRow = db.prepare("SELECT body FROM records WHERE table_name='business_profiles' AND id=?").get(profileId);
        if (!profileRow) throw new Error("Business account not found on this device.");
        const profile = JSON.parse(String(profileRow.body));
        const bills = db.prepare("SELECT body FROM records WHERE table_name='bills' AND json_extract(body,'$.profile_id')=?").all(profileId).map(row => JSON.parse(String(row.body)));
        const nextBill = bills.length ? Number(profile.next_bill_number) : 1;
        const nextDelivery = bills.reduce((next: number, bill: { delivery_no?: unknown }) => /^\d+$/.test(String(bill.delivery_no ?? "")) ? Math.max(next, Number(bill.delivery_no) + 1) : next, Math.max(1, Number(profile.next_delivery_number) || 1));
        if (nextBill !== remote.nextBillNumber || nextDelivery !== remote.nextDeliveryNumber) throw new Error("Bill or delivery numbers differ. Sync this account before enabling offline billing.");
        db.prepare("INSERT INTO sync_local_issuers(profile_id,device_id,epoch,state) VALUES(?,?,?,'assigned') ON CONFLICT(profile_id) DO UPDATE SET device_id=excluded.device_id,epoch=excluded.epoch,state='assigned'").run(profileId, deviceId, epoch);
        return read(profileId)!;
      });
    },
    canIssue(profileId: string, deviceId: string, epoch: number) {
      validate(profileId, deviceId, epoch);
      const current = read(profileId);
      return current?.state === "assigned" && current.deviceId === deviceId && current.epoch === epoch;
    },
    beginRelease(profileId: string, deviceId: string, epoch: number) {
      validate(profileId, deviceId, epoch);
      return transact(() => {
        const current = read(profileId);
        if (!current || current.deviceId !== deviceId || current.epoch !== epoch || current.state === "unassigned") throw new Error("Offline permission does not match this device.");
        if (current.state === "assigned") db.prepare("UPDATE sync_local_issuers SET state='releasing' WHERE profile_id=?").run(profileId);
        return read(profileId)!;
      });
    },
    readyForRelease(profileId: string, deviceId: string, epoch: number) {
      validate(profileId, deviceId, epoch);
      const current = read(profileId);
      return current?.state === "releasing" && current.deviceId === deviceId && current.epoch === epoch && outbox.pending(profileId, 1).length === 0;
    },
    finishRelease(profileId: string, deviceId: string, epoch: number, confirmedServerEpoch: number) {
      validate(profileId, deviceId, epoch); epochValue.parse(confirmedServerEpoch);
      if (confirmedServerEpoch !== epoch + 1) throw new Error("Server confirmation does not match the released permission.");
      return transact(() => {
        const current = read(profileId);
        if (current?.state === "unassigned" && current.epoch === confirmedServerEpoch) return current;
        if (!current || current.state !== "releasing" || current.deviceId !== deviceId || current.epoch !== epoch || outbox.pending(profileId, 1).length) throw new Error("Stop billing and sync all pending changes before releasing permission.");
        db.prepare("UPDATE sync_local_issuers SET state='unassigned',device_id=NULL,epoch=? WHERE profile_id=?").run(confirmedServerEpoch, profileId);
        return read(profileId)!;
      });
    },
  };
}
