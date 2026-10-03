import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase";

const profileSchema = z.object({ businessName: z.string().min(2).max(160), address: z.string().min(5).max(500), phone: z.string().min(7).max(20), logoUrl: z.string().url().optional().or(z.literal("")), nextBillNumber: z.coerce.number().int().positive().optional() });

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const { data, error } = await createAdminSupabase().from("business_profiles").select("*").eq("owner_id", user.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ profile: data });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load profile" }, { status: 401 }); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const input = profileSchema.parse(await request.json());
    const { data, error } = await createAdminSupabase().from("business_profiles").upsert({ owner_id: user.id, business_name: input.businessName, address: input.address, phone: input.phone, logo_url: input.logoUrl || null, ...(input.nextBillNumber ? { next_bill_number: input.nextBillNumber } : {}) }, { onConflict: "owner_id" }).select().single();
    if (error) throw error;
    return NextResponse.json({ profile: data });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save profile" }, { status: 400 }); }
}
