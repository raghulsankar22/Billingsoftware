import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { loadGlobalSearch } from "@/lib/global-search";
import { createLocalDatabase, localOwnerId } from "@/lib/local-database";
import { localStorageEnabled } from "@/lib/storage-mode";

const headers = { "cache-control": "no-store" };

export async function GET(request: Request) {
  try {
    if (!localStorageEnabled) throw new Error("All-account search is available in offline billing.");
    const user = await requireUser(request);
    if (user.id !== localOwnerId) throw new Error("Invalid local owner.");
    const results = await loadGlobalSearch(createLocalDatabase(), user.id, new URL(request.url).searchParams);
    return NextResponse.json(results, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to search bills." }, { status: 400, headers });
  }
}
