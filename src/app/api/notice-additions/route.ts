import { NextResponse } from "next/server";
import { accountSlot } from "../../../lib/accounts";
import { requireOwnerProfile, requireUser } from "../../../lib/auth";
import { isDelivered } from "../../../lib/delivery-status";
import { loadReportBills } from "../../../lib/excel-report";
import { createLocalDatabase } from "../../../lib/local-database";
import { withLocalSession } from "../../../lib/local-request";
import { addedNoticeBills } from "../../../lib/notice-additions";
import { localStorageEnabled } from "../../../lib/storage-mode";

const headers = { "cache-control": "no-store" };
const fail = (error: unknown, fallback: string) => NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 400, headers });

/** Reads the month and notice number the same way for every request. */
function target(source: URLSearchParams | Record<string, unknown>) {
  const read = (key: string) => source instanceof URLSearchParams ? source.get(key) : source[key];
  const month = String(read("month") ?? "");
  const notice = String(read("notice") ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 2) throw new Error("Choose a valid review month and year.");
  if (notice !== "1" && notice !== "2") throw new Error("Choose Notice 1 or Notice 2.");
  return { month, stage: Number(notice) };
}

async function context(request: Request) {
  if (!localStorageEnabled) throw new Error("Adding bills to a notice is available in offline billing.");
  const user = await requireUser(request);
  const profile = await requireOwnerProfile(user.id, accountSlot(request));
  if (!profile) throw new Error("Business profile is required.");
  return { profile: String(profile.id), db: createLocalDatabase() };
}

export const GET = withLocalSession(async (request: Request) => {
  try {
    const { profile } = await context(request);
    const { month, stage } = target(new URL(request.url).searchParams);
    return NextResponse.json({ bills: await addedNoticeBills(profile, month, stage) }, { headers });
  } catch (error) { return fail(error, "Unable to load the added bills."); }
});

export const POST = withLocalSession(async (request: Request) => {
  try {
    const { profile, db } = await context(request);
    const body = await request.json().catch(() => ({}));
    const { month, stage } = target(body);
    const billId = String(body?.billId ?? "");
    const bill = (await loadReportBills(profile, { query: "" })).find(candidate => candidate.id === billId);
    if (!bill) throw new Error("That bill was not found in this business account.");
    if (isDelivered(bill)) throw new Error(`Bill #${bill.billNumber} is already delivered, so it does not need a notice.`);
    db.noticeAdditions.add(profile, month, stage, billId);
    return NextResponse.json({ bills: await addedNoticeBills(profile, month, stage) }, { status: 201, headers });
  } catch (error) { return fail(error, "Unable to add the bill."); }
});

/** Takes a bill off this notice list only. The bill itself is not changed or deleted. */
export const DELETE = withLocalSession(async (request: Request) => {
  try {
    const { profile, db } = await context(request);
    const body = await request.json().catch(() => ({}));
    const { month, stage } = target(body);
    db.noticeAdditions.remove(profile, month, stage, String(body?.billId ?? ""));
    return NextResponse.json({ bills: await addedNoticeBills(profile, month, stage) }, { headers });
  } catch (error) { return fail(error, "Unable to remove the bill from the list."); }
});
