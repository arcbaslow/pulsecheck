# Dump format - session.jsonl (schema v1)

The export format is a contract. tracking-plan-lint and the analysis skill
depend on it. Breaking changes bump `schema` and get a migration note here.

## Migrations

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
{"type":"session","schema":1,"tool":"pulsecheck","version":"0.1.0",
 "startedAt":1754812800000,"page":"https://example.kz/loan",
 "userAgent":"...","notes":"","capture":{"allRequests":false}}
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
| `ts` | int | epoch ms, taken at send (push time for dataLayer, request start for network) |
| `source` | enum | `network` \| `datalayer` \| `consent` |
| `transport` | enum? | network only: `fetch` \| `xhr` \| `beacon` \| `pixel` \| `other` |
| `vendor` | string | `ga4`, `meta`, `metrica`, `amplitude`, `tiktok`, `generic`, `unparsed`, `datalayer`, `consent`, `request` |
| `event` | string | vendor event name as sent; dataLayer: value of `event` key or `(message)` |
| `params` | object | flat-ish decoded params; vendor-native keys, not normalized |
| `url` | string? | network only: full request URL (query preserved, body params merged into `params`) |
| `page` | string | page URL at capture time (SPA navigations update it) |
| `consent` | object? | GCM state stamped at send time, once consent capture is on |
| `redacted` | bool | true if the redaction pass masked anything in this line |
| `raw` | string? | only for `vendor:"unparsed"` - undecoded body, truncated 4 KB |

## Batch expansion

One network request carrying N events (GA4 `/g/collect` body lines,
Amplitude `events[]`) becomes N event lines sharing `url` and `ts`,
with consecutive `seq`. The skill counts events, not requests.

## vendor: "request" - context, not measurement

Off by default, enabled with **All requests** in the panel. The header's
`capture.allRequests` records which - without it, a dump with no API calls in
it is ambiguous between "none happened" and "we were not recording them".

Records XHR / fetch / beacon calls that carry no recognised event: the site's
own API traffic. Static assets are excluded by URL extension and response
MIME rather than by `_resourceType`, which is undocumented on the HAR entry -
a whitelist on a field that might be absent fails silent and captures nothing. `event` is `METHOD /path`, `params` carries `host`, `status`, `mime`
and the request body (2 KB cap, redacted like any other field).

These are not tracking events and must never be counted as such. They exist
so a finding can be anchored to what the site actually did: the form POST
that carried the ИИН, and the pixel 200 ms later that carried a hash of it.
Excluded from the duplicate check - a polling endpoint is not a double-count.

## Redaction

Runs before export, never after. Masks emails, phone numbers, and
name-like values in `params` and `url` query (`d***@***.com`,
`+7*******42`), sets `redacted:true`. The pre-redaction value never leaves
the panel. Detected PII locations are themselves an audit finding - the
mask preserves enough shape to prove the leak without carrying it.

## session.md (companion, human- and LLM-facing)

Exported alongside the JSONL and generated from the same redacted events:
session meta, vendor inventory with event counts, top events, mechanical
checks (duplicate suspects - same vendor+event+value within 2s; PII flags
with field and location, masked; consent violations - events sent while the
relevant storage was denied; unparsed/generic counts), then the full
timeline with every parameter, split by page.

This is the file you hand to an LLM, and it is the primary v0.1 output: it
is self-contained, so a dump is legible and analysable without any tooling.
The skill regenerates a richer analysis on top of it. The JSONL stays the
machine contract for tracking-plan-lint.
