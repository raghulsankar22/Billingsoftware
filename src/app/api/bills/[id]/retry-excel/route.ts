import { NextResponse } from "next/server";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase";
import { toBill } from "@/lib/bills";
import { syncBillToOneDrive } from "@/lib/onedrive";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request); const profile = await requireOwnerProfile(user.id);
    if (!profile) throw new Error("Business profile is required.");
    const { id } = await context.params; const supabase = createAdminSupabase();
    const { data, error } = await supabase.from("bills").select("*, bill_items(*)").eq("id", id).eq("profile_id", profile.id).single();
    if (error) throw error;
    const bill = toBill({ ...data, items: data.bill_items });
    await syncBillToOneDrive(profile.id, bill);
    await supabase.from("bills").update({ excel_sync_status: "synced", excel_sync_error: null }).eq("id", id);
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to retry Excel sync" }, { status: 400 }); }
}
