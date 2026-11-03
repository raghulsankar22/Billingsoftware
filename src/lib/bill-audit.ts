import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { currentLocalUser } from "./local-session-context";

import { changeReasons, type ChangeReason, type BillHistoryEntry } from "./bill-history-types";
const reasonContext = new AsyncLocalStorage<ChangeReason | null>();
export function withBillAuditReason<T>(reason: unknown, action: () => T): T { return reasonContext.run(typeof reason === "string" && Object.hasOwn(changeReasons, reason) ? reason as ChangeReason : null, action); }
type AuditRow = Record<string, any>;
type Snapshot = Map<string, { bill: AuditRow; fields: Record<string, string>; loan: number }>;
const trackedOperations = new Set(["create_bill", "create_bill_with_sync", "import_historical_bills", "record_bill_delivery", "record_bill_deliveries", "cancel_bill_delivery", "mark_lost_bill_declared", "edit_bill", "edit_bill_with_sync", "delete_bill", "replace_bill", "void_bill"]);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex");

export function createBillAudit(database: DatabaseSync) {
  database.exec("CREATE TABLE IF NOT EXISTS bill_history (sequence INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL, bill_id TEXT, bill_number INTEGER, action TEXT NOT NULL, occurred_at TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL, changes TEXT NOT NULL, previous_loan REAL, loan REAL); CREATE INDEX IF NOT EXISTS bill_history_profile ON bill_history(profile_id,sequence); CREATE TRIGGER IF NOT EXISTS bill_history_no_update BEFORE UPDATE ON bill_history BEGIN SELECT RAISE(ABORT,'Bill history is read-only.'); END; CREATE TRIGGER IF NOT EXISTS bill_history_no_delete BEFORE DELETE ON bill_history BEGIN SELECT RAISE(ABORT,'Bill history is read-only.'); END;");
  const rows = (table: string) => database.prepare("SELECT id,body FROM records WHERE table_name=?").all(table).map(row => ({ ...JSON.parse(String(row.body)), id: String(row.id) }) as AuditRow);
  function snapshot(operation?: string): Snapshot | null {
    if (!operation || !trackedOperations.has(operation)) return null;
    const items = new Map<string, AuditRow[]>();
    for (const item of rows("bill_items")) items.set(item.bill_id, [...items.get(item.bill_id) ?? [], item]);
    return new Map(rows("bills").map(bill => [String(bill.id), { bill, loan: Number(bill.total_loan_amount ?? 0), fields: {
      "Bill date": hash(bill.bill_date), "Customer details": hash([bill.customer_name,bill.father_name,bill.address,bill.phone,bill.government_id,bill.customer_id]),
      "Jewellery details": hash((items.get(bill.id) ?? []).sort((left,right) => left.sort_order-right.sort_order).map(item => [item.metal,item.particulars,item.remarks,item.grams,item.assessed_value,item.loan_amount])),
      "Loan amount": hash(bill.total_loan_amount), "Status": hash(bill.status),
      "Delivery": hash([bill.delivery_no,bill.delivery_date,bill.delivery_bill_receipt_status,bill.delivery_collected_by_name,bill.delivery_collected_by_relation,bill.cancelled_deliveries]),
      "Signed declaration": hash(bill.delivery_lost_bill_declared_at),
    } }]));
  }
  const insert = database.prepare("INSERT INTO bill_history(profile_id,bill_id,bill_number,action,occurred_at,actor,reason,changes,previous_loan,loan) VALUES(?,?,?,?,?,?,?,?,?,?)");
  function record(before: Snapshot | null, operation?: string) {
    if (!before) return;
    const after = snapshot(operation)!;
    const actor = currentLocalUser()?.username ?? "Local owner";
    const reason = reasonContext.getStore();
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const previous = before.get(id), current = after.get(id);
      const changes = previous && current ? Object.keys(current.fields).filter(field => previous.fields[field] !== current.fields[field]) : [];
      if (previous && current && changes.length === 0) continue;
      const bill = (current ?? previous)!.bill;
      const action = !previous ? (bill.historical_import ? "Imported" : "Created") : !current ? "Deleted" : operation === "replace_bill" || previous.bill.status !== bill.status ? "Voided" : !previous.bill.delivery_no && bill.delivery_no ? "Delivered" : previous.bill.delivery_no && !bill.delivery_no ? "Delivery cancelled" : changes.length === 1 && changes[0] === "Signed declaration" ? "Declaration confirmed" : "Edited";
      insert.run(bill.profile_id, id, Number(bill.bill_number), action, new Date().toISOString(), actor, reason ? changeReasons[reason] : "Not provided", JSON.stringify(changes), previous?.loan ?? null, current?.loan ?? null);
    }
  }
  function list(profileId: string, options: { billId?: string; billNumber?: number; offset?: number } = {}) {
    const clauses = ["profile_id=?"];
    const values: (string | number)[] = [profileId];
    if (options.billId) { clauses.push("(bill_id=? OR bill_id IS NULL)"); values.push(options.billId); }
    if (options.billNumber !== undefined) { clauses.push("(bill_number=? OR bill_number IS NULL)"); values.push(options.billNumber); }
    const where = clauses.join(" AND ");
    const total = Number(database.prepare("SELECT COUNT(*) AS total FROM bill_history WHERE " + where).get(...values)?.total ?? 0);
    const entries = database.prepare("SELECT * FROM bill_history WHERE " + where + " ORDER BY sequence DESC LIMIT 50 OFFSET ?").all(...values, options.offset ?? 0).map(row => ({ sequence: Number(row.sequence), billId: row.bill_id == null ? null : String(row.bill_id), billNumber: row.bill_number == null ? null : Number(row.bill_number), action: String(row.action), occurredAt: String(row.occurred_at), actor: String(row.actor), reason: String(row.reason), changes: JSON.parse(String(row.changes)), previousLoan: row.previous_loan == null ? null : Number(row.previous_loan), loan: row.loan == null ? null : Number(row.loan) } satisfies BillHistoryEntry));
    return { entries, total };
  }
  function restored(actor: string) {
    for (const profile of rows("business_profiles")) insert.run(profile.id, null, null, "Backup restored", new Date().toISOString(), actor, "Administrator confirmed recovery", JSON.stringify(["Ledger replaced with the selected backup. Earlier changes remain in the safety backup."]), null, null);
  }
  return { snapshot, record, list, restored };
}
