# Online and offline billing readiness

The current desktop application uses per-user SQLite databases and local PDF and Excel files. The older cloud mode has a different account model and does not expose all current desktop features. It is not ready for production hosting or data migration by changing a setting.

## Work required before deployment

1. Provide cloud authentication and enforce ownership for every user, business account, customer, bill, delivery, PDF and export. The current cloud implementation accepts only the configured owner and three account slots.
2. Bring the desktop features to the cloud, including multiple users and accounts, customers, deliveries, in-place edits, deletion, dashboard, notices, overdue reports, search and import.
3. Provide persistent cloud database and file storage. Keep the current local database and files as an offline copy; the files deployed with the web app are not the database.
4. Migrate profiles, users, customers, bill and delivery records, bill numbers, snapshots, status, PDF files and account associations. Preserve a verified local backup and compare counts, numbers and totals before cutover. Resolve how online credentials will be established without exposing passwords.
5. Add a durable, retryable sync queue with authenticated operations, unique operation IDs, version checks, clear pending/error status and a recoverable conflict process. An operation must be safe to retry after a disconnect. Deleted records require durable tombstones so they are not recreated by another device.
6. Resolve number allocation for bills and deliveries made on different devices while disconnected. The choice affects gaps, temporary numbers, deletion and reuse, and what gets printed on physical bills.
7. Test concurrent writes, lost responses and retries, duplicate deliveries, edit/delete conflicts, reconnect after long disconnection, multiple users, access isolation, restore from backups and Excel/PDF regeneration. Test with synthetic data before transferring actual records.

## Owner's choices

- One designated device per business account may issue bills while offline. Other devices may view and edit, but must wait to issue bills while that device is offline. A designation must not be automatically reassigned merely because a device is unreachable: it may still be issuing bills offline. Transfer requires synchronization and safe reconciliation.
- For concurrent edits, use the latest edit according to the device's recorded time, and warn if that device's clock appears incorrect. Preserve enough history to recover an overwritten edit. A device offline for a long time cannot reliably verify its own clock; do not silently treat an untrusted clock as authoritative.
- Consider the connected Supabase project, subject to inspecting its existing contents and understanding the plan and costs. The existing project is on the free plan.
- When the designated device is lost, an administrator may transfer permission; unsynced bills require manual review. The same designation covers offline delivery numbers. Existing users can establish new online passwords.
- A delete-versus-delivery conflict must preserve both changes for administrator review. For an edit and delivery, apply the latest change while retaining the delivery record unless a conflicting deletion is resolved by an administrator.
- Use the existing cloud sign-in for the owner's main account. Its credentials have not been changed; it has been approved as a billing administrator, but local records have not been associated with it yet.

Delivery numbers must use the same designated device. Delete-versus-delivery conflicts require an administrator review path; no operation may discard the delivery while that review is pending.

## Read-only inventory

Run `node scripts/audit-local-data.mjs` locally to count users, profiles, bills, items, customers, PDFs and Excel registers. The script does not print customer names or modify the database. Counts are a planning baseline, not a backup or proof of migration completeness.

Run `node scripts/check-local-migration.mjs` for a read-only, per-database snapshot check of IDs, account and customer references, duplicate bill numbers and loan/item totals. It prints aggregate results and row indices, not personal details. It does not check every field, upload data, or replace a backup. The local data has changed while development was in progress, so a fresh, quiescent snapshot and verification are required at cutover.

The Supabase project has been resumed. Its existing cloud billing tables contain no bills or business profiles; the one existing sign-in has been approved as administrator without changing its password. Private sync tables and service-only functions now cover device registration, issuer assignment, handover and administrator recovery, including receipt-based retries. They are not exposed to browser roles. The cloud schema has customer records, expanded account slots, delivery fields, metal and remarks, and unknown historical value support. Enabled user approval and ownership are required for direct reads of customer and billing data.

Cloud account creation, profile saving and one bill-create sync path are implemented only as opt-in development building blocks. The local ledger has a separately tested atomic bill-create-and-queue operation, but the app does not call it. Edits, deletions, deliveries, inbound sync, migration, protected credential integration, user setup, Excel and PDF synchronization, and manual conflict review are not yet connected. The new cloud mode explicitly refuses normal bill creation. `BILLING_CLOUD_MULTIUSER`, `NEXT_PUBLIC_BILLING_CLOUD_MULTIUSER`, and `BILLING_SYNC_BILL_EXPERIMENTAL` must remain disabled for production.

No existing local billing data has been moved, and there is no automatic offline-to-cloud sync yet.

## Sync safety rules now in place

- A change the server can't accept is set aside with its reason in the local review list (`held`), and other bills keep syncing. It pauses later changes to the same bill and, because numbers must arrive in order, later new bills. Permission can't be released while any remain.
- Outages and refused sign-ins stop the batch and retry later; they never go to review.
- Once an account joins sync, every change outside the queue is refused, including delivery, void, delete and import, until sync supports it. Accounts that haven't joined are unaffected.
- Online bill replacement is refused alongside online bill creation, through one shared check.
- A delivered bill's summary is recalculated on the server when it's edited, and its old delivery PDF is cleared. Corrected delivery numbers and dates reach the cloud.
- A future-dated edit goes to review. A future-dated new bill is accepted with the server's time. A slow clock can't move a bill's history backwards.
- Recovery removes a device from one account only; revoking it everywhere is a separate administrator action.
- A device states its bill and delivery counters when claiming offline permission, so a mismatch stops before the account is reserved.

## Still required before sync can be enabled

- Connect the app to the sync path; nothing in the running app calls it yet.
- Add delivery and deletion sync. `decideBillChange` records the delivery rules, but only the bill create and edit paths exist on the server, so those rules aren't enforced there yet.
- Sync customers. A bill linked to a saved customer is currently refused by the server and goes to review.
- Add inbound sync, so a device can download a newer version of a bill.
- Build the administrator screens for the local review list, for recovery and for `needs_review` server records.
- Add the routes for claiming and releasing offline permission and for recovery.
- Migrate existing records, encrypt Aadhaar numbers, and apply the latest migrations to the cloud project.
- Connect `device-identity.cjs`, which is packaged but not yet used.
