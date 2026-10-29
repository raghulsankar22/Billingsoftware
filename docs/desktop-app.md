# Windows desktop app

Run the Finance Billing shortcut or install `release/1.0.8/Finance-Billing-Setup-1.0.8.exe`.
The app opens its own window and starts its loopback-only billing server automatically.
No internet, separate Node installation, Microsoft 365 login or web hosting is needed for daily use.

On this computer all business accounts continue to use `D:\app\data`. Customer records are
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
activity reports. Version 1.0.3 fixes reports that hid all bills when their status was voided:
all dated loan bills are listed, with recorded, active, and voided amounts identified separately.
Delivery summaries include recorded deliveries even when the original loan is voided. Delivery totals are saved receipt balances,
not confirmations that cash was received.

Version 1.0.4 adds a Particulars jewellery dropdown to New Bill and Edit Bill. Starter
choices include Ring, Necklace and Haram. Use **+ Add new jewellery** to save a custom
name and select it for the current row. Custom choices are stored in the local SQLite
database and shared across all three accounts. Existing bill particulars are preserved.

Version 1.0.5 supports several jewellery names and quantities inside one Particulars box.
Select a jewellery name, enter a whole quantity and click **Add**; repeat for more names
(for example, `Ring 2, Studs 1`). The description can also be edited directly. Gram,
assessed value and loan amount remain totals for the pledge row. The combined description
is saved in the bill, PDF and Excel register and retained when editing an existing bill.

Version 1.0.6 removes the bottom **+ Add item** button and stacks the Gold and Silver
choices vertically in the Metal column. Several jewellery names and quantities can
still be added inside the same Particulars box.

Version 1.0.7 uses the supplied gold-pot image for the Windows application icon, desktop
and Start menu shortcuts, and the app-window icon. The app header, browser-tab icon
and printed bill logo keep their existing appearance.

Version 1.0.8 adds Yesterday, Today, Weekly, Monthly and Yearly under Updates. Weeks run
Monday–Sunday and years cover January 1–December 31. Use **+ Add new account** in the
business account selector to create more accounts with separate profiles, bill/delivery
numbering and Excel files. Existing accounts 1–3 stay available.

Delivery now has **Single Delivery** and **Multiple Delivery** options. Add bill numbers
such as `1, 2, 3`, choose a delivery date, and review principal, interest and total for each
bill and the combined amount to collect. Saving records the entire selection atomically
and creates a separate numbered receipt/PDF for each bill, including voided bills. Excel
failure does not undo saved delivery records; retrying reuses their delivery numbers.

The installer is not digitally signed. Distribution with a verified publisher identity
requires a separate Windows code-signing certificate. No online updater is configured.
