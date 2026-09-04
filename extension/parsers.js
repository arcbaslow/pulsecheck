// Vendor parsers - spec: docs/parsers.md
// Matchers are cheap and body-free where possible; extract() may read the body
// and may return N events for one request (GA4 / Amplitude batches).
// Order matters: specific vendors first, generic last.

/** Build the request shape parsers consume. Kept chrome-free so tests can call it. */
export function toRequest({ url, method = 'GET', body = '', transport = 'other' }) {
  let u;
  try { u = new URL(url); } catch { u = new URL('http://invalid.local/'); }
  return {
    url,
    method: (method || 'GET').toUpperCase(),
    body: body || '',
    transport,
    host: u.hostname,
    path: u.pathname,
    q: qs(u.searchParams),
  };
}

const qs = (sp) => {
  const o = {};
  for (const [k, v] of sp) o[k] = v;
  return o;
};

const urlencoded = (s) => (s ? qs(new URLSearchParams(s)) : {});

// Meta's pixel POSTs multipart/form-data, not urlencoded. Feeding that to
// URLSearchParams yields one garbage key holding the whole body, so `ev` never
// surfaces and the event lands as "(unnamed)".
const multipart = (s) => {
  // Chrome's delimiter line is `--` + a `----WebKitFormBoundary…` boundary,
  // so six dashes, not ten. Safe to keep loose: without named parts below,
  // this returns null and the urlencoded path takes over.
  const boundary = /^\s*(-{4,}[^\r\n]+)/.exec(s || '');
  if (!boundary) return null;
  const out = {};
  for (const part of s.split(boundary[1])) {
    const m = /name="([^"]+)"[\s\S]*?\r?\n\r?\n([\s\S]*?)\r?\n?$/.exec(part);
    if (m) out[m[1]] = m[2].trim();
  }
  return Object.keys(out).length ? out : null;
};

const form = (s) => multipart(s) || urlencoded(s);

const json = (s) => {
  if (!s) return null;
  const t = s.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return null;
  try { return JSON.parse(t); } catch { return null; }
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' ? n : v;
};

// --- ga4 ---------------------------------------------------------------
// sGTM runs on client-owned domains, so host matching alone is not enough:
// the query signature (v=2 + tid=G-) identifies GA4 anywhere.
const ga4 = {
  id: 'ga4',
  match: (r) =>
    /\/(g|mp|a)\/collect$/.test(r.path) ||
    (r.q.v === '2' && /^G-/.test(r.q.tid || '')) ||
    (r.host.endsWith('google-analytics.com') && r.path.includes('collect')),
  extract(r) {
    const base = r.q;
    // POST batch: one event per body line, each line overriding the shared query params.
    const lines = r.method === 'POST' && r.body ? r.body.split('\n').filter((l) => l.trim()) : [];
    const rows = lines.length ? lines.map((l) => ({ ...base, ...form(l) })) : [base];
    return rows.map((row) => ({
      vendor: 'ga4',
      // A /g/collect with no `en` on a doubleclick host is the Google Signals
      // ad-cookie sync, not a nameless event - and its presence is an audit
      // signal (Signals on, ad_storage granted), so name it instead of hiding it.
      event: row.en || (row.t === 'pageview' ? 'page_view' : row.t) ||
        (/doubleclick\.net$/.test(r.host) ? '(google_ads_sync)' : '(no event name)'),
      params: ga4Params(row),
    }));
  },
};

function ga4Params(row) {
  const p = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('ep.')) p[k.slice(3)] = v;
    else if (k.startsWith('epn.')) p[k.slice(4)] = num(v);
    else if (k.startsWith('up.')) p['user.' + k.slice(3)] = v;
    else if (k.startsWith('upn.')) p['user.' + k.slice(4)] = num(v);
    else p[k] = v;
  }
  if ('_dbg' in row) p.debug_mode = true;
  return p;
}

// --- meta --------------------------------------------------------------
const meta = {
  id: 'meta',
  match: (r) =>
    ((r.host === 'connect.facebook.net' || /(^|\.)facebook\.com$/.test(r.host)) && r.path.startsWith('/tr')) ||
    (/^\d{15,16}$/.test(r.q.id || '') && !!r.q.ev),
  extract(r) {
    const row = { ...r.q, ...(r.method === 'POST' ? form(r.body) : {}) };
    const p = {};
    for (const [k, v] of Object.entries(row)) {
      const cd = /^cd\[(.+)\]$/.exec(k);
      const ud = /^ud\[(.+)\]$/.exec(k);
      if (cd) p[cd[1]] = v;
      else if (ud) p['user.' + ud[1]] = v;
      else p[k] = v;
    }
    return [{ vendor: 'meta', event: row.ev || '(unnamed)', params: p }];
  },
};

