import { withLocalSession } from "../../../lib/local-request";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase";
import { localStorageEnabled } from "@/lib/storage-mode";
import { profileSchema } from "@/lib/profile-validation";
import { cloudMultiUserEnabled } from "@/lib/cloud-mode";

async function POSTHandler(request: Request) {
  try {
    if (!localStorageEnabled && !cloudMultiUserEnabled()) return NextResponse.json({ error: "Adding business accounts is available only in local billing." }, { status: 400 });
    const user = await requireUser(request);
    const input = profileSchema.parse(await request.json());
    const { data, error } = await createAdminSupabase().rpc("create_business_account", { p_owner_id: user.id, p_profile: input });
    if (error) throw error;
    return NextResponse.json({ profile: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create business account" }, { status: 400 });
  }
}

export const POST = withLocalSession(POSTHandler);
