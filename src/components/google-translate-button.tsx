"use client";

import { useEffect, useId, useRef, useState } from "react";
import { googleTranslationErrors, googleTranslationLimits, type GoogleTranslationErrorCode, type GoogleTranslationField, type TranslationLanguage } from "../lib/google-translation-input";
import { GoogleTranslateRequestError, requestGoogleTranslation } from "./google-translate-request";
import { useLanguage } from "./language-provider";

type Props = {
  text: string; field: GoogleTranslationField; source: TranslationLanguage; target: TranslationLanguage;
  disabled?: boolean; onTranslated: (text: string) => void;
};

const tamilErrors: Record<GoogleTranslationErrorCode, string> = {
  invalid: "பெயர் அல்லது முகவரி, மொழி மற்றும் ஒப்புதலைச் சரிபார்க்கவும்.",
  notConfigured: "Google மொழிபெயர்ப்பு அமைக்கப்படவில்லை. உரிமையாளர் சேவையை இயக்கி API சாவியைச் சேர்க்க வேண்டும்.",
  unauthenticated: "மீண்டும் உள்நுழையவும்.", rateLimited: "கோரிக்கைகள் அதிகம். ஒரு நிமிடம் காத்திருந்து மீண்டும் முயற்சிக்கவும்.",
  unavailable: "Google மொழிபெயர்ப்பு கிடைக்கவில்லை. இணையம், API சாவி, கட்டணம் மற்றும் வரம்பைச் சரிபார்க்கவும். உங்கள் வரைவு மாறவில்லை.",
  invalidResult: "Google பரிந்துரையைப் பயன்படுத்த முடியவில்லை. அசல் உரையை வைத்திருக்கவும் அல்லது எழுத்துகளைத் திருத்தவும்.",
};

export function GoogleTranslateButton(props: Props) {
  return <TranslationControl key={JSON.stringify([props.field, props.source, props.target, props.text, Boolean(props.disabled)])} {...props} />;
}

function TranslationControl({ text, field, source, target, disabled, onTranslated }: Props) {
  const { language } = useLanguage();
  const tamil = language === "ta";
  const id = useId();
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<GoogleTranslationErrorCode | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);

  const allowed = text.trim().length > 0 && text.trim().length <= googleTranslationLimits[field];
  async function translate() {
    if (!consent || !allowed || busy || disabled) return;
    const request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const translated = await requestGoogleTranslation({ text, field, source, target, consent: true }, request.signal);
      if (!request.signal.aborted) setResult(translated);
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof GoogleTranslateRequestError ? failure.code : "unavailable");
    } finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <div className="google-translate-control">
    <button type="button" className="secondary" disabled={disabled || !allowed || busy} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>Translate with Google</button>
    {open && <div id={id} className="google-translate-review">
      <p>{tamil ? "இந்தப் புலத்தின் உரை மட்டும் Google-க்கு இணையம் வழியாக அனுப்பப்படும். எண்கள் உள்ள சொற்கள் அனுப்பப்படாது; உள்ளூரிலேயே வைக்கப்படும். கட்டணம் ஏற்படலாம். தொலைபேசி அல்லது ஆதார் விவரங்களை இந்தப் புலத்தில் இட வேண்டாம்." : "Only this field’s text is sent online to Google. Tokens containing numbers stay on this computer. Charges may apply. Do not include phone or Aadhaar details in this field."}</p>
      <p>{tamil ? "பெயரின் பொருள் மொழிபெயர்க்கப்படலாம்; அதிகாரப்பூர்வ எழுத்து உறுதி செய்யப்படாது. முடிவைச் சரிபார்க்கவும். Google முடிவு தானாகச் சேமிக்கப்படாது." : "Names may be translated by meaning, not official spelling. Review the result. Google results are never saved automatically."}</p>
      <label className="google-translate-consent"><input type="checkbox" checked={consent} disabled={disabled || busy} onChange={event => setConsent(event.target.checked)} />{tamil ? "இந்த உரையை Google-க்கு அனுப்ப ஒப்புக்கொள்கிறேன்." : "I agree to send this text to Google."}</label>
      <button type="button" disabled={!consent || !allowed || disabled || busy} onClick={translate}>{busy ? (tamil ? "மொழிபெயர்க்கப்படுகிறது…" : "Translating…") : (tamil ? "இந்தப் புலத்தை மொழிபெயர்" : "Translate selected field")}</button>
      {error && <p className="error" role="alert">{tamil ? tamilErrors[error] : googleTranslationErrors[error]}</p>}
      {result !== null && <div className="google-translate-result">
        <label htmlFor={id + "-result"}>{target === "ta" ? "தமிழ் பரிந்துரை" : "English suggestion"}</label>
        <textarea id={id + "-result"} lang={target} maxLength={2500} disabled={disabled || busy} value={result} onChange={event => setResult(event.target.value)} />
        <p><a href="https://translate.google.com/" target="_blank" rel="noreferrer">Powered by Google Translate</a> — {tamil ? "தானியங்கி பரிந்துரை; நீங்கள் திருத்தலாம்." : "Automatic suggestion; you may edit it."}</p>
        <button type="button" disabled={disabled || busy || !result.trim()} onClick={() => onTranslated(result.trim())}>{tamil ? "இந்தப் பரிந்துரையைப் பயன்படுத்து" : "Use this suggestion"}</button>
      </div>}
      <small>{tamil ? "மொழிபெயர்ப்பின் துல்லியத்திற்கு உத்தரவாதம் இல்லை." : "Translation accuracy is not guaranteed."} <a href="https://docs.cloud.google.com/translate/attribution#disclaimer" target="_blank" rel="noreferrer">Google Translate disclaimer</a></small>
    </div>}
  </div>;
}
