import { describe, expect, it } from "vitest";
import { completeParticulars, particularsEntry, resumeParticularsDraft, selectedParticulars } from "./particulars-entry";

describe("combined particulars entry", () => {
  it("searches the unfinished last entry without replacing completed jewellery", () => {
    expect(particularsEntry("Ha")).toEqual({ prefix: "", query: "Ha" });
    expect(particularsEntry("Ring 2, Ha")).toEqual({ prefix: "Ring 2", query: "Ha" });
    expect(particularsEntry("Ring 2, ")).toEqual({ prefix: "Ring 2", query: "" });
    expect(particularsEntry("Ring 2")).toEqual({ prefix: "Ring 2", query: "" });
    expect(particularsEntry("1 Stone")).toEqual({ prefix: "", query: "1 Stone" });
  });
  it("puts the chosen name and quantity into the same description exactly once", () => {
    expect(selectedParticulars("Ring 2", "Haram")).toBe("Ring 2, Haram");
    expect(completeParticulars("Ring 2, Haram", "Haram", "1", "Ring 2")).toBe("Ring 2, Haram 1");
    expect(completeParticulars("Ring", "Ring", "3", "")).toBe("Ring 3");
  });
  it("respects the existing capitalization rule for multiword catalogue names", () => {
    expect(selectedParticulars("Ring 2", "Waist chain")).toBe("Ring 2, Waist Chain");
    expect(completeParticulars("Ring 2, Waist Chain", "Waist chain", "1", "Ring 2")).toBe("Ring 2, Waist chain 1");
  });
  it("keeps typed Tamil unchanged and never translates it", () => {
    const tamil = "மோதிரம்";
    expect(particularsEntry(tamil)).toEqual({ prefix: "", query: tamil });
    expect(selectedParticulars(tamil + " 2", "Haram")).toBe(tamil + " 2, Haram");
    expect(completeParticulars(tamil, tamil, "3", "")).toBe(tamil + " 3");
  });
  it("refuses stale selections instead of appending the wrong name", () => {
    expect(() => completeParticulars("Ring 2, Necklace", "Haram", "1", "Ring 2")).toThrow("Select jewellery to add.");
  });
  it.each(["0", "-1", "1.5", "10000"])("keeps existing quantity validation for %s", quantity => {
    expect(() => completeParticulars("Ring", "Ring", quantity, "")).toThrow();
  });
  it("refuses overlong entries before altering the current description", () => {
    expect(() => selectedParticulars("X".repeat(177), "Ring")).toThrow("180 characters");
    expect(() => completeParticulars("X".repeat(176), "Ring", "2")).toThrow("180 characters");
  });
  it("supports restored selections made by the earlier separate picker", () => {
    expect(completeParticulars("Ring 2", "Haram", "1")).toBe("Ring 2, Haram 1");
  });
  it("moves an earlier separate selection into the visible field without duplicating it", () => {
    const form = { billDate: "2026-11-03", customerName: "Example", fatherName: "", address: "", phone: "", items: [{ particulars: "Ring 2", grams: 1, loanAmount: 100, assessedValue: 110 }] };
    const restored = resumeParticularsDraft(form, { 0: { name: "Waist chain", quantity: "2", error: "" } });
    expect(restored.form.items[0].particulars).toBe("Ring 2, Waist Chain");
    const selection = restored.jewellery[0];
    expect(completeParticulars(restored.form.items[0].particulars, selection.name, selection.quantity, selection.prefix)).toBe("Ring 2, Waist chain 2");
    expect(resumeParticularsDraft(restored.form, restored.jewellery)).toEqual(restored);
    expect(form.items[0].particulars).toBe("Ring 2");
  });
  it("keeps an old unconfirmed Tamil query visible without restoring a stale selection", () => {
    const form = { billDate: "2026-11-03", customerName: "Example", fatherName: "", address: "", phone: "", items: [{ particulars: "Ring 2", grams: 1, loanAmount: 100, assessedValue: 110 }] };
    const restored = resumeParticularsDraft(form, { 0: { name: "Haram", quantity: "4", error: "", query: "மோதிரம்" } });
    expect(restored.form.items[0].particulars).toBe("Ring 2, மோதிரம்");
    expect(restored.jewellery[0]).toMatchObject({ name: "", quantity: "4", query: null });
    expect(resumeParticularsDraft(restored.form, restored.jewellery)).toEqual(restored);
  });
});
