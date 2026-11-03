import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "../../../lib/auth";
import { accountSlot } from "../../../lib/accounts";
import { billingToday } from "../../../lib/business-updates";
import { CashBookConflictError } from "../../../lib/cashbook";
import { createLocalDatabase, localDataDirectory } from "../../../lib/local-database";
import { withLocalSession } from "../../../lib/local-request";
import { localStorageEnabled } from "../../../lib/storage-mode";
import { validationMessage } from "../../../lib/validation";

export const runtime = "nodejs";
const headers = { "cache-control": "no-store" };
const querySchema = z.object({ date: z.string().default(billingToday), all: z.enum(["0", "1"]).default("0") });

export const GET = withLocalSession(async (request: Request) => {
  try {
    if (!localStorageEnabled) return NextResponse.json({ error: "Payments and Daily Closing are available only in the offline app." }, { status: 501, headers });
    await requireUser(request);
    const query = new URL(request.url).searchParams;
    const options = querySchema.parse(Object.fromEntries(["date", "all"].flatMap(key => query.has(key) ? [[key, query.get(key)]] : [])));
    const result = createLocalDatabase(localDataDirectory()).cashBook.view(accountSlot(request), options.date, options.all === "1");
    return NextResponse.json(result, { headers });
  } catch (error) { return NextResponse.json({ error: validationMessage(error, "Unable to load the cash book.") }, { status: 400, headers }); }
});

export const POST = withLocalSession(async (request: Request) => {
  try {
    if (!localStorageEnabled) return NextResponse.json({ error: "Payments and Daily Closing are available only in the offline app." }, { status: 501, headers });
    await requireUser(request);
    const query = new URL(request.url).searchParams;
    if (query.has("all") && query.get("all") !== "0") throw new Error("The combined cash book is read-only. Choose one account to record money or close a day.");
    const result = createLocalDatabase(localDataDirectory()).cashBook.post(accountSlot(request), await request.json());
    return NextResponse.json(result, { headers });
  } catch (error) { return NextResponse.json({ error: validationMessage(error, "Unable to save the money record.") }, { status: error instanceof CashBookConflictError ? 409 : 400, headers }); }
});
