"use client";

import { useId, useRef, useState } from "react";
import { containsTamil } from "@/lib/english-records";
import { canConfirmEnglish, suggestEnglish } from "@/lib/tamil-input";
import { useLanguage } from "./language-provider";

type Props = {
  label: string; value: string; onChange: (value: string) => void;
  multiline?: boolean; required?: boolean; minLength?: number; maxLength?: number;
  disabled?: boolean; className?: string; id?: string; autoFocus?: boolean;
};

export function EnglishRecordField(props: Props) {
  const { t } = useLanguage();
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const [draft, setDraft] = useState<string | null>(null);
  const [previousValue, setPreviousValue] = useState(props.value);
  if (previousValue !== props.value) { setPreviousValue(props.value); setDraft(null); }
  const [suggestion, setSuggestion] = useState("");
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const pending = draft !== null;
  const confirmationMessage = "Confirm the English spelling or discard the Tamil draft before saving.";
  function change(value: string) {
    if (containsTamil(value) || pending) {
      setDraft(value);
      setSuggestion(suggestEnglish(value));
      input.current?.setCustomValidity(t(confirmationMessage));
    } else props.onChange(value);
  }
  function discard() { setDraft(null); setSuggestion(""); input.current?.setCustomValidity(""); }
  function confirm() {
    if (!canConfirmEnglish(suggestion)) return;
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
    {pending && <div id={id + "-review"} className="notice" role="status">
      <p>{t("Tamil draft — not saved. Local vocabulary suggestions are not full sentence translations. Unknown words need English spelling entered manually.")}</p>
      <label htmlFor={id + "-english"}>{t("English text to save")}</label>
      <input id={id + "-english"} value={suggestion} disabled={props.disabled} onChange={event => setSuggestion(event.target.value)} />
      <button type="button" disabled={props.disabled || !canConfirmEnglish(suggestion)} onClick={confirm}>{t("Confirm English spelling")}</button>{" "}
      <button type="button" disabled={props.disabled} onClick={discard}>{t("Discard Tamil draft")}</button>
      <p>{t(confirmationMessage)}</p>
    </div>}
  </div>;
}
