const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('billingDesktop', Object.freeze({
  chooseBackupFolder: () => ipcRenderer.invoke('billing:choose-backup-folder'),
}));
