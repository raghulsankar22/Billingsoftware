const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:3110';
const sample = path.join(root, 'tmp', 'cashbook-website-demo');

async function runChecks(fixture) {
  let checks = 0;
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks++; };
  const wait = async (predicate, message) => { const start = Date.now(); while (!predicate()) { if (Date.now() - start > 30000) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 100)); } };
  const settle = () => new Promise(resolve => setTimeout(resolve, 120));
  const field = (form, text) => [...form.querySelectorAll('label')].find(label => label.textContent.startsWith(text))?.querySelector('input,select,textarea');
  const fill = async (element, value) => {
    assert(Boolean(element), 'Field exists');
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await settle();
  };
  const report = async (all = false) => { const response = await fetch('/api/cashbook?account=1&date=' + fixture.today + (all ? '&all=1' : '')); if (!response.ok) throw new Error('Cannot read fixture report'); return response.json(); };
  const journalCount = () => document.querySelectorAll('.cashbook-journal-table tbody tr').length;
  const successfulSubmit = async (form, predicate) => { form.requestSubmit(); await wait(predicate, 'Submission did not succeed: ' + document.querySelector('.cashbook')?.textContent); await wait(() => document.querySelector('.cashbook').getAttribute('aria-busy') === 'false', 'Submission stayed busy'); };
  await wait(() => document.querySelector('[aria-label="Payments / Daily Closing"]'), 'Payments navigation missing');
  document.querySelector('[aria-label="Payments / Daily Closing"]').click();
  await wait(() => document.querySelector('.cashbook-opening'), 'Opening setup missing');
  assert(document.querySelector('.demo-indicator')?.textContent.includes('Sample data only'), 'Verified sample banner is visible');
  assert(document.documentElement.lang === 'en', 'English remains default');
  const opening = document.querySelector('.cashbook-opening');
  await fill(field(opening, 'Opening cash'), '10000');
  await successfulSubmit(opening, () => Boolean(document.querySelector('.cashbook-workspace')));
  assert((await report()).accounts[0].expectedCash === 10000, 'Explicit opening is saved');
  let form = document.querySelector('.cashbook-form:not(.cashbook-closing)');
  await fill(field(form, 'Entry type'), 'expense'); await fill(field(form, 'Amount'), '100');
  form.requestSubmit(); await wait(() => document.querySelector('.cashbook-error')?.textContent.includes('Describe'), 'Missing-note refusal not shown');
  assert(field(form, 'Amount').value === '100', 'Rejected draft is retained');
  await fill(field(form, 'Note'), 'UI sample expense');
  form.querySelector('[type="submit"]').click(); form.querySelector('[type="submit"]').click();
  await wait(() => journalCount() === 1, 'Expense not saved');
  assert((await report()).accounts[0].entries.length === 1, 'Fast double submit does not duplicate a payment');
  await fill(field(form, 'Entry type'), 'disbursement'); await fill(field(form, 'Bill / customer'), fixture.payoutId);
  await fill(field(form, 'Note'), 'UI sample payout');
  await successfulSubmit(form, () => journalCount() === 2);
  assert((await report()).accounts[0].totals.loansPaid === 1000, 'UI loan payout uses the API allocation contract');
  await fill(field(form, 'Entry type'), 'collection'); await fill(field(form, 'Bill / customer'), fixture.deliveredId); await fill(field(form, 'Payment method'), 'upi');
  await successfulSubmit(form, () => journalCount() === 3);
  let day = (await report()).accounts[0];
  assert(day.expectedCash === 8900 && day.totals.upiIn === 1000 && day.totals.interestReceived === 0, 'UPI collection is separate from physical cash');
  await fill(field(form, 'Entry type'), 'expense'); await fill(field(form, 'Payment method'), 'cash'); await fill(field(form, 'Amount'), '30'); await fill(field(form, 'Note'), 'Lost confirmation test');
  const originalFetch = window.fetch.bind(window); let failOnce = true;
  window.fetch = async (input, init) => { const response = await originalFetch(input, init); if (failOnce && String(input).startsWith('/api/cashbook') && init?.method === 'POST') { failOnce = false; throw new Error('Simulated lost confirmation'); } return response; };
  form.requestSubmit(); await wait(() => document.querySelector('.cashbook-error')?.textContent.includes('Simulated lost confirmation'), 'Simulated failure not shown');
  assert(field(form, 'Amount').value === '30' && (await report()).accounts[0].entries.length === 4, 'Lost confirmation retains draft after exactly one server write');
  await successfulSubmit(form, () => journalCount() === 4 && field(form, 'Amount').value === ''); window.fetch = originalFetch;
  assert((await report()).accounts[0].entries.length === 4, 'Retry reuses the operation UUID without a duplicate');
  const combined = [...document.querySelectorAll('.cashbook-controls label')].find(label => label.textContent.includes('Combined accounts')).querySelector('input'); combined.click();
  await wait(() => document.querySelectorAll('.cashbook-account').length === 2, 'Combined report missing');
  assert(!document.querySelector('.cashbook form') && (await report(true)).combined.expectedCash === null, 'Combined view is read-only and unknown cash is not treated as zero');
  [...document.querySelectorAll('.cashbook-controls label')].find(label => label.textContent.includes('Combined accounts')).querySelector('input').click();
  await wait(() => document.querySelector('.cashbook-closing'), 'Closing form missing');
  let closing = document.querySelector('.cashbook-closing'); await fill(field(closing, 'Counted cash'), '8870');
  assert(!closing.checkValidity(), 'Unrecorded payout must be acknowledged'); closing.querySelector('[type="checkbox"]').click(); await settle();
  const external = await originalFetch('/api/cashbook?account=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'entry', operationId: crypto.randomUUID(), date: fixture.today, kind: 'cash_in', method: 'cash', amount: 10, note: 'Other window update' }) }); assert(external.ok, 'Concurrent sample write succeeded');
  closing.requestSubmit(); await wait(() => document.querySelector('.cashbook-error')?.textContent.includes('cash book changed'), 'Stale closing was not refused');
  assert(field(closing, 'Counted cash').value === '8870' && closing.querySelector('[type="submit"]').matches(':disabled'), 'Stale closing retains values and requires refresh');
  [...document.querySelectorAll('.cashbook-controls button')].find(button => button.textContent === 'Refresh').click(); await wait(() => document.querySelector('.cashbook').getAttribute('aria-busy') === 'false' && !document.querySelector('.cashbook-warning')?.textContent.includes('Refresh before'), 'Refresh failed');
  closing = document.querySelector('.cashbook-closing'); await fill(field(closing, 'Counted cash'), '8880');
  assert(!closing.querySelector('[type="checkbox"]').checked, 'Refresh requires a new acknowledgement for the current revision'); closing.querySelector('[type="checkbox"]').click(); await settle();
  await successfulSubmit(closing, () => !document.querySelector('.cashbook-workspace'));
  day = (await report()).accounts[0]; assert(day.closed && day.countedCash === 8880 && day.difference === 0, 'Closing stores counted cash and locks the date');
  document.querySelector('.cashbook-journal-table button').click(); await wait(() => document.querySelector('.cashbook-reversal') && !document.querySelector('.cashbook-reversal [role="status"]'), 'Reversal form missing');
  const reversal = document.querySelector('.cashbook-reversal');
  assert(reversal.querySelector('[type="submit"]').disabled && reversal.textContent.includes('Choose an open date'), 'A closed-date reversal cannot be posted');
  [...reversal.querySelectorAll('button')].find(button => button.textContent === 'Cancel reversal').click();
  return checks;
}

