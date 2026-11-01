import { z } from "zod";

const stampSchema = z.object({ id: z.string().uuid(), occurredAt: z.string().datetime({ offset: true }) });
type Stamp = z.infer<typeof stampSchema>;

/** Stable last-writer ordering. Callers must retain the replaced version for recovery. */
export function compareSyncEdits(left: Stamp, right: Stamp): number {
  const a = stampSchema.parse(left); const b = stampSchema.parse(right);
  const difference = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
  if (difference) return Math.sign(difference);
  // A deterministic tie-breaker gives all replicas the same result.
  const first = a.id.toLowerCase(), second = b.id.toLowerCase();
  return first === second ? 0 : first < second ? -1 : 1;
}

/** Check only when the server supplies its current time; offline clocks cannot be verified. */
export function clockSkewWarning(deviceTime: string, serverTime: string, toleranceMs = 5 * 60 * 1000): boolean {
  const date = z.string().datetime({ offset: true });
  const local = Date.parse(date.parse(deviceTime));
  const trusted = Date.parse(date.parse(serverTime));
  z.number().int().min(0).max(86400000).parse(toleranceMs);
  return Math.abs(local - trusted) > toleranceMs;
}
