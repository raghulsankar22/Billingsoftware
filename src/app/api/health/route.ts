import { isTamilPreviewStorage } from "@/lib/tamil-preview-storage";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { localStorageEnabled } from "@/lib/storage-mode";
import { baseDataDirectory, multiUserEnabled } from "@/lib/local-session-context";

export async function GET(request: Request) {
  try {
    await requireUser(request);
    return NextResponse.json({ application: "finance-billing", demo: isTamilPreviewStorage(), storage: localStorageEnabled ? "local" : "cloud", dataDirectory: localStorageEnabled ? baseDataDirectory() : null, ...(localStorageEnabled && multiUserEnabled() ? { authentication: "local-users-v1" } : {}) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Open billing on this computer." }, { status: 403 });
  }
}
