# Windows desktop app

Run the Finance Billing shortcut or install `release/Finance-Billing-Setup-1.0.0.exe`.
The app opens its own window and starts its loopback-only billing server automatically.
No internet, separate Node installation, Microsoft 365 login or web hosting is needed for daily use.

On this computer all three accounts continue to use `D:\app\data`. Customer records are
not copied into the installer. Updates and uninstalling the desktop program do not delete
this data directory. On computers without a D: drive, the app uses a data directory inside
the Windows user's Finance Billing application-data directory; see File > Open billing data folder.

Close billing before backing up the entire data directory to another drive. Keep both the
database and its PDF/Excel subfolders. An offline app does not provide a cloud backup.

The app reuses a compatible billing server already running on port 3100, but refuses to
attach to another program or a server using a different data directory. Closing the app
stops only a server that the app itself started. Program files contain no `.env` credentials
or real customer records. The app blocks external navigation, web requests and permissions;
the page has no access to Electron or Node APIs. Printing uses the Windows print dialog,
and PDF/Excel downloads use a Save dialog.

## Rebuild

1. Install project dependencies and the Electron runtime.
2. Run `pnpm desktop:prepare` to build and stage the offline server, its hoisted production dependencies, and the bundled Node runtime (no Windows symlink permissions required).
3. Run `node scripts/verify-desktop.mjs` for isolated local billing integration checks.
4. Run `pnpm desktop:start` to test the desktop window.
5. Run `pnpm desktop:package` to create the per-user Windows installer and unpacked app.

The installer is not digitally signed. Distribution with a verified publisher identity
requires a separate Windows code-signing certificate. No online updater is configured.
