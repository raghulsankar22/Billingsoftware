const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const hasBillingData = directory => ['billing.sqlite', 'users.sqlite'].some(name => existsSync(path.join(directory, name)));

/**
 * Remember where the ledger lives so a drive appearing or disappearing can never
 * switch the app to a different, empty ledger. Existing data is found once; after
 * that the saved folder is the only one used, and a missing folder stops the app.
 */
function resolveDataDirectory({ settingsFile, legacyDirectory, defaultDirectory }) {
  if (existsSync(settingsFile)) {
    let saved;
    try { saved = JSON.parse(readFileSync(settingsFile, 'utf8')).dataDirectory; } catch { saved = null; }
    if (typeof saved !== 'string' || !path.isAbsolute(saved)) throw new Error(`The saved billing data location could not be read (${settingsFile}). Your bills have not been changed.`);
    if (!existsSync(saved)) throw new Error(`The billing data folder ${saved} was not found. If it is on a removable or network drive, reconnect it and reopen Finance Billing. No new ledger was created and your bills have not been changed.`);
    return saved;
  }
  const chosen = [legacyDirectory, defaultDirectory].find(hasBillingData) ?? defaultDirectory;
  mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temporary = `${settingsFile}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ dataDirectory: chosen }, null, 2));
  renameSync(temporary, settingsFile);
  return chosen;
}

module.exports = { resolveDataDirectory };
