import { createHash } from "node:crypto";
import { z } from "zod";
import { requireUser } from "./auth";
import { cloudMultiUserEnabled } from "./cloud-mode";
import { localStorageEnabled } from "./storage-mode";
import { createAdminSupabase } from "./supabase";

/** Server-side device authentication for future sync routes. Never log headers. */
export async function requireCloudDevice(request: Request) {
  if (localStorageEnabled || !cloudMultiUserEnabled()) throw new Error("Cloud synchronization is unavailable.");
  const user = await requireUser(request);
  const id = z.string().uuid().safeParse(request.headers.get("x-billing-device-id"));
  const secret = z.string().regex(/^[0-9a-f]{64}$/).safeParse(request.headers.get("x-billing-device-secret"));
  if (!id.success || !secret.success) throw new Error("Device authentication failed.");
  const hash = createHash("sha256").update(secret.data).digest("hex");
  const { data, error } = await createAdminSupabase().rpc("verify_cloud_device", { p_owner_id: user.id, p_device_id: id.data, p_token_hash: hash });
  if (error || data !== true) throw new Error("Device authentication failed.");
  return { userId: user.id, deviceId: id.data };
}
