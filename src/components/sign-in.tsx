"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase";

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
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
  return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">SECURE OWNER ACCESS</p><h1>Finance Billing</h1><p>Create bills, keep your register organised, and sync every issued bill to Excel.</p><form onSubmit={submit}><label>Email address<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@business.com" /></label><button>Send secure sign-in link</button></form>{message && <p className="notice">{message}</p>}</section></main>;
}
