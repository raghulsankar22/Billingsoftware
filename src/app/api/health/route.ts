import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { localStorageEnabled } from "@/lib/storage-mode";
import { localDataDirectory } from "@/lib/local-database";

export async function GET(request: Request) {
  try {
    await requireUser(request);
    return NextResponse.json({ application: "finance-billing", storage: localStorageEnabled ? "local" : "cloud", dataDirectory: localStorageEnabled ? localDataDirectory() : null }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Open billing on this computer." }, { status: 403 });
  }
}
