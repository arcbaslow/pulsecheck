# Pulsecheck - session dump

| Field | Value |
|---|---|
| Page | https://shop.example/checkout |
| Scenario | checkout with a promo code |
| Started | 2026-09-04T10:00:00.000Z |
| Duration | 15s |
| Events | 10 |
| Site requests (non-tracking) | NOT recorded - the "All requests" toggle was off |
| User agent | Chrome |
| Dump schema | v1 (Pulsecheck 0.1.1) |

PII was masked before this file was written. Every number below is derivable from the timeline at the end of the document.

## Inventory

| Vendor | Events | Unique names | Identifiers |
|---|---|---|---|
| ga4 | 4 | 3 | G-DEMO123 |
| datalayer | 3 | 3 | - |
| consent | 2 | 2 | - |
| meta | 1 | 1 | 1234567890123456 |

## Top events

| Event | Count |
|---|---|
| ga4 · purchase | 2 |
| consent · consent_default | 1 |
| datalayer · gtm.js | 1 |
| ga4 · page_view | 1 |
| datalayer · begin_checkout | 1 |
| ga4 · begin_checkout | 1 |
| meta · InitiateCheckout | 1 |
| consent · consent_update | 1 |
| datalayer · purchase | 1 |

## Automatic checks

- Duplicate suspects (same vendor+event+value within 2s): **1**
  - `ga4|purchase|G-DEMO123|129|USD` - seq 9 and 10, 90ms apart
- Events sent while the relevant storage was denied: **1**
  - seq 6: meta `InitiateCheckout` with `ad_storage=denied`
- Sensitive fields (masked): **0**
- Not recognised by any parser: **0**, caught by the generic parser: **0**

## Timeline

### https://shop.example/checkout

- `+0.0s` **1** · consent · `consent_default` `{"analytics_storage":"granted","ad_storage":"denied"}`
- `+0.1s` **2** · datalayer · `gtm.js` `{"gtm.start":1788516000000}`
- `+0.9s` **3** · network/collect.shop.example · **ga4** · `page_view` `{"tid":"G-DEMO123","page_title":"Checkout"}`
- `+8.2s` **4** · datalayer · `begin_checkout` `{"currency":"USD","value":129}`
- `+8.4s` **5** · network/collect.shop.example · **ga4** · `begin_checkout` `{"tid":"G-DEMO123","currency":"USD","value":129}`
- `+8.5s` **6** · network/www.facebook.com · **meta** · `InitiateCheckout` `{"id":"1234567890123456","currency":"USD","value":129,"eid":"evt-42"}`
- `+10.1s` **7** · consent · `consent_update` `{"ad_storage":"granted"}`

### https://shop.example/confirmation

- `+14.3s` **8** · datalayer · `purchase` `{"transaction_id":"A-1042","currency":"USD","value":129}`
- `+14.4s` **9** · network/collect.shop.example · **ga4** · `purchase` `{"tid":"G-DEMO123","transaction_id":"A-1042","currency":"USD","value":129}`
- `+14.5s` **10** · network/collect.shop.example · **ga4** · `purchase` `{"tid":"G-DEMO123","transaction_id":"A-1042","currency":"USD","value":129}`

---

## What to do with this

Hand this file to Claude Code with the `pulsecheck-analyze` skill (`skill/SKILL.md`),
or just ask: "analyse this tracking dump as an audit".
The machine-readable version of the same session is the `.jsonl` next to it
(schema v1, docs/dump-format.md).
