// Offline search over the jewellery catalogue for the type-ahead box. It only ranks existing names;
// it never changes, converts or invents a jewellery name.

/** How well a catalogue name matches what was typed (lower is better). */
export const matchTier = { startsWith: 0, wordStartsWith: 1, contains: 2, lettersInOrder: 3 } as const;

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en-IN").replace(/\s+/g, " ").trim();
const words = (value: string) => value.split(/[\s.,()/-]+/).filter(Boolean);

/** True when every typed letter appears in the name in the same order, e.g. "hrm" in "haram". */
export function lettersInOrder(query: string, name: string): boolean {
  const letters = [...query.replace(/\s+/g, "")];
  if (!letters.length) return false;
  let position = 0;
  for (const character of name) if (character === letters[position] && ++position === letters.length) return true;
  return false;
}

function tierFor(query: string, text: string, allowLettersInOrder: boolean): number | null {
  if (!text) return null;
  if (text.startsWith(query)) return matchTier.startsWith;
  if (words(text).some(word => word.startsWith(query))) return matchTier.wordStartsWith;
  if (text.includes(query)) return matchTier.contains;
  if (allowLettersInOrder && lettersInOrder(query, text)) return matchTier.lettersInOrder;
  return null;
}

/**
 * Catalogue names matching the typed text, best first. The English name is ranked by
 * starts-with, word starts-with, contains, then letters in order; the Tamil name (as shown in
 * the label) by starts-with, word starts-with and contains. Ties keep catalogue order.
 */
export function searchJewellery(options: readonly string[], typed: string, tamilFor: (name: string) => string): string[] {
  const query = normalize(typed);
  if (!query) return [...options];
  return options
    .map((name, order) => {
      const english = tierFor(query, normalize(name), true);
      const tamil = tierFor(query, normalize(tamilFor(name)), false);
      const tiers = [english, tamil].filter((tier): tier is number => tier !== null);
      return tiers.length ? { name, order, tier: Math.min(...tiers) } : null;
    })
    .filter((match): match is { name: string; order: number; tier: number } => match !== null)
    .sort((first, second) => first.tier - second.tier || first.order - second.order)
    .map(match => match.name);
}

/** The Tamil part of a catalogue label such as "Haram (ஆரம்)"; empty when there is none. */
export function tamilFromLabel(name: string, label: string): string {
  return label.startsWith(`${name} (`) && label.endsWith(")") ? label.slice(name.length + 2, -1) : "";
}
