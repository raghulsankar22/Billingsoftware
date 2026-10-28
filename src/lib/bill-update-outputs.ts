import type { Bill, BusinessSnapshot } from "./types";
import { persistBillPdf } from "./bill-pdf-storage";
import { syncAccountRegister } from "./register-sync";
import { createAdminSupabase } from "./supabase";

export async function refreshUpdatedBillOutputs(profile: BusinessSnapshot & { id: string }, bill: Bill, previousPdfPath?: string | null) {
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