async function main() {
  if (!process.versions.electron) {
    if (fs.realpathSync(sample) !== sample || fs.readFileSync(path.join(sample, '.cashbook-demo'), 'utf8') !== 'synthetic-cashbook-preview-v1') throw new Error('Unverified sample folder');
    const health = await (await fetch(origin + '/api/health')).json();
    if (health.demo !== true || path.resolve(health.dataDirectory ?? '') !== sample) throw new Error('Refusing a non-sample server');
    const temporaryRoot = path.resolve(os.tmpdir()); const directory = fs.mkdtempSync(path.join(temporaryRoot, 'billing-cash-ui-'));
    if (path.dirname(path.resolve(directory)) !== temporaryRoot || !path.basename(directory).startsWith('billing-cash-ui-')) throw new Error('Unsafe temporary directory');
    try {
      const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
      const child = spawnSync(require('electron'), [__filename, directory], { cwd: root, windowsHide: true, env: environment, stdio: 'inherit', timeout: 180000 });
      if (child.error) throw child.error; process.exitCode = child.status ?? 1;
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    return;
  }
  const { app, BrowserWindow, session } = require('electron'); app.setPath('userData', path.join(process.argv[2], 'profile')); await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(origin + '/') && !details.url.startsWith('ws://127.0.0.1:3110/') && !details.url.startsWith('devtools:') && !details.url.startsWith('data:') }));
  const auth = JSON.parse(fs.readFileSync(path.join(sample, '.demo-login.json'), 'utf8'));
  const request = async (route, method = 'GET', body, cookie) => {
    const response = await fetch(origin + route, { method, headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json(); if (!response.ok) throw new Error(route + ': ' + (value.error || response.status)); return { value, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const admin = await request('/api/local-auth', 'POST', { action: 'login', ...auth });
  const username = 'ui-' + Date.now(); const password = 'Sample-' + randomBytes(8).toString('hex');
  await request('/api/local-auth', 'POST', { action: 'create', username, password }, admin.cookie);
  const login = await request('/api/local-auth', 'POST', { action: 'login', username, password });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const cookie = login.cookie;
  for (const account of [1, 2]) await request('/api/profile?account=' + account, 'POST', { businessName: 'UI SAMPLE ' + account, address: '123 Sample Street', phone: '1234567890', nextBillNumber: 1 }, cookie);
  const billInput = index => ({ billDate: today, customerName: 'UI Sample ' + index, fatherName: 'Sample Parent', address: '123 Sample Street', phone: '', items: [{ metal: 'Gold', particulars: 'Ring', grams: 2, assessedValue: 2000, loanAmount: 1000 }] });
  const bills = [];
  for (const index of [1, 2, 3]) bills.push((await request('/api/bills?account=1', 'POST', billInput(index), cookie)).value.bill);
  await request('/api/bills/' + bills[1].id + '/delivery?account=1', 'PATCH', { deliveryDate: today, billReceiptStatus: 'has_bill', collectedByRelation: 'self' }, cookie);
  const window = new BrowserWindow({ show: false, width: 1440, height: 1100, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  try {
    await session.defaultSession.cookies.set({ url: origin, name: 'billing_session', value: cookie.split('=')[1], httpOnly: true, sameSite: 'strict' });
    await window.loadURL(origin + '/');
    const checks = await window.webContents.executeJavaScript('(' + runChecks.toString() + ')(' + JSON.stringify({ today, payoutId: bills[0].id, deliveredId: bills[1].id }) + ')');
    fs.writeFileSync(path.join(sample, 'cashbook-ui-check.png'), (await window.webContents.capturePage()).toPNG());
    await session.defaultSession.cookies.set({ url: origin, name: 'billing_session', value: admin.cookie.split('=')[1], httpOnly: true, sameSite: 'strict' });
    await window.loadURL(origin + '/');
    await window.webContents.executeJavaScript('(async () => { const start=Date.now(); while(document.querySelector(".topbar h1")?.textContent!=="SAMPLE Finance 1" || !document.querySelector(\'[aria-label="Payments / Daily Closing"]\')) { if(Date.now()-start>30000) throw Error("Demo navigation unavailable"); await new Promise(resolve=>setTimeout(resolve,100)); } document.querySelector(\'[aria-label="Payments / Daily Closing"]\').click(); while(!document.querySelector(".cashbook-workspace")) { if(Date.now()-start>30000) throw Error("Demo form unavailable"); await new Promise(resolve=>setTimeout(resolve,100)); } window.scrollTo(0,0); })()');
    await window.webContents.executeJavaScript('(async()=>{await new Promise(resolve=>setTimeout(resolve,250)); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);})()');
    fs.writeFileSync(path.join(sample, 'cashbook-demo-dark.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript('(async()=>{document.querySelector(".cashbook-workspace").scrollIntoView(); await new Promise(resolve=>setTimeout(resolve,200));})()');
    fs.writeFileSync(path.join(sample, 'cashbook-demo-forms.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript('window.scrollTo(0,0)');
    await window.webContents.executeJavaScript('document.querySelector(\'[aria-label="Switch to light mode"]\').click()');
    await window.webContents.executeJavaScript('(async()=>{await new Promise(resolve=>setTimeout(resolve,200));})()');
    fs.writeFileSync(path.join(sample, 'cashbook-demo-light.png'), (await window.webContents.capturePage()).toPNG());
    window.setSize(600, 1000);
    await window.webContents.executeJavaScript('(async()=>{ await new Promise(resolve=>setTimeout(resolve,200)); if(document.documentElement.scrollWidth>window.innerWidth+1) throw Error("Cashbook overflows the narrow viewport"); })()');
    fs.writeFileSync(path.join(sample, 'cashbook-demo-narrow.png'), (await window.webContents.capturePage()).toPNG());
    console.log('Cash-book website: ' + checks + ' checks passed. Synthetic user only; external requests blocked.');
  } finally {
    if (!window.isDestroyed()) fs.writeFileSync(path.join(sample, 'cashbook-last-screen.png'), (await window.webContents.capturePage()).toPNG());
    window.destroy(); app.quit();
  }
}
main().catch(error => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
