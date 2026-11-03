import { z } from "zod";


export const jewelleryTamilLabels: Readonly<Record<string, string>> = {
  "1 Stone Mukkuthi": "1 கல் மூக்குத்தி",
  "1 Stone Ring": "1 கல் மோதிரம்",
  "3 Stone Mukkuthi": "3 கல் மூக்குத்தி",
  "3 Stone Ring": "3 கல் மோதிரம்",
  "7 Stone Mukkuthi": "7 கல் மூக்குத்தி",
  "Agal Vilaku": "அகல் விளக்கு",
  "Agarbathi stand": "அகர்பத்தி ஸ்டாண்ட்",
  "Annachi": "அண்ணாச்சி",
  "Anklet": "கொலுசு",
  "Arasa Leaf": "அரச இலை",
  "Attigai": "அட்டிகை",
  "Baby Bangle": "குழந்தை வளையல்",
  "Bangle": "வளையல்",
  "Bottu": "பொட்டு",
  "Bracelet": "பிரேஸ்லெட்",
  "Chain": "சயின்",
  "Design Tepus": "டிசைன் டெபஸ்",
  "Double chain": "இரட்டைச் பட்டை சயின்",
  "Ear extension chain": "சுத்து மாட்டல்",
  "Enamel Ring": "எனாமல் மோதிரம்",
  "Getti Golusu": "கெட்டி கொலுசு",
  "Gundu": "குண்டு",
  "Haram": "ஆரம்",
  "Jimikki": "ஜிமிக்கி",
  "Jimikki Kammal": "ஜிமிக்கி கம்மல்",
  "Kaal Savaram": "கால் சவரன்",
  "Kaapu": "காப்பு",
  "Kaasu Malai": "காசு மாலை",
  "Kamtachi Vilaku": "காமாட்சி விளக்கு",
  "Keychain": "சாவிக்கொத்தை",
  "Kungumam bharani": "குங்குமப் பரணி",
  "Kuthu Vilaku": "குத்து விளக்கு",
  "Ladies Ring": "Ladies மோதிரம்",
  "Ladoo Kammal": "லட்டு கம்மல்",
  "Lolaku": "லோலாக்கு",
  "Mahalakshmi Bottu": "மஹாலட்சுமி பொட்டு",
  "Manga": "மாங்கா",
  "Mani": "மணி",
  "Mathu Kammal Lolaku": "மத்து, கம்மல், லோலாக்கு",
  "Mathu Mukkuthi": "மத்து மூக்குத்தி",
  "Mugapu": "முகப்பு",
  "Muthu Arunakodi": "Muthu Arunakodi",
  "Naaanakulal": "நாணக்குழல்",
  "Nadhiya Kammal": "நதியா கம்மல்",
  "Navarathina Ring": "நவரத்தின மோதிரம்",
  "Necklace": "நெக்லஸ்",
  "Nose pin": "மூக்குத்தி",
  "Paneer Sombu": "பன்னீர்சோம்பு",
  "Pendant": "டாலர்",
  "Plate": "தட்டு",
  "Ring": "மோதிரம்",
  "Sandhana kinnam": "சந்தனக் கிண்ணம்",
  "Savaran": "சவரன்",
  "Side Mattal": "சைடு மட்டல்",
  "Single Chain": "ஒற்றைச் பட்டை சயின்",
  "Sombu": "சோம்பு",
  "Stone Bange": "கல் வளையல்",
  "Stone Kammal": "கல் கம்மல்",
  "Stone Mukkuthi": "கல் மூக்குத்தி",
  "Stone Vanki Ring": "கல் வங்கி மோதிரம்",
  "Studs": "தோடு",
  "T.V Ring": "T.V மோதிரம்",
  "Tepus": "டெபஸ்",
  "Tepus Thoongatam": "டெபஸ் தொங்கட்டம்",
  "Thali Saradu": "தாலி சரது",
  "Thambu Kyar Chain": "தாம்பு கயிர் சயின்",
  "Thandai": "தண்டை",
  "Thoongatam": "தொங்கட்டம்",
  "Thoongatam mookuthi": "தொங்காட்டம் மூக்குத்தி",
  "Toe ring": "மெட்டி",
  "Tumbler": "டம்ளர்",
  "Vanki Ring": "வங்கி மோதிரம்",
  "Vazhaseepu": "வாழைச்சீப்பு",
  "Vilva kaai": "வில்வக் காய்",
  "Vilva Leaf": "வில்வக் இலை",
  "Waist chain": "அருணாக்கொடி"
};

const compareNames = (first: string, second: string) => first.localeCompare(second, "en", { sensitivity: "base", numeric: true });
export const starterJewellery = Object.keys(jewelleryTamilLabels).sort(compareNames);
const displayLabels = new Map(Object.entries({ ...jewelleryTamilLabels, Coin: "நாணயம்", Earrings: "கம்மல்" }).map(([name, tamil]) => [name.toLowerCase(), tamil]));

export function jewelleryLabel(name: string): string {
  const tamil = displayLabels.get(name.toLowerCase());
  return tamil ? name + " (" + tamil + ")" : name;
}

export function formatParticulars(particulars: string): string {
  return particulars.split(",").map(segment => {
    const match = segment.trim().match(/^(.*?)(\s+\d+)?$/u);
    if (!match || !displayLabels.has(match[1].toLowerCase())) return segment;
    return segment.replace(match[1], jewelleryLabel(match[1]));
  }).join(",");
}

export const jewelleryNameSchema = z.string()
  .transform(value => value.normalize("NFKC").replace(/\s+/g, " ").trim())
  .pipe(z.string().min(2, "Enter at least 2 characters for the jewellery name.")
    .max(180, "Jewellery names can have up to 180 characters.")
    .regex(/^[^\u0000-\u001f\u007f]+$/, "Enter a valid jewellery name."));

export const jewelleryKey = (name: string) => name.toLocaleLowerCase("en-IN");

/** Quantities describe the jewellery; grams and money remain totals for the pledge row. */
export function appendJewelleryParticulars(current: string, name: string, quantity: string | number) {
  const jewellery = jewelleryNameSchema.parse(name);
  const count = z.coerce.number().finite().int("Quantity must be a whole number.")
    .min(1, "Quantity must be at least 1.").max(9999, "Quantity can be up to 9999.").parse(quantity);
  const description = [current.trim(), `${jewellery} ${count}`].filter(Boolean).join(", ");
  if (description.length > 180) throw new Error("Particulars can have up to 180 characters. Shorten the description before adding more jewellery.");
  return description;
}

/** Keep familiar defaults first; custom choices are shared by all business accounts. */
export function jewelleryChoices(customNames: string[], hiddenKeys: readonly string[] = []) {
  const choices = new Map<string, string>(starterJewellery.map(name => [jewelleryKey(name), name]));
  for (const name of customNames) choices.set(jewelleryKey(name), name);
  const hidden = new Set(hiddenKeys);
  return [...choices.values()].filter(name => !hidden.has(jewelleryKey(name))).sort(compareNames);
}
