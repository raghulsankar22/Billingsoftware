let pending = false;

async function chooseBackupFolderForSender({ event, args, window, origin, dialog }) {
  if (args.length || !window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Folder chooser is available only in the billing window.');
  let source;
  try { source = new URL(event.senderFrame.url); } catch { throw new Error('Invalid billing sender.'); }
  if (source.protocol !== 'http:' || source.origin !== origin || source.username || source.password) throw new Error('Invalid billing sender.');
  if (pending) throw new Error('A folder chooser is already open.');
  pending = true;
  try {
    const result = await dialog.showOpenDialog(window, { title: 'Choose billing backup folder', properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] });
    return result.canceled ? null : result.filePaths[0] || null;
  } finally { pending = false; }
}

module.exports = { chooseBackupFolderForSender };
