import { isAccountSlot } from "./account-url";
import { localStorageEnabled } from "./storage-mode";
import { cloudMultiUserEnabled } from "./cloud-mode";

export { accountSlots, isAccountSlot, type AccountSlot } from "./account-url";

/** Slots are permanent business ledgers owned by one authenticated user. */
export function accountSlot(request: Request): number {
  const value = new URL(request.url).searchParams.get("account") ?? "1";
  if (!/^[1-9]\d*$/.test(value) || !isAccountSlot(Number(value)) || (!localStorageEnabled && !cloudMultiUserEnabled() && Number(value) > 3)) throw new Error("Choose a valid business account.");
  return Number(value);
}
