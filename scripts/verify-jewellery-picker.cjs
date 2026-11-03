const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

async function runChecks() {
  let checks = 0;
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks++; };
  const settle = () => new Promise(resolve => setTimeout(resolve, 35));
  const input = () => document.querySelector('[role="combobox"]');
  const quantity = () => document.querySelector('.jewellery-entry-controls input[type="number"]');
  const add = () => document.querySelector('.jewellery-entry-controls > button');
  const particulars = () => document.querySelector('.jewellery-picker textarea');
  const fill = async (element, value) => {
    element.focus();
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };
  const press = async (key, options = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    input().dispatchEvent(event);
    await settle();
    return event;
  };
  const pick = async name => {
    await fill(input(), name);
    const choice = [...document.querySelectorAll('[role="option"]')].find(element => element.textContent.startsWith(name + ' (') || element.textContent === name);
    if (!choice) throw new Error('Missing jewellery option: ' + name);
    choice.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    choice.click();
    await settle();
  };
  for (let attempt = 0; attempt < 100 && (!input() || input().disabled); attempt++) await settle();
  assert(input() && !input().disabled, 'Catalogue loads');
  assert(quantity().value === '', 'Quantity starts blank');
  assert([...document.querySelectorAll('th')].some(element => element.textContent === 'Total grams'), 'Entry heading is Total grams');
  add().click(); await settle();
  assert(document.body.textContent.includes('Select jewellery to add.'), 'An item must be selected');
  await pick('Ring');
  assert(input().value.startsWith('Ring ('), 'Click explicitly selects the catalogue item');
  add().click(); await settle();
  assert(document.body.textContent.includes('Enter the quantity.'), 'Empty quantity has a clear error');
  assert(input().value.startsWith('Ring (') && particulars().value === '', 'Rejected empty Add keeps the selected item and particulars');
  for (const invalid of ['0', '-1', '1.5', '10000']) {
    await fill(quantity(), invalid); add().click(); await settle();
    assert(document.querySelector('.jewellery-picker [role="alert"]') && particulars().value === '', 'Invalid quantity is rejected: ' + invalid);
    assert(input().value.startsWith('Ring (') && quantity().value === invalid, 'Rejected Add preserves the item and quantity: ' + invalid);
  }
  await fill(quantity(), '3'); add().click(); await settle();
  assert(particulars().value === 'Ring 3', 'Adds three rings');
  assert(quantity().value === '' && input().value === '', 'Successful Add clears item and quantity');
  await pick('Studs'); await fill(quantity(), '2'); add().click(); await settle();
  assert(particulars().value === 'Ring 3, Studs 2', 'Adds multiple items to the same particulars');
  assert(quantity().value === '', 'Quantity clears after every successful Add');
  await fill(input(), 'hrm');
  assert(document.querySelector('[role="option"]').textContent.startsWith('Haram'), 'Ordered-letter search finds Haram');
  const enter = await press('Enter');
  assert(enter.defaultPrevented && input().value.startsWith('Haram ('), 'Enter selects without submitting the bill');
  await fill(quantity(), '4');
  await fill(input(), 'No Such Jewellery');
  quantity().focus(); add().click(); await settle();
  assert(input().value === 'No Such Jewellery', 'Rejected Add retains a typed query');
  assert(particulars().value === 'Ring 3, Studs 2' && document.body.textContent.includes('Select jewellery to add.'), 'Unconfirmed typing cannot add a stale selection');
  await press('Escape');
  assert(input().value.startsWith('Haram ('), 'Escape restores the last explicit selection');
  await fill(input(), 'New Pendant'); await press('End'); await press('Enter');
  assert(document.querySelector('#new-jewellery-0')?.value === 'New Pendant', 'No-match Add new preserves the typed name');
  [...document.querySelectorAll('.jewellery-add button')].find(element => element.textContent === 'Cancel').click(); await settle();
  assert(quantity().value === '4', 'Cancelling a new catalogue entry keeps the quantity');
  await fill(input(), 'மோதிரம்');
  assert(document.querySelector('[role="option"]').textContent.startsWith('Ring ('), 'Tamil search finds an English catalogue record');
  const composing = await press('Enter', { isComposing: true });
  assert(composing.defaultPrevented && input().value === 'மோதிரம்', 'Composition Enter neither selects nor submits');
  await press('ArrowDown'); await press('ArrowUp');
  const activeId = input().getAttribute('aria-activedescendant');
  assert(activeId && document.getElementById(activeId)?.getAttribute('role') === 'option', 'Keyboard focus points to a real option');
  await press('Escape'); await pick('Ring');
  await fill(particulars(), 'X'.repeat(178)); await fill(quantity(), '2'); add().click(); await settle();
  assert(particulars().value.length === 178 && quantity().value === '2' && input().value.startsWith('Ring ('), 'A length error preserves particulars, item and quantity');
  const quantityBox = quantity().getBoundingClientRect();
  const addBox = add().getBoundingClientRect();
  assert(quantityBox.left > input().getBoundingClientRect().left && Math.abs(addBox.left - quantityBox.left) < 2 && addBox.top >= quantityBox.bottom, 'Quantity sits beside the name and Add sits below quantity');
  const remarks = document.querySelector('.jewellery-remarks');
  const choices = [...remarks.querySelectorAll('label')];
  assert(getComputedStyle(remarks).display === 'flex' && getComputedStyle(remarks).flexWrap === 'wrap', 'Remarks wrap horizontally');
  assert(choices[0].getBoundingClientRect().top === choices[1].getBoundingClientRect().top, 'First two remarks appear side by side');
  const none = choices.find(element => element.textContent === 'None').querySelector('input');
  const broken = choices.find(element => element.textContent === 'Broken').querySelector('input');
  broken.click(); await settle(); none.click(); await settle();
  assert(none.checked && !broken.checked, 'None keeps the existing mutually exclusive remark behavior');
  document.documentElement.dataset.theme = 'light';
  assert(getComputedStyle(input()).backgroundColor === 'rgb(255, 255, 255)', 'The search field supports light mode');
  window.dispatchEvent(new CustomEvent('billing-language-change', { detail: 'ta' })); await settle();
  assert(document.querySelector('th:nth-child(4)').textContent === 'மொத்த கிராம்', 'Total grams has a Tamil label');
  return { checks, particulars: 'Test form only; no bills or catalogue records were saved.' };
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
