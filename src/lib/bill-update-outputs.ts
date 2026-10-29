import type { Bill, BusinessSnapshot } from "./types";
import { persistBillPdf } from "./bill-pdf-storage";
import { syncAccountRegister } from "./register-sync";
import { createAdminSupabase } from "./supabase";

export async function refreshUpdatedBillOutputs(profile: BusinessSnapshot & { id: string }, bill: Bill, previousPdfPath?: string | null, previousDeliveryPdfPath?: string | null, options: { syncRegister?: boolean } = {}) {
  const db = createAdminSupabase();
  const warnings: string[] = [];
  let pdfSaved = false;
  try {
    await persistBillPdf(profile, bill, true);
    pdfSaved = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF storage failed";
    await db.from("bills").update({ pdf_error: message }).eq("id", bill.id).eq("profile_id", profile.id);
    warnings.push(`PDF update needs a retry: ${message}`);
  }
  if (pdfSaved && previousPdfPath) {
    const { error } = await db.storage.from("bill-pdfs").remove([previousPdfPath]);
    if (error) {
      await db.from("bills").update({ pdf_error: `Previous PDF cleanup failed: ${error.message}` }).eq("id", bill.id).eq("profile_id", profile.id);
      warnings.push("The updated PDF is saved, but its previous copy could not be removed.");
    }
  }
  if (bill.deliveryNo && bill.deliveryDate && bill.deliverySummary && !bill.deliverySummary.missingMetal) {
    try {
      await persistBillPdf(profile, bill, true, "delivery");
      if (previousDeliveryPdfPath) {
        const { error } = await db.storage.from("bill-pdfs").remove([previousDeliveryPdfPath]);
        if (error) warnings.push("The delivery bill is saved, but its previous PDF could not be removed.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delivery PDF storage failed";
      await db.from("bills").update({ delivery_pdf_error: message }).eq("id", bill.id).eq("profile_id", profile.id);
      warnings.push(`Delivery PDF needs a retry: ${message}`);
    }
  } else if (previousDeliveryPdfPath) {
    const { error } = await db.storage.from("bill-pdfs").remove([previousDeliveryPdfPath]);
    if (error) warnings.push("The previous delivery PDF could not be removed.");
  }
  if (options.syncRegister === false) return warnings;
  try {
    await syncAccountRegister(profile.id);
    const { error } = await db.from("bills").update({ excel_sync_status: "synced", excel_sync_error: null }).eq("id", bill.id).eq("profile_id", profile.id);
    if (error) throw error;
    bill.excelSyncStatus = "synced";
    bill.excelSyncError = undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Excel sync failed";
    await db.from("bills").update({ excel_sync_status: "failed", excel_sync_error: message }).eq("id", bill.id).eq("profile_id", profile.id);
    bill.excelSyncStatus = "failed";
    bill.excelSyncError = message;
    warnings.push(`Excel update needs a retry: ${message}`);
  }
  return warnings;
}
