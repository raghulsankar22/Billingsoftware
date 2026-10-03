import { NextResponse } from "next/server";
import { billSchema } from "@/lib/validation";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase";
import { toBill, totals } from "@/lib/bills";
import { syncBillToOneDrive } from "@/lib/onedrive";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const profile = await requireOwnerProfile(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile is required." }, { status: 422 });
    const { id } = await context.params;
    const input = billSchema.parse(await request.json());
    const total = totals(input);
    const payload = {
      ...input,
      totalAssessedValue: total.assessedValue,
      totalLoanAmount: total.loanAmount,
      items: input.items.map((item, sortOrder) => ({ ...item, sortOrder })),
    };
    const supabase = createAdminSupabase();
    const { data: result, error: replaceError } = await supabase.rpc("replace_bill", {
      p_owner_id: user.id,
      p_original_id: id,
      p_bill: payload,
    });
    if (replaceError) throw replaceError;

    const { data, error } = await supabase.from("bills").select("*, bill_items(*)").eq("id", result.id).single();
    if (error) throw error;
    const bill = toBill({ ...data, items: data.bill_items });
    try {
      await syncBillToOneDrive(profile.id, bill);
      const { error: statusError } = await supabase.from("bills").update({ excel_sync_status: "synced", excel_sync_error: null }).eq("id", bill.id);
      if (statusError) throw statusError;
      bill.excelSyncStatus = "synced";
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "Excel sync failed";
      await supabase.from("bills").update({ excel_sync_status: "failed", excel_sync_error: message }).eq("id", bill.id);
      bill.excelSyncStatus = "failed";
      bill.excelSyncError = message;
    }
    return NextResponse.json({ bill }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to replace bill" }, { status: 400 });
  }
}
