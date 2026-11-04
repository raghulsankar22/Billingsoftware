# Keeping backups in Google Drive

Finance Billing saves a dated backup of everything (users, businesses, bills, customers, settings
and stored documents) to a folder you choose. If that folder is inside **Google Drive for desktop**,
Google Drive uploads each backup to your Google account automatically. The billing app does not
talk to Google itself: it only writes files to a folder, and Google Drive for desktop does the
uploading. No Google keys or sign-in are added to the app.

This is separate from the older Supabase Excel-register setup in `google-drive-setup.md`.

## One-time set-up (about ten minutes)

1. **Choose a Google account just for the business** (or the owner's own). Only the owner should
   be able to sign in to it, with two-step verification turned on. Backups hold customer names,
   addresses, Aadhaar numbers and password records, so treat the account like the ledger itself.
2. **Install Google Drive for desktop** on the shop computer
   (drive.google.com/drive/download) and sign in with that account. A drive such as `G:` named
   *My Drive* appears in File Explorer.
3. In Finance Billing, open the **Dashboard**, find **Data backup**, press **Change folder** (or
   set it for the first time) and press **Use Google Drive: G:\My Drive\Billing Backups**. If that
   button is missing, press **Choose folder…** and pick or create a folder inside *My Drive*.
4. Press **Save folder and back up**. The first backup is made at once, then one a day the first
   time the Dashboard is opened.
5. Open drive.google.com on any device and check that the *Billing Backups* folder holds a
   `.billing-backup` folder for each backup (a folder, not a single file).

The panel then says the folder is in Google Drive. Google Drive for desktop must be running and
signed in for copies to upload; a backup is not safe online until Drive shows it as synced (a green
tick in File Explorer).

## Restoring

- **Same computer, wrong data:** use **Restore from a backup** on the Dashboard.
- **New computer:** install Finance Billing and Google Drive for desktop, sign in to the same
  Google account, and choose the *Billing Backups* folder in the Data backup panel; then restore.
- **Google Drive offline:** a backup that Drive has not downloaded to this computer opens slowly the
  first time. Right-click the folder and choose **Offline access, available offline** to keep
  copies on the computer.

## Things to know

- **Backups are not encrypted.** Google protects files at rest and in transit, but anyone who
  signs in to the Google account can read them. Use a strong password and two-step verification
  and do not share the folder.
- **The newest 30 copies are kept.** Older copies are removed from the folder, and Drive moves
  them to its trash, where they stay for 30 days.
- **Free space.** A free Google account has 15 GB, shared with Gmail and Photos. Check the size of
  one backup in the Restore list: dozens of copies of a small ledger fit easily. If the account
  fills up, uploads stop silently, so look at the storage figure in Drive now and then. A paid
  Google One plan (about ₹130 a month for 100 GB) fixes that.
- **Not instant.** Drive uploads in the background. If the computer is switched off straight after
  a backup, the upload finishes later.
- **If the drive letter changes** (for example `G:` becomes `H:`), choose the folder again.
- Do not put the backup folder inside the billing data folder: the app refuses that.
