import { NextResponse } from "next/server";
import { accountSlot } from "@/lib/accounts";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { refreshUpdatedBillOutputs } from "@/lib/bill-update-outputs";
import { toBill } from "@/lib/bills";
import { syncAccountRegister } from "@/lib/register-sync";
import { localStorageEnabled } from "@/lib/storage-mode";
import { createAdminSupabase } from "@/lib/supabase";
import { batchDeliverySchema } from "@/lib/validation";
import type { Bill } from "@/lib/types";

export async function POST(request: Request) {
  try {
    if (!localStorageEnabled) return NextResponse.json({ error: "Multiple delivery is available in offline billing." }, { status: 501 });
    const user = await requireUser(request);
    const account = accountSlot(request);
    const profile = await requireOwnerProfile(user.id, account);
    if (!profile) return NextResponse.json({ error: "Set up this business account first." }, { status: 422 });
    const input = batchDeliverySchema.parse(await request.json());
    const db = createAdminSupabase();
    const { data: saved, error: saveError } = await db.rpc("record_bill_deliveries", { p_owner_id: user.id, p_account_slot: account, p_delivery: input });
    if (saveError) throw saveError;
    const bills: Bill[] = [];
    const warnings: string[] = [];
    for (const result of saved) {
      const { data, error } = await db.from("bills").select("*, bill_items(*)").eq("id", result.id).eq("profile_id", profile.id).single();
      if (error) throw error;
      const bill = toBill({ ...data, items: data.bill_items });
      bills.push(bill);
      const outputWarnings = await refreshUpdatedBillOutputs(profile, bill, result.previousPdfPath, result.previousDeliveryPdfPath, { syncRegister: false });
      warnings.push(...outputWarnings.map(message => `Bill #${bill.billNumber}: ${message}`));
    }
    // All delivery records are committed before exporting one shared account register.
    try {
      await syncAccountRegister(profile.id);
      for (const bill of bills) {
        const { error } = await db.from("bills").update({ excel_sync_status: "synced", excel_sync_error: null }).eq("id", bill.id).eq("profile_id", profile.id);
        if (error) throw error;
        bill.excelSyncStatus = "synced"; bill.excelSyncError = undefined;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Excel export failed.";
      for (const bill of bills) {
        await db.from("bills").update({ excel_sync_status: "failed", excel_sync_error: message }).eq("id", bill.id).eq("profile_id", profile.id);
        bill.excelSyncStatus = "failed"; bill.excelSyncError = message;
      }
      warnings.push(`Deliveries are saved. Excel needs a retry: ${message}`);
    }
    return NextResponse.json({ bills, warnings });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save deliveries." }, { status: 400 });
  }
}
