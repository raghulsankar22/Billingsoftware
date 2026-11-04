import { timingSafeEqual } from "node:crypto";
import { phoneHeader } from "../../desktop/phone-access.cjs";

/** True only for requests that came through the server's phone listener (it alone holds the secret). */
export function phoneRequest(request: Request) {
  const secret = process.env.BILLING_PHONE_SECRET; const value = request.headers.get(phoneHeader);
  if (!secret || !value || value.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(secret));
}

/** A phone page may talk only to the address it was opened from, and never as a cross-site request. */
export function phoneOriginAllowed(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const value = request.headers.get("origin");
  if (!value) return true;
  try { return new URL(value).host === request.headers.get("host"); } catch { return false; }
}
