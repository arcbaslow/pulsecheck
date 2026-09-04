# Vendor parsers - spec

Parsers are declarative: a matcher (host/path/query signature) plus a param
map. Adding a vendor must not require touching capture code. Do not chase
Omnibug's vendor count - 5 vendors + generic cover ~95% of our audits.

## Interface

```ts
interface Parser {
  id: string;                            // "ga4", "meta", ...
  match(req: CapturedRequest): boolean;  // cheap, no body access
  extract(req: CapturedRequest): ParsedEvent[];  // may read body; N events per request
}
```

Order matters: specific vendors first, `generic` last, `unparsed` fallback
is not a parser (capture layer emits it when extract throws).

## v0.1 vendors

### ga4
- Match: path `/g/collect` or `/mp/collect` on any host (sGTM custom
  domains!), OR query has `v=2` AND `tid=G-*`. Also `region1.google-analytics.com`
  style regional endpoints.
- Extract: query params + body lines (batch: each body line = one event,
  `en` = event name, `ep.*`/`epn.*` = params, `up.*` = user props). Keep
  `tid`, `cid`, `sid` in params - the skill needs them for stream/dedup
  checks. Flag `_dbg` presence.

### meta
- Match: host `facebook.com` or `connect.facebook.net`, path `/tr`
  (pixel GET/POST); note CAPI-gateway custom domains match by query
  signature `id=<15-16 digit>` + `ev=`.
- Extract: `ev` = event, `cd[*]` = custom data, `id` = pixel id, `eid` =
  event_id (dedup key - critical for CAPI audits).

### metrica
- Match: host `mc.yandex.ru` (also `mc.webvisor.org`), path `/watch/<id>`.
- Extract: counter id from path; `page-url`; goals from
  `site-info`/`params` JSON when present; browser-info parsed only for
  event type flags (hit vs goal vs webvisor chunk - webvisor chunks are
  counted, not decoded).
- Naming: Metrica fires several hits per pageview and names none of them.
  Take the leading browser-info type flag and emit it verbatim -
  `hit_pv`, `hit_pa`, `hit_nb` - rather than translating Yandex's
  semantics into ours. Collapsing them all to `hit` makes every pair look
  like a duplicate. `nohit=1` means Metrica is explicitly not counting the
  request: name it `nohit`, never `hit`.

### amplitude
- Match: host `api2.amplitude.com` or `api.eu.amplitude.com`, path
  `/2/httpapi` or `/batch`; proxied setups match by body signature
  (`api_key` + `events[]`).
- Extract: each `events[]` item = one line; `event_type`,
  `event_properties`, `user_properties` keys only (values pass through
  redaction), `device_id`/`user_id` masked by redaction, `insert_id`
  kept (dedup key).

### tiktok
- Match: host `analytics.tiktok.com`, path `/api/v2/pixel/track` or
  `/i18n/pixel/events.js` events; body `event` + `pixel_code`.
- Extract: `event`, `properties`, `pixel_code`, `event_id` (dedup).

### generic (last)
- Match: POST with JSON body containing any of `event`, `event_name`,
  `event_type`, `en`, `e` at top level or in an `events[]` array; or GET
  whose query contains `event=`; or a collector-shaped path
  (`/collect`, `/track`, `/event(s)`, `/hit`, `/beacon`, `/log`) carrying a
  JSON payload in the body or in a `data`/`payload`/`json` query param.
- The payload requirement is the noise filter: `/api/events?page=2` is a
  listing endpoint and stays out, `/api/collect/open?data={...}` is a
  first-party event stream and comes in.
- Extract: best-effort name + flat params, `vendor:"generic"`, host kept in
  params. When the payload carries no name key, fall back to the last path
  segment (`/api/collect/open` -> `open`). Purpose: nothing event-shaped is
  lost, ever - home-grown first-party collectors are the usual blind spot,
  and they are the ones most likely to be shipping raw identifiers.

## Fixtures and tests

One fixture file per vendor in `fixtures/<vendor>/`: captured real request
(sanitized) + expected ParsedEvent[] JSON. Tests are table-driven against
fixtures; no live network in tests. When a vendor changes wire format,
add a new fixture alongside, do not overwrite - old formats stay supported.

## Out of scope v0.1

Adobe Analytics, Tealium, Segment, Matomo, VK/Top.Mail pixels. Candidates
for v0.1.x by audit demand - VK pixel first if a client needs it.
