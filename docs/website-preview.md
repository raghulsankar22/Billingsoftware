# Website review

Run `pnpm preview:website` from `D:\app`, then open
[Finance Billing website](http://127.0.0.1:3101/).

This runs the editable website in development mode. It does not build an installer,
change the installed Finance Billing application, or bump its version. The desktop
app continues to run its previously installed files on port 3100. Build and install
a desktop update only when the owner requests it.

The website uses the same local billing data in `D:\app\data`. Bills and customers
saved through the website are real records. For disposable verification, set
`LOCAL_DATA_DIR` to a temporary folder and `BILLING_PREVIEW_PORT` to another port
such as 3102 before starting the preview. Each preview port has a separate ignored
Next.js development output directory, so previews cannot overwrite desktop build
staging or each other's compilation files.

The website has a left sidebar with Dashboard, Bills, New bill, Customer, Delivery,
Delivery Bills and Business profile. Dashboard includes the existing Yesterday,
Today, Weekly, Monthly and Yearly activity reports. New bill shows customer name
and father's name first, followed by mobile and Aadhaar. Saved customer IDs appear
in Customer and fill into New bill alongside the saved details.

Overdue reviews the selected calendar month against the same month in the previous
year. For example, October 2026 shows bills from 1–31 October 2025. Each account has
its own overdue list. Bills with a completed delivery number and date are excluded;
voiding alone does not mean delivery or repayment. Select any month or year to
review another cohort. This is a whole-month report, rather than a rolling 365-day
cutoff, matching the owner's requested date ranges.

Search looks for bills across every account owned by the local user, including
added accounts beyond the original three. It accepts customer ID, name, address,
phone and Aadhaar. Each result identifies its account and bill number; opening or
downloading a result uses that bill's own account context. Search includes both
delivered and undelivered history, while Overdue is restricted to pending delivery.

The customer directory is shared across all owned business accounts. Saving a
customer once makes the same customer ID and details available in every account.
Existing duplicates with matching Aadhaar or an unambiguous phone are reconciled
under the oldest customer ID. Historical IDs continue to work as search aliases;
bill snapshots retain their original customer details and financial amounts.
Different Aadhaar holders sharing a phone remain separate, and lookup asks for
Aadhaar when the phone alone is ambiguous. Delivered statuses in Search are green.

Dashboard has Activity, Jewels, Gold and Silver sections. Activity keeps the
existing daily/weekly/monthly/yearly reports. The stock sections include all
undelivered loans for the selected account, regardless of the Activity date range.
Gold and Silver totals include only their own pledge rows, including mixed-metal
bills. Stock shows loan principal, grams, pledge lots, known piece quantities and
bill count. Piece counts are read from explicit quantities such as `Ring 2, Studs 1`;
missing quantities are marked rather than assumed. Voided bills remain in stock
until delivery is recorded, and unclassified metals appear only under Jewels.
