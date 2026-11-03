import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createParticularsBlocks } from "./jewellery-particulars-pdf";
import { jewelleryLabel, starterJewellery } from "./jewellery";

describe("shaped bilingual particulars", () => {
  it("uses one reusable text block per distinct description with embedded Unicode fonts", async () => {
    const labels = starterJewellery.map(jewelleryLabel);
    const result = await createParticularsBlocks([...labels, ...labels], 30 * 72 / 25.4);
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPageCount()).toBe(76);
    expect(result.blocks.size).toBe(76);
    expect([...result.blocks.values()].every(block => block.height > 0 && block.height < 700)).toBe(true);
    const raw = Buffer.from(result.bytes).toString("latin1");
    expect(raw).toContain("/ToUnicode");
    expect(raw).not.toContain("/Subtype /Image");
  });
  it("wraps long words without dropping the last grapheme", async () => {
    const result = await createParticularsBlocks(["LongCustomWord".repeat(10), "மோதிரம்".repeat(10)], 60);
    expect(result.blocks.get("LongCustomWord".repeat(10))!.height).toBeGreaterThan(30);
    expect(result.blocks.get("மோதிரம்".repeat(10))!.height).toBeGreaterThan(30);
  });
});
