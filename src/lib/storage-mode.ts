export const localStorageEnabled = process.env.NEXT_PUBLIC_BILLING_STORAGE !== "cloud";
// The online version remains opt-in until its security and sync work is complete.
export const extendedAccounts = localStorageEnabled || process.env.NEXT_PUBLIC_BILLING_CLOUD_MULTIUSER === "1";
