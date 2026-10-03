import { NextRequest, NextResponse } from "next/server";
import { encrypt } from "@/lib/crypto";
import { createAdminSupabase } from "@/lib/supabase";
import { applicationUrl, exchangeMicrosoftCode, microsoftCookie, readMicrosoftConnection } from "@/lib/microsoft-oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirect = (query: string) => {
    const response = NextResponse.redirect(`${applicationUrl(url.origin)}/?${query}`);
    response.cookies.set(microsoftCookie, "", { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/api/onedrive", maxAge: 0 });
    return response;
  };
  try {
    const code = url.searchParams.get("code"); const state = url.searchParams.get("state");
    const payload = readMicrosoftConnection(new NextRequest(request).cookies.get(microsoftCookie)?.value, state);
    if (url.searchParams.has("error")) throw new Error("Microsoft sign-in was cancelled or access was not allowed. Please connect again.");
    if (!code || !state) throw new Error("Microsoft did not return a connection code.");
    const refreshToken = await exchangeMicrosoftCode(code, payload);
    const supabase = createAdminSupabase(); const { data: profile, error: profileError } = await supabase.from("business_profiles").select("id").eq("owner_id", payload.ownerId).single();
    if (profileError) throw profileError;
    const { error } = await supabase.from("microsoft_connections").upsert({ profile_id: profile.id, refresh_token_encrypted: encrypt(refreshToken), workbook_path: process.env.ONEDRIVE_WORKBOOK_PATH || "Finance Billing Register.xlsx", updated_at: new Date().toISOString() });
    if (error) throw error;
    return redirect("onedrive=connected");
  } catch (error) { return redirect(`onedrive=error&message=${encodeURIComponent(error instanceof Error ? error.message : "Connection failed")}`); }
}
