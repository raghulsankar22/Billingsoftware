/** The incomplete cloud multi-user path is opt-in and must stay disabled in production until sync is ready. */
export function cloudMultiUserEnabled() { return process.env.BILLING_CLOUD_MULTIUSER === "1"; }

/**
 * The older cloud functions can't issue current metal-aware, synchronized bills
 * or respect an offline device's reservation. Every route that issues a number checks this.
 */
export function legacyIssuanceBlocked(localStorage: boolean) { return !localStorage && cloudMultiUserEnabled(); }
