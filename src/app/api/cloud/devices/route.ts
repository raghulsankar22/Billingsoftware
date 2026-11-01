import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { cloudMultiUserEnabled } from "@/lib/cloud-mode";
import { localStorageEnabled } from "@/lib/storage-mode";
import { createAdminSupabase } from "@/lib/supabase";
import { withLocalSession } from "../../../../lib/local-request";

export const runtime = "nodejs";
const inputSchema = z.object({ name: z.string().trim().min(1).max(120), deviceId: z.string().uuid(), secret: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const headers = { "cache-control": "no-store" };

/** A device first stores its secret locally; retries submit the same ID and secret. */
async function POSTHandler(request: Request) {
  try {
    if (localStorageEnabled || !cloudMultiUserEnabled()) return NextResponse.json({ error: "Cloud device registration is not available." }, { status: 404, headers });
    const user = await requireUser(request);
    const { name, deviceId, secret } = inputSchema.parse(await request.json());
    const tokenHash = createHash("sha256").update(secret).digest("hex");
    const { data, error } = await createAdminSupabase().rpc("register_cloud_device", { p_owner_id: user.id, p_device_id: deviceId, p_name: name, p_token_hash: tokenHash });
    if (error) throw new Error("Unable to register device.");
    return NextResponse.json({ device: data }, { status: 201, headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "Invalid device registration details." : error instanceof Error ? error.message : "Unable to register device." }, { status: 400, headers });
  }
}
export const POST = withLocalSession(POSTHandler);