// --- metrica -----------------------------------------------------------
const metrica = {
  id: 'metrica',
  match: (r) => /(^|\.)(mc\.yandex\.(ru|com)|mc\.webvisor\.(org|com))$/.test(r.host) && r.path.startsWith('/watch'),
  extract(r) {
    const row = { ...r.q, ...(r.method === 'POST' ? form(r.body) : {}) };
    const counter = (/^\/watch\/(\d+)/.exec(r.path) || [])[1] || row['counter-id'] || '';
    const pageUrl = row['page-url'] || '';
    const goal = /^goal:\/\//.test(pageUrl) ? decodeURIComponent(pageUrl.replace(/^goal:\/\/[^/]*\//, '')) : '';
    const webvisor = /webvisor|\/wv/.test(r.path) || 'wv-type' in row;
    const p = { counter, page_url: pageUrl };
    if (row['page-ref']) p.referrer = row['page-ref'];
    if (row['browser-info']) p.browser_info = row['browser-info'];
    const info = json(row['site-info']);
    if (info) p.site_info = info;
    else if (row['site-info']) p.site_info = row['site-info'];
    // Metrica sends several hits per pageview and names none of them. The type
    // lives in the leading browser-info flag; we surface the flag verbatim
    // (hit_pv, hit_nb, ...) rather than guessing at Yandex's semantics. Without
    // this every hit is called "hit" and the duplicate check cries wolf on all
    // of them. Webvisor chunks are counted, not decoded - they are recordings.
    const flag = (/(?:^|:)(pv|nb|pa|dl|tr)(?::|$)/.exec(row['browser-info'] || '') || [])[1];
    if (flag) p.hit_type = flag;
    // nohit=1 is Metrica saying "do not count this as a hit" - calling it one
    // makes it a phantom duplicate of the real hit next to it.
    const name = row.nohit === '1' ? 'nohit' : goal || (flag ? 'hit_' + flag : 'hit');
    return [{ vendor: 'metrica', event: webvisor ? 'webvisor' : name, params: p }];
  },
};

// --- amplitude ---------------------------------------------------------
const amplitude = {
  id: 'amplitude',
  match: (r) =>
    (r.host.includes('amplitude.com') && /(httpapi|batch|collect)/.test(r.path)) ||
    (r.method === 'POST' && /"api_key"|api_key=/.test(r.body) && /"events?"|[?&]e=/.test(r.body)),
  extract(r) {
    let payload = json(r.body);
    if (!payload) {
      const f = form(r.body); // legacy HTTP API v1: e=<json>&client=<key>
      payload = { api_key: f.api_key || f.client, events: json(f.e) || json(f.upload) || [] };
    }
    const events = payload.events || payload.e || (Array.isArray(payload) ? payload : [payload]);
    return (Array.isArray(events) ? events : [events]).map((e) => ({
      vendor: 'amplitude',
      event: e.event_type || '(unnamed)',
      params: {
        ...(e.event_properties || {}),
        user_properties: e.user_properties,
        insert_id: e.insert_id,
        device_id: e.device_id,
        user_id: e.user_id,
        session_id: e.session_id,
        api_key: payload.api_key,
      },
    }));
  },
};

// --- tiktok ------------------------------------------------------------
const tiktok = {
  id: 'tiktok',
  match: (r) => r.host === 'analytics.tiktok.com' && /\/pixel\/(track|events)/.test(r.path),
  extract(r) {
    const payload = json(r.body) || {};
    const rows = payload.batch || (Array.isArray(payload) ? payload : [payload]);
    return rows.map((e) => ({
      vendor: 'tiktok',
      event: e.event || '(unnamed)',
      params: {
        ...(e.properties || {}),
        pixel_code: e.pixel_code || payload.pixel_code,
        event_id: e.event_id || e.message_id,
        context: e.context ? { ad: e.context.ad, user: e.context.user } : undefined,
      },
    }));
  },
};

