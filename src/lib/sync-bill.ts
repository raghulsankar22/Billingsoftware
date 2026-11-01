import { z } from "zod";
import { syncOperationSchema } from "./sync-outbox";
import { dateSchema, recordedGrams, recordedMoney } from "./validation";

const item = z.object({
  id: z.string().uuid(), metal: z.enum(["Gold", "Silver"]), particulars: z.string().trim().min(2).max(180),
  remarks: z.string().trim().max(180).optional(), grams: recordedGrams, assessedValue: recordedMoney, loanAmount: recordedMoney,
}).strict();
const payload = z.object({
  billNumber: z.number().int().min(1).max(2147483646), billDate: dateSchema,
  deliveryNo: z.string().max(60).optional(), deliveryDate: dateSchema.optional(),
  customerName: z.string().trim().min(2).max(120), fatherName: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(500), phone: z.string().trim().max(20).refine(value => !value || value.length >= 7),
  governmentId: z.string().max(80).optional(), customerId: z.string().uuid().optional().or(z.literal("")),
  businessSnapshot: z.object({ business_name: z.string().min(1).max(160), address: z.string().max(500), phone: z.string().max(20), logo_url: z.string().max(2048).nullable().optional(), license_number: z.string().max(80).nullable().optional() }).strict(),
  items: z.array(item).min(1).max(30),
}).strict();

/** Reject incomplete or ambiguous operations before they reach the ledger. */
export function parseSyncBill(value: unknown) {
  const operation = syncOperationSchema.parse(value);
  if (operation.entityType !== "bill" || !["create", "update"].includes(operation.action)) throw new Error("Unsupported sync operation.");
  const bill = payload.parse(operation.payload);
  if (new Set(bill.items.map(entry => entry.id)).size !== bill.items.length) throw new Error("Duplicate bill item IDs.");
  if (operation.action === "create") {
    if (operation.issuerEpoch === undefined) throw new Error("Unsupported sync operation.");
    return { ...operation, action: "create" as const, payload: bill, issuerEpoch: operation.issuerEpoch };
  }
  if (!operation.baseOperationId) throw new Error("A bill edit needs its base revision.");
  return { ...operation, action: "update" as const, payload: bill, baseOperationId: operation.baseOperationId };
}
