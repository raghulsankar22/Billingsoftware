const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { ensureBillingServer } = require('./server.cjs');
const { isAppUrl } = require('./security.cjs');

let window;
let server;
let quitting = false;
const testing = !app.isPackaged && process.env.BILLING_DESKTOP_TEST === '1';
const dataDirectory = testing && process.env.BILLING_DESKTOP_TEST_DATA
  ? path.resolve(process.env.BILLING_DESKTOP_TEST_DATA)
  : existsSync('D:\\') ? 'D:\\app\\data' : path.join(app.getPath('userData'), 'data');
const port = testing ? Number(process.env.BILLING_DESKTOP_TEST_PORT || 3111) : 3100;
if (testing) app.setPath('userData', path.join(dataDirectory, 'desktop-profile'));

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    server = await ensureBillingServer({
      runtimeDirectory: app.isPackaged ? path.join(process.resourcesPath, 'billing-runtime') : path.resolve(__dirname, '..', '.desktop-runtime'),
      dataDirectory, port,
      onUnexpectedExit: error => { if (!quitting) { dialog.showErrorBox('Billing server stopped', `${error.message}\n\nClose and reopen Finance Billing. Your saved bills are in ${dataDirectory}.`); app.quit(); } },
    });
    window = new BrowserWindow({
      title: 'Finance Billing', width: 1320, height: 900, minWidth: 760, minHeight: 580, show: false,
      backgroundColor: '#0b1420', icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, safeDialogs: true, devTools: !app.isPackaged },
    });
    const contents = window.webContents;
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
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [
        { label: 'Print current bill', accelerator: 'CmdOrCtrl+P', click: () => contents.print({ printBackground: true }) },
        { label: 'Open billing data folder', click: () => shell.openPath(dataDirectory) },
        { type: 'separator' }, { role: 'quit' },
      ] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { label: 'Help', submenu: [{ label: 'About Finance Billing', click: () => dialog.showMessageBox(window, { title: 'Finance Billing', message: `Finance Billing ${app.getVersion()}`, detail: `Offline billing for three business accounts.\n\nBills, PDFs and Excel registers are saved in:\n${dataDirectory}\n\nBack up this folder regularly after closing billing. Internet is not required.` }) }] },
    ]));
    await window.loadURL(server.origin);
    window.show();
    window.on('closed', () => { window = null; });
  }).catch(error => { dialog.showErrorBox('Unable to open Finance Billing', `${error.message}\n\nYour data remains in ${dataDirectory}.`); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { quitting = true; server?.stop(); });
}
