import type { Bill } from "./types";
import { createBillPdf } from "./bill-pdf";
import { createAdminSupabase } from "./supabase";

type BusinessDetails = { id: string; business_name: string; address: string; phone: string; logo_url?: string | null };

export async function persistBillPdf(profile: BusinessDetails, bill: Bill) {
  const supabase = createAdminSupabase();
  const path = `${profile.id}/${bill.id}.pdf`;
  const bytes = createBillPdf(bill, profile);
  const { error: uploadError } = await supabase.storage.from("bill-pdfs").upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) {
    const { data: existing, error: downloadError } = await supabase.storage.from("bill-pdfs").download(path);
    if (downloadError || !existing) throw uploadError;
    const { error: saveError } = await supabase.from("bills").update({ pdf_storage_path: path, pdf_error: null }).eq("id", bill.id).eq("profile_id", profile.id);
    if (saveError) throw saveError;
    return new Uint8Array(await existing.arrayBuffer());
  }
  const { error: saveError } = await supabase.from("bills").update({ pdf_storage_path: path, pdf_error: null }).eq("id", bill.id).eq("profile_id", profile.id);
  if (saveError) throw saveError;
  return bytes;
}

export async function loadBillPdf(profile: BusinessDetails, bill: Bill, path?: string | null) {
  const supabase = createAdminSupabase();
  if (path) {
    const { data, error } = await supabase.storage.from("bill-pdfs").download(path);
    if (!error && data) return new Uint8Array(await data.arrayBuffer());
  }
  return persistBillPdf(profile, bill);
}
