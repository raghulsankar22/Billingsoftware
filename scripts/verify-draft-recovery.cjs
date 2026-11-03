const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

async function runChecks(phase) {
  let checks = 0;
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks++; };
  const settle = () => new Promise(resolve => setTimeout(resolve, 400));
  const harness = window.draftHarness;
  const key = 'finance-billing-draft:v1:test-owner:1';
  const button = name => [...document.querySelectorAll('button')].find(element => element.textContent === name);
  const field = name => { const label = [...document.querySelectorAll('label')].find(element => element.textContent === name); return document.getElementById(label?.htmlFor) || label?.querySelector('input,textarea'); };
  const fill = async (element, value) => {
    assert(Boolean(element), 'Field exists');
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    await settle();
  };
  const draft = () => JSON.parse(localStorage.getItem(key));
  const remount = async (user, account) => { harness.mount(user, account); await settle(); };
  await settle();
  if (phase === 'lost-response' || phase === 'retry-reload') {
    if (phase === 'retry-reload') {
      assert(button('Resume draft') && !button('Discard draft'), 'An unresolved saved request cannot be silently discarded');
      assert(document.body.textContent.includes('A save was attempted'), 'Recovery does not falsely claim no bill was issued');
      button('Resume draft').click(); await settle();
      const id = sessionStorage.getItem('fixture-last-operation');
      assert(draft().submission.id === id && field('Customer name').matches(':disabled'), 'Recovered request keeps its original ID and locked details');
      const frozen = draft().submission.body;
      document.querySelector('form').requestSubmit(); document.querySelector('form').requestSubmit(); await settle();
      assert(harness.requests.length === 1, 'Repeated submit events produce one request');
      assert(harness.requests[0].id === id && harness.requests[0].body === frozen, 'Retry after reload sends byte-identical details and the original ID');
      assert(sessionStorage.getItem('fixture-issued-' + id) === frozen && harness.saves === 1, 'Lost response recovery returns the originally saved bill');
      assert(!localStorage.getItem(key), 'Confirmed retry clears the pending request');
      await remount();
      assert(!button('Resume draft') && !document.querySelector('fieldset').disabled, 'The next bill starts unlocked with no unresolved request');
      return checks;
    }
    localStorage.clear(); await remount();
    await fill(field('Customer name'), 'Retry Customer');
    await fill(field("Father's name / Husband's name"), 'Retry Parent');
    await fill(field('Address'), '123 Retry Street');
    await fill(document.querySelector('[role="combobox"]'), 'Ring 1');
    document.querySelector('input[type="checkbox"][value="Gold"]').click(); await settle();
    await fill(document.querySelector('[aria-label="Total grams for item 1"]'), '2');
    await fill(document.querySelector('[aria-label="Loan amount in rupees for item 1"]'), '100');
    harness.requests.length = 0; harness.loseResponse = true;
    document.querySelector('form').requestSubmit(); document.querySelector('form').requestSubmit(); await settle();
    assert(harness.requests.length === 1, 'A double submit starts only one bill save');
    const request = harness.requests[0]; sessionStorage.setItem('fixture-last-operation', request.id);
    assert(draft().submission.id === request.id && draft().submission.body === request.body, 'The exact request is durable before a response is received');
    assert(sessionStorage.getItem('fixture-issued-' + request.id) === request.body, 'Fixture simulates a committed bill with a lost response');
    assert(button('Retry save') && document.body.textContent.includes('Fixture response lost after save'), 'Unknown outcome offers Retry save instead of a new bill');
    assert(field('Customer name').matches(':disabled') && document.querySelector('[role="combobox"]').matches(':disabled'), 'Pending requests cannot be edited into a second bill');
    return checks;
  }
  if (phase === 'save') {
    localStorage.clear(); await remount();
    assert(!localStorage.getItem(key), 'An empty form creates no draft');
    await fill(field('Customer name'), 'சங்கர்');
    await fill(field("Father's name / Husband's name"), 'முத்து');
    await fill(field('Address'), 'மதுரை');
    const combo = document.querySelector('[role="combobox"]');
    await fill(combo, 'Ring');
    const option = document.querySelector('[role="option"]'); option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); option.click(); await settle();
    await fill(document.querySelector('.particulars-quantity input[type="number"]'), '3');
    await fill(combo, 'hrm');
    assert(draft().form.customerName === 'சங்கர்' && draft().form.address === 'மதுரை', 'Native text is preserved exactly');
    assert(draft().jewellery[0].quantity === '3' && draft().form.items[0].particulars === 'Hrm' && draft().jewellery[0].name === '', 'Pending typed particulars and quantity are preserved');
    assert(harness.saves === 0, 'Draft saving does not issue bills');
    return checks;
  }
  assert(button('Resume draft') && !field('Customer name'), 'Reload offers explicit resume instead of silently applying text');
  button('Resume draft').click(); await settle();
  assert(field('Customer name').value === 'சங்கர்', 'Reload resumes native text');
  assert(document.querySelector('[role="combobox"]').value === 'Hrm' && document.querySelector('.particulars-quantity input[type="number"]').value === '3', 'Reload resumes pending jewellery');
  await fill(document.querySelector('[role="combobox"]'), 'Ring 1, Ha');
  const pendingOption = document.querySelector('[role="option"]'); pendingOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); pendingOption.click(); await settle();
  assert(draft().jewellery[0].prefix === 'Ring 1' && draft().form.items[0].particulars === 'Ring 1, Haram', 'A selected suggestion persists its completion prefix');
  await remount(); button('Resume draft').click(); await settle();
  assert(document.querySelector('[role="combobox"]').value === 'Ring 1, Haram' && document.querySelector('.particulars-quantity input').value === '3', 'A pending selected name and quantity survive reload');
  document.querySelector('.particulars-quantity button').click(); await settle();
  assert(document.querySelector('[role="combobox"]').value === 'Ring 1, Haram 3', 'Resumed selection completes once without duplicate jewellery');
  await remount('other-user', 1); assert(!button('Resume draft') && field('Customer name').value === '', 'Other users do not see this draft');
  await remount('test-owner', 2); assert(!button('Resume draft') && field('Customer name').value === '', 'Other accounts do not see this draft');
  await remount(); button('Resume draft').click(); await settle();
  const foreign = draft(); foreign.form.customerName = 'Another window'; localStorage.setItem(key, JSON.stringify(foreign));
  await fill(field('Customer name'), 'My Window');
  assert(draft().form.customerName === 'Another window' && document.body.textContent.includes('will not overwrite'), 'A stale resumed window cannot overwrite a newer draft with the same ID');
  await remount(); button('Discard draft').click(); await settle(); await remount();
  assert(!localStorage.getItem(key) && !button('Resume draft'), 'Discard clears the draft without resurrecting on unmount');
  await fill(field('Customer name'), 'Sample Customer');
  await fill(field("Father's name / Husband's name"), 'Sample Parent');
  await fill(field('Address'), 'Sample Street');
  await fill(document.querySelector('.jewellery-picker textarea'), 'Ring 1');
  document.querySelector('input[type="checkbox"][value="Gold"]').click(); await settle();
  await fill(document.querySelector('[aria-label="Total grams for item 1"]'), '2');
  await fill(document.querySelector('[aria-label="Loan amount in rupees for item 1"]'), '100');
  harness.fail = true;
  document.querySelector('form').requestSubmit(); await settle();
  assert(document.body.textContent.includes('Fixture save rejected') && draft().form.customerName === 'Sample Customer', 'A server rejection retains the recoverable draft');
  harness.fail = false; document.querySelector('form').requestSubmit(); await settle();
  assert(harness.saves === 1 && !localStorage.getItem(key), 'Successful issue clears the draft before the form unmounts');
  await remount(); assert(!button('Resume draft') && !localStorage.getItem(key), 'A saved bill never resurrects as a draft');
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function() { throw new Error('Fixture storage blocked'); };
  await fill(field('Customer name'), 'Unsaved');
  assert(document.body.textContent.includes('Draft recovery is unavailable'), 'Blocked storage is visible rather than reported as saved');
  Storage.prototype.setItem = original;
  await remount(); harness.dialog(); await settle();
  assert(document.activeElement?.tagName === 'SELECT', 'Correction dialog moves keyboard focus into the dialog');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
  assert(harness.reason === 'cancelled', 'Escape safely cancels correction');
  harness.dialog(); await settle(); await fill(document.querySelector('select'), 'duplicate');
  button('Continue').click(); await settle(); assert(harness.reason === 'duplicate', 'Correction uses an in-app reason without a native prompt');
  return checks;
}

