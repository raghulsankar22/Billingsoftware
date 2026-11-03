"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { translate, type Language } from "@/lib/language";

const preferenceKey = "finance-billing-language-v2";
const LanguageContext = createContext({ language: "en" as Language, t: (text: string) => text });
const LanguageSetterContext = createContext<(language: Language) => void>(() => {});

export function LanguageProvider({ children, demo = false }: { children: React.ReactNode; demo?: boolean }) {
  const [language, setLanguage] = useState<Language>("en");
  const [restored, setRestored] = useState(false);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    setDesktop(/Electron/i.test(navigator.userAgent));
    try {
      const saved = window.localStorage.getItem(preferenceKey);
      if (saved === "en" || saved === "ta") setLanguage(saved);
    } catch {}
    function selectLanguage(event: Event) {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === "en" || detail === "ta") setLanguage(detail);
    }
    window.addEventListener("billing-language-change", selectLanguage);
    setRestored(true);
    return () => window.removeEventListener("billing-language-change", selectLanguage);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    if (restored) {
      try { window.localStorage.setItem(preferenceKey, language); } catch {}
    }
  }, [language, restored]);
  const value = useMemo(() => ({ language, t: (text: string) => translate(language, text) }), [language]);
  return <LanguageSetterContext.Provider value={setLanguage}><LanguageContext.Provider value={value}>
    {(!desktop || demo) && <aside className="panel language-controls" aria-label="View options">
      {!desktop && <details className="website-view-menu"><summary>View</summary><div><strong>Languages</strong><LanguageSwitch /></div></details>}
      {demo && <strong className="demo-indicator" role="status">DEMO · Sample data only</strong>}
    </aside>}
    {children}
  </LanguageContext.Provider></LanguageSetterContext.Provider>;
}

export function useLanguage() { return useContext(LanguageContext); }

export function LanguageSwitch() {
  const { language } = useLanguage();
  const setLanguage = useContext(LanguageSetterContext);
  return <div className="language-switch" role="group" aria-label="Languages">
    <button type="button" lang="en" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>English</button>{" "}
    <button type="button" lang="ta" aria-pressed={language === "ta"} onClick={() => setLanguage("ta")}>Tamil (தமிழ்)</button>
  </div>;
}
