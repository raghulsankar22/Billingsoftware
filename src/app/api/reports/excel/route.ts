import { NextResponse } from "next/server";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { buildReportRegister, loadReportBills, reportFilters } from "@/lib/excel-report";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request); const profile = await requireOwnerProfile(user.id);
    if (!profile) throw new Error("Business profile is required.");
    const filters = reportFilters(new URL(request.url).searchParams);
    const workbook = buildReportRegister(await loadReportBills(profile.id, filters));
    const bytes = await workbook.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="Finance Billing Register.xlsx"', "cache-control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to export Excel register" }, { status: 400 }); }
}
