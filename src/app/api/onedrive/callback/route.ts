import { NextResponse } from "next/server";
import { encrypt, readSignedState } from "@/lib/crypto";
import { createAdminSupabase } from "@/lib/supabase";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const code = url.searchParams.get("code"); const state = url.searchParams.get("state");
    if (!code || !state) throw new Error("Microsoft did not return a connection code.");
    const payload = JSON.parse(readSignedState(state)) as { ownerId: string; exp: number };
    if (payload.exp < Date.now()) throw new Error("Microsoft connection request expired. Please try again.");
    const clientId = process.env.MICROSOFT_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_CLIENT_ID; const secret = process.env.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !secret) throw new Error("Microsoft OAuth server credentials are not configured.");
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;
    const response = await fetch(`https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_TENANT_ID || "common"}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: secret, code, redirect_uri: `${baseUrl}/api/onedrive/callback`, grant_type: "authorization_code", scope: "offline_access Files.ReadWrite" }) });
    if (!response.ok) throw new Error(`Microsoft token exchange failed: ${await response.text()}`);
    const tokens = await response.json() as { refresh_token?: string };
    if (!tokens.refresh_token) throw new Error("Microsoft did not provide an offline refresh token.");
    const supabase = createAdminSupabase(); const { data: profile, error: profileError } = await supabase.from("business_profiles").select("id").eq("owner_id", payload.ownerId).single();
    if (profileError) throw profileError;
    const { error } = await supabase.from("microsoft_connections").upsert({ profile_id: profile.id, refresh_token_encrypted: encrypt(tokens.refresh_token), workbook_path: process.env.ONEDRIVE_WORKBOOK_PATH || "Finance Billing Register.xlsx", updated_at: new Date().toISOString() });
    if (error) throw error;
    return NextResponse.redirect(`${baseUrl}/?onedrive=connected`);
  } catch (error) { return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL || url.origin}/?onedrive=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Connection failed")}`); }
}
