import { describe, expect, it } from "vitest";
import { translate } from "./language";

describe("rendering-only language dictionary", () => {
  it("localizes standard labels but leaves English mode identical", () => {
    for (const label of ["Gold", "Silver", "Customer name", "Confirm English spelling", "Issue bill"]) {
      expect(translate("en", label)).toBe(label);
      expect(translate("ta", label)).toMatch(/[஀-௿]/u);
    }
  });
  it("does not rewrite arbitrary names, identifiers or saved text", () => {
    for (const value of ["Sample Kumar", "Raja", "12 Main Street", "ID-123", "123456789012", "₹1,000.00", "José O’Neil"]) expect(translate("ta", value)).toBe(value);
  });
});
