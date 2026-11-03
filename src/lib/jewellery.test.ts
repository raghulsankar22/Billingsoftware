import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalDatabase } from "./local-database";
import { appendJewelleryParticulars, formatParticulars, jewelleryChoices, jewelleryLabel, jewelleryNameSchema, starterJewellery } from "./jewellery";

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
  it("contains the 76 approved entries in English alphabetical order", () => {
    expect(starterJewellery).toHaveLength(76);
    expect(starterJewellery).toEqual([...starterJewellery].sort((first, second) => first.localeCompare(second, "en", { sensitivity: "base", numeric: true })));
    expect(starterJewellery).not.toContain("Coin");
    expect(starterJewellery).not.toContain("Earrings");
    expect(jewelleryLabel("Chain")).toBe("Chain (சயின்)");
    expect(jewelleryLabel("Savaran")).toBe("Savaran (சவரன்)");
    expect(jewelleryLabel("Getti Golusu")).toBe("Getti Golusu (கெட்டி கொலுசு)");
    expect(jewelleryLabel("Kaasu Malai")).toBe("Kaasu Malai (காசு மாலை)");
    expect(jewelleryLabel("Vilva Leaf")).toBe("Vilva Leaf (வில்வக் இலை)");
    expect(jewelleryLabel("Mathu Mukkuthi")).toBe("Mathu Mukkuthi (மத்து மூக்குத்தி)");
    expect(jewelleryLabel("Muthu Arunakodi")).toBe("Muthu Arunakodi (Muthu Arunakodi)");
    expect(jewelleryChoices(["Z custom", "A custom", "ring"])[0]).toBe("1 Stone Mukkuthi");
  });
  it("formats exact known particulars without changing saved descriptions or quantities", () => {
    const original = "Ring 2, Studs 1";
    expect(formatParticulars(original)).toBe("Ring (மோதிரம்) 2, Studs (தோடு) 1");
    expect(original).toBe("Ring 2, Studs 1");
    expect(formatParticulars("1 Stone Ring 2")).toBe("1 Stone Ring (1 கல் மோதிரம்) 2");
    expect(formatParticulars("Coin 1, Earrings 2")).toBe("Coin (நாணயம்) 1, Earrings (கம்மல்) 2");
    expect(formatParticulars("old Ring repaired 2, Custom item")).toBe("old Ring repaired 2, Custom item");
    expect(formatParticulars(formatParticulars(original))).toBe(formatParticulars(original));
    expect(formatParticulars("மோதிரம் 2")).toBe("மோதிரம் 2");
    expect(jewelleryLabel("சங்கர்")).toBe("சங்கர்");
  });
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
  it("persists English and native Tamil catalogue names without translation", () => {
    const db = open();
    expect(db.jewellery.list()).toEqual(starterJewellery);
    expect(db.jewellery.add("  Stone   Jhumka ").name).toBe("Stone Jhumka");
    expect(db.jewellery.add("காப்பு").name).toBe("காப்பு");
    db.close(); database = createLocalDatabase(directory);
    expect(database.jewellery.list()).toEqual(expect.arrayContaining(["Ring", "Necklace", "Haram", "Stone Jhumka"]));
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

  it("removes starter and custom choices durably and lets them be added again", () => {
    const db = open();
    db.jewellery.add("Custom Pendant");
    expect(db.jewellery.remove("ring").items).not.toContain("Ring");
    expect(db.jewellery.remove("Custom Pendant").items).not.toContain("Custom Pendant");
    db.close(); database = createLocalDatabase(directory);
    expect(database.jewellery.list()).not.toContain("Ring");
    expect(database.jewellery.list()).not.toContain("Custom Pendant");
    expect(database.jewellery.add("ring").name).toBe("Ring");
    expect(database.jewellery.add("Custom Pendant").items).toContain("Custom Pendant");
  });
  it("renames supplied and custom names, including case-only edits and Tamil text", () => {
    const db = open();
    expect(db.jewellery.rename("Ring", "Wedding Ring").items).not.toContain("Ring");
    expect(db.jewellery.list()).toContain("Wedding Ring");
    expect(db.jewellery.rename("Wedding Ring", "மோதிரம்").items).toContain("மோதிரம்");
    expect(db.jewellery.rename("Chain", "CHAIN").items).toContain("CHAIN");
    expect(db.jewellery.list()).not.toContain("Chain");
    db.close(); database = createLocalDatabase(directory);
    expect(database.jewellery.list()).toContain("மோதிரம்");
    expect(database.jewellery.list()).toContain("CHAIN");
    expect(database.jewellery.list()).not.toContain("Ring");
    expect(formatParticulars("Ring 2")).toBe("Ring (மோதிரம்) 2");
  });
  it("rejects duplicate, missing and invalid edits without partial catalogue changes", () => {
    const db = open();
    const before = db.jewellery.list();
    expect(() => db.jewellery.rename("Ring", "chain")).toThrow("already exists");
    expect(() => db.jewellery.rename("Not Saved", "Something Else")).toThrow("no longer available");
    for (const name of ["", "X", "Ring\u0000", null, 5]) {
      expect(() => db.jewellery.rename("Ring", name)).toThrow();
      expect(() => db.jewellery.remove(name)).toThrow();
    }
    expect(db.jewellery.list()).toEqual(before);
  });
  it("never rewrites saved bills, customer details or numbering while changing the catalogue", async () => {
    const db = open();
    const profile = await db.rpc("save_business_profile", { p_owner_id: "local-owner", p_profile: { businessName: "Sample Finance", address: "123 Business Street", phone: "1234567890", accountSlot: 1 } });
    expect(profile.error).toBeNull();
    const created = await db.rpc("create_bill", { p_owner_id: "local-owner", p_bill: { accountSlot: 1, billDate: "2026-11-02", customerName: "Test Customer", fatherName: "Test Parent", address: "123 Test Street", phone: "1234567890", items: [{ metal: "Gold", particulars: "Ring 2, Chain 1", grams: 10, assessedValue: 1100, loanAmount: 1000 }] } });
    expect(created.error).toBeNull();
    const before = (await db.from("bills").select()).data;
    const customers = db.customers.list(1);
    const counters = db.sync.counters(profile.data.id);
    db.jewellery.rename("Ring", "Special Ring"); db.jewellery.remove("Chain");
    expect((await db.from("bills").select()).data).toEqual(before);
    expect((await db.from("bill_items").select()).data[0].particulars).toBe("Ring 2, Chain 1");
    expect(db.customers.list(1)).toEqual(customers);
    expect(db.sync.counters(profile.data.id)).toEqual(counters);
  });
});
