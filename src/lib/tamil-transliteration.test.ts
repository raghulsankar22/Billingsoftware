import { describe, expect, it } from "vitest";
import { suggestTamil, transliterateTamil } from "./tamil-transliteration";

describe("offline spelling suggestions", () => {
  it("shows Tamil for English names without changing the source", () => {
    expect(suggestTamil("Kumar")).toBe("குமார்");
    expect(suggestTamil("Muthu")).toBe("முத்து");
    expect(suggestTamil("Ravi")).toBe("ரவி");
    expect(suggestTamil("Raja")).toBe("ராஜா");
    expect(suggestTamil("12 Chennai Street")).toBe("12 சென்னை தெரு");
  });
  it("offers Latin spellings beyond the old dictionary", () => {
    expect(transliterateTamil("முத்து")).toBe("Muthu");
    expect(transliterateTamil("கமலா")).toBe("Kamalaa");
    expect(transliterateTamil("12 சென்னை தெரு")).toBe("12 Chennai Street");
  });
  it("preserves identifiers, numbers, punctuation and unsupported letters", () => {
    const identifiers = "9876543210 123456789012 ID-42 12A ₹ 2.5 A";
    expect(suggestTamil(identifiers)).toBe(identifiers);
    expect(transliterateTamil(identifiers)).toBe(identifiers);
    expect(suggestTamil("José O’Neil")).toContain("José");
    expect(transliterateTamil("௳")).toBe("௳");
    expect(suggestTamil("குமார்")).toBe("குமார்");
  });
});
