import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);
vi.mock("./language-provider", () => ({ useLanguage: () => ({ language: "ta", t: (text: string) => text }) }));
import { EnglishRecordField } from "./english-record-field";

describe("record text without automatic translation", () => {
  it.each([["Name", "Muthu"], ["Business name", "சங்கர்"], ["Father's Name", "முத்து"], ["Address", "12 சென்னை தெரு"]])("keeps the supplied %s text unchanged", (label, value) => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(React.createElement(EnglishRecordField, { label, value, onChange }));
    expect(html).toContain('value="' + value + '"');
    for (const removed of ["Translate with Google", "Confirm English", "Tamil draft", "English text to save", "data-english-review-pending"]) expect(html).not.toContain(removed);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("keeps the Particulars label available to assistive technology but visually hidden", () => {
    const html = renderToStaticMarkup(React.createElement(EnglishRecordField, { id: "particulars-1", label: "Particulars", hideLabel: true, multiline: true, value: "மோதிரம் 2", onChange: () => {} }));
    expect(html).toContain('<label for="particulars-1" class="sr-only">Particulars</label>');
    expect(html).toContain('<textarea id="particulars-1">மோதிரம் 2</textarea>');
    expect(html).not.toContain("Ring");
  });
});
