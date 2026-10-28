import { NextResponse } from "next/server";
import { accountSlot } from "@/lib/accounts";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase";
import { toBill } from "@/lib/bills";
import { syncBillToRegister } from "@/lib/register-sync";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request); const profile = await requireOwnerProfile(user.id, accountSlot(request));
    if (!profile) throw new Error("Business profile is required.");
    const { id } = await context.params; const supabase = createAdminSupabase();
    const { data, error } = await supabase.from("bills").select("*, bill_items(*)").eq("id", id).eq("profile_id", profile.id).single();
    if (error) throw error;
    const bill = toBill({ ...data, items: data.bill_items });
    const { error: pendingError } = await supabase.from("bills").update({ excel_sync_status: "pending", excel_sync_error: null }).eq("id", id).eq("profile_id", profile.id);
    if (pendingError) throw new Error("Unable to record Excel retry. Please try again.");
    try {
      await syncBillToRegister(profile.id, bill);
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "Excel sync failed";
      const { error: failureError } = await supabase.from("bills").update({ excel_sync_status: "failed", excel_sync_error: message }).eq("id", id).eq("profile_id", profile.id);
      if (failureError) throw new Error("Excel sync failed and its status could not be saved. Please retry.");
      throw new Error(message);
    }
    const { error: savedError } = await supabase.from("bills").update({ excel_sync_status: "synced", excel_sync_error: null }).eq("id", id).eq("profile_id", profile.id);
    if (savedError) throw new Error("Excel was updated, but its sync status could not be saved. Retry is safe.");
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to retry Excel sync" }, { status: 400 }); }
}
