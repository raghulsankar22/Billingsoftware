# Windows desktop app

## Version 1.0.25

- Adds a **Data backup** panel at the top of the Dashboard. Type the full path of a folder on a USB drive or another disk once; the app then saves a verified, dated copy of the bills and customers database (`billing-backup-YYYY-MM-DD-HHMMSS.sqlite`) the first time the Dashboard is opened each day. **Back up now** makes one immediately. The newest 30 copies are kept and other files in that folder are never touched. A folder inside the billing data folder is refused, because it would be lost with it. The panel turns amber if the last backup is over a day old or the drive is missing.
- Adds **Restore from a backup**: choose a dated copy, read the warning, and confirm. The backup is verified first, the current bills are saved to `backups/before-restore-*.sqlite` inside the data folder (the newest five are kept), and the app then switches to the chosen copy and reloads. Anything saved after that backup is removed from the app but remains in the safety copy.
- Backups contain the bills and customers database only. Generated PDFs and Excel files are not copied; Excel registers are rebuilt after a restore.
- The billing server now keeps one shared database connection per data file so a restore can close it before swapping the file.
- The bill-entry items table now fits a 1280 pixel window without sideways scrolling, using narrower Particulars, Remarks and amount columns. Saved bills and printed layouts are unchanged.
- Retains all 1.0.24 jewellery search, Total grams and remarks layout, and every earlier feature.

The build-only installer is `release/1.0.25/Finance-Billing-Setup-1.0.25.exe`; installation requires a separate owner request.

## Version 1.0.24

- Replaces only the bill-entry jewellery dropdown with an offline searchable combobox over the existing catalogue. English prefixes rank first, then word prefixes, contained text and letters in order; Tamil labels and custom Tamil names are searchable too. Use arrow keys and Enter to choose, Escape to cancel a search or Tab to leave without choosing a new entry.
- A search chooses the same catalogue value as before. It does not translate or rewrite saved particulars, historical bills or the approved bilingual catalogue. No aliases, Google service or customer-data transfer are introduced. The existing Add new jewellery review and Manage jewellery flows remain available.
- The quantity starts empty and clears after every successful Add. Choose an item, enter a whole number from 1 to 9999, then Add. Quantity stays beside the jewellery name and Add sits directly underneath quantity. Rejected additions retain the draft and existing particulars.
- The entry form now says Total grams. Remarks checkboxes sit side by side and wrap; their saved values are unchanged. Printed bills and PDFs keep their existing labels and layout.
- Retains all 1.0.23 menu, theme, account, combined Excel, overdue, notice and lost-bill features.

The build-only installer is `release/1.0.24/Finance-Billing-Setup-1.0.24.exe`; installation requires a separate owner request.

## Version 1.0.23

- Retains all 1.0.22 billing, jewellery, overdue, notice, lost-bill and combined Excel features.
- Adds a slim grouped icon menu. Drag its right edge from 68px to 248px, or focus the divider and use the arrow keys, Home/End or Enter. Tamil has a 100px minimum to keep words intact. The width is remembered on this computer.
- Full menu names appear on hover or keyboard focus. Settings and administrative pages keep their existing permissions and remain in the native File menu on desktop.
- All bills, Customer Bill Lost, Notice and Overdue badges show the open account only and refresh after billing reloads. Notice keeps its monthly rules; overdue remains undelivered bills older than 365 days. Counts do not automatically roll over at midnight until the next reload.
- Dark is the default screen theme. Use the bottom menu button to switch to light; the choice is remembered on this computer. Printed bills, letters and declarations keep their white paper layout. Dashboard content is unchanged.
- Short Tamil menu labels are provisional until the owner approves them. The approved jewellery catalogue is unchanged. No Google translation service or new customer-data transfer is enabled.

The build-only installer is `release/1.0.23/Finance-Billing-Setup-1.0.23.exe`; installation is left to the owner.

## Version 1.0.22

- Includes the combined work from both development threads, retaining the 1.0.21 jewellery catalogue manager and Father's name / Husband's name fields.
- Dashboard Download Excel exports one workbook with an Account N sheet for every configured account belonging to the signed-in user, including empty configured accounts. Each sheet contains the complete account register, not just the dashboard period.
- Dashboard Refresh and Refresh Excel regenerate all account sheets together and refresh the saved per-account registers. The combined local workbook is saved as registers/All Accounts.xlsx inside that user's billing data folder. Downloaded workbooks are snapshots; download again for updated contents. Close the saved workbook in Excel before refreshing if Windows reports that it is locked.
- Notice Excel adds Message (English) and Message (Tamil) columns. Print letters uses the filtered Notice list, groups bills by customer, omits amounts and provides both approved messages. Notice 2 uses the print/download day in India plus 20 calendar days. Normal letters start on separate pages; unusually large histories can continue onto additional pages rather than losing content.
- Removes the shop phone from finance bills, delivery bills, notice letters/messages and lost-bill declarations. Customer phone numbers remain. Existing cached PDFs regenerate on their next download using the v10 template.
- Older unsigned lost-bill deliveries can be marked as signed after opening the declaration's print dialog and confirming that the customer has signed the paper. This records a confirmation timestamp, not a digital signature or a stored scan. An Excel failure does not undo the signed confirmation; retry Excel after resolving the error.
- Overdue remains undelivered bills more than 365 days old, across all months and years. Typed Tamil and historical particulars are not automatically translated or rewritten. No Google Translate service or new online transfer is enabled.

