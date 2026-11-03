# Payments and Daily Closing — 1.0.27

Only payment recording and Daily Closing are in scope. This does not introduce packet tracking, customer statements, staff roles, encrypted backups or installer signing.

## Money is confirmed, never inferred

Delivery receipts retain their calculated amounts. They do not become payments automatically. Existing bills and deliveries remain Not recorded in the cash book until a person confirms money movement.

Choose an opening date and the physical cash present at the start of that date for each business account. This is an explicit starting point, not a reconstructed historical balance. Cash, UPI and Bank are recorded separately. One record uses one payment method; split and partial payments are outside this first version.

A loan disbursement records the actual amount handed to the customer, not an assumed principal outflow. A collection records the full bill principal plus interest actually received. Any discount applies to interest only. When a saved delivery calculation exists, interest received plus discount must equal that calculation. For historical deliveries without a calculation, staff enter the interest explicitly and add an explanatory note; missing interest is not guessed.

Expenses and cash introduced/withdrawn are explicit manual records. Cash introductions and withdrawals are not interest income or business expenses. No transaction is copied into old bills, saved PDFs or the existing loan register.

## Closing and corrections

Expected physical cash = opening cash + confirmed Cash receipts − confirmed Cash payments. UPI and Bank never affect physical cash. Earlier unclosed days carry forward into the selected day's opening balance.

Counted cash is entered by the operator. A discrepancy requires an explanation; it is not silently booked as income or expense. The next day carries the counted cash forward, with the discrepancy retained in the closing record.

Saving a closing locks that date and earlier dates against money-record changes. Closings are sequential and immutable. Corrections use a dated reversal on an open day, followed by a new correct record if appropriate. A closed date is never rewritten. Stale closing screens must refresh before saving.

A closing warns about bills dated that day whose disbursements or collections are still Not recorded. The operator must acknowledge that check. Combined reports include only the signed-in user's business accounts, not other users' ledgers. Any account without an opening balance remains Not recorded rather than contributing an invented zero balance.

Money records are stored in the existing local ledger, so complete offline backup and recovery includes them. They are app-read-only after posting, not tamper-proof against someone with filesystem access.

An active confirmed payment prevents deleting, voiding, replacing or changing the bill's financial details until that payment is reversed. Customer-name/address corrections and document/register synchronization remain available. A confirmed collection also protects its delivery from cancellation or re-recording.

Payouts can be recorded for issued, undelivered bills; collections require a recorded delivery. The closing warning counts eligible same-day payouts and same-day deliveries without a confirmed collection. Closed-day money remains fixed even when a later reversal corrects it.

## Release limits

Version 1.0.27 includes these screens in the offline desktop installer. Building the installer does not install it or change live records. Existing financial documents keep their current meaning and layout. New money-book and closing screens are not a replacement for a statutory accounting system.

## Running the isolated demonstration

From this source worktree, run `node scripts/seed-cashbook-demo.cjs`, then `node scripts/start-cashbook-preview.mjs`. Open `http://127.0.0.1:3110/`. This is a development website, not an installed-app upgrade.

Both scripts refuse a real-data override. The server requires the exact marked `tmp/cashbook-website-demo` directory; missing configuration or a bad marker stops it instead of opening the real ledger. The visible DEMO banner and health response derive from that verified directory. Ports 3100, 3101 and 3103 are not reused.

The seed contains fictional people and two sample business accounts only. Demo credentials are generated locally in the ignored sample folder; no password is published in source or documentation. Existing sample data is not reset when the seed runs again. Complete backup packages remain unencrypted.
