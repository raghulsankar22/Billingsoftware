import crypto from "node:crypto";
import { isAccountSlot } from "./account-url";
import { decrypt, encrypt } from "./crypto";

export const googleCookie = "google-drive_oauth";
type ConnectionRequest = { ownerId: string; profileId: string; accountSlot: number; state: string; verifier: string; expiresAt: number; redirectUri: string };

export function driveWorkbookName(accountSlot: number, businessName: string) {
  const base = (process.env.GOOGLE_DRIVE_WORKBOOK_NAME || "Finance Billing Register.xlsx").replace(/\.xlsx$/i, "");
  const safe = (value: string) => value.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${safe(base) || "Billing Register"} - Account ${accountSlot} - ${safe(businessName) || "Business"}.xlsx`;
}

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && (process.env.TOKEN_ENCRYPTION_KEY?.length ?? 0) >= 32);
}

export function applicationUrl(origin: string) {
  return new URL(process.env.NEXT_PUBLIC_APP_URL || origin).origin;
}

export function beginGoogleConnection(ownerId: string, origin: string, profileId: string, accountSlot: number) {
  if (!googleConfigured()) throw new Error("Configure Google client ID, client secret, and the token encryption key before connecting Google Drive.");
  const payload: ConnectionRequest = { ownerId, profileId, accountSlot, state: crypto.randomBytes(32).toString("base64url"), verifier: crypto.randomBytes(48).toString("base64url"), expiresAt: Date.now() + 10 * 60_000, redirectUri: `${applicationUrl(origin)}/api/google-drive/callback` };
  const parameters = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, response_type: "code", redirect_uri: payload.redirectUri, scope: "https://www.googleapis.com/auth/drive.file", state: payload.state, code_challenge: crypto.createHash("sha256").update(payload.verifier).digest("base64url"), code_challenge_method: "S256", access_type: "offline", prompt: "consent select_account" });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${parameters}`, cookie: encrypt(JSON.stringify(payload)) };
}

export function readGoogleConnection(cookie: string | undefined, state: string | null) {
  if (!cookie || !state) throw new Error("Google connection request is missing. Start again from this browser.");
  let payload: ConnectionRequest;
  try { payload = JSON.parse(decrypt(cookie)) as ConnectionRequest; }
  catch { throw new Error("Google connection request is invalid. Please try again."); }
  if (!payload || typeof payload.state !== "string" || payload.state !== state || typeof payload.ownerId !== "string" || !payload.ownerId || typeof payload.verifier !== "string" || !payload.verifier || typeof payload.redirectUri !== "string" || !payload.redirectUri) throw new Error("Google connection request is invalid. Please try again.");
  if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) throw new Error("Google connection request expired. Please try again.");
  if (typeof payload.profileId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.profileId) || !isAccountSlot(payload.accountSlot)) throw new Error("Google connection account is invalid. Please try again.");
  return payload;
}

export async function exchangeGoogleCode(code: string, payload: ConnectionRequest) {
  if (!googleConfigured()) throw new Error("Google OAuth server credentials are not configured.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", signal: AbortSignal.timeout(20_000), cache: "no-store", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, code, redirect_uri: payload.redirectUri, grant_type: "authorization_code", code_verifier: payload.verifier, scope: "https://www.googleapis.com/auth/drive.file" }),
  });
  if (!response.ok) throw new Error("Google could not complete sign-in. Check the app credentials and callback URL, then reconnect.");
  const tokens = await response.json() as { refresh_token?: string };
  if (!tokens.refresh_token) throw new Error("Google did not provide offline access. Reconnect and allow Google Drive access.");
  return tokens.refresh_token;
}

