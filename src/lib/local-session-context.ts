import { AsyncLocalStorage } from "node:async_hooks";
import { join, resolve } from "node:path";
import type { LocalUser } from "./local-users";

const context = new AsyncLocalStorage<LocalUser>();
// Local app and preview require sign-in by default. Tests can explicitly opt out.
export const multiUserEnabled = () => process.env.BILLING_MULTI_USER === "1" || (process.env.BILLING_MULTI_USER !== "0" && process.env.NODE_ENV !== "test");
export const baseDataDirectory = () => resolve(process.env.LOCAL_DATA_DIR || resolve(process.cwd(), "data"));
export const runAsLocalUser = <T>(user: LocalUser, action: () => T): T => context.run(user, action);
export function currentLocalUser() { return context.getStore(); }
export function scopedDataDirectory() {
  const root = baseDataDirectory();
  if (!multiUserEnabled()) return root;
  const user = currentLocalUser();
  if (!user) throw new Error("Sign in is required.");
  if (user.legacyData) return root;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id)) throw new Error("Invalid user.");
  return join(root, "users", user.id);
}
