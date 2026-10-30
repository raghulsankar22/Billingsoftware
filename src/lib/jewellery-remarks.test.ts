import { describe, expect, it } from "vitest";
import { selectedJewelleryRemarks, toggleJewelleryRemark } from "./jewellery-remarks";

describe("jewellery condition checkboxes", () => {
  it("allows several conditions without duplicates", () => {
    const first = toggleJewelleryRemark("", "Broken", true);
    const second = toggleJewelleryRemark(first, "No screw", true);
    expect(selectedJewelleryRemarks(second)).toEqual(["Broken", "No screw"]);
    expect(toggleJewelleryRemark(second, "No screw", true)).toBe(second);
    expect(toggleJewelleryRemark(second, "Broken", false)).toBe("No screw");
  });
  it("makes None exclusive and lets the owner clear it", () => {
    expect(toggleJewelleryRemark("Broken; No screw", "None", true)).toBe("None");
    expect(toggleJewelleryRemark("None", "Missing stone", true)).toBe("Missing stone");
    expect(toggleJewelleryRemark("None", "None", false)).toBe("");
  });
  it("recognizes earlier written choices and retains other saved notes", () => {
    expect(selectedJewelleryRemarks("slightly bent; missing stone; no anklet screw")).toEqual(["Slightly bent", "Missing stone", "No screw"]);
    expect(toggleJewelleryRemark("Old clasp loose", "Broken", true)).toBe("Old clasp loose; Broken");
    expect(toggleJewelleryRemark("Old clasp loose; Broken", "Old clasp loose", false)).toBe("Broken");
  });
});
