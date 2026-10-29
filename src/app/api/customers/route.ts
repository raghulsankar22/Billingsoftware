import { NextResponse } from "next/server";
import { z } from "zod";
import { accountSlot } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";
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
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to access customers." }, { status: 400, headers });
}

export async function GET(request: Request) {
  try {
    const { account, customers } = await context(request);
    const query = new URL(request.url).searchParams;
    if (query.has("phone") || query.has("aadhaar")) {
      return NextResponse.json({ customer: customers.lookup(account, { phone: query.get("phone") ?? undefined, aadhaar: query.get("aadhaar") ?? undefined }) }, { headers });
    }
    return NextResponse.json({ customers: customers.list(account, query.get("q") ?? "") }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const { account, customers } = await context(request);
    const customer = customers.save(account, await request.json());
    return NextResponse.json({ customer }, { status: 201, headers });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  try {
    const { account, customers } = await context(request);
    const input = await request.json();
    const id = z.string().uuid("Choose a saved customer to edit.").parse(input?.id);
    return NextResponse.json({ customer: customers.save(account, input, id) }, { headers });
  } catch (error) { return failure(error); }
}
