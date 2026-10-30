const { createReadStream } = require('node:fs');
const { readFile, stat, mkdir, mkdtemp, copyFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');

function versionParts(version) {
  if (typeof version !== 'string' || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(version)) throw new Error('Invalid update version.');
  return version.split('.').map(Number);
}
function isNewerVersion(candidate, current) {
  const next = versionParts(candidate), installed = versionParts(current);
  for (let index = 0; index < 3; index++) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}
async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
async function readUpdate(manifestPath, currentVersion) {
  if ((await stat(manifestPath)).size > 16384) throw new Error('Update information is too large.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  versionParts(manifest.version);
  // A release contains one installer beside its manifest, or in its version subfolder.
  const expected = `Finance-Billing-Setup-${manifest.version}.exe`;
  if (manifest.application !== 'finance-billing-desktop' || ![expected, `${manifest.version}/${expected}`].includes(manifest.file)
    || !/^[a-f0-9]{64}$/.test(manifest.sha256) || !Number.isSafeInteger(manifest.size) || manifest.size <= 0) {
    throw new Error('This is not a valid Finance Billing update.');
  }
  if (!isNewerVersion(manifest.version, currentVersion)) return null;
  const installer = path.resolve(path.dirname(manifestPath), ...manifest.file.split('/'));
  if ((await stat(installer)).size !== manifest.size || await sha256(installer) !== manifest.sha256) {
    throw new Error('The update file is incomplete or has changed. Build or copy the update again.');
  }
  return { ...manifest, installer };
}
async function stageUpdate(update, updatesDirectory) {
  await mkdir(updatesDirectory, { recursive: true });
  const directory = await mkdtemp(path.join(updatesDirectory, `${update.version}-`));
  const installer = path.join(directory, path.basename(update.installer));
  await copyFile(update.installer, installer);
  if (await sha256(installer) !== update.sha256) throw new Error('The staged update failed its integrity check.');
  return installer;
}
async function launchInstaller({ installer, sha256: hash, executable, parentPid, helper, logFile }) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
    '-Installer', installer, '-ExpectedHash', hash, '-Executable', executable, '-ParentProcessId', String(parentPid), '-LogFile', logFile],
  { detached: true, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
}
function createUpdateAction({ app, dialog, getWindow, dataDirectory, launch = launchInstaller }) {
  let busy = false;
  return async function checkForUpdates() {
    if (busy) return;
    busy = true;
    try {
      if (!app.isPackaged) {
        await dialog.showMessageBox(getWindow(), { title: 'App updates', message: 'Open the installed Finance Billing app to install updates.' });
        return;
      }
      const localManifest = path.join(path.dirname(dataDirectory), 'release', 'latest.json');
      let update;
      try { update = await readUpdate(localManifest, app.getVersion()); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!update) {
        const result = await dialog.showMessageBox(getWindow(), { title: 'App updates', message: `Finance Billing ${app.getVersion()}`,
          detail: 'No newer local update was found. After a new version is built, check again. You can also choose an update.json file copied from another computer or USB drive.',
          buttons: ['Close', 'Choose update file…'], defaultId: 0, cancelId: 0 });
        if (result.response !== 1) return;
        const selection = await dialog.showOpenDialog(getWindow(), { title: 'Choose Finance Billing update information',
          filters: [{ name: 'Update information (update.json or latest.json)', extensions: ['json'] }], properties: ['openFile'] });
        if (selection.canceled || !selection.filePaths.length) return;
        update = await readUpdate(selection.filePaths[0], app.getVersion());
        if (!update) {
          await dialog.showMessageBox(getWindow(), { title: 'App updates', message: 'This version is already installed or is older than your app.' });
          return;
        }
      }
      const confirmation = await dialog.showMessageBox(getWindow(), { type: 'question', title: 'Update Finance Billing',
        message: `Install Finance Billing ${update.version}?`, detail: 'Save any unfinished bill or profile changes first. The app will close, install the update and reopen. Your saved billing data stays in the same folder.',
        buttons: ['Not now', 'Install and restart'], defaultId: 0, cancelId: 0, noLink: true });
      if (confirmation.response !== 1) return;
      const updatesDirectory = path.join(app.getPath('userData'), 'updates');
      const installer = await stageUpdate(update, updatesDirectory);
      const helper = path.join(path.dirname(installer), 'install-update.ps1');
      await copyFile(path.join(__dirname, 'install-update.ps1'), helper);
      await launch({ installer, sha256: update.sha256, executable: process.execPath, parentPid: process.pid,
        helper, logFile: path.join(updatesDirectory, 'install.log') });
      app.quit();
    } catch (error) {
      await dialog.showMessageBox(getWindow(), { type: 'error', title: 'Unable to update Finance Billing', message: error.message,
        detail: 'Your saved billing data has not been changed. Try again after rebuilding or copying the update files.' });
    } finally { busy = false; }
  };
}
module.exports = { isNewerVersion, sha256, readUpdate, stageUpdate, createUpdateAction };
