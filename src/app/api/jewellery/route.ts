import { withLocalSession } from "../../../lib/local-request";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createLocalDatabase } from "@/lib/local-database";
import { localStorageEnabled } from "@/lib/storage-mode";

async function catalogue(request: Request) {
  await requireUser(request);
  if (!localStorageEnabled) throw new Error("The jewellery list is available in offline billing.");
  return createLocalDatabase().jewellery;
}

async function GETHandler(request: Request) {
  try {
    const jewellery = await catalogue(request);
    return NextResponse.json({ items: jewellery.list() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load jewellery." }, { status: 400 });
  }
}

async function POSTHandler(request: Request) {
  try {
    const jewellery = await catalogue(request);
    const input = await request.json();
    return NextResponse.json(jewellery.add(input?.name));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save jewellery." }, { status: 400 });
  }
}

async function PATCHHandler(request: Request) {
  try {
    const jewellery = await catalogue(request);
    const input = await request.json();
    return NextResponse.json(jewellery.rename(input?.originalName, input?.name));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to edit jewellery." }, { status: 400 });
  }
}

async function DELETEHandler(request: Request) {
  try {
    const jewellery = await catalogue(request);
    const input = await request.json();
    return NextResponse.json(jewellery.remove(input?.name));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to delete jewellery." }, { status: 400 });
  }
}

export const GET = withLocalSession(GETHandler);
export const POST = withLocalSession(POSTHandler);
export const PATCH = withLocalSession(PATCHHandler);
export const DELETE = withLocalSession(DELETEHandler);
