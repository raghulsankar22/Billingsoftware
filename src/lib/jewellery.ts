import { z } from "zod";

export const starterJewellery = [
  "Ring", "Necklace", "Haram", "Chain", "Bangle", "Bracelet", "Earrings",
  "Studs", "Pendant", "Nose pin", "Anklet", "Toe ring", "Waist chain", "Coin",
] as const;

export const jewelleryNameSchema = z.string()
  .transform(value => value.normalize("NFKC").replace(/\s+/g, " ").trim())
  .pipe(z.string().min(2, "Enter at least 2 characters for the jewellery name.")
    .max(180, "Jewellery names can have up to 180 characters.")
    .regex(/^[^\u0000-\u001f\u007f]+$/, "Enter a valid jewellery name."));

export const jewelleryKey = (name: string) => name.toLocaleLowerCase("en-IN");

/** Keep familiar defaults first; custom choices are shared by all three accounts. */
export function jewelleryChoices(customNames: string[]) {
  const choices = new Map<string, string>(starterJewellery.map(name => [jewelleryKey(name), name]));
  for (const name of customNames) if (!choices.has(jewelleryKey(name))) choices.set(jewelleryKey(name), name);
  return [...choices.values()];
}
