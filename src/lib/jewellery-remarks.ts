export const jewelleryRemarkOptions = ["None", "Broken", "Slightly bent", "Missing stone", "No screw"] as const;

export function selectedJewelleryRemarks(value = ""): string[] {
  const selected = value.split(/[;,\n]/).map(part => part.trim()).filter(Boolean).map(part => {
    const lower = part.toLowerCase().replace(/\s+/g, " ");
    if (lower === "no anklet screw") return "No screw";
    if (lower === "no stone") return "Missing stone";
    return jewelleryRemarkOptions.find(option => option.toLowerCase() === lower) ?? part;
  });
  const unique = [...new Set(selected)];
  return unique.length > 1 ? unique.filter(option => option !== "None") : unique;
}

export function toggleJewelleryRemark(value: string | undefined, option: string, checked: boolean): string {
  if (option === "None" && checked) return "None";
  const remaining = selectedJewelleryRemarks(value).filter(existing => existing !== option && existing !== "None");
  if (checked) remaining.push(option);
  return remaining.join("; ");
}
