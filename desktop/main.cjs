const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('node:path');
const { resolveDataDirectory } = require('./data-location.cjs');
const { ensureBillingServer } = require('./server.cjs');
const { isAppUrl } = require('./security.cjs');
const { createUpdateAction } = require('./updates.cjs');
const { chooseBackupFolderForSender } = require('./backup-folder.cjs');

let window;
let server;
let quitting = false;
const testing = !app.isPackaged && process.env.BILLING_DESKTOP_TEST === '1';
let dataDirectory;
let dataLocationError;
if (testing && process.env.BILLING_DESKTOP_TEST_DATA) dataDirectory = path.resolve(process.env.BILLING_DESKTOP_TEST_DATA);
else {
  try {
    dataDirectory = resolveDataDirectory({
      settingsFile: path.join(app.getPath('userData'), 'data-location.json'),
      legacyDirectory: 'D:\\app\\data',
      defaultDirectory: path.join(app.getPath('userData'), 'data'),
    });
  } catch (error) { dataLocationError = error; }
}
const port = testing ? Number(process.env.BILLING_DESKTOP_TEST_PORT || 3111) : 3100;
if (testing) app.setPath('userData', path.join(dataDirectory, 'desktop-profile'));

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    if (dataLocationError) throw dataLocationError;
    server = await ensureBillingServer({
      runtimeDirectory: app.isPackaged ? path.join(process.resourcesPath, 'billing-runtime') : path.resolve(__dirname, '..', '.desktop-runtime'),
      dataDirectory, port,
      onUnexpectedExit: error => { if (!quitting) { dialog.showErrorBox('Billing server stopped', `${error.message}\n\nClose and reopen Finance Billing. Your saved bills are in ${dataDirectory}.`); app.quit(); } },
    });
    window = new BrowserWindow({
      title: 'Finance Billing', width: 1320, height: 900, minWidth: 760, minHeight: 580, show: false,
      backgroundColor: '#0b1420', icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, safeDialogs: true, devTools: !app.isPackaged },
    });
    const contents = window.webContents;
    ipcMain.handle('billing:choose-backup-folder', (event, ...args) => chooseBackupFolderForSender({ event, args, window, origin: server.origin, dialog }));
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => { if (!isAppUrl(url, server.origin)) event.preventDefault(); });
    contents.on('will-redirect', (event, url) => { if (!isAppUrl(url, server.origin)) event.preventDefault(); });
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.session.setPermissionCheckHandler(() => false);
    contents.session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      callback({ cancel: !isAppUrl(details.url, server.origin) && !details.url.startsWith('data:') });
    });
    contents.session.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({ title: 'Save billing document', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
    });
    // The page has no Electron access, so the menu tells it which page to open; the page checks the user may see it.
    const openPage = page => () => contents.executeJavaScript(`window.dispatchEvent(new CustomEvent('billing-file-menu', { detail: ${JSON.stringify(page)} }))`);
    const selectLanguage = language => () => contents.executeJavaScript(`window.localStorage.setItem('finance-billing-language-v2', ${JSON.stringify(language)}); window.dispatchEvent(new CustomEvent('billing-language-change', { detail: ${JSON.stringify(language)} }))`);
    contents.on('did-finish-load', async () => {
      try {
        const saved = await contents.executeJavaScript("window.localStorage.getItem('finance-billing-language-v2')");
        const language = saved === 'ta' ? 'ta' : 'en';
        const menu = Menu.getApplicationMenu();
        for (const code of ['en', 'ta']) {
          const item = menu?.getMenuItemById('language-' + code);
          if (item) item.checked = code === language;
        }
      } catch {}
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [
        { label: 'Import old bills', click: openPage('import') },
        { label: 'My account', click: openPage('my-account') },
        { label: 'Users', click: openPage('users') },
        { label: 'Business profile', click: openPage('settings') },
        { type: 'separator' },
        { label: 'Print current bill', accelerator: 'CmdOrCtrl+P', click: () => contents.print({ printBackground: true }) },
        { label: 'Open billing data folder', click: () => shell.openPath(dataDirectory) },
        { type: 'separator' }, { role: 'quit' },
      ] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ label: 'Languages', submenu: [{ id: 'language-en', label: 'English', type: 'radio', checked: true, click: selectLanguage('en') }, { id: 'language-ta', label: 'Tamil (தமிழ்)', type: 'radio', click: selectLanguage('ta') }] }, { type: 'separator' }, { role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { label: 'Help', submenu: [
        { label: 'Check for updates…', click: createUpdateAction({ app, dialog, getWindow: () => window, dataDirectory }) },
        { type: 'separator' },
        { label: 'About Finance Billing', click: () => dialog.showMessageBox(window, { title: 'Finance Billing', message: `Finance Billing ${app.getVersion()}`, detail: `Offline billing with separate business accounts.\n\nBills, PDFs and Excel registers are saved in:\n${dataDirectory}\n\nBack up this folder regularly after closing billing. Internet is not required.` }) },
      ] },
    ]));
    await window.loadURL(server.origin);
    window.show();
    window.on('closed', () => { window = null; });
  }).catch(error => { dialog.showErrorBox('Unable to open Finance Billing', dataDirectory ? `${error.message}\n\nYour data remains in ${dataDirectory}.` : error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { quitting = true; server?.stop(); });
}
