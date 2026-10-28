import { createAdminSupabase } from "./supabase";
import { localStorageEnabled } from "./storage-mode";

export function assertOwnerEmail(actual: string | undefined, configured: string | undefined) {
  const ownerEmail = configured?.trim().toLowerCase();
  if (!ownerEmail) throw new Error("BILLING_OWNER_EMAIL is not configured on the server.");
  if (actual?.toLowerCase() !== ownerEmail) throw new Error("This account is not authorized to access billing.");
}

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function sameLocalOrigin(value: string, requestUrl: URL) {
  try {
    const origin = new URL(value);
    return origin.origin === value
      && localHosts.has(origin.hostname)
      && origin.protocol === requestUrl.protocol
      && origin.port === requestUrl.port;
  } catch {
    return false;
  }
}

export async function requireUser(request: Request) {
  if (localStorageEnabled) {
    const url = new URL(request.url);
    if (!localHosts.has(url.hostname)) throw new Error("Local billing is available only on this computer.");
    const origin = request.headers.get("origin");
    if ((origin && !sameLocalOrigin(origin, url)) || request.headers.get("sec-fetch-site") === "cross-site") throw new Error("Open billing directly on this computer.");
    return { id: "local-owner", email: "local@localhost" };
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in is required.");
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("Your session has expired. Please sign in again.");
  assertOwnerEmail(data.user.email, process.env.BILLING_OWNER_EMAIL);
  return data.user;
}

export async function requireOwnerProfile(ownerId: string, account = 1) {
  const supabase = createAdminSupabase();
  if (!Number.isInteger(account) || account < 1 || account > 3) throw new Error("Choose account 1, 2 or 3.");
  const { data, error } = await supabase.from("business_profiles").select("*").eq("owner_id", ownerId).eq("account_slot", account).maybeSingle();
  if (error) throw error;
  return data;
}
