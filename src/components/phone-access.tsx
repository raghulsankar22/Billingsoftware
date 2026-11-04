"use client";

import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "./language-provider";

type Address = { kind: "tailscale" | "wifi"; adapter: string; url: string };
type Status = { administrator: boolean; enabled?: boolean; port?: number; fromPhone?: boolean; addresses?: Address[] };

async function call(method: "GET" | "PUT", body?: Record<string, unknown>): Promise<Status> {
  const response = await fetch("/api/phone-access", { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Phone access could not be changed.");
  return payload;
}

/** Administrator switch that lets phones on the shop Wi-Fi or a private network (Tailscale) open billing. */
export function PhoneAccess() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const load = useCallback(() => call("GET").then(setStatus).catch(failure => setError(failure instanceof Error ? failure.message : "Phone access could not be loaded.")), []);
  useEffect(() => { void load(); }, [load]);

  async function change(enabled: boolean) {
    setBusy(true); setError("");
    try { setStatus(await call("PUT", { enabled })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Phone access could not be changed."); }
    finally { setBusy(false); }
  }
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(url); setTimeout(() => setCopied(""), 2000); } catch { setCopied(""); }
  }

  if (!status?.administrator) return error ? <p className="error" role="alert">{t(error)}</p> : null;
  const addresses = status.addresses ?? [];
  const hasTailscale = addresses.some(address => address.kind === "tailscale");
  return <section className="phone-access" aria-label={t("Phone access")}>
    <h3>{t("Phone access")}</h3>
    <p className="muted">{t("Lets a phone open this billing app. Bills and customers stay on this computer; the phone only shows and edits them. This computer must stay on and billing must be running.")}</p>
    <p><strong>{status.enabled ? t("Phone access is ON") : t("Phone access is OFF")}</strong></p>
    {status.fromPhone && <p className="notice">{t("Change phone access on the shop computer, not on a phone.")}</p>}
    <div className="backup-actions">
      <button type="button" disabled={busy || status.fromPhone} onClick={() => void change(!status.enabled)} className={status.enabled ? "secondary" : undefined}>{status.enabled ? t("Turn off phone access") : t("Turn on phone access")}</button>
    </div>
    {status.enabled && <>
      <p>{t("On the phone, open one of these addresses in Chrome or Safari, then sign in:")}</p>
      {addresses.length === 0 ? <p className="error" role="alert">{t("No network address was found. Connect this computer to the shop Wi-Fi or to Tailscale.")}</p> :
        <ul className="phone-addresses">{addresses.map(address => <li key={address.url}>
          <strong>{address.kind === "tailscale" ? t("From anywhere (Tailscale)") : t("On the shop Wi-Fi")}</strong>
          <code>{address.url}</code>
          <button type="button" className="secondary" onClick={() => void copy(address.url)}>{copied === address.url ? t("Copied") : t("Copy")}</button>
        </li>)}</ul>}
      {!hasTailscale && <p className="muted">{t("To bill from another city, install Tailscale (free) on this computer and on the phone, sign in to the same Tailscale account on both, then use the Tailscale address.")}</p>}
      <p className="muted">{t("If Windows asks whether to allow billing through the firewall, allow it on private networks. Anyone on the same Wi-Fi can see the sign-in page, so use strong passwords and turn this off when you do not need it.")}</p>
    </>}
    {error && <p className="error" role="alert">{t(error)}</p>}
  </section>;
}
