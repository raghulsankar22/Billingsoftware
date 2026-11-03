import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "../../../lib/auth";
import { accountSlot } from "../../../lib/accounts";
import { createLocalDatabase, localDataDirectory } from "../../../lib/local-database";
import { withLocalSession } from "../../../lib/local-request";
import { localStorageEnabled } from "../../../lib/storage-mode";
import { validationMessage } from "../../../lib/validation";

export const GET = withLocalSession(async (request: Request) => {
  const headers = { "cache-control": "no-store" };
  try {
    if (!localStorageEnabled) return NextResponse.json({ error: "Bill history is available in the offline app." }, { status: 501, headers });
    await requireUser(request);
    const query = new URL(request.url).searchParams;
    const options = z.object({ billId: z.string().uuid().optional(), billNumber: z.coerce.number().int().positive().max(1_000_000_000).optional(), offset: z.coerce.number().int().min(0).max(1_000_000).default(0) }).parse(Object.fromEntries(["billId", "billNumber", "offset"].flatMap(key => query.has(key) ? [[key, query.get(key)]] : [])));
    return NextResponse.json(createLocalDatabase(localDataDirectory()).history(accountSlot(request), options), { headers });
  } catch (error) { return NextResponse.json({ error: validationMessage(error, "Unable to load bill history.") }, { status: 400, headers }); }
});
