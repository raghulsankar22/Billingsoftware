import crypto from "node:crypto";
import { decrypt, encrypt } from "./crypto";
import { createAdminSupabase } from "./supabase";
import { buildReportRegister, loadReportBills } from "./excel-report";
import type { Bill } from "./types";

const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function driveFetch(token: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  if (!response.ok) throw new Error(response.status === 401 ? "Reconnect Google Drive to renew access." : response.status === 403 ? "Google Drive access was denied. Check permissions and storage space." : "Google Drive sync failed. Retry Excel sync shortly.");
  return response;
}

// Supabase is the register's source of truth; a lease serializes exports across servers.
async function syncRegister(profileId: string) {
  const db = createAdminSupabase();
  const { data: connection, error } = await db.from("google_drive_connections").select("*").eq("profile_id", profileId).maybeSingle();
  if (error) throw new Error("Unable to read Google Drive connection.");
  if (!connection) throw new Error("Connect Google Drive before syncing Excel.");
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error("Google OAuth server credentials are not configured.");
  const lease = crypto.randomUUID();
  const claimed = await db.rpc("acquire_drive_sync", { p_profile_id: profileId, p_lease: lease });
  if (claimed.error || !claimed.data) throw new Error("The Google Drive register is syncing. Retry shortly.");
  const startedAt = Date.now();
  try {
    // Read after acquiring the lease to use the latest file ID and refresh token.
    const latest = await db.from("google_drive_connections").select("*").eq("profile_id", profileId).single();
    if (latest.error || !latest.data) throw new Error("Unable to read Google Drive connection.");
    const current = latest.data;
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(20_000), headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: decrypt(current.refresh_token_encrypted) }),
    });
    if (!response.ok) throw new Error("Reconnect Google Drive to renew access.");
    const tokens = await response.json() as { access_token?: string; refresh_token?: string };
    if (!tokens.access_token) throw new Error("Google did not return an access token. Reconnect Google Drive.");
    if (tokens.refresh_token) {
      const saved = await db.from("google_drive_connections").update({ refresh_token_encrypted: encrypt(tokens.refresh_token) }).eq("profile_id", profileId);
      if (saved.error) throw new Error("Unable to save renewed Google access.");
    }
    let fileId: string | null = current.workbook_file_id;
    if (!fileId) {
      const generated = await (await driveFetch(tokens.access_token, "https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files")).json() as { ids?: string[] };
      fileId = generated.ids?.[0] ?? null;
      if (!fileId) throw new Error("Google Drive did not return a workbook ID.");
      // Persist before creating so ambiguous upload failures never create duplicates.
      const saved = await db.from("google_drive_connections").update({ workbook_file_id: fileId }).eq("profile_id", profileId);
      if (saved.error) throw new Error("Unable to save Google Drive workbook ID.");
    }
    const bills = await loadReportBills(profileId, { query: "" });
    const workbook = buildReportRegister(bills);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    if (bytes.length > 5 * 1024 * 1024) throw new Error("The register exceeds the Drive upload limit. Download Excel directly.");
    const path = encodeURIComponent(fileId);
    const metadata = await fetch(`https://www.googleapis.com/drive/v3/files/${path}?fields=id`, { headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    // Leave enough lease time for one bounded upload, even for a large report.
    if (Date.now() - startedAt > 240_000) throw new Error("Register preparation took too long. Retry Excel sync.");
    if (metadata.status === 404) {
      const boundary = `billing_${crypto.randomUUID()}`;
      const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ id: fileId, name: current.workbook_name, mimeType: mime })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
      await driveFetch(tokens.access_token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
    } else {
      if (!metadata.ok) throw new Error("Unable to locate the Google Drive register. Reconnect and retry.");
      await driveFetch(tokens.access_token, `https://www.googleapis.com/upload/drive/v3/files/${path}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": mime }, body: bytes });
    }
    const saved = await db.from("google_drive_connections").update({ updated_at: new Date().toISOString() }).eq("profile_id", profileId);
    if (saved.error) throw new Error("Register uploaded but sync metadata could not be saved. Retry safely.");
  } finally {
    const released = await db.rpc("release_drive_sync", { p_profile_id: profileId, p_lease: lease });
    if (released.error) throw new Error("Unable to release the Google Drive sync lock. Retry after five minutes.");
  }
}

export async function syncBillToGoogleDrive(profileId: string, _bill: Bill) { await syncRegister(profileId); }
export async function markBillVoidInGoogleDrive(profileId: string, _billNumber: number) { await syncRegister(profileId); }
