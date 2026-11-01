/** The incomplete cloud multi-user path is opt-in and must stay disabled in production until sync is ready. */
export function cloudMultiUserEnabled() { return process.env.BILLING_CLOUD_MULTIUSER === "1"; }
