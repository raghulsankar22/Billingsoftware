# Local billing

Local storage is the default. On this Windows computer, double-click `D:\app\Start Billing.cmd` to start the built app and open it in your browser. If it is already running, the starter opens the existing app. The server binds only to this computer at http://127.0.0.1:3100. No cloud account, email sign-in, OAuth client, or paid service is required. Developers can also run `pnpm dev` or build then `pnpm start`.

Bills and the three account profiles live in `data/billing.sqlite`. PDFs live below `data/bill-pdfs`, and each account has an automatically refreshed Excel file below `data/registers`. The app also provides PDF and Excel downloads. Set `LOCAL_DATA_DIR` to choose another local directory.

Bill issuance and replacement use SQLite transactions so number allocation, pledge items, business snapshots, and correction history persist together. Excel or PDF write failures retain the saved bill and expose retry/download behavior.

Close the billing server before copying the entire data directory to a backup drive. Keep this directory when updating the app. Local access relies on your Windows account and the loopback server; anyone using this Windows session can open billing.

The previously created cloud project is retained. Local mode does not read, migrate, or delete cloud records. To explicitly opt back into configured cloud storage, set `NEXT_PUBLIC_BILLING_STORAGE=cloud` and restart/rebuild. Google OAuth is only used in cloud mode.