// --- generic (last) ----------------------------------------------------
// Purpose: nothing event-shaped is lost. An unknown sender on the page is
// itself an audit finding.
const NAME_KEYS = ['event', 'event_name', 'eventName', 'event_type', 'eventType', 'en', 'e'];
const nameOf = (o) => {
  for (const k of NAME_KEYS) if (typeof o?.[k] === 'string' && o[k]) return o[k];
  return '';
};
// Query side stays narrow on purpose: `?e=` / `?t=` are cache busters on half
// the web, and a matcher that fires on those buries the timeline in noise.
const queryName = (q) => (typeof q.event === 'string' ? q.event : '');

// First-party collectors are the common blind spot: a beacon to
// /api/collect/open?data={json} is a real event stream with no vendor name on
// it. Requiring both a collector-shaped path AND a JSON payload keeps this
// from firing on ordinary API traffic - a bare /api/events?page=2 has no
// payload and stays out.
const COLLECTOR_PATH = /\/(collect|track|events?|hit|beacon|log)(\/|$)/i;
const PAYLOAD_KEYS = ['data', 'payload', 'json', 'body', 'e', 'p'];

const jsonPayload = (r) => {
  const b = json(r.body);
  if (b) return b;
  for (const k of PAYLOAD_KEYS) {
    const v = r.q[k] && json(r.q[k]);
    if (v && typeof v === 'object') return v;
  }
  return null;
};

// Falls back to the last path segment: /api/collect/open -> "open".
const pathName = (path) => {
  const seg = path.split('/').filter(Boolean).pop() || '';
  return COLLECTOR_PATH.test('/' + seg) || /^\d+$/.test(seg) ? '' : seg;
};

const generic = {
  id: 'generic',
  match(r) {
    if (r.method === 'POST') {
      const p = json(r.body);
      if (p && (nameOf(p) || (Array.isArray(p.events) && p.events.some(nameOf)) || (Array.isArray(p) && p.some(nameOf)))) return true;
      if (r.body && !p && nameOf(form(r.body))) return true;
    }
    if (queryName(r.q)) return true;
    return COLLECTOR_PATH.test(r.path) && !!jsonPayload(r);
  },
  extract(r) {
    const p = json(r.body) || (r.body ? form(r.body) : null) || jsonPayload(r);
    const rows = Array.isArray(p) ? p : Array.isArray(p?.events) ? p.events : p ? [p] : [r.q];
    const fallback = pathName(r.path);
    return rows
      .filter((row) => nameOf(row) || fallback)
      .map((row) => ({
        vendor: 'generic',
        event: nameOf(row) || fallback,
        params: { ...row, _host: r.host, _path: r.path },
      }));
  },
};

export const parsers = [ga4, meta, metrica, amplitude, tiktok, generic];

/**
 * dataLayer messages arrive as plain objects, arrays, or gtag `arguments`
 * objects (serialised to {0:..,1:..}). Consent commands are split out: the
 * panel stamps their state onto every later event.
 */
export function parseDataLayer(msg) {
  if (msg === null || typeof msg !== 'object') return { event: '(message)', params: { value: msg } };
  const args = Array.isArray(msg)
    ? msg
    : '0' in msg
      ? Object.keys(msg).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k) => msg[k])
      : null;
  if (args) {
    const [cmd, a, b] = args;
    if (cmd === 'consent') return { source: 'consent', event: 'consent_' + a, params: b || {} };
    if (cmd === 'event') return { event: String(a ?? '(unnamed)'), params: b || {} };
    return { event: 'gtag_' + cmd, params: { args: args.slice(1) } };
  }
  const { event, ...rest } = msg;
  return { event: typeof event === 'string' && event ? event : '(message)', params: rest };
}

/**
 * Run the parser chain. Total function: a throwing parser yields one
 * `unparsed` record instead of losing the request. Returns [] if no match.
 */
export function parse(req) {
  for (const p of parsers) {
    let matched = false;
    try { matched = p.match(req); } catch { matched = false; }
    if (!matched) continue;
    try {
      const events = p.extract(req) || [];
      if (events.length) return events.map((e) => ({ ...e, url: req.url, transport: req.transport }));
    } catch (err) {
      return [{
        vendor: 'unparsed',
        event: '(' + p.id + ' parse error)',
        params: { error: String(err && err.message ? err.message : err) },
        url: req.url,
        transport: req.transport,
        raw: (req.body || '').slice(0, 4096),
      }];
    }
  }
  return [];
}
