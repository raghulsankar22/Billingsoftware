import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);
vi.mock("./language-provider", () => ({ useLanguage: () => ({ t: (text: string) => text }) }));
vi.mock("@/lib/jewellery", () => import("../lib/jewellery"));
vi.mock("@/lib/jewellery-search", () => import("../lib/jewellery-search"));
vi.mock("@/lib/particulars-entry", () => import("../lib/particulars-entry"));
import { ParticularsCombobox } from "./particulars-combobox";

describe("Particulars with integrated jewellery suggestions", () => {
  it.each(["Ring 2", "மோதிரம் 2"])("uses one accessible textarea and preserves %s", value => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(<ParticularsCombobox value={value} options={["Ring", "Haram"]} ariaLabel="Particulars for item 1" disabled={false} catalogueReady onChange={onChange} onSelect={vi.fn()} onAddNew={vi.fn()} />);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="Particulars for item 1"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(value + "</textarea>");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<label");
    expect(html).not.toContain("Type to search jewellery");
    expect(onChange).not.toHaveBeenCalled();
  });
});
