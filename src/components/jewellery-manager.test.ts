import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);
vi.mock("./language-provider", () => ({ useLanguage: () => ({ t: (text: string) => text }) }));
vi.mock("@/lib/jewellery", () => import("../lib/jewellery"));
vi.mock("./api", () => ({ api: vi.fn() }));
import { JewelleryManager } from "./jewellery-manager";

describe("jewellery management dialog", () => {
  it("offers labelled edit/delete controls and explains that historical bills stay unchanged", () => {
    const html = renderToStaticMarkup(React.createElement(JewelleryManager, { accountSlot: 1, items: ["Ring", "மோதிரம்"], onChange: vi.fn(), onClose: vi.fn() }));
    expect(html).toContain("<dialog");
    expect(html).toContain('aria-labelledby="jewellery-manager-title"');
    expect(html).toContain("existing bills, PDFs or Excel records");
    expect(html).toContain('aria-label="Edit jewellery: Ring (மோதிரம்)"');
    expect(html).toContain('aria-label="Delete jewellery: Ring (மோதிரம்)"');
    expect(html).toContain("மோதிரம்");
    expect(html).toContain("Add jewellery");
  });
});
