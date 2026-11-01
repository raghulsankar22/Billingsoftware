import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCloudDevice } from "@/lib/cloud-device-auth";
import { parseSyncBill } from "@/lib/sync-bill";
import { canonicalSyncOperation } from "@/lib/sync-outbox";
import { createAdminSupabase } from "@/lib/supabase";
import { clockSkewWarning } from "@/lib/sync-conflicts";
import { withLocalSession } from "../../../../../lib/local-request";

export const runtime = "nodejs";
const headers = { "cache-control": "no-store" };
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

/** Experimental only: issuing real bills remains disabled until full sync is ready. */
async function POSTHandler(request: Request) {
  if (process.env.BILLING_SYNC_BILL_EXPERIMENTAL !== "1") return NextResponse.json({ error: "Bill synchronization is not available." }, { status: 404, headers });
  try {
    const device = await requireCloudDevice(request);
    const deviceTime = request.headers.get("x-billing-device-time");
    if (!deviceTime) return NextResponse.json({ error: "Device time is required." }, { status: 400, headers });
    let clockWarning: boolean;
    try { clockWarning = clockSkewWarning(deviceTime, new Date().toISOString()); }
    catch { return NextResponse.json({ error: "Device time is invalid." }, { status: 400, headers }); }
    const body = await readLimitedBody(request);
    if (body === null) return NextResponse.json({ error: "Sync operation is too large." }, { status: 413, headers });
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { return NextResponse.json({ error: "Invalid sync operation." }, { status: 400, headers }); }
    const operation = parseSyncBill(raw);
    if (operation.deviceId !== device.deviceId) return NextResponse.json({ error: "Device does not match the sync operation." }, { status: 403, headers });
    const operationHash = createHash("sha256").update(canonicalSyncOperation(operation)).digest("hex");
    const tokenHash = createHash("sha256").update(request.headers.get("x-billing-device-secret")!).digest("hex");
    const common = { p_owner_id: device.userId, p_profile_id: operation.accountId, p_device_id: device.deviceId, p_token_hash: tokenHash,
      p_operation_id: operation.id, p_operation_hash: operationHash, p_bill_id: operation.entityId, p_payload: operation.payload, p_occurred_at: operation.occurredAt };
    const { data, error } = operation.action === "create"
      ? await createAdminSupabase().rpc("sync_issue_bill_v3", { ...common, p_epoch: operation.issuerEpoch, p_bill_number: operation.payload.billNumber })
      : await createAdminSupabase().rpc("sync_edit_bill", { ...common, p_base_operation_id: operation.baseOperationId });
    if (error) {
      const message = String(error.message ?? "");
      if (message.includes("Offline permission changed") || message.includes("Bill number") || message.includes("Sync operation does not match") || message.includes("revision not available") || message.includes("history not available")) return NextResponse.json({ error: "This bill requires manual review before it can sync." }, { status: 409, headers });
      return NextResponse.json({ error: "Unable to sync this bill. Please retry." }, { status: 503, headers });
    }
    if (!data || data.operationId !== operation.id || data.billId !== operation.entityId) return NextResponse.json({ error: "The server could not confirm this bill." }, { status: 503, headers });
    if (operation.action === "create" && data.billNumber !== operation.payload.billNumber) return NextResponse.json({ error: "The server could not confirm this bill." }, { status: 503, headers });
    if (operation.action === "update" && data.outcome === "needs_review") return NextResponse.json({ error: "This bill requires manual review before it can sync." }, { status: 409, headers });
    if (operation.action === "update" && !["applied", "superseded"].includes(data.outcome)) return NextResponse.json({ error: "The server could not confirm this bill." }, { status: 503, headers });
    return NextResponse.json({ operationId: data.operationId, accepted: true, clockWarning, superseded: operation.action === "update" && data.outcome === "superseded" }, { headers });
  } catch (error) {
    const invalid = error instanceof z.ZodError || (error instanceof Error && ["Unsupported sync operation.", "Duplicate bill item IDs.", "A bill edit needs its base revision."].includes(error.message));
    return NextResponse.json({ error: invalid ? "Invalid sync operation." : "Device authentication failed." }, { status: invalid ? 400 : 403, headers });
  }
}
export const POST = withLocalSession(POSTHandler);
