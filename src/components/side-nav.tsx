"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AccountSlot } from "@/lib/account-url";
import { applyTheme, clampNavWidth, keyboardNavWidth, navExpandedFrom, navMaxWidth, navMinWidth, readNavWidth, tamilNavMinWidth, readTheme, saveNavWidth, saveTheme, type AppTheme } from "@/lib/app-theme";
import { billingToday } from "@/lib/business-updates";
import { badgeText, navCounts, type NavCounts } from "@/lib/nav-counts";
import type { Bill } from "@/lib/types";
import { api } from "./api";
import { useLanguage } from "./language-provider";

export type NavView = "bills" | "new" | "customers" | "delivery" | "lost-bills" | "delivery-bills" | "dashboard" | "notice" | "overdue" | "search" | "settings" | "users" | "my-account" | "import" | "cashbook";
export type NavAccess = { localStorage: boolean; inDesktopApp: boolean; signedInUser: boolean; administrator: boolean };

type Item = { view: NavView; icon: string; label: string; short: string; count?: keyof NavCounts; alert?: boolean; show: boolean };

/** The same visibility rules as the old menu: desktop-only pages stay in the native File menu. */
export function navGroups(access: NavAccess): { heading: string; items: Item[] }[] {
  const local = access.localStorage;
  const website = !access.inDesktopApp;
  const groups: { heading: string; items: Item[] }[] = [
    { heading: "Daily work", items: [
      { view: "dashboard", icon: "📊", label: "Dashboard", short: "Home", show: local },
      { view: "delivery", icon: "📦", label: "Delivery", short: "Delivery", show: local },
      { view: "customers", icon: "👥", label: "Customers", short: "Customers", show: local },
      { view: "cashbook", icon: "₹", label: "Payments / Daily Closing", short: "Payments", show: local },
    ] },
    { heading: "Records", items: [
      { view: "bills", icon: "📚", label: "All bills", short: "Bills", count: "bills", show: true },
      { view: "delivery-bills", icon: "🧾", label: "Delivery Bills", short: "Delivered", show: local },
      { view: "lost-bills", icon: "📄", label: "Customer Bill Lost", short: "Bill lost", count: "lostBills", show: local },
    ] },
    { heading: "Reminders", items: [
      { view: "notice", icon: "📨", label: "Notice", short: "Notice", count: "notice", alert: true, show: local },
      { view: "overdue", icon: "⏰", label: "Overdue", short: "Overdue", count: "overdue", alert: true, show: local },
      { view: "search", icon: "🔍", label: "Search", short: "Search", show: local },
    ] },
    { heading: "Settings", items: [
      { view: "import", icon: "📥", label: "Import old bills", short: "Import", show: website && local },
      { view: "my-account", icon: "🔐", label: "My account", short: "Account", show: website && access.signedInUser },
      { view: "users", icon: "👤", label: "Users", short: "Users", show: website && access.administrator },
      { view: "settings", icon: "⚙️", label: "Business profile", short: "Profile", show: website },
    ] },
  ];
  return groups.map(group => ({ ...group, items: group.items.filter(item => item.show) })).filter(group => group.items.length > 0);
}

/** Counts for the open account only. Reloads when the account changes or the app reloads its bills. */
function useNavCounts(accountSlot: AccountSlot, version: number, enabled: boolean) {
  const [counts, setCounts] = useState<NavCounts | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setCounts(null);
    if (!enabled) return;
    api("/api/bills", accountSlot)
      .then(result => { if (current === generation.current) setCounts(navCounts((result.bills ?? []) as Bill[], billingToday())); })
      .catch(() => { if (current === generation.current) setCounts(null); });
  }, [accountSlot, version, enabled]);
  useEffect(() => () => { generation.current++; }, []);
  return counts;
}

