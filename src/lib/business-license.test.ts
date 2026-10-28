import { describe, expect, it } from "vitest";
import { billLicenseNumber, billLicenseMetadata } from "./business-license";

describe("business license on bills", () => {
  it("uses the current account license for older bills without that snapshot field", () => {
    expect(billLicenseNumber({}, { license_number: " TN/123 " })).toBe("TN/123");
  });
  it("keeps the license captured when the bill was issued", () => {
    expect(billLicenseNumber({ businessSnapshot: { business_name: "Finance", address: "Address", phone: "123", license_number: "OLD-1" } }, { license_number: "NEW-2" })).toBe("OLD-1");
  });
  it("does not add a later license to bills explicitly issued without one", () => {
    expect(billLicenseNumber({ businessSnapshot: { business_name: "Finance", address: "Address", phone: "123", license_number: null } }, { license_number: "NEW-2" })).toBe("");
    expect(billLicenseNumber({}, {})).toBe("");
  });
  it("changes cached PDF metadata when the license for a legacy bill changes", () => {
    expect(billLicenseMetadata({}, { license_number: "ONE" })).not.toBe(billLicenseMetadata({}, { license_number: "TWO" }));
  });
});
