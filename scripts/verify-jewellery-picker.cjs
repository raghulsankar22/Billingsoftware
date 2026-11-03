const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

async function runChecks() {
  let checks = 0;
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks++; };
  const settle = () => new Promise(resolve => setTimeout(resolve, 45));
  const input = () => document.querySelector('[role="combobox"]');
  const quantity = () => document.querySelector('.particulars-quantity input');
  const add = () => document.querySelector('.particulars-quantity button');
  const fill = async (element, value) => {
    element.focus();
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };
  const press = async (key, options = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    input().dispatchEvent(event); await settle(); return event;
  };
  const pick = async (name, prefix = '') => {
    await fill(input(), (prefix ? prefix + ', ' : '') + name);
    const choice = [...document.querySelectorAll('[role="option"]')].find(element => element.textContent.startsWith(name + ' (') || element.textContent === name);
    if (!choice) throw new Error('Missing jewellery option: ' + name);
    choice.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); choice.click(); await settle();
  };
  await settle(); await settle();
  assert(input()?.tagName === 'TEXTAREA' && document.querySelectorAll('.jewellery-picker input').length === 0, 'Particulars is the only jewellery entry field');
  assert(quantity().value === '' && quantity().disabled, 'Quantity starts blank until a suggestion is selected');
  const headings = [...document.querySelectorAll('th')].map(element => element.textContent);
  assert(headings.join('|') === 'Metal|Particulars|Qty|Remarks (optional)|Total grams|Loan amount (₹)|Assessed amount (₹)|', 'The agreed column order is exact');
  assert(!document.body.textContent.includes('Type to search jewellery'), 'The separate search control is removed');
  const gold = document.querySelector('.metal-choice input[value="Gold"]');
  const silver = document.querySelector('.metal-choice input[value="Silver"]');
  assert(gold.type === 'checkbox' && silver.type === 'checkbox', 'Gold and Silver look like the remarks checkboxes');
  assert(!gold.checkValidity(), 'A metal is required for a new item');
  gold.click(); await settle(); assert(gold.checked && !silver.checked, 'Gold selects one metal');
  silver.click(); await settle(); assert(silver.checked && !gold.checked && gold.checkValidity(), 'Silver clears Gold and satisfies the metal requirement');
  silver.click(); await settle(); assert(silver.checked && !gold.checked, 'Clicking the chosen metal cannot leave the row with no metal');
  add().click(); await settle(); assert(document.body.textContent.includes('Select jewellery to add.'), 'Add requires an explicit catalogue selection');
  await pick('Ring'); assert(input().value === 'Ring' && !quantity().disabled, 'Choosing a suggestion writes it once and enables Qty: ' + input().value);
  add().click(); await settle(); assert(document.body.textContent.includes('Enter the quantity.') && input().value === 'Ring', 'An empty quantity keeps the selected name and explains the error');
  for (const invalid of ['0', '-1', '1.5', '10000']) {
    await fill(quantity(), invalid); add().click(); await settle();
    assert(document.querySelector('.particulars-quantity [role="alert"]') && input().value === 'Ring' && quantity().value === invalid, 'Invalid quantity retains the entry: ' + invalid);
  }
  await fill(quantity(), '3'); add().click(); await settle();
  assert(input().value === 'Ring 3' && quantity().value === '' && quantity().disabled, 'Add completes the same text field and resets quantity');
  await pick('Studs', 'Ring 3'); await fill(quantity(), '2');
  quantity().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await settle();
  assert(input().value === 'Ring 3, Studs 2', 'Multiple jewellery entries and Enter in Qty retain the original serialization');
  await fill(input(), 'Ring 3, Studs 2, hrm');
  assert(document.querySelector('[role="option"]').textContent.startsWith('Haram'), 'Letters-in-order search remains available inside Particulars');
  const enter = await press('Enter');
  assert(enter.defaultPrevented && input().value === 'Ring 3, Studs 2, Haram', 'Enter chooses without submitting or duplicating the prefix');
  await fill(quantity(), '4'); await fill(input(), 'Ring 3, No Such Jewellery'); add().click(); await settle();
  assert(input().value === 'Ring 3, No Such Jewellery' && quantity().disabled, 'Typing over a selection never adds a stale name');
  await press('Escape'); assert(input().value === 'Ring 3, No Such Jewellery' && input().getAttribute('aria-expanded') === 'false', 'Escape closes suggestions without changing typed text');
  await fill(input(), 'Ring 3, New Pendant');
  [...document.querySelectorAll('[role="option"]')].find(element => element.classList.contains('add-new')).click(); await settle();
  assert(document.querySelector('#new-jewellery-0')?.value === 'New Pendant', 'No-match Add new keeps the typed name for review');
  [...document.querySelectorAll('.jewellery-add button')].find(element => element.textContent === 'Cancel').click(); await settle();
  assert(quantity().value === '4' && input().value === 'Ring 3, New Pendant', 'Cancelling Add new retains the quantity and raw particulars');
  await fill(input(), 'மோதிரம்'); assert(input().value === 'மோதிரம்', 'Typing Tamil does not translate or replace it');
  assert(document.querySelector('[role="option"]').textContent.startsWith('Ring ('), 'Tamil catalogue matching still works');
  input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); await settle();
  await press('Enter', { isComposing: true });
  assert(input().value === 'மோதிரம்' && input().getAttribute('aria-expanded') === 'false', 'IME Enter does not choose a suggestion');
  input().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); await settle();
  await press('ArrowDown'); await press('ArrowUp');
  const activeId = input().getAttribute('aria-activedescendant');
  assert(activeId && document.getElementById(activeId)?.getAttribute('role') === 'option', 'Keyboard navigation points to a real suggestion');
  await press('Tab'); assert(input().value === 'மோதிரம்' && input().getAttribute('aria-expanded') === 'false', 'Tab preserves Tamil text');
  await pick('Ring', 'X'.repeat(174)); await fill(quantity(), '2'); add().click(); await settle();
  assert(input().value.length === 180 && quantity().value === '2' && document.body.textContent.includes('180 characters'), 'Overlong completion preserves the pending selection and quantity');
  const inputBox = input().getBoundingClientRect(), quantityBox = quantity().getBoundingClientRect(), addBox = add().getBoundingClientRect();
  assert(quantityBox.left > inputBox.right && Math.abs(addBox.left - quantityBox.left) < 2 && addBox.top >= quantityBox.bottom, 'Qty is beside Particulars and Add is directly beneath it');
  const tools = document.querySelector('.jewellery-add-actions');
  assert(tools.closest('td') === input().closest('td') && tools.getBoundingClientRect().top >= inputBox.bottom, 'Add new jewellery and Manage jewellery are beneath Particulars');
  const remarks = document.querySelector('.jewellery-remarks');
  assert(getComputedStyle(remarks).display === 'flex' && getComputedStyle(remarks).flexWrap === 'wrap', 'Remarks keep their wrapping checkbox layout');
  const choices = [...remarks.querySelectorAll('label')];
  const none = choices.find(element => element.textContent === 'None').querySelector('input');
  const broken = choices.find(element => element.textContent === 'Broken').querySelector('input');
  broken.click(); await settle(); none.click(); await settle(); assert(none.checked && !broken.checked, 'None keeps its existing exclusive behavior');
  document.documentElement.dataset.theme = 'light'; assert(getComputedStyle(input()).backgroundColor === 'rgb(255, 255, 255)', 'Combined Particulars supports light mode');
  return { checks, particulars: 'Isolated form with a read-only mocked catalogue; no records were saved.' };
}

