export const containsTamil = (value: string) => /[஀-௿]/u.test(value);

export const englishRecordMessage = "Use English letters or digits for phone numbers and identifiers; these fields are not translated.";

export const isEnglishRecord = (value: string) => !containsTamil(value);
