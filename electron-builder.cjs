module.exports = {
  appId: 'in.financebilling.desktop', productName: 'Finance Billing',
  directories: { app: '.', output: `../release/${require('./desktop/package.json').version}`, buildResources: 'assets' },
  electronVersion: '45.1.0', npmRebuild: false,
  files: ['main.cjs', 'server.cjs', 'security.cjs', 'updates.cjs', 'install-update.ps1', 'package.json', 'assets/icon.png'],
  extraResources: [{ from: '../.desktop-runtime', to: 'billing-runtime', filter: ['**/*', '!**/.env*'] }],
  asar: true,
  artifactName: 'Finance-Billing-Setup-${version}.${ext}',
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'assets/icon.png', executableName: 'Finance Billing', requestedExecutionLevel: 'asInvoker' },
  nsis: { oneClick: true, perMachine: false, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'Finance Billing', deleteAppDataOnUninstall: false, runAfterFinish: false },
  publish: null,
};
