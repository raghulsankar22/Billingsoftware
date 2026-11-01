export const containsTamil = (value: string) => /[஀-௿]/u.test(value);

export const englishRecordMessage = "Use confirmed English text for saved records. Tamil is supported only as an entry draft.";

export const isEnglishRecord = (value: string) => !containsTamil(value);
