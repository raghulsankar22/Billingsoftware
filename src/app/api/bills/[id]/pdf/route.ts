import { NextResponse } from "next/server";
import { accountSlot } from "@/lib/accounts";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase";
import { toBill } from "@/lib/bills";
import { loadBillPdf } from "@/lib/bill-pdf-storage";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const profile = await requireOwnerProfile(user.id, accountSlot(request));
    if (!profile) return NextResponse.json({ error: "Business profile is required." }, { status: 422 });
    const { id } = await context.params;
    const { data, error } = await createAdminSupabase().from("bills").select("*, bill_items(*)").eq("id", id).eq("profile_id", profile.id).single();
    if (error) throw error;
    const bill = toBill({ ...data, items: data.bill_items });
    const bytes = await loadBillPdf(profile, bill, data.pdf_storage_path);
    return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Bill-${bill.billNumber}.pdf"`, "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load bill PDF" }, { status: 400 });
  }
}
