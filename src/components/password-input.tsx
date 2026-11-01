"use client";

import { useState, type InputHTMLAttributes } from "react";
import { useLanguage } from "./language-provider";

export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);
  return <span className="password-field">
    <input {...props} type={visible ? "text" : "password"} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
    <button type="button" className="secondary" aria-pressed={visible} aria-label={t(visible ? "Hide password" : "Show password")} onClick={() => setVisible(current => !current)}>{t(visible ? "Hide" : "Show")}</button>
  </span>;
}
