import { compareSyncEdits } from "./sync-conflicts";

type Stamp = { id: string; occurredAt: string };
type BillChange = Stamp & { action: "edit" | "delete" | "delivery"; baseOperationId: string | null };
type CurrentBill = Stamp & { action: "create" | "edit" | "delete" | "delivery"; delivered: boolean };
type History = { deliveryChangedSinceBase: boolean; deletionChangedSinceBase: boolean };
type Decision = { outcome: "apply" | "superseded" | "review"; keepDelivery: boolean };

/**
 * The server must calculate history from durable records, not client claims.
 * Missing base/history requires review before these rules can be applied.
 */
export function decideBillChange(incoming: BillChange, current: CurrentBill, history: History | null): Decision {
  if (!incoming.baseOperationId || !history) return { outcome: "review", keepDelivery: current.delivered };
  if (current.action === "delete" && incoming.action !== "delete") return { outcome: "review", keepDelivery: current.delivered || incoming.action === "delivery" };
  const concurrent = incoming.baseOperationId !== current.id;
  if (concurrent && ((incoming.action === "delete" && (history.deliveryChangedSinceBase || current.action === "delivery"))
    || (incoming.action === "delivery" && (history.deletionChangedSinceBase || current.action === "delete"))
    || (incoming.action === "edit" && (history.deletionChangedSinceBase || current.action === "delete")))) {
    return { outcome: "review", keepDelivery: current.delivered || incoming.action === "delivery" };
  }
  if (concurrent && compareSyncEdits(incoming, current) <= 0) return { outcome: "superseded", keepDelivery: current.delivered };
  return { outcome: "apply", keepDelivery: incoming.action === "delete" ? false : current.delivered || incoming.action === "delivery" };
}
