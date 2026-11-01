import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { decideBillChange } from "./sync-bill-conflict";

const history = { deliveryChangedSinceBase: false, deletionChangedSinceBase: false };

it("keeps a concurrent deletion and delivery for administrator review regardless of their timestamps", () => {
  const current = { id: randomUUID(), occurredAt: "2026-11-01T10:00:00Z", action: "delivery" as const, delivered: true };
  for (const time of ["2026-11-01T09:00:00Z", "2026-11-01T11:00:00Z"]) {
    expect(decideBillChange({ id: randomUUID(), occurredAt: time, action: "delete", baseOperationId: randomUUID() }, current, { ...history, deliveryChangedSinceBase: true })).toEqual({ outcome: "review", keepDelivery: true });
  }
});

it("uses the latest edit while preserving a recorded delivery", () => {
  const current = { id: randomUUID(), occurredAt: "2026-11-01T10:00:00Z", action: "delivery" as const, delivered: true };
  expect(decideBillChange({ id: randomUUID(), occurredAt: "2026-11-01T11:00:00Z", action: "edit", baseOperationId: randomUUID() }, current, { ...history, deliveryChangedSinceBase: true })).toEqual({ outcome: "apply", keepDelivery: true });
  expect(decideBillChange({ id: randomUUID(), occurredAt: "2026-11-01T09:00:00Z", action: "edit", baseOperationId: randomUUID() }, current, { ...history, deliveryChangedSinceBase: true })).toEqual({ outcome: "superseded", keepDelivery: true });
});

it("allows an intentional deletion after seeing delivery and refuses an unverified history", () => {
  const id = randomUUID(), current = { id, occurredAt: "2026-11-01T10:00:00Z", action: "delivery" as const, delivered: true };
  expect(decideBillChange({ id: randomUUID(), occurredAt: "2026-11-01T11:00:00Z", action: "delete", baseOperationId: id }, current, history)).toEqual({ outcome: "apply", keepDelivery: false });
  expect(decideBillChange({ id: randomUUID(), occurredAt: "2026-11-01T11:00:00Z", action: "delete", baseOperationId: null }, current, null)).toEqual({ outcome: "review", keepDelivery: true });
});

it("does not silently restore a deleted bill when a later delivery arrives", () => {
  const id = randomUUID();
  expect(decideBillChange({ id: randomUUID(), occurredAt: "2026-11-01T11:00:00Z", action: "delivery", baseOperationId: id }, { id, occurredAt: "2026-11-01T10:00:00Z", action: "delete", delivered: false }, history)).toEqual({ outcome: "review", keepDelivery: true });
});
