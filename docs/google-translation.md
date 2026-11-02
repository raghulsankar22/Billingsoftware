# Optional Translate with Google button

## Status and scope

The isolated Tamil branch includes an optional **Translate with Google** control for customer name, father's name and address in bill/customer forms and in Tamil bill review. Other fields do not opt in. The installed desktop app and main checkout are not changed by this branch.

Offline suggestions remain the default. No translation request is made on typing, mounting or opening a bill. The button opens a disclosure; staff must tick consent and press **Translate selected field**. Each request contains one field only. Google results appear separately and are applied only with **Use this suggestion**. Reverse Tamil-to-English suggestions still require the existing **Confirm English spelling** step before saving. Tamil print text still requires bill review before printing. Google can translate the meaning of personal names, so official spellings must always be checked.

The optional online feature uses Google Translate through the official Cloud Translation API. Internet access is required. It is not an offline Google engine. This app does not imply Google endorsement. Automatic translations have no accuracy guarantee; the result panel links to Google's translation disclaimer.

- Official API: https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate
- Setup: https://docs.cloud.google.com/translate/docs/setup
- Pricing: https://cloud.google.com/translate/pricing
- Attribution/disclaimer: https://docs.cloud.google.com/translate/attribution

## Activation (not performed yet)

The code fails closed until BOTH server settings are present:

    BILLING_GOOGLE_TRANSLATION=1
    GOOGLE_TRANSLATION_API_KEY=<private Cloud Translation API key>

Use the isolated worktree's ignored .env.local or the server's private environment. Never prefix this key with NEXT_PUBLIC_, never put it in a form/browser bundle, and never commit it. Use secure secret entry with the assistant rather than posting a key in chat. Do not reuse Google Drive OAuth credentials: those are a different integration.

The owner must first choose a Google Cloud project, enable Cloud Translation API, arrange billing and create an appropriately restricted API key. Limit the key to Cloud Translation API; apply server/network restrictions appropriate to the deployment. Changes to billing, API enablement and key restrictions are the owner's decision. Restart the isolated website after setting the private environment.

No API key is committed. Automated tests mock Google; live activation is a separate owner setup step. With missing/disabled configuration the form shows an actionable setup error and preserves the draft.

## Data and persistence

Only the selected name/address text is processed. Text is sent from the local browser to this app's authenticated server, and only its nonnumeric segments are forwarded to Google. Tokens containing digits and currency signs stay local and are reassembled unchanged; this includes house numbers, mixed numeric IDs, phone/Aadhaar digits, dates and decimals accidentally embedded in the chosen field. Do not paste phone or Aadhaar information into name/address fields. Dedicated phone/Aadhaar/ID/amount/weight inputs never offer Google translation. Empty, oversized, extra-field or nonconsented requests are rejected.

Text, translations and API keys are not logged or cached by application code, and no translation history is saved. Existing hosting/provider logs and Google's handling remain subject to those services' policies. The API key is sent only in the server's x-goog-api-key header, not a URL. Provider errors are replaced with fixed public messages. Outputs are rendered as React text/textarea values, never as HTML.

Google edits cannot directly change ledger records. Choosing an English suggestion still leaves it pending human confirmation; Tamil suggestions update only the temporary display/print draft. Phone, Aadhaar, bill/customer IDs, dates, weights, amounts, saved English PDFs and Excel continue through the original unchanged storage paths. Tamil preview corrections are transient and are NOT carried from entry fields into the separately reviewed bill preview.

## Limits and cost controls

The endpoint requires the existing signed-in local session, same-origin protection, and requireUser authentication for cloud mode. Only en/ta are supported, with an explicit source and different target. Names are limited to 120 input characters and addresses to 500. Request bodies are bounded to 8192 bytes, upstream responses to 32768 bytes, and a request can contain at most 24 nonnumeric text segments. Google calls time out after 10 seconds; there are no automatic retries.

An in-process limit allows at most 20 requests/user/minute and 60 total/minute. This resets on restart and is not a monthly spending cap or a cross-server quota. Configure Google's own API quotas and budget alerts before production activation. Budget alerts alone do not stop spending. Every repeated manual click can incur another API call; names are not cached to avoid retaining private text.

Changing the source text/direction or leaving the field cancels its pending client request and resets consent/result state. If a paid upstream request has already reached Google, browser cancellation cannot guarantee that billing is avoided. Late results cannot overwrite the newer field or be automatically accepted.

## Verification and remaining work

Automated tests cover official URL/header/body use, local-session and cross-origin refusal, absent key/flag, consent, allowed fields/languages, input/body bounds, numeric isolation and reassembly, encoded quotes, malformed provider output, safe errors, rate limits, authenticated client requests, late-result cancellation, no-network rendering and original English persistence tests.

Current automated results: 507 tests in 79 files pass, typecheck passes, and lint has zero errors with six existing warnings. No real Google request, browser session, server, production build or installer was used for this implementation checkpoint.

Still required: owner API-key/billing setup, a synthetic live Google smoke test after explicit activation, browser consent/review interaction testing, real Tamil keyboard/IME testing, and Tamil printed/PDF layout review. Do not install or claim live Google verification until those checks are complete. No production build/install or real-ledger write is part of this task.
