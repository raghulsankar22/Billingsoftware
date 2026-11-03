"use client";

import { useId } from "react";
import { useLanguage } from "./language-provider";

type Props = {
  label: string; value: string; onChange: (value: string) => void;
  multiline?: boolean; required?: boolean; minLength?: number; maxLength?: number;
  disabled?: boolean; className?: string; id?: string; autoFocus?: boolean; hideLabel?: boolean;
};

export function EnglishRecordField(props: Props) {
  const { t } = useLanguage();
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const attributes = {
    id, value: props.value, disabled: props.disabled,
    required: props.required, minLength: props.minLength, maxLength: props.maxLength,
    autoFocus: props.autoFocus,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => props.onChange(event.target.value),
  };
  return <div className={props.className}>
    <label htmlFor={id} className={props.hideLabel ? "sr-only" : undefined}>{t(props.label)}</label>
    {props.multiline ? <textarea {...attributes} /> : <input {...attributes} />}
  </div>;
}
