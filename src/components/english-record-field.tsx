"use client";

import { useId, useRef, useState } from "react";
import { containsTamil } from "@/lib/english-records";
import { canConfirmEnglish } from "@/lib/tamil-input";
import { suggestTamil, transliterateTamil } from "@/lib/tamil-transliteration";
import { useLanguage } from "./language-provider";
import { GoogleTranslateButton } from "./google-translate-button";
import type { GoogleTranslationField } from "../lib/google-translation-input";

type Props = {
  label: string; value: string; onChange: (value: string) => void;
  multiline?: boolean; required?: boolean; minLength?: number; maxLength?: number;
  disabled?: boolean; className?: string; id?: string; autoFocus?: boolean; googleField?: GoogleTranslationField;
};

export function EnglishRecordField(props: Props) {
  const { language, t } = useLanguage();
  const [tamilPreview, setTamilPreview] = useState<string | null>(null);
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const [draft, setDraft] = useState<string | null>(null);
  const [previousValue, setPreviousValue] = useState(props.value);
  if (previousValue !== props.value) { setPreviousValue(props.value); setDraft(null); setTamilPreview(null); }
  const [suggestion, setSuggestion] = useState("");
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const pending = draft !== null;
  const validSuggestion = canConfirmEnglish(suggestion) && (!props.maxLength || suggestion.trim().length <= props.maxLength);
  const confirmationMessage = "Confirm the English spelling or discard the Tamil draft before saving.";
  function change(value: string) {
    if (containsTamil(value) || pending) {
      setDraft(value);
      setSuggestion(transliterateTamil(value));
      input.current?.setCustomValidity(t(confirmationMessage));
    } else props.onChange(value);
  }
  function discard() { setDraft(null); setSuggestion(""); input.current?.setCustomValidity(""); }
  function confirm() {
    if (!validSuggestion) return;
    props.onChange(suggestion.trim());
    discard();
  }
  const attributes = {
    id, ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => { if (element) element.setCustomValidity(pending ? t(confirmationMessage) : ""); input.current = element as HTMLInputElement & HTMLTextAreaElement; }, value: draft ?? props.value, disabled: props.disabled,
    required: props.required, minLength: props.minLength, maxLength: props.maxLength,
    autoFocus: props.autoFocus, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(event.target.value),
    "aria-describedby": pending ? id + "-review" : undefined,
    "data-english-review-pending": pending ? "true" : undefined,
  };
  return <div className={props.className}>
    <label htmlFor={id}>{t(props.label)}</label>
    {props.multiline ? <textarea {...attributes} /> : <input {...attributes} />}
    {(language === "ta" || tamilPreview !== null) && !pending && props.value.trim() && <div className="notice">
      <label htmlFor={id + "-tamil"}>தமிழ் உச்சரிப்பு வரைவு (சேமிக்கப்படாது)</label>
      <input id={id + "-tamil"} lang="ta" value={tamilPreview ?? suggestTamil(props.value)} disabled={props.disabled} onChange={event => setTamilPreview(event.target.value)} />
      <small>{tamilPreview === null ? "இது இணையமில்லா உச்சரிப்பு உதவி மட்டுமே. சரியான மொழிபெயர்ப்பு அல்ல. " : "இது நீங்கள் தேர்ந்தெடுத்த தற்காலிக தமிழ் வரைவு. "}பதிவில் ஆங்கிலம் மட்டுமே சேமிக்கப்படும்.</small>
    </div>}
    {props.googleField && (!pending || containsTamil(draft ?? "")) && <GoogleTranslateButton text={draft ?? props.value} field={props.googleField} source={pending ? "ta" : "en"} target={pending ? "en" : "ta"} disabled={props.disabled} onTranslated={value => { if (pending) setSuggestion(value); else setTamilPreview(value); }} />}
    {pending && <div id={id + "-review"} className="notice" role="status">
      <p>{language === "ta" ? "தமிழ் வரைவு சேமிக்கப்படாது. இணையமில்லா உச்சரிப்பு உதவி மட்டுமே; ஆங்கில எழுத்துகளைச் சரிபார்த்து உறுதிசெய்யவும்." : "Tamil draft — not saved. Offline phonetic suggestions are approximate, not sentence translations. Check and confirm the English spelling."}</p>
      <label htmlFor={id + "-english"}>{t("English text to save")}</label>
      <input id={id + "-english"} value={suggestion} maxLength={props.maxLength} disabled={props.disabled} onChange={event => setSuggestion(event.target.value)} />
      {props.maxLength && suggestion.trim().length > props.maxLength && <p className="error">{language === "ta" ? "பரிந்துரை மிக நீளமாக உள்ளது; சேமிக்கும் முன் சுருக்கவும்." : "The suggestion is too long; shorten it before confirming."}</p>}
      <button type="button" disabled={props.disabled || !validSuggestion} onClick={confirm}>{t("Confirm English spelling")}</button>{" "}
      <button type="button" disabled={props.disabled} onClick={discard}>{t("Discard Tamil draft")}</button>
      <p>{t(confirmationMessage)}</p>
    </div>}
  </div>;
}