Run the Finance Billing shortcut or install `release/1.0.22/Finance-Billing-Setup-1.0.22.exe`.
The app opens its own window and starts its loopback-only billing server automatically.
No internet, separate Node installation, Microsoft 365 login or web hosting is needed for daily use.

The multi-user app asks the first person to create an administrator username
and password. That first user keeps the existing accounts. The administrator can create
other users and reset passwords under **Users**; each user has separate business accounts,
customer records, bills, PDFs and Excel registers. User credentials and sessions are stored
in `users.sqlite` in the billing data folder; other users' files live in its `users` folder.
Back up the entire folder, including these files and subfolders, with billing closed.

Every user can change their own password under **My account** using their current password.
Changing it signs the user out on all sessions. **Forgot password?** on the sign-in page
explains how an administrator can reset another user's password. The offline app does not
currently provide automatic recovery if the administrator forgets their own password.

Sign-in limits access through the updated app. Anyone with access to the same Windows
account can still access local billing files directly. Version 1.0.12 and earlier
predate login and can open the original accounts without it. Updated desktop builds refuse to reuse an older
server that does not enforce the new sign-in.

On this computer all business accounts continue to use `D:\app\data`. Customer records are
not copied into the installer. Updates and uninstalling the desktop program do not delete
this data directory. A new installation uses a data directory inside the Windows user's
Finance Billing application-data directory; see File > Open billing data folder.

The first time this version runs, it saves the folder holding the existing bills in
`data-location.json` in the app's user-data folder and uses only that folder afterwards.
If the folder is missing, for example on a disconnected drive, the app shows a message
and closes instead of opening an empty ledger.

`D:\app\data` is inside the code folder but ignored by Git, so Git cannot restore it.
Never run `git clean -x` (or `-X`) in `D:\app`: it permanently deletes bills, PDFs and backups.

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
3. Run `node scripts/verify-desktop.mjs` and `node scripts/verify-desktop-users.mjs` for isolated local billing and multi-user checks.
4. Run `pnpm desktop:start` to test the desktop window.
5. Run `pnpm desktop:package` to create the per-user Windows installer and unpacked app.

To repeat the isolated checks against the packaged files rather than staging, set
`BILLING_TEST_RUNTIME_DIR` to the absolute path of
`release/<version>/win-unpacked/resources/billing-runtime` and run both verification
scripts again. They create disposable ledgers under `tmp/` and choose unused ports;
they do not use the installed app's billing data. These are HTTP/runtime checks,
not a visual click-through or an installer installation test.

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

Version 1.0.9 adds a **Customer** tab with saved name, father's name, address, optional
mobile and optional Aadhaar for each business account. Enter an exact saved mobile or
Aadhaar in New bill to fill customer details. Customer edits apply to future lookups;
previously issued bills retain their saved customer details. Mobile/Aadhaar duplicates
within an account are rejected. Aadhaar is masked in the customer list and available
when editing the customer. Customer records are kept in the existing local SQLite
database, so include that database in backups.

New bill shows Loan amount before Assessed value. Entering the loan automatically
sets the assessed value to loan plus 10%, rounded to paise (₹10,000 → ₹11,000).
An old bill's assessed value is retained until its loan amount is changed.

Version 1.0.10 brings the reviewed website changes into the desktop app: a left
sidebar; Dashboard naming; reordered customer fields; shared customer IDs and details
across every owned account; all-account Search with green Delivered statuses; and
the monthly Overdue report for undelivered bills from the same month last year.
Existing duplicate customer IDs remain valid search aliases for the shared identity.

Dashboard includes Activity, Jewels, Gold and Silver. Stock views include all
undelivered pledge rows for the selected account, with metal-specific loan amounts,
grams, recorded piece quantities and bill counts. Missing quantities are identified
instead of guessed. The existing PDF/Excel output and billing data folder are retained.

The first-month interest-at-issue row, amount and explanatory notes are removed from
overviews, delivery screens, Dashboard notes, printed receipts and PDFs. Previously
saved PDFs regenerate when downloaded so the updated template also applies to old bills.

