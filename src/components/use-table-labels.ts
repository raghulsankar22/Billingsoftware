"use client";

import { useEffect } from "react";

/**
 * On a phone the wide tables turn into stacked cards. Each cell needs its column heading, so this copies the
 * heading text onto every cell (data-label). The labels are used only by the phone-width stylesheet.
 */
export function useTableLabels() {
  useEffect(() => {
    let frame = 0;
    const apply = () => {
      document.querySelectorAll<HTMLTableElement>("table.item-table, table.history-table").forEach(table => {
        const headings = [...table.querySelectorAll("thead th")].map(cell => (cell.textContent ?? "").trim());
        table.querySelectorAll("tbody tr").forEach(row => {
          [...row.children].forEach((cell, index) => {
            if (!(cell instanceof HTMLElement) || cell.hasAttribute("colspan")) return;
            const label = headings[index];
            if (label) { if (cell.dataset.label !== label) cell.dataset.label = label; }
            else if (cell.dataset.label !== undefined) delete cell.dataset.label;
          });
        });
      });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(apply); };
    schedule();
    // Attribute changes are not observed, so setting the labels cannot trigger another pass.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
}
