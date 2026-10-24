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
{"type":"session","schema":1,"tool":"pulsecheck","version":"0.1.1",
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
| `event` | string | vendor event name; dataLayer: value of `event` key or `(message)`; inline patterns are masked, and `METHOD /path` names also use URL path-segment rules |
| `params` | object | flat-ish decoded params; vendor-native keys, not normalized |
| `url` | string? | network only: full request URL (query preserved, body params merged into `params`) |
| `page` | string | page URL at capture time (SPA navigations update it), redacted using the same URL rules as `url` and the session header's `page` |
| `consent` | object? | GCM state stamped at send time, once consent capture is on |
| `redacted` | bool | true if the redaction pass masked anything in this line |
| `raw` | string? | only for `vendor:"unparsed"` - undecoded body, truncated 4 KB |

## Batch expansion

One network request carrying N events (GA4 `/g/collect` body lines,
Amplitude `events[]`) becomes N event lines sharing `url` and `ts`,
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
Client ids and other audit identifiers are retained deliberately. Detection
is incomplete; review exports before sharing. Scenario notes and the
user-agent string are not redacted.

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
