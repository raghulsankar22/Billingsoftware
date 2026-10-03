import ExcelJS from "exceljs";
import { decrypt, encrypt } from "./crypto";
import { createAdminSupabase } from "./supabase";
import { appendRegisterBill, createRegister } from "./register";
import type { Bill } from "./types";

const graphBase = "https://graph.microsoft.com/v1.0";

function graphPath(path: string) {
  const parts = path.replace(/^\/+/, "").split("/");
  if (parts.some((part) => !part || part === "." || part === "..") || !path.toLowerCase().endsWith(".xlsx")) throw new Error("OneDrive workbook path must identify an .xlsx file in an existing folder.");
  return parts.map(encodeURIComponent).join("/");
}

async function accessToken(profileId: string) {
  const supabase = createAdminSupabase();
  const { data: connection, error } = await supabase.from("microsoft_connections").select("*").eq("profile_id", profileId).maybeSingle();
  if (error) throw error;
  if (!connection) throw new Error("Connect Microsoft OneDrive in Settings before syncing Excel.");
  const clientId = process.env.MICROSOFT_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Microsoft OAuth server credentials are not configured.");
  const response = await fetch(`https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_TENANT_ID || "common"}/oauth2/v2.0/token`, {
    method: "POST", signal: AbortSignal.timeout(20_000), cache: "no-store",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: decrypt(connection.refresh_token_encrypted), scope: "offline_access Files.ReadWrite" }),
  });
  if (!response.ok) throw new Error(response.status === 400 || response.status === 401 ? "Reconnect Microsoft OneDrive to renew access." : "Microsoft sign-in is temporarily unavailable. Retry Excel sync shortly.");
  const tokens = await response.json() as { access_token?: string; refresh_token?: string };
  if (!tokens.access_token) throw new Error("Microsoft did not return an access token. Reconnect OneDrive.");
  if (tokens.refresh_token) {
    const { error: saveError } = await supabase.from("microsoft_connections").update({ refresh_token_encrypted: encrypt(tokens.refresh_token), updated_at: new Date().toISOString() }).eq("profile_id", profileId).eq("refresh_token_encrypted", connection.refresh_token_encrypted);
    if (saveError) throw new Error("Unable to save renewed Microsoft access. Retry Excel sync.");
  }
  return { token: tokens.access_token, path: connection.workbook_path as string };
}

class GraphError extends Error {
  constructor(public status: number) {
    const detail = status === 401 ? "Reconnect Microsoft OneDrive." : status === 403 ? "Microsoft access was denied. Check OneDrive permissions." : status === 404 ? "OneDrive workbook or folder was not found." : status === 409 || status === 412 ? "The Excel register changed during sync. Please retry." : status === 423 ? "The Excel register is locked. Close it in Excel and retry." : status === 429 ? "Microsoft is busy. Retry Excel sync shortly." : "OneDrive is temporarily unavailable. Retry Excel sync.";
    super(detail);
  }
}

async function graphFetch(token: string, path: string, init?: RequestInit) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${graphBase}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${token}`, ...init?.headers } });
    if (response.ok) return response;
    if (![429, 502, 503, 504].includes(response.status) || attempt === 2) throw new GraphError(response.status);
    const retryAfter = response.headers.get("retry-after");
    const wait = retryAfter ? (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 250 * 2 ** attempt;
    if (wait > 5000) throw new GraphError(response.status);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number.isFinite(wait) ? wait : 250)));
  }
  throw new Error("Unable to contact OneDrive.");
}

async function updateRegister(profileId: string, modify: (workbook: ExcelJS.Workbook) => void, allowCreate: boolean) {
  const { token, path } = await accessToken(profileId);
  const itemPath = `/me/drive/root:/${graphPath(path)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let workbook: ExcelJS.Workbook, etag: string | undefined, id: string | undefined;
    try {
      // Download redirects use storage ETags; item metadata supplies the Graph version.
      const item = await (await graphFetch(token, itemPath)).json() as { id?: string; eTag?: string };
      id = item.id; etag = item.eTag;
      if (!id || !etag) throw new Error("OneDrive did not return the workbook version. Retry Excel sync.");
      const existing = await graphFetch(token, `/me/drive/items/${encodeURIComponent(id)}/content`);
      workbook = new ExcelJS.Workbook();
      try { await workbook.xlsx.load(Buffer.from(await existing.arrayBuffer()) as never); }
      catch { throw new Error("The OneDrive register is not a readable Excel workbook."); }
    } catch (error) {
      if (!(error instanceof GraphError) || error.status !== 404 || !allowCreate) throw error;
      workbook = createRegister();
      // A download 404 after finding metadata means the file was removed; retry
      // through the path instead of addressing a stale item ID.
      id = undefined; etag = undefined;
    }
    modify(workbook);
    const bytes = await workbook.xlsx.writeBuffer();
    try {
      await graphFetch(token, id ? `/me/drive/items/${encodeURIComponent(id)}/content` : `${itemPath}:/content?@microsoft.graph.conflictBehavior=fail`, {
        method: "PUT", headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ...(etag ? { "If-Match": etag } : { "If-None-Match": "*" }) }, body: Buffer.from(bytes),
      });
      return;
    } catch (error) {
      if (!(error instanceof GraphError) || ![409, 412].includes(error.status) || attempt === 2) throw error;
      // Merge this bill into the winning file rather than overwriting another bill.
    }
  }
}

export async function syncBillToOneDrive(profileId: string, bill: Bill) {
  await updateRegister(profileId, (workbook) => appendRegisterBill(workbook, bill), true);
}

export async function markBillVoidInOneDrive(profileId: string, billNumber: number) {
  await updateRegister(profileId, (workbook) => {
    const sheet = workbook.getWorksheet("Bills");
    if (!sheet) throw new Error("The workbook has no Bills register.");
    let found = false;
    sheet.eachRow((row, index) => {
      if (index > 1 && Number(row.getCell(4).value) === billNumber) {
        found = true;
        const text = String(row.getCell(7).value ?? "");
        if (!text.startsWith("VOID — ")) row.getCell(7).value = `VOID — ${text}`;
        row.font = { color: { argb: "FFB42318" }, strike: true };
      }
    });
    if (!found) throw new Error("The original bill has not been synced to the OneDrive register.");
  }, false);
}
