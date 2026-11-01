/** Capitalises the first letter of each word and leaves every other letter as typed. */
export function capitalizeWords(value: string): string {
  return value.replace(/(^|[\s.,(/-])(\p{Ll})/gu, (_match, before: string, letter: string) => before + letter.toLocaleUpperCase("en-IN"));
}

/** React moves the cursor to the end when it changes typed text, so put it back. */
export function holdCaret() {
  const field = document.activeElement;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
  const position = field.selectionStart;
  if (position === null) return;
  requestAnimationFrame(() => { if (document.activeElement === field) field.setSelectionRange(position, position); });
}
