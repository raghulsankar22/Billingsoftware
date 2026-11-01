import { suggestEnglish } from "./tamil-input";

const knownTamil: Record<string, string> = {
  kumar: "குமார்", sankar: "சங்கர்", shankar: "சங்கர்", raja: "ராஜா", ravi: "ரவி", muthu: "முத்து",
  chennai: "சென்னை", madurai: "மதுரை", street: "தெரு", road: "சாலை",
  ring: "மோதிரம்", chain: "சங்கிலி", bangle: "வளையல்", gold: "தங்கம்", silver: "வெள்ளி",
};
const consonants: Record<string, string> = {
  "க": "k", "ங": "ng", "ச": "s", "ஞ": "ny", "ட": "d", "ண": "n", "த": "th", "ந": "n",
  "ப": "p", "ம": "m", "ய": "y", "ர": "r", "ல": "l", "வ": "v", "ழ": "zh", "ள": "l",
  "ற": "r", "ன": "n", "ஜ": "j", "ஷ": "sh", "ஸ": "s", "ஹ": "h", "ஶ": "sh",
};
const independent: Record<string, string> = {
  "அ": "a", "ஆ": "aa", "இ": "i", "ஈ": "ee", "உ": "u", "ஊ": "oo", "எ": "e", "ஏ": "ae", "ஐ": "ai", "ஒ": "o", "ஓ": "oa", "ஔ": "au",
};
const signs: Record<string, string> = {
  "ா": "aa", "ி": "i", "ீ": "ee", "ு": "u", "ூ": "oo", "ெ": "e", "ே": "ae", "ை": "ai", "ொ": "o", "ோ": "oa", "ௌ": "au", "்": "",
};
const romanConsonants: Record<string, string> = {
  zh: "ழ", ng: "ங", ny: "ஞ", th: "த", dh: "த", sh: "ஷ", ch: "ச", kh: "க", ph: "ப", bh: "ப",
  k: "க", g: "க", c: "க", s: "ச", j: "ஜ", t: "ட", d: "ட", n: "ந", p: "ப", b: "ப", m: "ம", y: "ய", r: "ர", l: "ல", v: "வ", w: "வ", h: "ஹ", f: "ஃப",
};
const romanVowels: Record<string, [string, string]> = {
  aa: ["ஆ", "ா"], ee: ["ஈ", "ீ"], ii: ["ஈ", "ீ"], oo: ["ஊ", "ூ"], uu: ["ஊ", "ூ"], ai: ["ஐ", "ை"], au: ["ஔ", "ௌ"], ae: ["ஏ", "ே"], oa: ["ஓ", "ோ"],
  a: ["அ", ""], i: ["இ", "ி"], u: ["உ", "ு"], e: ["எ", "ெ"], o: ["ஒ", "ொ"],
};

export function transliterateTamil(value: string): string {
  return value.normalize("NFC").replace(/[\u0B80-\u0BFF]+/gu, word => {
    if (word === "முத்து") return "Muthu";
    const known = suggestEnglish(word);
    if (known !== word) return known;
    let result = "";
    const letters = Array.from(word);
    for (let index = 0; index < letters.length; index++) {
      const letter = letters[index];
      if (consonants[letter]) {
        const next = letters[index + 1];
        result += consonants[letter] + (next in signs ? signs[next] : "a");
        if (next in signs) index++;
      } else result += independent[letter] ?? letter;
    }
    return result.charAt(0).toUpperCase() + result.slice(1);
  });
}

export function suggestTamil(value: string): string {
  return value.replace(/[\p{L}\p{M}\p{N}_-]+/gu, word => {
    if (!/^[a-z]{2,}$/i.test(word)) return word;
    const roman = word.toLowerCase();
    if (knownTamil[roman]) return knownTamil[roman];
    let result = "";
    let index = 0;
    while (index < roman.length) {
      const vowel = romanVowels[roman.slice(index, index + 2)] ? roman.slice(index, index + 2) : roman[index];
      if (romanVowels[vowel]) {
        result += romanVowels[vowel][0];
        index += vowel.length;
        continue;
      }
      const consonant = romanConsonants[roman.slice(index, index + 2)] ? roman.slice(index, index + 2) : roman[index];
      if (!romanConsonants[consonant]) return word;
      index += consonant.length;
      const following = romanVowels[roman.slice(index, index + 2)] ? roman.slice(index, index + 2) : roman[index];
      result += romanConsonants[consonant] + (romanVowels[following]?.[1] ?? "்");
      if (romanVowels[following]) index += following.length;
    }
    return result;
  });
}
