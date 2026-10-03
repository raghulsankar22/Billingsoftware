import { NextRequest, NextResponse } from "next/server";
import { encrypt } from "@/lib/crypto";
import { createAdminSupabase } from "@/lib/supabase";
import { applicationUrl, exchangeGoogleCode, googleCookie, readGoogleConnection } from "@/lib/google-oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirect = (query: string) => {
    const response = NextResponse.redirect(`${applicationUrl(url.origin)}/?${query}`);
    response.cookies.set(googleCookie, "", { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/api/google-drive", maxAge: 0 });
    return response;
  };
  try {
    const code = url.searchParams.get("code"); const state = url.searchParams.get("state");
    const payload = readGoogleConnection(new NextRequest(request).cookies.get(googleCookie)?.value, state);
    if (url.searchParams.has("error")) throw new Error("Google sign-in was cancelled or access was not allowed. Please connect again.");
    if (!code || !state) throw new Error("Google did not return a connection code.");
    const refreshToken = await exchangeGoogleCode(code, payload);
    const supabase = createAdminSupabase(); const { data: profile, error: profileError } = await supabase.from("business_profiles").select("id").eq("owner_id", payload.ownerId).single();
    if (profileError) throw profileError;
    // Reconnecting replaces the credentials while retaining the existing Drive file.
    const { error } = await supabase.from("google_drive_connections").upsert({ profile_id: profile.id, refresh_token_encrypted: encrypt(refreshToken), workbook_name: process.env.GOOGLE_DRIVE_WORKBOOK_NAME || "Finance Billing Register.xlsx", updated_at: new Date().toISOString() }, { onConflict: "profile_id" });
    if (error) throw error;
    return redirect("google-drive=connected");
  } catch (error) { return redirect(`google-drive=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Connection failed")}`); }
}

