import { containsTamil } from "./english-records";

const spellings: Record<string, string> = {
  "குமார்": "Kumar", "சங்கர்": "Sankar", "ராஜா": "Raja", "ரவி": "Ravi",
  "சென்னை": "Chennai", "மதுரை": "Madurai", "தெரு": "Street", "சாலை": "Road",
  "மோதிரம்": "Ring", "சங்கிலி": "Chain", "வளையல்": "Bangle", "தங்கம்": "Gold", "வெள்ளி": "Silver",
};

export function suggestEnglish(value: string): string {
  return value.replace(/[஀-௿]+/gu, word => spellings[word] ?? word);
}

export function canConfirmEnglish(value: string): boolean {
  return Boolean(value.trim()) && !containsTamil(value);
}
