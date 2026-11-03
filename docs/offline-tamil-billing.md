# Native text entry with approved jewellery particulars

## Latest source update: typed text is not translated

Tamil typed in business profiles, customer details, bill text or custom jewellery is retained in Tamil. English stays English. Entry fields no longer offer phonetic suggestions, English confirmation or Google translation. Phone numbers, identifiers, dates, amounts and weights keep their existing validation.

The duplicate Particulars label above the text area is visually hidden while its screen-reader label and main table heading remain. Approved catalogue labels and spellings are unchanged; free-form Tamil particulars receive no English conversion or extra brackets.

Saved records and Excel now retain the script entered by the user, rather than requiring English. Finance/delivery PDFs use bundled shaped Tamil fonts for typed business details, customer details, collector names, particulars and remarks. Historical imports accept Tamil text without conversion. Existing saved records are not rewritten.

These source changes are later than the already-built 1.0.19 installer below. That installer does not include this update until a new build is requested.

## Previous build behavior (1.0.19)

## Version 1.0.19

The interface defaults to English. Choose **View > Languages > English / Tamil (தமிழ்)** in the desktop menu. The website provides the same choices under View. This changes interface labels only, not saved records or customer details.

The approved catalogue contains 76 alphabetically sorted jewellery names. Dropdown labels, read-only lists, finance and delivery printouts, saved PDFs and lost-bill declarations display known particulars as **English (Tamil)**. Quantities remain outside the brackets. Examples: Ring (மோதிரம்) 2, Chain (சயின்), Kaasu Malai (காசு மாலை), Vilva Leaf (வில்வக் இலை), Mathu Mukkuthi (மத்து மூக்குத்தி).

Canonical particulars, names, father's names, addresses, database records and Excel remain English. Existing and custom descriptions are not renamed; only exact known names receive display labels. Legacy Coin and Earrings remain readable without changing stored values. The approved Muthu Arunakodi (Muthu Arunakodi) label is retained exactly.

Full-Tamil bill and Google/name translation controls are no longer offered. No Google key is required and no customer text is sent online. Existing server-side English-record validation remains in effect.

PDF particulars use bundled Latin and Tamil fonts with shaped, selectable text. Browser print waits for the bundled Tamil font. The PDF template version changes so existing cached PDFs regenerate on access; records are not rewritten proactively.

## Lost bill declaration integration

This version includes the other thread's Customer Bill Lost tab, printable English/Tamil declaration, signature boxes, signed-confirmation requirement for single and multiple delivery, and English Excel signed marker. Changes to delivery details clear confirmation. Historical deliveries without a recorded acknowledgement show Not recorded.

## Isolated preview and build

Worktree: D:/app-worktrees/offline-tamil-billing. Builds must not modify D:/app/data. Synthetic preview is restricted to the exact marked demo directory on port 3103; real-data ports 3100 and 3101 are not used for testing.

The sample-only /bilingual-preview route shows English details with bilingual particulars without saving any record. It returns 404 outside demo storage. Building the installer does not install it or update the real ledger.
