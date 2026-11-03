import { describe, expect, it } from "vitest";
import { jewelleryLabel } from "./jewellery";
import { lettersInOrder, searchJewellery, tamilFromLabel } from "./jewellery-search";

const tamilFor = (name: string) => tamilFromLabel(name, jewelleryLabel(name));

describe("jewellery catalogue search", () => {
  it("returns all options for blank input without changing catalogue order", () => {
    const options = ["Studs", "Ring", "Haram"];
    expect(searchJewellery(options, "  ", tamilFor)).toEqual(options);
    expect(searchJewellery(options, "", tamilFor)).not.toBe(options);
  });
  it("ranks prefixes, word prefixes, substrings and ordered letters", () => {
    const options = ["Boring", "Right Angled", "Ladies Ring", "Ring"];
    expect(searchJewellery(options, "RIN", tamilFor)).toEqual(["Ring", "Ladies Ring", "Boring", "Right Angled"]);
    expect(searchJewellery(["Haram", "Chain", "Haram Pendant"], "hrm", tamilFor)).toEqual(["Haram", "Haram Pendant"]);
    expect(searchJewellery(options, "impossible", tamilFor)).toEqual([]);
    expect(options[0]).toBe("Boring");
  });
  it("matches Tamil labels and custom Tamil names without translating stored names", () => {
    expect(searchJewellery(["Ring", "Studs", "Haram"], "மோதிரம்", tamilFor)).toEqual(["Ring"]);
    expect(searchJewellery(["Ring", "புதிய நகை"], "புதிய", tamilFor)).toEqual(["புதிய நகை"]);
    expect(tamilFromLabel("Ring", jewelleryLabel("Ring"))).toBe("மோதிரம்");
    expect(tamilFromLabel("Custom", "Custom")).toBe("");
  });
  it("normalizes case, full-width letters and spaces while retaining tie order", () => {
    expect(searchJewellery(["Ring", "Ring Two", "Haram"], " ＲＩＮＧ ", tamilFor)).toEqual(["Ring", "Ring Two"]);
    expect(searchJewellery(["Ladies Ring"], "Ladies   Ring", tamilFor)).toEqual(["Ladies Ring"]);
    expect(lettersInOrder("hrm", "haram")).toBe(true);
    expect(lettersInOrder("mrh", "haram")).toBe(false);
    expect(lettersInOrder(" ", "haram")).toBe(false);
  });
});
