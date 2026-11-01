import { z } from "zod";
import { parseSyncBill } from "./sync-bill";
import type { SyncOperation } from "./sync-outbox";

type Fetch = typeof fetch;
const acknowledgement = z.object({ operationId: z.string().uuid(), accepted: z.literal(true), clockWarning: z.boolean(), superseded: z.boolean() }).strict();

/** Server-side transport only. Credentials must come from protected local storage. */
export function createCloudSyncClient(options: { baseUrl: string; accessToken: string; deviceId: string; deviceSecret: string; fetcher?: Fetch }) {
  const base = new URL(options.baseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if ((base.protocol !== "https:" && !(local && base.protocol === "http:")) || base.username || base.password || base.search || base.hash) throw new Error("Choose a secure billing server address.");
  z.string().min(1).max(16384).parse(options.accessToken);
  z.string().uuid().parse(options.deviceId);
  z.string().regex(/^[0-9a-f]{64}$/).parse(options.deviceSecret);
  const endpoint = new URL("/api/cloud/sync/bills", base).toString();
  const fetcher = options.fetcher ?? fetch;
  return {
    async submit(input: SyncOperation) {
      const operation = parseSyncBill(input);
      if (operation.deviceId !== options.deviceId) throw new Error("The pending change belongs to another device.");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "POST", cache: "no-store", redirect: "error", signal: controller.signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${options.accessToken}`, "x-billing-device-id": options.deviceId, "x-billing-device-secret": options.deviceSecret, "x-billing-device-time": new Date().toISOString() },
          body: JSON.stringify(operation),
        });
      } catch { clearTimeout(timeout); throw new Error("Unable to connect. Changes remain on this device."); }
      try {
        if (response.status === 409) throw new Error("This bill needs manual review before it can sync.");
        if (response.status === 401 || response.status === 403) throw new Error("Sign in again or check this device's permission. Changes remain on this device.");
        if (!response.ok) throw new Error("Unable to sync this bill. Changes remain on this device.");
        let data: unknown;
        try { data = await response.json(); } catch { throw new Error("The billing server returned an invalid confirmation."); }
        const result = acknowledgement.safeParse(data);
        if (!result.success || result.data.operationId !== operation.id) throw new Error("The billing server returned an invalid confirmation.");
        return result.data;
      } finally { clearTimeout(timeout); }
    },
  };
}
