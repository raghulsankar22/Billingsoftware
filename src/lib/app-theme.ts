// Screen theme and side-menu width. Both are per-computer display preferences, never billing data.

export type AppTheme = "dark" | "light";
export const themeStorageKey = "finance-billing-theme";
export const navWidthStorageKey = "finance-billing-nav-width";
/** The owner chose dark as the default. */
export const defaultTheme: AppTheme = "dark";

/** Slim icon bar width, widest full menu, and the width where names and counts appear in full. */
export const navMinWidth = 68;
/** Tamil words are longer, so the slim bar is a little wider and words aren't split. */
export const tamilNavMinWidth = 100;
export const navMaxWidth = 248;
export const navExpandedFrom = 160;
export const navKeyboardStep = 20;

export function parseTheme(value: unknown): AppTheme {
  return value === "light" ? "light" : defaultTheme;
}

export function clampNavWidth(value: unknown): number {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return navMinWidth;
  return Math.round(Math.min(navMaxWidth, Math.max(navMinWidth, number)));
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function readTheme(): AppTheme {
  try { return parseTheme(storage()?.getItem(themeStorageKey)); } catch { return defaultTheme; }
}

export function readNavWidth(): number {
  try { return clampNavWidth(storage()?.getItem(navWidthStorageKey) ?? navMinWidth); } catch { return navMinWidth; }
}

/** Saving is optional: if storage is blocked the choice still applies until the app closes. */
export function saveTheme(theme: AppTheme) {
  try { storage()?.setItem(themeStorageKey, theme); } catch { /* keep the in-memory choice */ }
}

export function saveNavWidth(width: number) {
  try { storage()?.setItem(navWidthStorageKey, String(clampNavWidth(width))); } catch { /* keep the in-memory choice */ }
}

export function applyTheme(theme: AppTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

/**
 * Runs before the page paints so the saved theme shows without a flash of the wrong colours.
 * Kept as a plain string because it's inlined into the page head.
 */
export const themeBootScript = `try{var t=localStorage.getItem(${JSON.stringify(themeStorageKey)});document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;

/** Next width when the resize handle is used from the keyboard. */
export function keyboardNavWidth(current: number, key: string): number | null {
  if (key === "ArrowRight") return clampNavWidth(current + navKeyboardStep);
  if (key === "ArrowLeft") return clampNavWidth(current - navKeyboardStep);
  if (key === "Home") return navMinWidth;
  if (key === "End") return navMaxWidth;
  if (key === "Enter" || key === " ") return current >= navExpandedFrom ? navMinWidth : navMaxWidth;
  return null;
}
