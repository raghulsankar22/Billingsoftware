import { NextResponse } from "next/server";
import { phoneAccessEnabled, phoneAddresses, phonePort, setPhoneAccess } from "../../../../desktop/phone-access.cjs";
import { requireUser } from "../../../lib/auth";
import { phoneRequest, withLocalSession } from "../../../lib/local-request";
import { baseDataDirectory, currentLocalUser } from "../../../lib/local-session-context";
import { localStorageEnabled } from "../../../lib/storage-mode";
import { validationMessage } from "../../../lib/validation";

const headers = { "cache-control": "no-store" };
function failure(error: unknown, status = 400) { return NextResponse.json({ error: validationMessage(error, "Phone access could not be changed.") }, { status, headers }); }
async function available(request: Request) {
  if (!localStorageEnabled) throw new Error("Phone access is available only in the offline app.");
  await requireUser(request);
}
function status(request: Request) {
  const enabled = phoneAccessEnabled(baseDataDirectory());
  return { administrator: true, enabled, port: phonePort, fromPhone: phoneRequest(request), addresses: enabled ? phoneAddresses() : [] };
}

export const GET = withLocalSession(async (request: Request) => {
  try {
    await available(request);
    // Addresses and the switch are shown to administrators only.
    if (currentLocalUser()?.administrator !== true) return NextResponse.json({ administrator: false }, { headers });
    return NextResponse.json(status(request), { headers });
  } catch (error) { return failure(error); }
});

/** Turns the phone listener on or off. It can be changed only from the shop computer, never from a phone. */
export const PUT = withLocalSession(async (request: Request) => {
  try {
    await available(request);
    if (currentLocalUser()?.administrator !== true) return failure("Administrator sign-in is required to change phone access.", 403);
    if (phoneRequest(request)) return failure("Change phone access on the shop computer, not on a phone.", 403);
    const body = await request.json().catch(() => ({}));
    if (typeof body?.enabled !== "boolean") throw new Error("Choose on or off.");
    setPhoneAccess(baseDataDirectory(), body.enabled);
    return NextResponse.json(status(request), { headers });
  } catch (error) { return failure(error); }
});
