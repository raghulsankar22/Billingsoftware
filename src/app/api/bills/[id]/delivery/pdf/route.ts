import { NextResponse } from "next/server";
import { accountSlot } from "@/lib/accounts";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { loadBillPdf } from "@/lib/bill-pdf-storage";
import { toBill } from "@/lib/bills";
import { createAdminSupabase } from "@/lib/supabase";
import { localStorageEnabled } from "@/lib/storage-mode";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!localStorageEnabled) return NextResponse.json({ error: "Delivery bills are available in local billing mode." }, { status: 501 });
    const user = await requireUser(request);
    const profile = await requireOwnerProfile(user.id, accountSlot(request));
    if (!profile) throw new Error("Business profile is required.");
    const { id } = await context.params;
    const { data, error } = await createAdminSupabase().from("bills").select("*, bill_items(*)").eq("id", id).eq("profile_id", profile.id).single();
    if (error) throw error;
    const bill = toBill({ ...data, items: data.bill_items });
    if (!bill.deliveryNo || !bill.deliveryDate) throw new Error("Save delivery before printing the delivery bill.");
    const bytes = await loadBillPdf(profile, bill, data.delivery_pdf_storage_path, "delivery");
    return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Delivery-Bill-${bill.billNumber}.pdf"`, "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load delivery bill." }, { status: 400 });
  }
}
