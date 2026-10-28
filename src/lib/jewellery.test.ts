import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalDatabase } from "./local-database";
import { appendJewelleryParticulars, jewelleryNameSchema, starterJewellery } from "./jewellery";

let directory: string;
let database: ReturnType<typeof createLocalDatabase> | undefined;
afterEach(() => {
  database?.close(); database = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
});
function open() {
  directory = mkdtempSync(join(tmpdir(), "billing-jewellery-"));
  database = createLocalDatabase(directory);
  return database;
}

describe("offline jewellery catalogue", () => {
  it("adds different jewellery and whole quantities to the same description", () => {
    const first = appendJewelleryParticulars("", "Ring", "2");
    expect(first).toBe("Ring 2");
    expect(appendJewelleryParticulars(first, "Studs", 1)).toBe("Ring 2, Studs 1");
  });
  it("appends without guessing or rewriting an older bill's description", () => {
    expect(appendJewelleryParticulars("Old ring description 2", "Necklace", 1)).toBe("Old ring description 2, Necklace 1");
  });
  it("rejects invalid quantities and descriptions that would exceed the bill limit", () => {
    for (const quantity of ["", 0, -1, 1.5, 10000, Infinity, "abc"]) expect(() => appendJewelleryParticulars("Ring 2", "Studs", quantity)).toThrow();
    expect(() => appendJewelleryParticulars("X".repeat(178), "Ring", 1)).toThrow("180 characters");
  });
  it("provides starter choices and persists custom English and Tamil names after reopening", () => {
    const db = open();
    expect(db.jewellery.list()).toEqual(starterJewellery);
    expect(db.jewellery.add("  Stone   Jhumka ").name).toBe("Stone Jhumka");
    db.jewellery.add("காப்பு");
    db.close(); database = createLocalDatabase(directory);
    expect(database.jewellery.list()).toEqual(expect.arrayContaining(["Ring", "Necklace", "Haram", "Stone Jhumka", "காப்பு"]));
    expect(database.jewellery.add("stone jhumka").name).toBe("Stone Jhumka");
    expect(database.jewellery.list().filter(name => name.toLowerCase() === "stone jhumka")).toHaveLength(1);
  });

  it("does not duplicate starter choices or consume bill numbers when jewellery is added", async () => {
    const db = open();
    expect(db.jewellery.add(" ｒｉｎｇ ").name).toBe("Ring");
    expect(db.jewellery.list()).toEqual(starterJewellery);
    db.jewellery.add("Jhumka");
    expect((await db.from("bills").select()).data).toEqual([]);
    expect((await db.from("business_profiles").select()).data).toEqual([]);
  });

  it("rejects blank, too-short, oversized and invalid values without saving them", () => {
    const db = open();
    for (const name of ["", "   ", "a", "X".repeat(181), "Ring\u0000", null, 123]) {
      expect(() => db.jewellery.add(name)).toThrow();
    }
    expect(db.jewellery.list()).toEqual(starterJewellery);
    expect(jewelleryNameSchema.parse("  Double\t  ring  ")).toBe("Double ring");
  });
});
