# Tamil website preview

For the newer offline phonetic-entry and reviewed Tamil bill-print checkpoint, see [offline-tamil-billing.md](offline-tamil-billing.md). The original implementation notes below describe the 1.0.17 baseline.

This phase changes only localhost website source. Do not package or install the desktop application until separately approved.

## Open the isolated demo

Open http://127.0.0.1:3103/ or run `Start Tamil Website Preview.cmd`.

- Demo username: `tamil-demo`
- Demo sign-in credentials are shared directly, not stored in this public repository.
- Data folder: `D:\app\tmp\tamil-website-demo`
- One sample business, customer and bill are provided. Do not enter real personal or financial information.
- The sample-only banner comes from the verified directory and marker, not a public feature flag.
- Port 3101 is the existing real-ledger website: do not use it for Tamil tests. This launcher does not start, stop or reuse 3100 or 3101.

For first setup in a fresh checkout, run `node scripts/start-tamil-preview.mjs --initialize`. This creates a marked, empty synthetic directory only when it does not already exist. Ordinary launch refuses missing/unmarked sample storage or a different LOCAL_DATA_DIR; it never falls back to `data/`. A fresh empty demo needs its own demo sign-in/account setup.

## Tamil entry, English records

Use the Tamil/English switch, also available before sign-in. The interface language is remembered in this browser.

Names, father’s names, addresses, particulars and custom jewellery accept Tamil drafts. A small offline dictionary offers known English spellings (குமார் → Kumar; மோதிரம் → Ring). Unknown Tamil words need manual English spelling. This is not Google Translate, general sentence translation or automatic transliteration. No customer text is sent to an external translation provider.

Edit the English suggestion, then press **Confirm English spelling**. Tamil drafts are not saved; saving is blocked until confirmation or discard. Phone, Aadhaar, identifiers, amounts and weights are not converted. Standard jewellery, metal, status and remark choices display translated labels while retaining their original English values.

Database records, Excel and generated PDFs remain English. Server write validation refuses Tamil script in record text even for stale tabs or skipped browser controls. It is not ASCII-only: accented Latin and normal punctuation remain accepted. Reading existing records does not rewrite or reject them; historical blanks remain editable. Editing an existing record containing Tamil requires correcting that text before re-saving.

## Historical imports

A workbook with Tamil customer-name, address or particulars cells is blocked as a whole. The error names the sheet, row and column. Correct the cell to confirmed English and retry. Rejection happens before import backup/write: no partial rows are imported.

## Verification

Tests cover narrow script guards, historical blanks, bill/customer create/edit refusal, all-or-nothing historical import, and English values through the actual local database, Excel and PDF. Preview safety tests cover missing/wrong configuration and invalid markers. Visual layout, Tamil wording and keyboard/IME entry still need the owner’s localhost test.
