import { NextResponse } from "next/server";
import { accountSlot } from "@/lib/accounts";
import { requireUser, requireOwnerProfile } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase";
import { beginGoogleConnection, googleConfigured, googleCookie } from "@/lib/google-oauth";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const profile = await requireOwnerProfile(user.id, accountSlot(request));
    if (!profile) return NextResponse.json({ configured: googleConfigured(), connected: false, workbookName: null, updatedAt: null });
    const { data, error } = await createAdminSupabase().from("google_drive_connections").select("workbook_name,updated_at").eq("profile_id", profile.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ configured: googleConfigured(), connected: Boolean(data), workbookName: data?.workbook_name ?? null, updatedAt: data?.updated_at ?? null });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read Google Drive connection" }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const profile = await requireOwnerProfile(user.id, accountSlot(request));
    if (!profile) throw new Error("Set up your business before connecting Google Drive.");
    const origin = new URL(request.url).origin;
    const connection = beginGoogleConnection(user.id, origin, profile.id, accountSlot(request));
    const response = NextResponse.json({ url: connection.url });
    response.cookies.set(googleCookie, connection.cookie, { httpOnly: true, secure: origin.startsWith("https://"), sameSite: "lax", path: "/api/google-drive", maxAge: 600 });
    return response;
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to begin Google Drive connection" }, { status: 400 }); }
}


