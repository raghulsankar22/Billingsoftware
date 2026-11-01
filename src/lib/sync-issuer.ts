/**
 * Rules for one account's bill and delivery number issuer. These are pure
 * decisions, not an authorization boundary; transitions must be persisted and
 * checked atomically by the authenticated server and offline device.
 */
export type IssuerState =
  | { mode: "assigned"; deviceId: string; epoch: number }
  | { mode: "online"; epoch: number }
  | { mode: "review"; deviceId: string; epoch: number };

export function mayIssue(state: IssuerState, deviceId: string, offline: boolean, epoch: number): boolean {
  if (state.epoch !== epoch || state.mode === "review") return false;
  if (state.mode === "assigned") return state.deviceId === deviceId;
  return !offline;
}

/** A device may hand control back only after it has stopped offline issuance and synced. */
export function releaseIssuer(state: IssuerState, deviceId: string, offlineDisabled: boolean, queueEmpty: boolean): IssuerState {
  if (state.mode !== "assigned" || state.deviceId !== deviceId || !offlineDisabled || !queueEmpty) throw new Error("Stop offline billing and sync all changes before transferring permission.");
  return { mode: "online", epoch: state.epoch + 1 };
}

/** An administrator transfer after device loss requires manual reconciliation. */
export function forceTransferIssuer(state: IssuerState, replacementDeviceId: string): IssuerState {
  if (!replacementDeviceId || (state.mode === "assigned" && replacementDeviceId === state.deviceId)) throw new Error("Choose a different replacement device.");
  return { mode: "review", deviceId: replacementDeviceId, epoch: state.epoch + 1 };
}

export function finishIssuerReview(state: IssuerState, confirmed: boolean): IssuerState {
  if (state.mode !== "review" || !confirmed) throw new Error("Review unsynced bills and deliveries before resuming.");
  return { mode: "assigned", deviceId: state.deviceId, epoch: state.epoch };
}
