import { withLocalSession } from "../../../../lib/local-request";
import { NextResponse } from "next/server";
import { accountSlot } from "@/lib/accounts";
import { requireOwnerProfile, requireUser } from "@/lib/auth";
import { loadReportBills } from "@/lib/excel-report";
import { buildNoticeRegister, noticeReportFilters } from "@/lib/notice-report";
import { mergeNoticeBills, noticeBillHistory } from "@/lib/notices";
import { addedNoticeBills } from "@/lib/notice-additions";
import { noticeLastDate } from "@/lib/notice-messages";
import { billingToday } from "@/lib/business-updates";
import { localStorageEnabled } from "@/lib/storage-mode";

async function GETHandler(request: Request) {
  try {
    const user = await requireUser(request);
    const account = accountSlot(request);
    const profile = await requireOwnerProfile(user.id, account);
    if (!profile) throw new Error("Business profile is required.");
    const { stage, month, range, query } = noticeReportFilters(new URL(request.url).searchParams);
    const natural = noticeBillHistory(await loadReportBills(profile.id, { ...range, query: "" }), month, stage, query);
    // Bills the owner added by hand to this notice are included too.
    const bills = localStorageEnabled ? mergeNoticeBills(natural, await addedNoticeBills(String(profile.id), month, stage), query) : natural;
    const workbook = buildNoticeRegister(bills, stage, { business_name: String(profile.business_name ?? "") }, noticeLastDate(billingToday()));
    return new NextResponse(Buffer.from(await workbook.xlsx.writeBuffer()), { headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="Notice-${stage}-Account-${account}-${month}.xlsx"`,
      "cache-control": "private, no-store",
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to export notice Excel." }, { status: 400, headers: { "cache-control": "private, no-store" } });
  }
}

export const GET = withLocalSession(GETHandler);
