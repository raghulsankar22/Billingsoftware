"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { jewelleryLabel } from "@/lib/jewellery";
import { searchJewellery, tamilFromLabel } from "@/lib/jewellery-search";
import { particularsEntry } from "@/lib/particulars-entry";
import { useLanguage } from "./language-provider";

type Props = {
  value: string;
  options: readonly string[];
  ariaLabel: string;
  disabled: boolean;
  catalogueReady: boolean;
  inputRef?: (element: HTMLTextAreaElement | null) => void;
  onChange: (value: string) => void;
  onSelect: (name: string, prefix: string) => void;
  onAddNew: (typed: string) => void;
};

const addNew = "\u0001add-new";

export function ParticularsCombobox({ value, options, ariaLabel, disabled, catalogueReady, inputRef, onChange, onSelect, onAddNew }: Props) {
  const { t } = useLanguage();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const composing = useRef(false);
  const list = useRef<HTMLUListElement>(null);
  const { prefix, query } = particularsEntry(value);
  const matches = useMemo(() => searchJewellery(options, query, name => tamilFromLabel(name, jewelleryLabel(name))), [options, query]);
  const choices = [...matches, addNew];
  const highlighted = Math.min(active, choices.length - 1);
  const expanded = open && !disabled && catalogueReady;

  useEffect(() => {
    if (expanded) list.current?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlighted, expanded, query, options]);

  const choose = (choice: string) => {
    if (!choices.includes(choice)) return;
    setOpen(false);
    if (choice === addNew) onAddNew(query);
    else onSelect(choice, prefix);
  };

  return <div className="jewellery-combobox particulars-combobox">
    <textarea ref={inputRef} role="combobox" aria-label={ariaLabel} aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
      aria-activedescendant={expanded ? `${listId}-${highlighted}` : undefined} autoComplete="off" spellCheck={false}
      value={value} maxLength={180} required disabled={disabled}
      onClick={event => { setActive(0); setOpen(event.currentTarget.selectionEnd === value.length); }}
      onChange={event => { onChange(event.target.value); setActive(0); setOpen(!composing.current && event.target.selectionEnd === event.target.value.length); }}
      onCompositionStart={() => { composing.current = true; setOpen(false); }}
      onCompositionEnd={() => { composing.current = false; setActive(0); setOpen(true); }}
      onBlur={() => setOpen(false)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229 || !catalogueReady) return;
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && event.currentTarget.selectionEnd !== value.length) return;
        if (event.key === "ArrowDown") { event.preventDefault(); if (!expanded) { setActive(0); setOpen(true); } else setActive(Math.min(highlighted + 1, choices.length - 1)); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive(Math.max(highlighted - 1, 0)); }
        else if (event.key === "Enter" && expanded) { event.preventDefault(); choose(choices[highlighted]); }
        else if (event.key === "Escape" && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        else if (event.key === "Tab") setOpen(false);
      }} />
    {expanded && <ul className="jewellery-combobox-list" role="listbox" id={listId} ref={list} aria-label={ariaLabel}>
      {choices.map((choice, index) => <li key={choice} id={listId + "-" + index} data-index={index} role="option" aria-selected={index === highlighted}
        className={(index === highlighted ? "active" : "") + (choice === addNew ? " add-new" : "")}
        onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(choice)}>
        {choice === addNew ? (query && !matches.length ? t("+ Add as new jewellery:") + " " + query : t("+ Add new jewellery…")) : jewelleryLabel(choice)}
      </li>)}
      {query && !matches.length && <li className="jewellery-combobox-empty" aria-hidden="true">{t("No jewellery matches.")}</li>}
    </ul>}
  </div>;
}
