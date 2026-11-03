import { withLocalSession } from "../../../../lib/local-request";
import { NextResponse } from "next/server";
import { accountSlot } from "@/lib/accounts";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { buildReportRegister, loadReportBills, reportFilters } from "@/lib/excel-report";
import { syncAccountRegister, syncAllAccountRegisters } from "@/lib/register-sync";
import { buildAllAccountRegister, loadAccountReports } from "@/lib/all-account-register";
import { localStorageEnabled } from "@/lib/storage-mode";
import { localDataDirectory } from "@/lib/local-database";
import { join } from "node:path";

async function GETHandler(request: Request) {
  try {
    const user = await requireUser(request);
    if (new URL(request.url).searchParams.get("scope") === "all") {
      if (!localStorageEnabled) throw new Error("All-account Excel export is available only in local billing.");
      const workbook = buildAllAccountRegister(await loadAccountReports(user.id));
      const bytes = await workbook.xlsx.writeBuffer();
      return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="Finance Billing - All Accounts.xlsx"', "cache-control": "private, no-store" } });
    }
    const profile = await requireOwnerProfile(user.id, accountSlot(request));
    if (!profile) throw new Error("Business profile is required.");
    const filters = reportFilters(new URL(request.url).searchParams);
    const workbook = buildReportRegister(await loadReportBills(profile.id, filters));
    const bytes = await workbook.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="Finance Billing Register.xlsx"', "cache-control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to export Excel register" }, { status: 400 }); }
}

async function POSTHandler(request: Request) {
  try {
    const user = await requireUser(request);
    if (new URL(request.url).searchParams.get("scope") === "all") {
      const savedTo = await syncAllAccountRegisters(user.id);
      return NextResponse.json({ ok: true, savedTo });
    }
    const profile = await requireOwnerProfile(user.id, accountSlot(request));
    if (!profile) throw new Error("Business profile is required.");
    await syncAccountRegister(profile.id);
    return NextResponse.json({ ok: true, savedTo: localStorageEnabled ? join(localDataDirectory(), "registers", `${profile.id}.xlsx`) : "the connected Google Drive workbook" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to refresh Excel register" }, { status: 400 });
  }
}

export const GET = withLocalSession(GETHandler);
export const POST = withLocalSession(POSTHandler);
