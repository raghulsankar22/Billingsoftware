"use client";

import { jewelleryRemarkOptions, selectedJewelleryRemarks, toggleJewelleryRemark } from "@/lib/jewellery-remarks";

export function JewelleryRemarks({ index, value, disabled, onChange }: { index: number; value: string | undefined; disabled: boolean; onChange: (value: string) => void }) {
  const selected = selectedJewelleryRemarks(value);
  // Retain older written notes as checked choices so editing cannot silently lose them.
  const savedOptions = selected.filter(option => !jewelleryRemarkOptions.some(known => known === option));
  return <fieldset className="jewellery-remarks" disabled={disabled}>
    <legend className="sr-only">Remarks for item {index + 1}</legend>
    {[...jewelleryRemarkOptions, ...savedOptions].map(option => <label key={option}>
      <input type="checkbox" checked={selected.includes(option)} onChange={event => onChange(toggleJewelleryRemark(value, option, event.target.checked))} />
      <span>{option}</span>
    </label>)}
  </fieldset>;
}
