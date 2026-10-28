import { NextResponse } from "next/server";
import { accountSlot } from "@/lib/accounts";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { refreshUpdatedBillOutputs } from "@/lib/bill-update-outputs";
import { toBill } from "@/lib/bills";
import { localStorageEnabled } from "@/lib/storage-mode";
import { createAdminSupabase } from "@/lib/supabase";
import { deliverySchema } from "@/lib/validation";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!localStorageEnabled) return NextResponse.json({ error: "Delivery is available in local billing mode." }, { status: 501 });
    const user = await requireUser(request);
    const account = accountSlot(request);
    const profile = await requireOwnerProfile(user.id, account);
    if (!profile) return NextResponse.json({ error: "Set up this business account first." }, { status: 422 });
    const { id } = await context.params;
    const input = deliverySchema.parse(await request.json());
    const db = createAdminSupabase();
    const { data: result, error: saveError } = await db.rpc("record_bill_delivery", { p_owner_id: user.id, p_bill_id: id, p_account_slot: account, p_delivery: input });
    if (saveError) throw saveError;
    const { data, error } = await db.from("bills").select("*, bill_items(*)").eq("id", result.id).eq("profile_id", profile.id).single();
    if (error) throw error;
    const bill = toBill({ ...data, items: data.bill_items });
    const warnings = await refreshUpdatedBillOutputs(profile, bill, result.previousPdfPath, result.previousDeliveryPdfPath);
    return NextResponse.json({ bill, warnings });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save delivery." }, { status: 400 });
  }
}