async function main() {
  if (!process.versions.electron) {
    const temporaryRoot = path.resolve(os.tmpdir());
    const directory = fs.mkdtempSync(path.join(temporaryRoot, 'billing-draft-ui-'));
    if (path.dirname(path.resolve(directory)) !== temporaryRoot || !path.basename(directory).startsWith('billing-draft-ui-')) throw new Error('Invalid cleanup directory');
    try {
      const vitePackage = require.resolve('vite/package.json', { paths: [path.dirname(require.resolve('vitest/package.json'))] });
      const { build } = createRequire(vitePackage)('esbuild');
      const result = await build({ absWorkingDir: root, entryPoints: ['scripts/draft-recovery-fixture.tsx'], bundle: true, write: false, outfile: 'fixture.js', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_BILLING_STORAGE': '"local"' } });
      fs.writeFileSync(path.join(directory, 'fixture.js'), result.outputFiles[0].contents);
      fs.writeFileSync(path.join(directory, 'fixture.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
      const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
      const child = spawnSync(require('electron'), [__filename, directory], { cwd: root, windowsHide: true, env: environment, stdio: 'inherit', timeout: 75000 });
      if (child.error) throw child.error; process.exitCode = child.status ?? 1;
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    return;
  }
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', path.join(process.argv[2], 'electron-profile'));
  await app.whenReady();
  const window = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  try {
    const file = path.join(process.argv[2], 'fixture.html');
    await window.loadFile(file);
    let checks = await window.webContents.executeJavaScript('(' + runChecks.toString() + ')("save")');
    await window.loadFile(file);
    checks += await window.webContents.executeJavaScript('(' + runChecks.toString() + ')("recover")');
    checks += await window.webContents.executeJavaScript('(' + runChecks.toString() + ')("lost-response")');
    await window.loadFile(file);
    checks += await window.webContents.executeJavaScript('(' + runChecks.toString() + ')("retry-reload")');
    console.log('Draft recovery UI: ' + checks + ' checks passed. Mocked requests only; no real billing data.');
  } finally { window.destroy(); app.quit(); }
}
main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
