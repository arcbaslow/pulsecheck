# Chrome Web Store dashboard answers

## Store listing

- Product name: `Pulsecheck - tracking audit recorder`
- Summary: `Records tracking requests, dataLayer pushes and consent changes, then exports the session as Markdown or JSONL.`
- Category: `Developer Tools`
- Language: `English`
- Homepage: `https://github.com/arcbaslow/pulsecheck`
- Support: `https://github.com/arcbaslow/pulsecheck/issues`
- Privacy policy: `https://github.com/arcbaslow/pulsecheck/blob/main/PRIVACY.md`

Paste `description.txt` into the detailed-description field.

## Single purpose

Record a website's measurement activity in Chrome DevTools and export one
tracking-audit session as Markdown or JSONL.

Every feature supports that purpose: network and data-layer capture provide the
evidence, consent replay and duplicate checks annotate it, filtering helps the
user inspect it, and export creates the audit artifact.

## Permissions justification

The manifest requests no extension permissions or host permissions.
`devtools_page` registers the Pulsecheck panel. The panel uses the DevTools
network API while it is open and uses `chrome.devtools.inspectedWindow.eval` to
install the bundled `tap.js` data-layer recorder in the inspected page. No
remote JavaScript is fetched or executed.

## Remote code

Select **No, I am not using remote code**.

All executable JavaScript ships inside the extension ZIP. The privacy-policy
link opens only after a user clicks it and is not used as a code source.

## Data-use disclosure

Conservatively disclose these handled data types:

- Personally identifiable information — may appear in inspected tracking
  payloads; detected fields are masked before export.
- Authentication information — named password, token, cookie and similar fields
  are removed before export.
- Financial and payment information — named card, CVV, IBAN and account-number
  fields are removed before export.
- Web history — inspected page URLs and tracking-request URLs.
- User activity — analytics events can describe actions on the inspected page.
- Website content — request payloads and data-layer values.

For each type, state that processing is local, necessary for the single audit
purpose, not transmitted to the developer and not retained outside the
in-memory session unless the user explicitly creates an export.

Certify that data is not sold, used for unrelated purposes, used for
creditworthiness or lending, or transferred for advertising. The extension has
no telemetry and no developer-operated data collection endpoint.

## Prominent disclosure

The store description states which page and request data is processed. The
panel's empty state says that the session stays local. Enabling optional API
context requires a user click and a confirmation that lists the exact metadata
recorded and states that bodies and query strings are excluded.
