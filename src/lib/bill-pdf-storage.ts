import type { Bill } from "./types";
import { randomUUID } from "node:crypto";
import { createBillPdf } from "./bill-pdf";
import { createAdminSupabase } from "./supabase";
import { PDFDocument } from "pdf-lib";
import { billPdfTemplateVersion } from "./bill-conditions";
import { billLicenseMetadata } from "./business-license";

type BusinessDetails = { id: string; business_name: string; address: string; phone: string; logo_url?: string | null; license_number?: string | null };

export async function persistBillPdf(profile: BusinessDetails, bill: Bill, newVersion = false, documentType: "finance" | "delivery" = "finance") {
  const supabase = createAdminSupabase();
  const path = newVersion ? `${profile.id}/${bill.id}-${randomUUID()}.pdf` : `${profile.id}/${bill.id}.pdf`;
  const bytes = await createBillPdf(bill, profile, documentType);
  const metadata = { [documentType === "delivery" ? "delivery_pdf_storage_path" : "pdf_storage_path"]: path, [documentType === "delivery" ? "delivery_pdf_error" : "pdf_error"]: null };
  const { error: uploadError } = await supabase.storage.from("bill-pdfs").upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) {
    const { data: existing, error: downloadError } = await supabase.storage.from("bill-pdfs").download(path);
    if (newVersion || downloadError || !existing) throw uploadError;
    const { error: saveError } = await supabase.from("bills").update(metadata).eq("id", bill.id).eq("profile_id", profile.id);
    if (saveError) throw saveError;
    return new Uint8Array(await existing.arrayBuffer());
  }
  const { error: saveError } = await supabase.from("bills").update(metadata).eq("id", bill.id).eq("profile_id", profile.id);
  if (saveError) throw saveError;
  return bytes;
}

export async function loadBillPdf(profile: BusinessDetails, bill: Bill, path?: string | null, documentType: "finance" | "delivery" = "finance") {
  const supabase = createAdminSupabase();
  if (path) {
    const { data, error } = await supabase.storage.from("bill-pdfs").download(path);
    if (!error && data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      try {
        const document = await PDFDocument.load(bytes);
        if (document.getSubject() === billPdfTemplateVersion && document.getKeywords() === billLicenseMetadata(bill, profile)) return bytes;
      } catch {
        // Regenerate unreadable PDFs and older photo-based templates as a new version.
      }
    }
  }
  return persistBillPdf(profile, bill, true, documentType);
}
