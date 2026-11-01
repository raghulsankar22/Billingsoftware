import { expect, it } from "vitest";
import { finishIssuerReview, forceTransferIssuer, mayIssue, releaseIssuer } from "./sync-issuer";

it("allows only the assigned device to create numbers until it has safely released control", () => {
  const state = { mode: "assigned", deviceId: "device-a", epoch: 5 } as const;
  expect(mayIssue(state, "device-a", true, 5)).toBe(true);
  expect(mayIssue(state, "device-b", false, 5)).toBe(false);
  expect(() => releaseIssuer(state, "device-a", true, false)).toThrow(/sync/);
  expect(() => releaseIssuer(state, "device-a", false, true)).toThrow(/offline/);
  const online = releaseIssuer(state, "device-a", true, true);
  expect(mayIssue(online, "device-a", true, 5)).toBe(false);
  expect(mayIssue(online, "device-b", false, 6)).toBe(true);
  expect(mayIssue(online, "device-b", true, 6)).toBe(false);
});

it("rejects a lost device's stale epoch on reconnect and blocks issuance until manual review", () => {
  const lost = { mode: "assigned", deviceId: "device-a", epoch: 5 } as const;
  const review = forceTransferIssuer(lost, "device-b");
  expect(mayIssue(review, "device-a", true, 5)).toBe(false);
  expect(mayIssue(review, "device-b", false, 6)).toBe(false);
  expect(() => finishIssuerReview(review, false)).toThrow(/Review/);
  const replacement = finishIssuerReview(review, true);
  expect(mayIssue(replacement, "device-b", true, 6)).toBe(true);
  expect(mayIssue(replacement, "device-a", true, 5)).toBe(false);
});
