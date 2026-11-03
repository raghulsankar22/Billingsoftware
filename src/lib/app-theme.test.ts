import { describe, expect, it } from "vitest";
import { clampNavWidth, defaultTheme, keyboardNavWidth, navExpandedFrom, navMaxWidth, navMinWidth, parseTheme, themeBootScript } from "./app-theme";

describe("screen theme and menu width", () => {
  it("opens in dark mode unless light was saved", () => {
    expect(defaultTheme).toBe("dark");
    for (const saved of [null, undefined, "", "blue", "DARK", "dark"]) expect(parseTheme(saved)).toBe("dark");
    expect(parseTheme("light")).toBe("light");
  });
  it("keeps the saved menu width between the slim bar and the full menu", () => {
    expect(clampNavWidth(undefined)).toBe(navMinWidth);
    expect(clampNavWidth("abc")).toBe(navMinWidth);
    expect(clampNavWidth("-500")).toBe(navMinWidth);
    expect(clampNavWidth(10_000)).toBe(navMaxWidth);
    expect(clampNavWidth("180.6")).toBe(181);
  });
  it("resizes from the keyboard", () => {
    expect(keyboardNavWidth(navMinWidth, "ArrowRight")).toBe(navMinWidth + 20);
    expect(keyboardNavWidth(navMinWidth, "ArrowLeft")).toBe(navMinWidth);
    expect(keyboardNavWidth(100, "End")).toBe(navMaxWidth);
    expect(keyboardNavWidth(200, "Home")).toBe(navMinWidth);
    expect(keyboardNavWidth(navMinWidth, "Enter")).toBe(navMaxWidth);
    expect(keyboardNavWidth(navExpandedFrom, " ")).toBe(navMinWidth);
    expect(keyboardNavWidth(100, "a")).toBeNull();
  });
  it("sets the saved theme before the page paints, and falls back to dark", () => {
    const run = (storage: { getItem: (key: string) => string | null }) => {
      const root = { dataset: {} as Record<string, string> };
      new Function("localStorage", "document", themeBootScript)(storage, { documentElement: root });
      return root.dataset.theme;
    };
    expect(run({ getItem: () => "light" })).toBe("light");
    expect(run({ getItem: () => null })).toBe("dark");
    expect(run({ getItem: () => "<script>" })).toBe("dark");
    expect(run({ getItem: () => { throw new Error("storage blocked"); } })).toBe("dark");
  });
});
