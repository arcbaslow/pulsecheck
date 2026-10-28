# Dump format - session.jsonl (schema v1)

The export format is a contract. tracking-plan-lint and the analysis skill
depend on it. Breaking changes bump `schema` and get a migration note here.

## Migrations

**2026-10-29, capture metadata and checks.** Schema stays `1`. Optional
`historical` and `truncated` event flags and `capture.dropped` /
`capture.truncated` counters are additive; absent counters mean zero.
Vendor names now include `gads` and `floodlight`. Companion checks expose
`checks.consent` observations and duplicate `kind`; consumers of earlier
companion checks should switch to these fields. Checks are returned by
`buildSession`, not written into JSONL event lines.

**2026-08-10, `tool` renamed.** The project was renamed from `signal-tap` to
`pulsecheck` before any dump left the machine, so `tool` now reads
`"pulsecheck"` and export filenames are `pulsecheck-<host>-<date>.*`.
`schema` stays `1` - no field changed shape. Readers that key on `tool` must
accept `"signal-tap"` as an alias: dumps taken during the pre-rename alpha
are still valid v1 and still worth analysing.

## File layout

JSONL: one JSON object per line. Line 1 is the session header; every
subsequent line is an event.

Order = send time. The panel appends events as they arrive, but dataLayer
pushes surface in drain batches, so arrival order is not send order. Export
sorts by `ts` (arrival order breaks ties), replays consent over the sorted
timeline, and assigns `seq` last. File order, time order and `seq` order are
therefore always identical, in both outputs. `seq` is what findings cite.

## Session header (line 1)

```json
{"type":"session","schema":1,"tool":"pulsecheck","version":"0.1.1",
 "startedAt":1754812800000,"page":"https://example.kz/loan",
 "userAgent":"...","notes":"","capture":{"allRequests":false,"dropped":0,"truncated":0}}
```

## Event lines

```json
{"type":"event","seq":42,"ts":1754812803217,
 "source":"network","transport":"fetch",
 "vendor":"ga4","event":"add_to_cart",
 "params":{"currency":"KZT","value":125000,"tid":"G-XXXX"},
 "url":"https://sgtm.example.kz/g/collect?v=2&...",
 "page":"https://example.kz/loan",
 "consent":{"ad_storage":"denied","analytics_storage":"granted"},
 "redacted":false}
```

| Field | Type | Notes |
|---|---|---|
| `seq` | int | monotonic per session, gap-free, assigned at export in `ts` order |
| `ts` | int | epoch ms, taken at send (push time for dataLayer, request start for network); historical entries use snapshot time |
| `source` | enum | `network` \| `datalayer` \| `consent` |
| `transport` | enum? | network only: `fetch` \| `xhr` \| `beacon` \| `pixel` \| `other` |
| `vendor` | string | `ga4`, `gads`, `floodlight`, `meta`, `metrica`, `amplitude`, `tiktok`, `generic`, `unparsed`, `datalayer`, `consent`, `request` |
| `event` | string | vendor event name; dataLayer: value of `event` key or `(message)`; inline patterns are masked, and `METHOD /path` names also use URL path-segment rules |
| `params` | object | flat-ish decoded params; vendor-native keys, not normalized |
| `url` | string? | network only: full request URL (query preserved, body params merged into `params`) |
| `page` | string | page URL at capture time (SPA navigations update it), redacted using the same URL rules as `url` and the session header's `page` |
| `consent` | object? | GCM state stamped at send time, once consent capture is on |
| `redacted` | bool | true if the redaction pass masked anything in this line |
| `raw` | string? | only for `vendor:"unparsed"` - undecoded body, truncated 4 KB |
| `historical` | true? | pre-recording dataLayer entry, snapshotted at panel open; timeline displays `before`, consent commands still apply to later events |
| `truncated` | true? | tap clipped payload at 200 keys/items or depth 6; omitted unless set |

`capture.dropped` counts dataLayer pushes lost when the tap's 5000-entry
buffer filled. Each drain reports losses since the preceding drain and
resets its counter; the panel accumulates them until Clear.
`capture.truncated` counts exported events with `truncated:true`. Both
counters are always shown in Markdown, including zero. When historical
entries exist, meta also gives their count and explains snapshot timestamps.

## Batch expansion

One network request carrying N events (GA4 `/g/collect` body lines,
GA4 Measurement Protocol JSON `events[]`, Amplitude `events[]`) becomes N event lines sharing `url` and `ts`,
with consecutive `seq`. The skill counts events, not requests.

## vendor: "request" - context, not measurement

Off by default, enabled with **API context** in the panel. The header's
`capture.allRequests` records which - without it, a dump with no API calls in
it is ambiguous between "none happened" and "we were not recording them".

