# Recovery and history — 1.0.26

## Complete offline backups

On Dashboard, an administrator chooses a backup folder, preferably on a separate
USB drive or disk. The desktop app offers a native folder chooser; the localhost
website accepts a full folder path. Never use the live data folder as the destination.

The package is a directory, not a single SQLite file or ZIP. Keep the complete
directory and its manifest together. It includes every existing user's billing
ledger, the authentication database, application data settings and stored PDF/Excel
documents. SQLite snapshots include committed WAL changes. Browser settings,
unfinished browser drafts, the application executable and unrelated files are not included.

Checksums, database integrity and expected paths are verified before recovery.
Daily backup checks run while locally signed in, on every screen, with further
checks on focus and visibility. A disconnected drive causes a visible error rather
than a false success. Back up now is available for an additional manual copy.
Thirty normal complete packages and five pre-recovery safety packages are retained.

Backups are **not encrypted**. They contain customer details and password hashes.
Protect the drive and store another copy away from the computer. Copying the live
SQLite file without its WAL is not a substitute for these backups.

## Restore

1. Finish or discard unfinished bills and close other app/browser windows. Stop
   any external program that writes directly to the data directory.
2. An administrator selects Restore from a backup on Dashboard, selects a package
   and previews its date, user, business, bill and customer counts.
3. Read the replacement warning and enter the **current administrator password**.
   All saved users, businesses, passwords, settings and documents are replaced.
4. A verified complete safety package is made before any replacement. Active
   requests are blocked and pooled database handles are closed during recovery.
   A failed apply rolls back replaced files. Interrupted recovery or a failed
   rollback fails closed: retain the transaction/safety files for manual recovery.
5. After success, close and reopen the app. All restored sessions are revoked;
   sign in with the credentials that existed in the selected backup. Browser draft
   keys are cleared in the restoring window. Do not resume an older window's draft.

Legacy single-ledger backups can be previewed but replace **only the main ledger**,
not other users' ledgers or documents. The warning identifies that limitation.
Recovery of sync-managed ledgers is deliberately refused. This release does not
add cloud synchronization or support external database writers during recovery.

## Unfinished new-bill drafts

New-bill text, the bill date, item amounts, particulars and pending jewellery
selection/query/quantity are kept in local browser storage. Reloading offers
**Resume draft** or **Discard draft**; it never silently applies the draft.
Check the original date and details before issuing it. Customer links and delivery
fields are not restored from a draft. Editing an issued bill does not create a draft.

There is one pending draft per signed-in user and business account in that browser.
Successful issuance clears it; a rejected save retains it. Drafts never issue a bill
number, change a ledger, or appear in Excel. A stale window will not overwrite a
different saved draft. Storage failures are shown as warnings.

Draft storage is **not encrypted** and can contain names, addresses, mobile numbers
and Aadhaar typed into the form. Protect access to the Windows account. Clearing
browser/app storage removes drafts; they are not part of installation backups.
Close the bill normally before closing the computer to allow pending draft writes.

## Bill-change history

All bills offers Bill change history for the open account, with bill-number search
and paging. It records creation/import, edits, voids, deletion, delivery/cancellation
and lost-bill declaration confirmation. Entries include time, signed-in username,
record ID, bill number, changed field categories and old/new loan totals. Editing,
voiding and deleting through the interface asks for a fixed correction reason.
Older API clients may show Not provided rather than an invented reason.

No copied customer names, addresses, phone numbers, Aadhaar, particulars, collector
names or free-form reasons are stored in the log. Failed operations do not produce
successful history entries. PDF/Excel refreshes and idempotent retries add no noise.
Deleted bill identities remain even if a bill number is reused.

History starts with this version; it cannot reconstruct earlier changes. The
application exposes no update/delete interface, and SQLite triggers refuse normal
updates/deletes. This is **not tamper-proof against someone with filesystem access**.
Recovery restores the history present in the selected backup and adds a Backup
restored boundary. Changes made after that backup remain in the complete safety
package, not merged into the restored ledger.

## Release boundaries

This release does not add staff roles, Daily Closing, cloud synchronization,
installer signing or external translation services. English remains the default;
optional Tamil interface labels remain under View > Languages. Existing jewellery
labels and native typed text are unchanged. Build and verification use disposable
data only. Installation remains a separate owner action.
