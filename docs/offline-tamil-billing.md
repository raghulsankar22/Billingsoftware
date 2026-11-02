# Offline Tamil entry and bill preview

## Development checkpoint

Isolated branch: feature/offline-tamil-billing, based on d4ccd9b. Worktree: D:/app-worktrees/offline-tamil-billing. Not installed, merged or pushed. Installed 1.0.17 is unchanged.

## Entry

In Tamil interface mode, English-record fields now show an editable Tamil phonetic preview below the English input. Kumar becomes குமார்; Muthu becomes முத்து. Preview corrections are temporary: they are not saved or carried into the bill preview.

Typing Tamil instead keeps a pending draft and offers approximate Latin spelling beyond the old dictionary. Check/edit and explicitly confirm the English spelling before saving. Existing server refusal of Tamil record text is unchanged. Phone, Aadhaar, identifiers, dates, amounts and weights have no conversion control.

The default offline path is a dictionary plus deterministic letter-based spelling aid, NOT Google Translate or full sentence translation. English spellings do not uniquely identify Tamil spellings; Latin suggestions are not guaranteed official names. Addresses need human correction. Unsupported characters may stay unchanged. Only the separately consented Google option sends selected text online.

## Tamil customer bill

Open a finance or delivery bill. Tamil interface mode initially shows its Tamil preview; the English bill view also has a Tamil bill button. Review the English source beside each editable Tamil field, correct business/customer/item/collector text, and confirm the checkbox. Any further edit invalidates confirmation. Required original text cannot be blanked to bypass review.

Use Tamil Print / PDF, then choose **Save as PDF** in the browser print dialog. The button waits for bundled Tamil fonts and uses browser text shaping. Direct browser printing before review shows a warning instead of the bill. This is not a server-generated Tamil PDF download.

Tamil edits are for this open preview only. They disappear on close, bill changes or switching to English; they do not overwrite database records, Excel, business snapshots or archived English PDFs. IDs, dates, weights and all financial amounts come directly from the original bill. Delivery totals retain existing saved-summary/calculation rules, including missing historic amounts.

The English bill view still downloads the original English PDF. Legal conditions and amount-in-words text remain in original English (labelled accordingly); existing Tamil notices are retained. Legal text has not been machine-translated.

## Local testing after restart

No website server is left running at this checkpoint because shutdown is pending. From this worktree, first initialize the synthetic folder with: node scripts/start-tamil-preview.mjs --initialize

Then use **Start Tamil Website Preview.cmd** in this worktree. Its existing launcher verifies the exact marked sample folder beneath THIS checkout. If port 3103 belongs to another checkout, it refuses it: do not reuse that server to test these changes. Never use ports 3100/3101 or real data. A new sample folder needs its own demo account setup. Do not enter real customer data.

Automated tests cover bidirectional example spellings, unchanged identifiers, unsupported-character fallback, historical blanks and detached Tamil bill drafts. The full suite also exercises the existing English database/Excel/PDF boundary. Real Tamil IME composition, owner-approved spellings, print layout/page breaks, browser Save as PDF and physical printing still need manual testing after restart. This checkpoint is NOT print-verified.

## Automated verification

485 tests across 76 files pass, including actual component rendering for all three entry fields and Tamil finance/delivery bill markup. Typecheck passes. Lint has zero errors and six warnings (existing warnings plus the same logo-image pattern in the new bill view). No production build, installer, browser session or website server was started for this checkpoint.

## Optional Google integration

The optional button and authenticated server endpoint are now implemented, but not activated or live-tested without an owner-supplied API key. See [google-translation.md](google-translation.md) for the per-field consent flow, setup, data handling, cost controls and remaining checks. Google is not an offline dependency; never commit its key or customer text.
