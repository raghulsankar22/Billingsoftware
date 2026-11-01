import { withLocalSession } from "../../../lib/local-request";
import { NextResponse } from "next/server";
import { z } from "zod";
import { accountSlot } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";
import { SharedPhoneError } from "../../../lib/customers";
import { createLocalDatabase, localOwnerId } from "@/lib/local-database";
import { localStorageEnabled } from "@/lib/storage-mode";

const headers = { "cache-control": "no-store" };

async function context(request: Request) {
  if (!localStorageEnabled) throw new Error("Customers are available in offline billing.");
  const user = await requireUser(request);
  if (user.id !== localOwnerId) throw new Error("Invalid local owner.");
  const account = accountSlot(request);
  return { account, customers: createLocalDatabase().customers };
}

function failure(error: unknown) {
  if (error instanceof SharedPhoneError) return NextResponse.json({ error: error.message, sharedPhone: error.customer }, { status: 409, headers });
  return NextResponse.json({ error: error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Unable to access customers." }, { status: 400, headers });
}

async function GETHandler(request: Request) {
  try {
    const { account, customers } = await context(request);
    const query = new URL(request.url).searchParams;
    // A phone can be shared by family members, so staff choose rather than the app assuming.
    if (query.has("phone") && !query.has("aadhaar")) return NextResponse.json({ customer: null, matches: customers.phoneMatches(account, query.get("phone") ?? "") }, { headers });
    if (query.has("phone") || query.has("aadhaar")) {
      return NextResponse.json({ customer: customers.lookup(account, { phone: query.get("phone") ?? undefined, aadhaar: query.get("aadhaar") ?? undefined }) }, { headers });
    }
    return NextResponse.json({ customers: customers.list(account, query.get("q") ?? "") }, { headers });
  } catch (error) { return failure(error); }
}

async function POSTHandler(request: Request) {
  try {
    const { account, customers } = await context(request);
    const input = await request.json();
    const customer = customers.save(account, input, undefined, { allowSharedPhone: input?.allowSharedPhone === true });
    return NextResponse.json({ customer }, { status: 201, headers });
  } catch (error) { return failure(error); }
}

async function PATCHHandler(request: Request) {
  try {
    const { account, customers } = await context(request);
    const input = await request.json();
    const id = z.string().uuid("Choose a saved customer to edit.").parse(input?.id);
    return NextResponse.json({ customer: customers.save(account, input, id, { allowSharedPhone: input?.allowSharedPhone === true }) }, { headers });
  } catch (error) { return failure(error); }
}

export const GET = withLocalSession(GETHandler);
export const POST = withLocalSession(POSTHandler);
export const PATCH = withLocalSession(PATCHHandler);
