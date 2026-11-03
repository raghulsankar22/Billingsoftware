"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { jewelleryLabel } from "@/lib/jewellery";
import { searchJewellery, tamilFromLabel } from "@/lib/jewellery-search";
import { useLanguage } from "./language-provider";

type Props = {
  value: string;
  query: string | null;
  options: readonly string[];
  ariaLabel: string;
  disabled: boolean;
  inputRef?: (element: HTMLInputElement | null) => void;
  onSelect: (name: string) => void;
  onQueryChange: (query: string | null) => void;
  onAddNew: (typed: string) => void;
};

const addNew = "\u0001add-new";

export function JewelleryCombobox({ value, query, options, ariaLabel, disabled, inputRef, onSelect, onQueryChange, onAddNew }: Props) {
  const { t } = useLanguage();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const matches = useMemo(() => searchJewellery(options, query ?? "", name => tamilFromLabel(name, jewelleryLabel(name))), [options, query]);
  const typed = (query ?? "").trim();
  const choices = [...matches, addNew];
  const highlighted = Math.min(active, choices.length - 1);
  const shown = query ?? (value ? jewelleryLabel(value) : "");

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open, query, options]);

  const close = () => { setOpen(false); onQueryChange(null); };
  const choose = (choice: string) => {
    if (!choices.includes(choice)) return;
    if (choice === addNew) { const text = typed; close(); onAddNew(text); return; }
    onSelect(choice); close();
  };

  return <div className="jewellery-combobox">
    <input ref={inputRef} type="text" role="combobox" aria-label={ariaLabel} aria-autocomplete="list" aria-expanded={open && !disabled} aria-controls={listId}
      aria-activedescendant={open && !disabled ? `${listId}-${highlighted}` : undefined} autoComplete="off" spellCheck={false}
      placeholder={t("Type to search jewellery")} value={shown} disabled={disabled}
      onFocus={event => event.currentTarget.select()}
      onClick={() => { setActive(0); setOpen(true); }}
      onChange={event => { onQueryChange(event.target.value); setActive(0); setOpen(true); }}
      onBlur={() => setOpen(false)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === "Enter") event.preventDefault(); return; }
        if (event.key === "ArrowDown") { event.preventDefault(); if (!open) { setActive(0); setOpen(true); } else setActive(Math.min(highlighted + 1, choices.length - 1)); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive(Math.max(highlighted - 1, 0)); }
        else if (event.key === "Home" && open) { event.preventDefault(); setActive(0); }
        else if (event.key === "End" && open) { event.preventDefault(); setActive(choices.length - 1); }
        else if (event.key === "Enter") { event.preventDefault(); if (open) choose(choices[highlighted]); else { setActive(0); setOpen(true); } }
        else if (event.key === "Escape" && (open || query !== null)) { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === "Tab") close();
      }} />
    {open && !disabled && <ul className="jewellery-combobox-list" role="listbox" id={listId} ref={list} aria-label={ariaLabel}>
      {choices.map((choice, index) => <li key={choice} id={`${listId}-${index}`} data-index={index} role="option" aria-selected={index === highlighted}
        className={`${index === highlighted ? "active" : ""}${choice === addNew ? " add-new" : ""}${choice === value ? " chosen" : ""}`}
        onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(choice)}>
        {choice === addNew ? (typed && !matches.length ? `${t("+ Add as new jewellery:")} ${typed}` : t("+ Add new jewellery…")) : jewelleryLabel(choice)}
      </li>)}
      {typed && !matches.length && <li className="jewellery-combobox-empty" aria-hidden="true">{t("No jewellery matches.")}</li>}
    </ul>}
  </div>;
}