Version 1.0.11 includes Notice 1/Notice 2 with separate Excel downloads, the expanded
Dashboard loan table, visible VOIDED labels in bill PDFs, wrapped Excel register text,
and cleanup of every owned PDF version when a bill is permanently deleted.

Use **Help > Check for updates** in the desktop app. It checks `release/latest.json`
beside the data folder (on this computer, `D:\app\release\latest.json`). Building with
`pnpm desktop:package` publishes this file only after the new installer is complete.
Save unfinished work, then choose **Install and restart**. The updater checks the
installer's size and SHA-256, stages a separate copy, waits for billing to close, runs
the per-user installer, and reopens the app. It does not change the billing data folder.
Failed installations are recorded under the app's user-data `updates/install.log`.

Version 1.0.12 ensures the app reopens with a visible window after an update and
that opening its shortcut brings an existing hidden window back into view.

Version 1.0.13 includes the multi-user sign-in, password-change and administrator reset
features described above, coloured navigation icons, and the following billing changes.
New Bill and Edit Bill have optional
jewellery-condition checkboxes beside Particulars: **None**, **Broken**, **Slightly bent**,
**Missing stone**, and **No screw**. Several conditions can be selected; None clears the
others. Older written notes remain available as checked choices when editing.
Delivery requires choosing **Customer has
bill** or **Customer lost bill**, separately for every bill in multiple delivery. Jewellery
remarks appear in finance and delivery PDFs; the bill choice appears on delivery receipts
and in Delivery Bills history. Both are retained in the Excel register's existing Particulars
cell. Historical deliveries have no assumed choice and show **Not recorded** until updated.
Looking up an already-delivered bill opens a notice showing its delivery number and date.
Multiple Delivery lists all delivered bills found in the requested selection in one notice,
including bills whose original loan was voided. Looking up or dismissing a notice does not
record another delivery; saving remains a separate action.

Family members can share a mobile number. New bill lists the saved customers for a mobile
number so staff can choose one or enter a different person. The Customer tab asks before
saving someone with different details under a number that is already saved. Aadhaar still
identifies one person.

Version 1.0.15 packages the reviewed register-import, shared-phone, delivery-date,
data-location and disabled-sync safety changes. The release verifier also checks
shared-phone confirmation, early-delivery rejection, sample workbook imports and
duplicate-import rejection. Online sync remains disabled and incomplete.

Version 1.0.16 opens in Tamil with an English switch while records, Excel and PDFs stay in English. Switching
accounts opens the Dashboard. Import old bills, My account, Users and Business profile move to the File menu.
A new bill with a phone or Aadhaar creates a customer ID, and name, address and particulars get capital letters
as you type. An Aadhaar saved for someone with another name stops the bill. Delivery records who took the
jewellery and their relation. Password boxes have a Show button, and **Create new user** on the sign-in screen
works only with the administrator's username and password.

Version 1.0.19 defaults to English and keeps **View > Languages > English / Tamil**. The approved 76-name
jewellery catalogue displays English names with Tamil in brackets, including printed bills and saved PDFs.
Saved particulars, customer details and Excel remain English. It also includes the Customer Bill Lost tab,
printable lost-bill declaration and signed confirmation before saving a lost-bill delivery.

Version 1.0.21 uses one **Father’s name / Husband’s name** field in bills and customer details.
**Manage jewellery** beside **Add new jewellery** can add, rename or remove supplied and custom
choices across your business accounts. Removing or renaming choices never rewrites saved bill
particulars, customer records, PDFs or Excel files. Removed names can be added again later.

Version 1.0.20 shows all undelivered bills more than 365 days after their bill date in Overdue,
across every month and year. Day 365 is not overdue; day 366 is. Completed and historical deliveries
are excluded, and Notice 1 / Notice 2 keep their existing monthly rules. Free-text Tamil input now
stays as entered without automatic English conversion; the approved jewellery catalogue is unchanged.

Version 1.0.17 keeps a name box beside **Who is taking the jewellery?** and adds **Cancel delivery bill** to the
Delivery tab. Cancelling returns the bill to awaiting delivery, removes its delivery PDF and updates Excel. The
cancelled delivery is kept on the bill, and its number is not used again.

For another computer or USB drive, copy a whole version folder containing its installer
and `update.json`; use **Choose update file** in the update dialog. Older or equal versions
are refused. Updates are local and work offline; new code must first be built into an
installer. Editing the website alone does not update the installed desktop app.

The installer is not digitally signed. SHA-256 detects a changed or incomplete installer;
it does not authenticate its publisher. Only choose update files from your own builds.
Distribution with a verified publisher identity requires a Windows code-signing certificate.
