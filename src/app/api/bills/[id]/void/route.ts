import { NextResponse } from "next/server";
import { accountSlot } from "@/lib/accounts";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase";
import { markBillVoidInGoogleDrive } from "@/lib/google-drive";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request); const profile = await requireOwnerProfile(user.id, accountSlot(request));
    if (!profile) throw new Error("Business profile is required.");
    const { id } = await context.params;
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.from("bills").update({ status: "void", voided_at: new Date().toISOString() }).eq("id", id).eq("profile_id", profile.id).eq("status", "issued").select("id, bill_number").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Only issued bills can be voided.");
    try {
      await markBillVoidInGoogleDrive(profile.id, data.bill_number);
      await supabase.from("bills").update({ excel_sync_status: "synced", excel_sync_error: null }).eq("id", id);
      return NextResponse.json({ ok: true, excelSyncStatus: "synced" });
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "Excel sync failed";
      await supabase.from("bills").update({ excel_sync_status: "failed", excel_sync_error: message }).eq("id", id);
      return NextResponse.json({ ok: true, excelSyncStatus: "failed", excelSyncError: message });
    }
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to void bill" }, { status: 400 }); }
}
