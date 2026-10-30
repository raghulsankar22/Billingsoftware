import { withLocalSession } from "../../../../lib/local-request";
import { NextRequest, NextResponse } from "next/server";
import { encrypt } from "@/lib/crypto";
import { createAdminSupabase } from "@/lib/supabase";
import { applicationUrl, driveWorkbookName, exchangeGoogleCode, googleCookie, readGoogleConnection } from "@/lib/google-oauth";

async function GETHandler(request: Request) {
  const url = new URL(request.url);
  let account = 1;
  const redirect = (query: string) => {
    const response = NextResponse.redirect(`${applicationUrl(url.origin)}/?account=${account}&${query}`);
    response.cookies.set(googleCookie, "", { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/api/google-drive", maxAge: 0 });
    return response;
  };
  try {
    const code = url.searchParams.get("code"); const state = url.searchParams.get("state");
    const payload = readGoogleConnection(new NextRequest(request).cookies.get(googleCookie)?.value, state);
    account = payload.accountSlot;
    if (url.searchParams.has("error")) throw new Error("Google sign-in was cancelled or access was not allowed. Please connect again.");
    if (!code || !state) throw new Error("Google did not return a connection code.");
    const supabase = createAdminSupabase(); const { data: profile, error: profileError } = await supabase.from("business_profiles").select("id,business_name").eq("owner_id", payload.ownerId).eq("id", payload.profileId).eq("account_slot", payload.accountSlot).maybeSingle();
    if (profileError) throw profileError;
    if (!profile) throw new Error("The selected business account is no longer available. Connect again.");
    const refreshToken = await exchangeGoogleCode(code, payload);
    // Reconnecting replaces the credentials while retaining the existing Drive file.
    const { error } = await supabase.from("google_drive_connections").upsert({ profile_id: profile.id, refresh_token_encrypted: encrypt(refreshToken), workbook_name: driveWorkbookName(payload.accountSlot, profile.business_name), updated_at: new Date().toISOString() }, { onConflict: "profile_id" });
    if (error) throw error;
    return redirect("google-drive=connected");
  } catch (error) { return redirect(`google-drive=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Connection failed")}`); }
}


export const GET = withLocalSession(GETHandler);
