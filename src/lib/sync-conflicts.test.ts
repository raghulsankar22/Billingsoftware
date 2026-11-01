import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { clockSkewWarning, compareSyncEdits } from "./sync-conflicts";

it("chooses the latest device timestamp regardless of arrival order and breaks ties consistently", () => {
  const earlier = { id: randomUUID(), occurredAt: "2026-10-30T09:00:00Z" };
  const later = { id: randomUUID(), occurredAt: "2026-10-30T09:01:00Z" };
  expect(compareSyncEdits(later, earlier)).toBeGreaterThan(0);
  expect(compareSyncEdits(earlier, later)).toBeLessThan(0);
  const tied = { ...later, occurredAt: earlier.occurredAt };
  expect(Math.sign(compareSyncEdits(earlier, tied))).toBe(-Math.sign(compareSyncEdits(tied, earlier)));
  expect(compareSyncEdits(earlier, earlier)).toBe(0);
});

it("warns when a device clock differs from trusted server time and rejects invalid clocks", () => {
  expect(clockSkewWarning("2026-10-30T09:05:00Z", "2026-10-30T09:00:00Z")).toBe(false);
  expect(clockSkewWarning("2026-10-30T09:05:01Z", "2026-10-30T09:00:00Z")).toBe(true);
  expect(() => clockSkewWarning("invalid", "2026-10-30T09:00:00Z")).toThrow();
});
