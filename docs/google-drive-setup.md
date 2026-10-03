# Google Drive setup

The app now uses Google Drive for its Excel register. Supabase remains the source of truth: synchronization regenerates the workbook from all saved bills, including voided bills. Treat the Drive workbook as an export; manual edits will be replaced during the next sync. Excel downloads still work independently.

Set `SUPABASE_SERVICE_ROLE_KEY`, `BILLING_OWNER_EMAIL`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` in `.env.local`. Use the email address for the single owner login. The URL, browser publishable key, and generated encryption key are already configured locally. Retain the encryption key securely. Run `pnpm check:configuration` to list missing settings without revealing values.

In Google Cloud, enable the Google Drive API, configure the OAuth consent screen, and create a Web application OAuth client. Register `http://localhost:3100/api/google-drive/callback` as an authorized redirect URI. Add your account as a test user if the consent screen is in testing. Testing-mode refresh tokens can expire; use an appropriate published consent configuration for sustained use.

The app requests `drive.file`, offline access, and consent with state and PKCE. Each business account has its own connection and remembered workbook ID. Names include the account number and sanitized business name, for example `Finance Billing Register - Account 2 - Example Business.xlsx`. `GOOGLE_DRIVE_WORKBOOK_NAME` controls the base name. Select and connect each business account separately; use the same Google account when reconnecting.

Connection status and OAuth start use `?account=1|2|3` (default 1). The encrypted browser request binds the authenticated owner, profile UUID, and account slot. The callback verifies all three against the database before exchanging credentials and returns to the selected account. Reconnection preserves that profile's existing workbook ID.

Synchronization uses a database lease shared across servers. Busy syncs report a retryable error. File IDs are generated and saved before creation so retries do not create duplicates. Transfers are bounded to 20 seconds; registers larger than 5 MB require direct Excel download. Failed syncs retain saved bills and retry controls.

The new Google connection migration is installed remotely; its lease contention/release test passed with rollback. Google Drive tokens have server-only privileges and row-level security. The historical Microsoft table remains unused so no old data is deleted.

Restart the app after configuring credentials, sign in, save the business profile, and choose **Connect Google Drive**. Issue a test bill and verify its workbook row. Live Google access remains unverified: OAuth credentials are missing and Chrome is unavailable in this chat.

Sources: [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [Drive permissions](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Generated file IDs](https://developers.google.com/workspace/drive/api/guides/create-file).