async function main() {
  if (!process.versions.electron) {
    const temporaryRoot = path.resolve(os.tmpdir());
    const directory = fs.mkdtempSync(path.join(temporaryRoot, 'billing-jewellery-ui-'));
    if (path.dirname(path.resolve(directory)) !== temporaryRoot || !path.basename(directory).startsWith('billing-jewellery-ui-')) throw new Error('Invalid test cleanup directory.');
    try {
      const vitePackage = require.resolve('vite/package.json', { paths: [path.dirname(require.resolve('vitest/package.json'))] });
      const { build } = createRequire(vitePackage)('esbuild');
      const result = await build({ absWorkingDir: root, entryPoints: ['scripts/jewellery-picker-fixture.tsx'], bundle: true, write: false, outfile: 'fixture.js', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_BILLING_STORAGE': '"local"' } });
      fs.writeFileSync(path.join(directory, 'fixture.js'), result.outputFiles[0].contents);
      fs.writeFileSync(path.join(directory, 'fixture.html'), '<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>' + fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8') + '</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      const child = spawnSync(require('electron'), [__filename, directory], { cwd: root, windowsHide: true, env: environment, stdio: 'inherit', timeout: 45000 });
      if (child.error) throw child.error;
      process.exitCode = child.status ?? 1;
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    return;
  }
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', path.join(process.argv[2], 'electron-profile'));
  await app.whenReady();
  const window = new BrowserWindow({ show: false, width: 1680, height: 1100, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  try {
    await window.loadFile(path.join(process.argv[2], 'fixture.html'));
    const result = await window.webContents.executeJavaScript('(' + runChecks.toString() + ')()');
    console.log('Jewellery picker UI: ' + result.checks + ' checks passed. ' + result.particulars);
  } finally { window.destroy(); app.quit(); }
}

main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
