import { NextResponse } from "next/server";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request); const profile = await requireOwnerProfile(user.id);
    if (!profile) throw new Error("Business profile is required.");
    const { id } = await context.params;
    const { data, error } = await createAdminSupabase().from("bills").update({ status: "void", voided_at: new Date().toISOString() }).eq("id", id).eq("profile_id", profile.id).eq("status", "issued").select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Only issued bills can be voided.");
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to void bill" }, { status: 400 }); }
}
