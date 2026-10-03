import { NextResponse } from "next/server";
import { requireUser, requireOwnerProfile } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase";
import { beginMicrosoftConnection, microsoftConfigured, microsoftCookie } from "@/lib/microsoft-oauth";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const profile = await requireOwnerProfile(user.id);
    if (!profile) return NextResponse.json({ configured: microsoftConfigured(), connected: false, workbookPath: null, updatedAt: null });
    const { data, error } = await createAdminSupabase().from("microsoft_connections").select("workbook_path,updated_at").eq("profile_id", profile.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ configured: microsoftConfigured(), connected: Boolean(data), workbookPath: data?.workbook_path ?? null, updatedAt: data?.updated_at ?? null });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read OneDrive connection" }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const profile = await requireOwnerProfile(user.id);
    if (!profile) throw new Error("Set up your business before connecting OneDrive.");
    const origin = new URL(request.url).origin;
    const connection = beginMicrosoftConnection(user.id, origin);
    const response = NextResponse.json({ url: connection.url });
    response.cookies.set(microsoftCookie, connection.cookie, { httpOnly: true, secure: origin.startsWith("https://"), sameSite: "lax", path: "/api/onedrive", maxAge: 600 });
    return response;
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to begin OneDrive connection" }, { status: 400 }); }
}
