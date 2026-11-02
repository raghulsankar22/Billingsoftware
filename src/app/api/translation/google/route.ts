import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { withLocalSession } from "../../../../lib/local-request";
import { currentLocalUser } from "../../../../lib/local-session-context";
import { GoogleTranslationError, GoogleTranslationLimiter, parseGoogleTranslationInput, readTranslationJson, translateWithGoogle } from "../../../../lib/google-translation";

export const runtime = "nodejs";
const limiter = new GoogleTranslationLimiter();
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

async function POSTHandler(request: Request) {
  try {
    let user;
    try { user = await requireUser(request); } catch { throw new GoogleTranslationError("unauthenticated", 401); }
    const key = process.env.GOOGLE_TRANSLATION_API_KEY?.trim();
    if (process.env.BILLING_GOOGLE_TRANSLATION !== "1" || !key) throw new GoogleTranslationError("notConfigured", 503);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new GoogleTranslationError("invalid", 400);
    const input = parseGoogleTranslationInput(await readTranslationJson(request, 8192));
    if (!limiter.allow(currentLocalUser()?.id ?? user.id)) throw new GoogleTranslationError("rateLimited", 429);
    const text = await translateWithGoogle(input, key);
    return NextResponse.json({ text, source: input.source, target: input.target, provider: "Google Translate" }, { headers });
  } catch (error) {
    const failure = error instanceof GoogleTranslationError ? error : new GoogleTranslationError("unavailable", 503);
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status, headers });
  }
}

export const POST = withLocalSession(POSTHandler);
