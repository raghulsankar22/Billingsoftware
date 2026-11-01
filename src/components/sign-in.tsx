"use client";

import { useLanguage } from "./language-provider";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const { error } = await createBrowserSupabase().auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
      if (error) throw error;
      setMessage("A secure sign-in link was sent to your email.");
      window.setTimeout(onSignedIn, 1500);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not send sign-in link."); }
  }
  return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">{t("SECURE OWNER ACCESS")}</p><h1>{t("Finance Billing")}</h1><p>{t("Create bills, keep your register organised, and sync every issued bill to Excel.")}</p><form onSubmit={submit}><label>{t("Email address")}<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("owner@business.com")} /></label><button>{t("Send secure sign-in link")}</button></form>{message && <p className="notice">{t(message)}</p>}</section></main>;
}