export function SideNav({ view, access, accountSlot, countsVersion, countsEnabled, onSelect }: { view: NavView; access: NavAccess; accountSlot: AccountSlot; countsVersion: number; countsEnabled: boolean; onSelect: (view: NavView) => void }) {
  const { t, language } = useLanguage();
  const [width, setWidth] = useState(navMinWidth);
  const [theme, setTheme] = useState<AppTheme>("dark");
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const counts = useNavCounts(accountSlot, countsVersion, countsEnabled);
  const shown = Math.max(width, language === "ta" ? tamilNavMinWidth : navMinWidth);
  const expanded = shown >= navExpandedFrom;

  useEffect(() => { setWidth(readNavWidth()); const saved = readTheme(); setTheme(saved); applyTheme(saved); }, []);
  useEffect(() => {
    if (!tip) return;
    const hide = (event: KeyboardEvent) => { if (event.key === "Escape") setTip(null); };
    const scrolled = () => setTip(null);
    window.addEventListener("keydown", hide); window.addEventListener("scroll", scrolled, true);
    return () => { window.removeEventListener("keydown", hide); window.removeEventListener("scroll", scrolled, true); };
  }, [tip]);

  const resize = (next: number, save = true) => { const value = clampNavWidth(next); setWidth(value); setTip(null); if (save) saveNavWidth(value); };
  // Short Tamil menu words are separate entries so they can be approved without changing the full names.
  const shortLabel = (item: Item) => {
    if (language !== "ta") return item.short;
    const key = `Menu: ${item.short}`; const tamil = t(key);
    return tamil === key ? t(item.label) : tamil;
  };
  const countFor = (item: Item) => (item.count && counts ? counts[item.count] : 0);
  const describe = (item: Item) => { const count = countFor(item); return count ? `${t(item.label)} · ${count.toLocaleString("en-IN")}` : t(item.label); };
  const showTip = (target: HTMLElement, text: string) => {
    if (expanded) return;
    const box = target.getBoundingClientRect();
    setTip({ text, top: box.top + box.height / 2, left: box.right + 10 });
  };
  const tipHandlers = (text: string) => ({
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => showTip(event.currentTarget, text),
    onMouseLeave: () => setTip(null),
    onFocus: (event: React.FocusEvent<HTMLElement>) => showTip(event.currentTarget, text),
    onBlur: () => setTip(null),
  });
  const switchTheme = () => { const next: AppTheme = theme === "dark" ? "light" : "dark"; setTheme(next); applyTheme(next); saveTheme(next); };
  const themeLabel = theme === "dark" ? t("Switch to light mode") : t("Switch to dark mode");

  return <nav className={`app-rail${expanded ? " app-rail-expanded" : ""}`} aria-label={t("Billing menu")} style={{ width: shown }}>
    <div className="rail-scroll">
      <button type="button" className={`rail-new${view === "new" ? " active" : ""}`} aria-current={view === "new" ? "page" : undefined} aria-label={t("New bill")} {...tipHandlers(t("New bill"))} onClick={() => onSelect("new")}>
        <span className="rail-plus" aria-hidden="true">＋</span><span className="rail-label">{expanded ? t("New bill") : shortLabel({ view: "new", icon: "", label: "New bill", short: "New bill", show: true })}</span>
      </button>
      {navGroups(access).map(group => <div className="rail-group" role="group" aria-label={t(group.heading)} key={group.heading}>
        {expanded ? <p className="rail-heading">{t(group.heading)}</p> : <hr className="rail-divider" aria-hidden="true" />}
        {group.items.map(item => {
          const count = countFor(item);
          return <button type="button" key={item.view} data-view={item.view} className={`rail-item${view === item.view ? " active" : ""}`} aria-current={view === item.view ? "page" : undefined} aria-label={describe(item)} {...tipHandlers(describe(item))} onClick={() => onSelect(item.view)}>
            <span className="rail-icon" aria-hidden="true">{item.icon}</span>
            <span className="rail-label" aria-hidden="true">{expanded ? t(item.label) : shortLabel(item)}</span>
            {count > 0 && <span className={`rail-badge${item.alert ? " alert" : ""}`} aria-hidden="true">{badgeText(count)}</span>}
          </button>;
        })}
      </div>)}
    </div>
    <div className="rail-foot">
      <button type="button" className="rail-theme" aria-label={themeLabel} {...tipHandlers(themeLabel)} onClick={switchTheme}>
        <span aria-hidden="true">{theme === "dark" ? "☀️" : "🌙"}</span>{expanded && <span className="rail-label">{theme === "dark" ? t("Light mode") : t("Dark mode")}</span>}
      </button>
    </div>
    <div className="rail-resize" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t("Menu width. Drag, or use the arrow keys.")} aria-valuemin={navMinWidth} aria-valuemax={navMaxWidth} aria-valuenow={shown}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { startX: event.clientX, startWidth: shown }; setTip(null); }}
      onPointerMove={event => { if (drag.current) resize(drag.current.startWidth + event.clientX - drag.current.startX, false); }}
      onPointerUp={event => { if (!drag.current) return; resize(drag.current.startWidth + event.clientX - drag.current.startX); drag.current = null; }}
      onPointerCancel={() => { drag.current = null; saveNavWidth(width); }}
      onDoubleClick={() => resize(expanded ? navMinWidth : navMaxWidth)}
      onKeyDown={event => { const next = keyboardNavWidth(shown, event.key); if (next === null) return; event.preventDefault(); resize(next); }} />
    {/* Drawn at the top of the page, so page content can never cover it. */}
    {tip && createPortal(<span className="rail-tip" role="tooltip" style={{ top: tip.top, left: tip.left }}>{tip.text}</span>, document.body)}
  </nav>;
}
