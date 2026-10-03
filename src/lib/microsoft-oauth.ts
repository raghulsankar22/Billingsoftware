import crypto from "node:crypto";
import { decrypt, encrypt } from "./crypto";

export const microsoftCookie = "onedrive_oauth";
type ConnectionRequest = { ownerId: string; state: string; verifier: string; expiresAt: number; redirectUri: string };

export function microsoftConfigured() {
  return Boolean((process.env.MICROSOFT_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_CLIENT_ID) && process.env.MICROSOFT_CLIENT_SECRET && (process.env.TOKEN_ENCRYPTION_KEY?.length ?? 0) >= 32);
}

export function applicationUrl(origin: string) {
  return new URL(process.env.NEXT_PUBLIC_APP_URL || origin).origin;
}

export function beginMicrosoftConnection(ownerId: string, origin: string) {
  if (!microsoftConfigured()) throw new Error("Configure Microsoft client ID, client secret, and the token encryption key before connecting OneDrive.");
  const payload: ConnectionRequest = { ownerId, state: crypto.randomBytes(32).toString("base64url"), verifier: crypto.randomBytes(48).toString("base64url"), expiresAt: Date.now() + 10 * 60_000, redirectUri: `${applicationUrl(origin)}/api/onedrive/callback` };
  const parameters = new URLSearchParams({ client_id: (process.env.MICROSOFT_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_CLIENT_ID)!, response_type: "code", redirect_uri: payload.redirectUri, response_mode: "query", scope: "offline_access Files.ReadWrite", state: payload.state, code_challenge: crypto.createHash("sha256").update(payload.verifier).digest("base64url"), code_challenge_method: "S256", prompt: "select_account" });
  return { url: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_TENANT_ID || "common"}/oauth2/v2.0/authorize?${parameters}`, cookie: encrypt(JSON.stringify(payload)) };
}

export function readMicrosoftConnection(cookie: string | undefined, state: string | null) {
  if (!cookie || !state) throw new Error("Microsoft connection request is missing. Start again from this browser.");
  let payload: ConnectionRequest;
  try { payload = JSON.parse(decrypt(cookie)) as ConnectionRequest; }
  catch { throw new Error("Microsoft connection request is invalid. Please try again."); }
  if (typeof payload.state !== "string" || payload.state !== state || typeof payload.ownerId !== "string" || !payload.ownerId || typeof payload.verifier !== "string" || typeof payload.redirectUri !== "string") throw new Error("Microsoft connection request is invalid. Please try again.");
  if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) throw new Error("Microsoft connection request expired. Please try again.");
  return payload;
}

export async function exchangeMicrosoftCode(code: string, payload: ConnectionRequest) {
  if (!microsoftConfigured()) throw new Error("Microsoft OAuth server credentials are not configured.");
  const response = await fetch(`https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_TENANT_ID || "common"}/oauth2/v2.0/token`, {
    method: "POST", signal: AbortSignal.timeout(20_000), cache: "no-store", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: (process.env.MICROSOFT_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_CLIENT_ID)!, client_secret: process.env.MICROSOFT_CLIENT_SECRET!, code, redirect_uri: payload.redirectUri, grant_type: "authorization_code", code_verifier: payload.verifier, scope: "offline_access Files.ReadWrite" }),
  });
  if (!response.ok) throw new Error("Microsoft could not complete sign-in. Check the app credentials and callback URL, then reconnect.");
  const tokens = await response.json() as { refresh_token?: string };
  if (!tokens.refresh_token) throw new Error("Microsoft did not provide offline access. Reconnect and allow OneDrive access.");
  return tokens.refresh_token;
}
