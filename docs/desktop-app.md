# Windows desktop app

Run the Finance Billing shortcut or install `release/1.0.2/Finance-Billing-Setup-1.0.2.exe`.
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

Builds are stored under `release/<version>/`, so creating a new version never replaces
program files in an older running build. Close the installed app before running the new
installer, then reopen the Finance Billing shortcut. Version 1.0.1 adds per-account business
license numbers in profile/header/PDF and a searchable Delivery Bills receipt-history tab.
Version 1.0.2 adds one Updates tab with Daily, Weekly (Monday–Sunday), and calendar-month
activity reports. Loan summaries exclude voided loans; delivery summaries include recorded
deliveries even when the original loan is voided. Delivery totals are saved receipt balances,
not confirmations that cash was received.

The installer is not digitally signed. Distribution with a verified publisher identity
requires a separate Windows code-signing certificate. No online updater is configured.
