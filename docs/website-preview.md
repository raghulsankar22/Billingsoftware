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
