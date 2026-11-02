import { googleTranslationErrors, type GoogleTranslationErrorCode, type GoogleTranslationInput } from "../lib/google-translation-input";
import { localStorageEnabled } from "../lib/storage-mode";
import { requestHeaders } from "./api";

export class GoogleTranslateRequestError extends Error {
  constructor(readonly code: GoogleTranslationErrorCode) { super(googleTranslationErrors[code]); }
}

export async function requestGoogleTranslation(input: GoogleTranslationInput, signal: AbortSignal): Promise<string> {
  let headers: Record<string, string>;
  try { headers = await requestHeaders(); } catch { throw new GoogleTranslateRequestError("unauthenticated"); }
  signal.throwIfAborted();
  const response = await fetch("/api/translation/google", {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(input), signal, cache: "no-store",
  });
  const result = await response.json();
  signal.throwIfAborted();
  if (response.status === 401 && localStorageEnabled && typeof window !== "undefined") window.dispatchEvent(new Event("billing-session-expired"));
  if (!response.ok) {
    const code = response.status === 401 ? "unauthenticated" : typeof result?.code === "string" && Object.hasOwn(googleTranslationErrors, result.code) ? result.code as GoogleTranslationErrorCode : "unavailable";
    throw new GoogleTranslateRequestError(code);
  }
  if (typeof result?.text !== "string" || !result.text.trim() || result.text.length > 2500 || result.provider !== "Google Translate" || result.source !== input.source || result.target !== input.target) throw new GoogleTranslateRequestError("invalidResult");
  return result.text;
}
