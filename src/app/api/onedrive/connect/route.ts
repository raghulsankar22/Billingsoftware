import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { signState } from "@/lib/crypto";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const clientId = process.env.MICROSOFT_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_CLIENT_ID;
    if (!clientId) throw new Error("Set MICROSOFT_CLIENT_ID before connecting OneDrive.");
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    const state = signState(JSON.stringify({ ownerId: user.id, exp: Date.now() + 10 * 60_000 }));
    const parameters = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: `${baseUrl}/api/onedrive/callback`, response_mode: "query", scope: "offline_access Files.ReadWrite", state });
    return NextResponse.json({ url: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_TENANT_ID || "common"}/oauth2/v2.0/authorize?${parameters}` });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to begin OneDrive connection" }, { status: 400 }); }
}
