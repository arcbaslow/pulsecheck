# Vendor parsers - spec

Parsers are declarative: a matcher (host/path/query signature) plus a param
map. Adding a vendor must not require touching capture code. Do not chase
Omnibug's vendor count - focus on formats observed in audits.

## Interface

```ts
interface Parser {
  id: string;                            // "ga4", "meta", ...
  match(req: CapturedRequest): boolean;  // cheap, no body access
  extract(req: CapturedRequest): ParsedEvent[];  // may read body; N events per request
}
```

Order matters: specific vendors first, `generic` last, `unparsed` fallback
is not a parser (emitted when extract throws, or a specific match decodes nothing).

## v0.1 vendors

### ga4
- Match: path `/g/collect`, `/mp/collect` or `/debug/mp/collect` on any host (sGTM custom
  domains!), OR query has `v=2` AND `tid=G-*`. Also `region1.google-analytics.com`
  style regional endpoints.
- Extract: query params + body lines (batch: each body line = one event,
  `en` = event name, `ep.*`/`epn.*` = params, `up.*` = user props). Keep
  `tid`, `cid`, `sid` in params - the skill needs them for stream/dedup
  checks. Flag `_dbg` presence.
- Measurement Protocol POST JSON with `events[]`: one event per entry, named
  by `name`, carrying its `params`. `tid` comes from query `measurement_id`
  or `firebase_app_id`; body `client_id`, `app_instance_id`, `user_id` and
  `timestamp_micros` are retained when present. Body `consent` is kept in
  params as the hit's own claim, separate from stamped page consent.
  `/debug/mp/collect` sets `debug_mode:true`. Never copy `api_secret` into
  params; the request URL is retained and its secret is redacted on export.
  Non-JSON bodies keep the form-line batch path.

### meta
- Match: host `facebook.com` or `connect.facebook.net`, path `/tr`
  (pixel GET/POST); note CAPI-gateway custom domains match by query
  signature `id=<15-16 digit>` + `ev=`.
- Extract: `ev` = event, `cd[*]` = custom data, `id` = pixel id, `eid` =
  event_id (dedup key - critical for CAPI audits).

### metrica
- Match: host `mc.yandex.ru` (also `mc.webvisor.org`), paths `/watch/<id>`,
  `/webvisor/<id>` and `/clmap/<id>`.
- Recording endpoints: `/webvisor/` yields `webvisor`, `/clmap/` yields
  `clickmap`. Keep only `counter`; do not decode or retain recording bodies.
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
- Match: amplitude.com or its subdomains (api2, api.eu, api.lab), path
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

### gads
- Match: `/pagead/conversion/<id>`, `/pagead/viewthroughconversion/<id>`
  or `/pagead/1p-conversion/<id>` on googleadservices.com, doubleclick.net
  and google.* hosts (including subdomains and regional TLDs).
- Extract: event named by path (`conversion`, `viewthroughconversion`,
  `1p_conversion`), numeric conversion id in `params.id`, all query params
  preserved. `label` present means a conversion action; absent means
  remarketing or sync. Do not infer intent from `viewthroughconversion` alone.
- The `1p-conversion` host has not been verified against a live capture;
  www.google.com and regional Google hosts are expected, matched by path.

### floodlight
- Match: any doubleclick.net host whose path carries `/activityi`,
  `/activityj` or `/ddm/activity/` (`<n>.fls.`, `ad.` and `td.` hosts; the
  `td.doubleclick.net/td/fls/rul/` shape is not verified against a live capture).
- Extract: semicolon-delimited path params after the activity word, decoded
  like form params; normal query params override them. Event is `type/cat`,
  whichever exists, or `activity`. Keep advertiser id `src`, `ord`, `qty`,
  `cost`, custom `uN` variables and all other params. `ord` is an order id
  only when `qty` or `cost` exists; otherwise it is a cache buster.

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

Cases live inline in `test/run.mjs`, grouped by `console.log` headings,
using synthetic requests and sanitised live captures. There are no fixture
files and tests use no live network. When a vendor changes wire format,
add a case alongside existing cases so old formats stay supported.

## Out of scope v0.1

Adobe Analytics, Tealium, Segment, Matomo, VK/Top.Mail pixels. Candidates
for v0.1.x by audit demand - VK pixel first if a client needs it.
