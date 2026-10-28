export type AccountSlot = 1 | 2 | 3;

/** Adds the selected business ledger to an API path while preserving other query parameters. */
export function withAccountSlot(path: string, accountSlot: AccountSlot): string {
  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const queryIndex = withoutHash.indexOf("?");
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const query = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "");
  query.set("account", String(accountSlot));
  return `${pathname}?${query.toString()}${hash}`;
}
