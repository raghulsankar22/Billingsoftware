export type AccountSlot = number;

export function isAccountSlot(value: unknown): value is AccountSlot {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 2_147_483_646;
}

/** Keep the original slots visible, even when their business details are still unset. */
export function accountSlots(profiles: readonly { account_slot: unknown }[]): AccountSlot[] {
  return [...new Set([1, 2, 3, ...profiles.map(profile => profile.account_slot).filter(isAccountSlot)])].sort((left, right) => left - right);
}

/** Adds the selected business ledger to an API path while preserving other query parameters. */
export function withAccountSlot(path: string, accountSlot: AccountSlot): string {
  if (!isAccountSlot(accountSlot)) throw new Error("Choose a valid business account.");
  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const queryIndex = withoutHash.indexOf("?");
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const query = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "");
  query.set("account", String(accountSlot));
  return `${pathname}?${query.toString()}${hash}`;
}
