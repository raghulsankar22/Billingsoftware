import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCloudDevice } from "@/lib/cloud-device-auth";
import { calculateRepayment } from "@/lib/interest";
import { parseSyncBill } from "@/lib/sync-bill";
import { canonicalSyncOperation } from "@/lib/sync-outbox";
import { createAdminSupabase } from "@/lib/supabase";
import { clockSkewWarning } from "@/lib/sync-conflicts";
import { withLocalSession } from "../../../../../lib/local-request";

export const runtime = "nodejs";
const headers = { "cache-control": "no-store" };
const futureToleranceMs = 5 * 60 * 1000;
const respond = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

async function readLimitedBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 100000) return null;
  if (!request.body) return "";
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 100000) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Decide whether the device should retry later or send this change to a person. */
function databaseFailure(error: { message?: unknown; code?: unknown }) {
  const message = String(error.message ?? "");
  const code = String(error.code ?? "");
  if (message.includes("Device authentication failed")) return respond("Device authentication failed.", 403);
  if (message.includes("Delivery changed")) return respond("Unable to sync this bill. Please retry.", 503);
  if (["Offline permission changed", "Bill number", "Sync operation does not match", "revision not available", "history not available"].some(text => message.includes(text))) return respond("This bill requires manual review before it can sync.", 409);
  if (message.includes("Device time is in the future")) return respond("This device's clock was ahead when the change was made. Review the change.", 422);
  // Bad data and missing links (such as a customer not yet in the cloud) fail the same way every time.
  if (code === "P0001" || code.startsWith("22") || code.startsWith("23")) return respond("The server can't accept this bill as it is. Review the change.", 422);
  return respond("Unable to sync this bill. Please retry.", 503);
}

/** Experimental only: issuing real bills remains disabled until full sync is ready. */
async function POSTHandler(request: Request) {
  if (process.env.BILLING_SYNC_BILL_EXPERIMENTAL !== "1") return respond("Bill synchronization is not available.", 404);
  let device;
  try { device = await requireCloudDevice(request); }
  catch (error) {
    // An outage must not tell staff to sign in again.
    const refused = /Device authentication|Sign in|session has expired|not approved|not authorized/.test(error instanceof Error ? error.message : "");
    return refused ? respond("Device authentication failed.", 403) : respond("Unable to sync this bill. Please retry.", 503);
  }
  try {
    const deviceTime = request.headers.get("x-billing-device-time");
    if (!deviceTime) return respond("Device time is required.", 400);
    const now = new Date();
    let clockWarning: boolean;
    try { clockWarning = clockSkewWarning(deviceTime, now.toISOString()); }
    catch { return respond("Device time is invalid.", 400); }
    const body = await readLimitedBody(request);
    if (body === null) return respond("Sync operation is too large.", 413);
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { return respond("Invalid sync operation.", 400); }
    const operation = parseSyncBill(raw);
    if (operation.deviceId !== device.deviceId) return respond("Device does not match the sync operation.", 403);
    const inFuture = Date.parse(operation.occurredAt) > now.getTime() + futureToleranceMs;
    if (inFuture && operation.action === "update") return respond("This device's clock was ahead when the change was made. Review the change.", 422);
    const operationHash = createHash("sha256").update(canonicalSyncOperation(operation)).digest("hex");
    const tokenHash = createHash("sha256").update(request.headers.get("x-billing-device-secret")!).digest("hex");
    // A new bill can't conflict, so it's accepted with the server's time rather than a future one.
    const occurredAt = inFuture ? now.toISOString() : operation.occurredAt;
    const common = { p_owner_id: device.userId, p_profile_id: operation.accountId, p_device_id: device.deviceId, p_token_hash: tokenHash,
      p_operation_id: operation.id, p_operation_hash: operationHash, p_bill_id: operation.entityId, p_payload: operation.payload, p_occurred_at: occurredAt };
    const supabase = createAdminSupabase();
    let result;
    if (operation.action === "create") {
      result = await supabase.rpc("sync_issue_bill_v3", { ...common, p_epoch: operation.issuerEpoch, p_bill_number: operation.payload.billNumber });
    } else {
      const { data: bill, error: billError } = await supabase.from("bills").select("delivery_date").eq("id", operation.entityId).eq("profile_id", operation.accountId).maybeSingle();
      if (billError) return respond("Unable to sync this bill. Please retry.", 503);
      const deliveryDate: string | null = operation.payload.deliveryDate ?? (bill?.delivery_date ? String(bill.delivery_date).slice(0, 10) : null);
      let deliverySummary = null;
      if (deliveryDate && deliveryDate >= operation.payload.billDate) deliverySummary = calculateRepayment(operation.payload.items, operation.payload.billDate, deliveryDate);
      result = await supabase.rpc("sync_edit_bill", { ...common, p_base_operation_id: operation.baseOperationId, p_delivery_date: deliveryDate, p_delivery_summary: deliverySummary });
    }
    const { data, error } = result;
    if (error) return databaseFailure(error);
    if (!data || data.operationId !== operation.id || data.billId !== operation.entityId) return respond("The server could not confirm this bill.", 503);
    if (operation.action === "create" && data.billNumber !== operation.payload.billNumber) return respond("The server could not confirm this bill.", 503);
    if (operation.action === "update" && data.outcome === "needs_review") return respond("This bill requires manual review before it can sync.", 409);
    if (operation.action === "update" && !["applied", "superseded"].includes(data.outcome)) return respond("The server could not confirm this bill.", 503);
    return NextResponse.json({ operationId: data.operationId, accepted: true, clockWarning: clockWarning || inFuture, superseded: operation.action === "update" && data.outcome === "superseded" }, { headers });
  } catch (error) {
    const invalid = error instanceof z.ZodError || (error instanceof Error && ["Unsupported sync operation.", "Duplicate bill item IDs.", "A bill edit needs its base revision."].includes(error.message));
    return invalid ? respond("Invalid sync operation.", 400) : respond("Unable to sync this bill. Please retry.", 503);
  }
}
export const POST = withLocalSession(POSTHandler);