Records metadata for XHR / fetch / beacon calls that carry no recognised event:
the site's own API traffic. Static assets are excluded by URL extension and
response MIME rather than by `_resourceType`, which is undocumented on the HAR
entry. `event` is `METHOD /path`; `params` carries `host`, `status` and `mime`.
Request bodies and query strings are not kept for context rows.

These are not tracking events and must never be counted as such. They exist
so a finding can be anchored to what the site actually did: the form POST
that carried the ИИН, and the pixel 200 ms later that carried a hash of it.
Excluded from the duplicate check - a polling endpoint is not a double-count.

## Redaction

Runs before export, never after. Masks detected emails, phone numbers, IP
addresses and values under recognised personal-identifier, person-name and
national-id keys in `params`, including JSON and form-encoded bodies.
Request URLs, page URLs (including the session header) and absolute HTTP(S)
URL-valued parameters receive authority, query, path and fragment checks.
Path segments use the previous segment as their key; this also applies to
paths in `METHOD /path` event names. Every event name receives inline pattern
detection, but is not treated as a person-name value.

IP detection applies to whole trimmed addresses (including bracketed IPv6)
or values under IP-like keys (`ip`, `ip_address`, `client_ip`, `remote_addr`,
`x-forwarded-for`, `uip`, `_uip`), excluding `uafvl`, `uapv` and keys containing
`version`. URL hosts detected as IP addresses or phone numbers become
`redacted.invalid`. Parser-error `raw` bodies
receive JSON/form decoding and inline detection, without URL-aware handling
of standalone URL strings or multipart parts.

Masking sets `redacted:true` on affected event lines. Detected PII locations
are themselves an audit finding; PII in a URL is always high severity.
Shape-preserving masks (`d***@***.com`, `+7*******42`) retain evidence of a leak.

Named credential and payment-secret fields are replaced with `[redacted]`
rather than shape-preserving masks.
Client ids and other audit identifiers are retained deliberately, but keep-listed
strings still mask emails and plus-prefixed phones (never bare numeric ids).
URL userinfo is cleared structurally, including encoded usernames. Nested
URL decoding is bounded at three levels. Consent replay stamps only valid
Consent Mode storage/user-data/personalization keys with granted/denied,
numeric `wait_for_update` and string-array `region`; extra command fields
stay in the command's own params and are redacted there. Stamped consent
also passes through redaction. Detection
is incomplete; review exports before sharing. Scenario notes and the
user-agent string are not redacted.

## session.md (companion, human- and LLM-facing)

Exported alongside the JSONL and generated from the same redacted events:
session meta, automatic checks, vendor inventory, top events, redaction
information, then the full timeline with every parameter, split by page.

`checks.dupes` entries carry `key`, `a`/`b` (seq), `gap` (ms) and `kind`:
`order_id` (same vendor, stream, event and order id anywhere in the session),
`dedup_key` (same vendor, stream and browser dedup key anywhere; the event name is part of the key for Meta and TikTok, not for Amplitude), or `payload`
(same vendor, stream, event and stable payload within 2s).
Order ids are GA4/dataLayer `transaction_id`, Ads `oid` within one conversion `label` and Floodlight `ord`
only with `qty` or `cost`. Browser dedup keys are Meta `eid`, Amplitude
`insert_id` and TikTok `event_id`. Payload comparison sorts object keys and
omits top-level keys starting with `_`, plus `sct`, `seg`, `ts`, `random`,
`rqm`, `r`, `num`, `timestamp`, `time`, `event_time`, dedup keys, `message_id`
and non-sales Floodlight `ord`. Checks compare events before redaction;
displayed keys are redacted. One suspect per repeated event, with order id
taking priority over dedup key, then payload. Context rows are excluded.

`checks.consent` entries are `{seq, vendor, event, key, kind, gcs}` (`gcs`
optional). GA4 answers to analytics_storage; Ads, Floodlight, Meta, TikTok
and the GA4 `(google_ads_sync)` ping answer to ad_storage. Under denied:
`cookieless` = Google hit's gcs agrees (expected), `mismatch` = it claims
granted, `unsigned` = missing or undecodable gcs, `ungated` = Meta/TikTok
not gated by Consent Mode. Decode `G1ab` as ad_storage=a, analytics_storage=b,
0 denied / 1 granted. These are observations; legal interpretation belongs
to the analysis skill. Metrica and Amplitude are outside Consent Mode and
are judged by the skill from the timeline. Other checks report masked PII
locations and unparsed/generic counts.

This is the file you hand to an LLM, and it is the primary v0.1 output: it
is self-contained, so a dump is legible and analysable without any tooling.
The skill regenerates a richer analysis on top of it. The JSONL stays the
machine contract for tracking-plan-lint.
