export type GoogleTranslationField = "customerName" | "fatherName" | "address";
export type TranslationLanguage = "en" | "ta";
export const googleTranslationLimits = { customerName: 120, fatherName: 120, address: 500 } as const;
export const googleTranslationErrors = {
  invalid: "Choose a name or address, English/Tamil, and consent before translating.",
  notConfigured: "Google translation is not configured. Ask the owner to enable it and add a server-side API key.",
  unauthenticated: "Sign in again before using Google translation.",
  rateLimited: "Too many translation requests. Wait a minute and try again.",
  unavailable: "Google translation is unavailable. Check the internet connection, API key, billing and quota. Your draft has not changed.",
  invalidResult: "Google returned an unusable suggestion. Keep the original text or enter a spelling manually.",
} as const;
export type GoogleTranslationErrorCode = keyof typeof googleTranslationErrors;

export type GoogleTranslationInput = {
  text: string; field: GoogleTranslationField; source: TranslationLanguage; target: TranslationLanguage; consent: true;
};

export function splitTranslationText(text: string) {
  const parts = text.split(/([\p{L}\p{N}_./:+-]*\p{N}[\p{L}\p{N}_./:+-]*|[₹$€£])/gu);
  const indices = parts.flatMap((part, index) => /\p{L}/u.test(part) && !/\p{N}/u.test(part) ? [index] : []);
  return { parts, indices };
}
