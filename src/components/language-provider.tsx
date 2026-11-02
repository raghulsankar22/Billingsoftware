"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { translate, type Language } from "@/lib/language";

const preferenceKey = "finance-billing-language-v1";
const LanguageContext = createContext({ language: "ta" as Language, t: (text: string) => translate("ta", text) });
const LanguageSetterContext = createContext<(language: Language) => void>(() => {});

export function LanguageProvider({ children, demo = false }: { children: React.ReactNode; demo?: boolean }) {
  const [language, setLanguage] = useState<Language>("ta");
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(preferenceKey);
      if (saved === "en" || saved === "ta") setLanguage(saved);
    } catch {}
    setRestored(true);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    if (restored) {
      try { window.localStorage.setItem(preferenceKey, language); } catch {}
    }
  }, [language, restored]);
  const value = useMemo(() => ({ language, t: (text: string) => translate(language, text) }), [language]);
  return <LanguageSetterContext.Provider value={setLanguage}><LanguageContext.Provider value={value}>
    <aside className="panel language-controls" aria-label={value.t("Language")}>
      <LanguageSwitch />
      {demo && <strong className="demo-indicator" role="status">{language === "ta" ? "சோதனை • மாதிரி பதிவுகள் மட்டும்" : "DEMO • Sample data only"}</strong>}
      <details className="language-help">
        <summary>{language === "ta" ? "விவரங்கள்" : "Details"}</summary>
        <div className="language-explanation">
          {demo && <p>{value.t("DEMO: Synthetic sample data only. This is not a real ledger. Do not enter real customer or financial data.")}</p>}
          <p>{value.t("Stored records and Excel remain in English. Check and explicitly confirm local spelling suggestions before saving English values.")}</p>
          <p>{language === "ta" ? "இயல்பாக இணையமில்லா பரிந்துரைகள் மட்டுமே. Google பொத்தானைத் தேர்ந்தெடுத்து ஒப்புதல் அளித்தால் அந்தப் புலத்தின் உரை மட்டும் இணையம் வழியாக அனுப்பப்படும்; கட்டணம் ஏற்படலாம்." : "Suggestions are offline by default. Google translation sends only the selected field’s text online after your consent and may incur charges."}</p>
        </div>
      </details>
    </aside>
    {children}
  </LanguageContext.Provider></LanguageSetterContext.Provider>;
}

export function useLanguage() { return useContext(LanguageContext); }

export function LanguageSwitch() {
  const { language, t } = useLanguage();
  const setLanguage = useContext(LanguageSetterContext);
  return <div className="language-switch" role="group" aria-label={t("Language")}>
    <button type="button" lang="ta" aria-pressed={language === "ta"} onClick={() => setLanguage("ta")}>தமிழ்</button>{" "}
    <button type="button" lang="en" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>English</button>
  </div>;
}
