# Local billing

Local storage is the default. Run `pnpm dev` or build then `pnpm start`; open http://127.0.0.1:3100. The server binds only to this computer. No cloud account, email sign-in, OAuth client, or paid service is required.

Bills and the three account profiles live in `data/billing.sqlite`. PDFs live below `data/bill-pdfs`, and each account has an automatically refreshed Excel file below `data/registers`. The app also provides PDF and Excel downloads. Set `LOCAL_DATA_DIR` to choose another local directory.

Bill issuance and replacement use SQLite transactions so number allocation, pledge items, business snapshots, and correction history persist together. Excel or PDF write failures retain the saved bill and expose retry/download behavior.

Close the billing server before copying the entire data directory to a backup drive. Keep this directory when updating the app. Local access relies on your Windows account and the loopback server; anyone using this Windows session can open billing.

The previously created cloud project is retained. Local mode does not read, migrate, or delete cloud records. To explicitly opt back into configured cloud storage, set `NEXT_PUBLIC_BILLING_STORAGE=cloud` and restart/rebuild. Google OAuth is only used in cloud mode.
