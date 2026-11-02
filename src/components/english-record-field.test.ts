import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);
vi.mock("@/lib/english-records", () => import("../lib/english-records"));
vi.mock("@/lib/tamil-input", () => import("../lib/tamil-input"));
vi.mock("@/lib/tamil-transliteration", () => import("../lib/tamil-transliteration"));
vi.mock("./language-provider", () => ({ useLanguage: () => ({ language: "ta", t: (text: string) => text }) }));
vi.mock("./api", () => ({ requestHeaders: async () => ({}) }));
import { EnglishRecordField } from "./english-record-field";

describe("Tamil entry preview", () => {
  it.each([["Name", "Muthu", "முத்து"], ["Father's Name", "Raja", "ராஜா"], ["Address", "12 Chennai Street", "12 சென்னை தெரு"]])("shows Tamil for %s while retaining the English input", (label, value, expected) => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(React.createElement(EnglishRecordField, { label, value, onChange }));
    expect(html).toContain('value="' + value + '"');
    expect(html).toContain(expected);
    expect(html).toContain("சேமிக்கப்படாது");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("offers Google only when a field explicitly opts in, without translating on render", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const onChange = vi.fn();
    const allowed = renderToStaticMarkup(React.createElement(EnglishRecordField, { label: "Customer name", value: "Kumar", googleField: "customerName", onChange }));
    const ordinary = renderToStaticMarkup(React.createElement(EnglishRecordField, { label: "Particulars", value: "Ring", onChange }));
    expect(allowed).toContain("Translate with Google");
    expect(allowed).toContain('aria-expanded="false"');
    expect(ordinary).not.toContain("Translate with Google");
    expect(fetch).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.stubGlobal("React", React);
  });
});
