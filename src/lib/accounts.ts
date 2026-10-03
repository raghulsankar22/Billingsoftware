/** Slots are permanent business ledgers owned by one authenticated user. */
export function accountSlot(request: Request): number {
  const value = new URL(request.url).searchParams.get("account") ?? "1";
  if (!/^[123]$/.test(value)) throw new Error("Choose account 1, 2 or 3.");
  return Number(value);
}
