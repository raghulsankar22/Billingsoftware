# Finance Billing

Billing software for a gold and silver pledge-loan (finance) business. Staff issue loan bills against pledged jewellery, record the jewellery's return, and calculate the interest to collect. The app also keeps customer records, printable PDFs and an Excel register.

It runs as a **Windows desktop app that works fully offline**. Data stays on the computer it runs on. An online, multi-device version is being built but isn't ready for use (see [Project status](#project-status)).

## What it does

Version 1.0.28 combines jewellery search with Particulars, places Qty beside it,
and keeps Add below Qty. Gold/Silver use single-selection checkbox-style choices.
The duplicate Add account button is removed; account creation stays in the dropdown.

Version 1.0.27 adds explicit payment recording and Daily Closing, with separate Cash, UPI
and Bank totals. Existing bills are not automatically treated as paid. Set a starting
cash balance for each account before recording money. See [Payments and Daily Closing](docs/cashbook.md).

Version 1.0.26 adds complete offline backup/recovery, unfinished new-bill drafts,
and read-only bill-change history. See [Recovery and history](docs/recovery-and-history.md)
for coverage, safeguards and important limits. Updating the installer does not restore a backup.

| Area | Features |
| --- | --- |
| **Loan bills** | Automatic bill numbers, gold and silver items, weight, assessed value (loan + 10%), jewellery picker with quantities, condition remarks, edit, void and delete |
| **Delivery** | Record the return of pledged jewellery for one bill or up to 50 together, with separate delivery numbers and receipts, and the interest and total to collect |
| **Interest** | Monthly interest worked out in whole paise: silver 3%, gold 2.5%, or 2% when a bill's gold principal is above ₹5,000 |
| **Customers** | One shared directory with customer IDs and lookup by mobile or Aadhaar (masked in the customer list). Family members can share a mobile number after staff confirm |
| **Business accounts** | Several businesses in one app, each with its own profile, license number, numbering, bills and Excel file |
| **Users** | Sign-in with an administrator and separate data for each user, password change and administrator reset |
| **Reports** | Dashboard for today, yesterday, week, month and year; jewel stock by metal; Notice 1 and 2 lists; overdue bills; search across all accounts |
| **Documents** | Finance and delivery bill PDFs, printing, and an automatically rebuilt Excel register |
| **Old registers** | Import old bills from Excel with a row-by-row preview. Details the register doesn't have stay "Not recorded" and are never invented |
| **Desktop updates** | Local installer updates, with a checksum check before installing |

## Tech stack

- **App:** Next.js 15, React 19 and TypeScript
- **Offline storage:** SQLite (`node:sqlite`) plus local PDF and Excel files
- **Desktop:** Electron, with a sandboxed window and a server reachable only from the same computer
- **Documents:** jsPDF, pdf-lib, PDFKit and ExcelJS
- **Validation:** Zod
- **Online version (in development):** Supabase (Postgres) and Google Drive
- **Quality checks:** Vitest, ESLint, GitHub Actions

## Project structure

```text
.
├── src/
│   ├── app/              # Pages and API routes (src/app/api/...)
│   ├── components/       # Screens: bill form, delivery, customers, dashboard, import...
│   └── lib/              # Business rules: ledger, interest, PDFs, Excel, sign-in, import, sync
│       └── local-database.ts   # The offline ledger; number allocation and transactions
├── desktop/              # Electron app: window security, server start, data folder, updates
├── scripts/              # Build, packaging, preview, and read-only data checks
├── supabase/
│   ├── migrations/       # Online database schema and server functions
│   └── tests/            # SQL tests
├── docs/                 # Setup guides and design notes
├── public/               # Logo and fonts (includes Tamil)
├── .github/workflows/    # Automated checks
├── .codex/               # AI coding assistant skills used during development; not part of the app
├── Start Billing.cmd          # Starts the built app in a browser
└── Start Website Preview.cmd  # Starts the development preview on port 3101
```

These folders are created on your computer and are deliberately **not** in this repository: `data/`, `backups/`, `release/`, `.desktop-runtime/`, `.next*/` and `node_modules/`, along with any `.env.local` settings file.

## Getting started

You need [Node.js](https://nodejs.org) 22.18 or newer and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev          # http://127.0.0.1:3100
```

No accounts or cloud services are needed. The first person to open the app creates the administrator. Bills are stored in `data/` unless you set `LOCAL_DATA_DIR`. Copy `.env.example` to `.env.local` only if you need to change settings.

### Build the Windows desktop app

```bash
pnpm desktop:prepare    # Build and stage the offline server
pnpm desktop:start      # Try the desktop window
pnpm desktop:package    # Create the installer in release/<version>/
```

### Checks

```bash
pnpm test               # Automated tests (temporary data only)
pnpm typecheck
pnpm lint
pnpm build
```

Read-only checks of local data, which never print customer details:

```bash
node scripts/audit-local-data.mjs       # Counts of users, bills, customers, files
node scripts/check-imported-bills.mjs   # Review bills imported from old registers
node scripts/check-local-migration.mjs  # Check data consistency before any migration
```

## Data and safety

- **Bill numbers** are allocated inside database transactions, so they can't be issued twice.
- **Issued bills keep their own copy** of customer and business details, so later edits to those records don't change them.
- **Money** is calculated in whole paise to avoid rounding errors.
- **The desktop window** can't reach the internet or computer files directly; its server listens only on the same computer.
- **Passwords** are stored as salted scrypt hashes.

Things to know:

- **Back up your data.** On the Dashboard, choose a backup folder on a USB drive or another disk; the app saves a dated copy every day and can restore one from the same panel. You can also close the app and copy the whole data folder. The offline app has no cloud backup.
- **Data isn't encrypted on disk.** Customer details, including Aadhaar numbers, can be read by anyone with access to the Windows account.
- **The installer isn't digitally signed.** Only install builds you made yourself.
- **Never run `git clean -x` in a folder holding live data.** The data folder is ignored by Git, so Git can't restore it.

## Project status

| Part | Status |
| --- | --- |
| Offline desktop billing | Working |
| Import from old Excel registers | Working; try a small sample first |
| Online and multi-device sync | **In development; not ready for use.** Parts are built and tested on their own but not connected to the app, and they're switched off by default. Keep the `BILLING_CLOUD_MULTIUSER`, `NEXT_PUBLIC_BILLING_CLOUD_MULTIUSER` and `BILLING_SYNC_BILL_EXPERIMENTAL` settings off |

The plan and open work for online sync are in [docs/online-offline-readiness.md](docs/online-offline-readiness.md).

## More documentation

- [Desktop app guide and version history](docs/desktop-app.md)
- [Local storage](docs/local-storage.md)
- [Website preview](docs/website-preview.md)
- [Online setup](docs/integration-setup.md)
- [Google Drive setup](docs/google-drive-setup.md)
