// Export: session.md (primary - the artifact you hand to an LLM) and
// session.jsonl (the contract - docs/dump-format.md, schema 1).
// Both are built from the same redacted event list. Redaction runs here,
// once, before either file exists.

import { redactEvent, redactUrl } from './redact.js';

const SCHEMA = 1;
const TOOL_VERSION = '0.1.1';

const CONSENT_KEY = { ga4: 'analytics_storage', gads: 'ad_storage', floodlight: 'ad_storage', meta: 'ad_storage', tiktok: 'ad_storage' };

// Per-event override: GA4 is an analytics vendor, but its Google Signals ping
// sets an ad cookie and answers to ad_storage. Checking it against
// analytics_storage would miss an ad-storage mismatch.
const consentKey = (e) => (e.event === '(google_ads_sync)' ? 'ad_storage' : CONSENT_KEY[e.vendor]);

function decodeGcs(gcs) {
  const digits = /^G1([01])([01])$/.exec(gcs);
  return digits ? { ad_storage: digits[1] === '1' ? 'granted' : 'denied', analytics_storage: digits[2] === '1' ? 'granted' : 'denied' } : null;
}

const CONSENT_TYPES = new Set(['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization', 'functionality_storage', 'personalization_storage', 'security_storage']);
function consentState(params = {}) {
  return Object.fromEntries(Object.entries(params).filter(([key, value]) =>
    (CONSENT_TYPES.has(key) && (value === 'granted' || value === 'denied')) ||
    (key === 'wait_for_update' && typeof value === 'number' && Number.isFinite(value)) ||
    (key === 'region' && Array.isArray(value) && value.every((v) => typeof v === 'string'))));
}

// Identical payloads sent to different streams are separate measurements.
const streamId = (p) => (p && (p.tid || p.id || p.src || p.counter || p.pixel_code || p.api_key)) || '';

const VOLATILE = new Set(['sct', 'seg', 'ts', 'random', 'rqm', 'r', 'num', 'timestamp', 'time', 'event_time', 'eid', 'event_id', 'insert_id', 'message_id']);
const salesTag = (e) => e.vendor === 'floodlight' && (e.params?.qty !== undefined || e.params?.cost !== undefined);
const orderId = (e) => {
  const p = e.params || {};
  if (['ga4', 'datalayer'].includes(e.vendor)) return p.transaction_id;
  if (e.vendor === 'gads') return p.oid;
  if (salesTag(e)) return p.ord;
};
const dedupField = (e) => ({ meta: 'eid', amplitude: 'insert_id', tiktok: 'event_id' })[e.vendor];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  return value;
}

function dupeKey(e, kind) {
  // Google Ads conversion actions share one account id and differ by label;
  // Ads deduplicates transaction ids per action, so the label is part of the stream.
  const prefix = [e.vendor, streamId(e.params), ...(e.vendor === 'gads' ? [e.params?.label ?? ''] : [])];
  if (kind === 'order_id') return [...prefix, e.event, orderId(e)];
  // Meta and TikTok deduplicate on event name plus id; Amplitude on insert_id alone.
  if (kind === 'dedup_key') return [...prefix, ...(e.vendor === 'amplitude' ? [] : [e.event]), dedupField(e), e.params?.[dedupField(e)]];
  const payload = Object.fromEntries(Object.entries(e.params || {}).filter(([k]) =>
    !k.startsWith('_') && !VOLATILE.has(k) && !(e.vendor === 'floodlight' && k === 'ord' && !salesTag(e))));
  return [...prefix, e.event, stable(payload)];
}

function duplicateSuspects(events) {
  const seen = new Map();
  const dupes = [];
  for (const e of events) {
    if (e.vendor === 'request') continue;
    // Recording chunks carry only the counter id, so every pair would collide.
    if (e.vendor === 'metrica' && (e.event === 'webvisor' || e.event === 'clickmap')) continue;
    const keys = [
      ['order_id', orderId(e)],
      ['dedup_key', e.params?.[dedupField(e)]],
      ['payload', true],
    ];
    let found = false;
    for (const [kind, value] of keys) {
      if (value === undefined || value === null || value === '') continue;
      const key = JSON.stringify([kind, ...dupeKey(e, kind)]);
      const prev = seen.get(key);
      if (!found && prev && (kind !== 'payload' || e.ts - prev.ts <= 2000)) {
        dupes.push({ kind, a: prev.seq, b: e.seq, gap: e.ts - prev.ts });
        found = true;
      }
      seen.set(key, e);
    }
  }
  return dupes;
}

/**
 * Order, stamp consent, redact - in that order, and only here.
 *
 * The panel appends events as they arrive, but dataLayer pushes surface in
 * 500ms drain batches, so arrival order is not send order: a push at t=1000
 * can land after a network hit at t=1200. Consent state is the thing that
 * suffers - a stamp taken on arrival can miss a `consent update` that really
 * happened first, and "fired while denied" is a headline finding to get wrong.
 * So the timeline is sorted by send time here, consent is replayed over it,
 * and `seq` is assigned last - leaving file order, time order and seq order
 * identical in both outputs.
 */
export function buildSession({ startedAt, page, notes = '', userAgent = '', events, capture = {} }) {
  const hits = [];
  const consent = {};
  const ordered = [...events]
    .sort((a, b) => a.ts - b.ts || a.seq - b.seq)
    .map((e, i) => ({ ...e, seq: i + 1 }));
  const dupes = duplicateSuspects(ordered);
  const out = ordered.map((e) => {
    const stamped = { ...e };
    if (stamped.historical !== true) delete stamped.historical;
    if (stamped.truncated !== true) delete stamped.truncated;
    if (Object.keys(consent).length) stamped.consent = { ...consent };
    else delete stamped.consent;
    if (e.source === 'consent') Object.assign(consent, consentState(e.params));
    const { event, hits: h } = redactEvent(stamped);
    for (const x of h) hits.push({ ...x, seq: stamped.seq });
    return event;
  });
  const header = {
    type: 'session',
    schema: SCHEMA,
    tool: 'pulsecheck',
    version: TOOL_VERSION,
    startedAt,
    // Where the session began, not where it ended. The panel tracks the
    // current page, so passing that through would label a session that
    // navigated with its last URL - and name the export file after it too.
    page: (out.length && out[0].page) || redactUrl(page, [], 'page'),
    userAgent,
    notes,
    // What the recorder was set to. Without this, "no API calls in the dump"
    // is ambiguous between "none happened" and "we were not recording them".
    capture: { allRequests: !!capture.allRequests, dropped: capture.dropped ?? 0, truncated: out.filter((e) => e.truncated === true).length },
  };
  // Compare original identifiers, but expose only redacted keys in findings.
  for (const d of dupes) d.key = JSON.stringify(dupeKey(out[d.b - 1], d.kind));
  return { header, events: out, checks: checks(out, hits, dupes) };
}

export function toJsonl(session) {
  return [session.header, ...session.events].map((o) => JSON.stringify(o)).join('\n') + '\n';
}

// --- checks ------------------------------------------------------------
// Cheap, mechanical, and every number derivable from the dump. The skill
// does the real analysis; this exists so a dump is legible without tooling.
function checks(events, hits, dupes) {
  const byVendor = new Map();
  const byName = new Map();
  for (const e of events) {
    const v = byVendor.get(e.vendor) || { count: 0, names: new Set(), ids: new Set() };
    v.count++;
    v.names.add(e.event);
    for (const k of ['tid', 'id', 'src', 'counter', 'pixel_code', 'api_key']) {
      if (e.params && e.params[k]) v.ids.add(String(e.params[k]));
    }
    byVendor.set(e.vendor, v);
    // Top events ranks what the page measures. One embedded YouTube player
    // emits dozens of telemetry beats and would otherwise own the table -
    // context traffic stays in the inventory and the timeline, not the ranking.
    if (e.vendor === 'request') continue;
    const nk = e.vendor + ' · ' + e.event;
    byName.set(nk, (byName.get(nk) || 0) + 1);
  }

  const consent = events
    .map((e) => ({ e, key: consentKey(e) }))
    .filter(({ e, key }) => key && e.consent && e.consent[key] === 'denied')
    .map(({ e, key }) => {
      const gcs = e.params?.gcs;
      const claim = decodeGcs(gcs)?.[key];
      const kind = ['meta', 'tiktok'].includes(e.vendor) ? 'ungated' : claim === 'denied' ? 'cookieless' : claim === 'granted' ? 'mismatch' : 'unsigned';
      return { seq: e.seq, vendor: e.vendor, event: e.event, key, kind, gcs };
    });

  const piiByPath = new Map();
  for (const h of hits) {
    const p = piiByPath.get(h.path) || { path: h.path, kinds: new Set(), count: 0, seqs: [], inUrl: false };
    p.kinds.add(h.kind);
    p.inUrl ||= h.inUrl === true || /^(url|page)\./.test(h.path);
    p.count++;
    if (p.seqs.length < 5) p.seqs.push(h.seq);
    piiByPath.set(h.path, p);
  }

  return {
    vendors: [...byVendor.entries()].map(([vendor, v]) => ({ vendor, count: v.count, names: v.names.size, ids: [...v.ids] })).sort((a, b) => b.count - a.count),
    top: [...byName.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 15),
    dupes,
    consent,
    pii: [...piiByPath.values()].map(({ kinds, ...p }) => ({ ...p, kind: [...kinds].join(', ') })).sort((a, b) => b.count - a.count),
    unparsed: events.filter((e) => e.vendor === 'unparsed').length,
    generic: events.filter((e) => e.vendor === 'generic').length,
  };
}

// --- markdown ----------------------------------------------------------
const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (headers, rows) =>
  [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

const dur = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

const hostOf = (url) => { try { return new URL(url).host; } catch { return ''; } };

export function toMarkdown(session) {
  const { header, events, checks: c } = session;
  const last = events.length ? events[events.length - 1].ts : header.startedAt;
  const L = [];

  L.push('# Pulsecheck - tracking session', '');
  L.push(table(['Field', 'Value'], [
    ['Page', header.page],
    ['Scenario', header.notes || '(not stated)'],
    ['Started', new Date(header.startedAt).toISOString()],
    ['Duration', dur(last - header.startedAt)],
    ['Events', events.length],
    ['dataLayer pushes dropped (tap buffer full)', header.capture.dropped],
    ['Events with clipped payloads (200 keys / depth 6)', header.capture.truncated],
    ...(events.some((e) => e.historical) ? [['Pre-recording dataLayer entries', `${events.filter((e) => e.historical).length} (snapshot at panel open; their time is the snapshot time)`]] : []),
    ['Site requests (non-tracking)', header.capture.allRequests ? 'recorded' : 'NOT recorded - the "API context" toggle was off'],
    ['User agent', header.userAgent],
    ['Dump schema', `v${header.schema} (Pulsecheck ${header.version})`],
  ]));
  L.push('', 'Detection is incomplete; review before sharing. Scenario notes and the user-agent string are not redacted.', '');

  L.push('## Automatic checks', '');
  L.push(`- Duplicate suspects: **${c.dupes.length}**` +
    (c.dupes.length ? '\n' + c.dupes.slice(0, 20).map((d) => {
      const e = events[d.b - 1];
      const detail = d.kind === 'order_id' ? `${d.gap}ms apart (order id ${orderId(e)} repeated)`
        : d.kind === 'dedup_key' ? `${d.gap}ms apart (dedup key ${dedupField(e)}=${e.params[dedupField(e)]} repeated)`
        : `${d.gap}ms apart (same payload)`;
      return `  - \`${d.key}\` - seq ${d.a} and ${d.b}, ${detail}`;
    }).join('\n') : ''));
  L.push(`- Consent observations (sent while the Google Consent Mode storage they answer to was denied): **${c.consent.length}**` +
    (c.consent.length ? '\n' + c.consent.slice(0, 20).map((o) => {
      const description = { cookieless: 'cookieless ping, expected', mismatch: 'the hit claims consent the page did not grant', unsigned: o.gcs ? 'unrecognised gcs on the hit' : 'no gcs on the hit', ungated: 'not gated by Consent Mode' }[o.kind];
      return `  - seq ${o.seq}: ${o.vendor} \`${o.event}\`, ${o.key}=denied${o.gcs ? ', gcs=' + o.gcs : ''}: ${description}`;
    }).join('\n') : ''));
  L.push(`- Sensitive fields (masked): **${c.pii.length}**` +
    (c.pii.length ? '\n' + c.pii.map((p) => `  - \`${p.path}\` - ${p.kind}, ${p.count}x${p.inUrl ? ', **in a URL**' : ''} (seq ${p.seqs.join(', ')})`).join('\n') : ''));
  L.push(`- Not recognised by any parser: **${c.unparsed}**, caught by the generic parser: **${c.generic}**`);
  L.push('');

  L.push('## Inventory', '');
  L.push(c.vendors.length
    ? table(['Vendor', 'Events', 'Unique names', 'Identifiers'], c.vendors.map((v) => [v.vendor, v.count, v.names, v.ids.join(', ') || '-']))
    : '_Nothing captured._');
  L.push('');

  L.push('## Top events', '');
  L.push(c.top.length ? table(['Event', 'Count'], c.top.map((t) => [t.name, t.count])) : '_Nothing captured._');
  L.push('');

  L.push('## Redaction', '');
  L.push('Pattern-based redaction masks detected emails, phones and IP addresses, plus values under recognised personal-identifier, person-name and secret keys in parameters, bodies, request URLs, page URLs and URL-valued parameters (including paths and fragments). IP detection applies to whole trimmed addresses or values under IP-like keys, excluding uafvl, uapv and keys containing version. Every event name undergoes inline pattern detection; paths in METHOD /path names use the same segment rules as URL paths. Client ids and other audit identifiers are kept by design. Event names and page_name are not treated as person-name keys. Detection is incomplete; review before sharing. Scenario notes and the user-agent string are not redacted. Every number in this file is derivable from the timeline at the end of the document.', '');

  L.push('## Timeline');
  let page = null;
  for (const e of events) {
    if (e.page !== page) {
      page = e.page;
      L.push('', `### ${page}`, '');
    }
    const t = ((e.ts - header.startedAt) / 1000).toFixed(1);
    const src = e.source === 'network' ? `network/${hostOf(e.url) || '?'} · **${e.vendor}**` : e.source === e.vendor ? e.source : `${e.source} · **${e.vendor}**`;
    const params = e.params && Object.keys(e.params).length ? ' `' + oneLine(e.params) + '`' : '';
    L.push(`- \`${e.historical ? 'before' : '+' + t + 's'}\` **${e.seq}** · ${src} · \`${e.event}\`${params}`);
  }

  L.push('', '---', '');
  L.push('## What to do with this', '');
  L.push('Hand this file to Claude Code with the `pulsecheck-analyze` skill (`skill/SKILL.md`),');
  L.push('or just ask: "analyse this tracking dump as an audit".');
  L.push('Save .jsonl in the panel for the machine-readable version of the same session (schema v1, docs/dump-format.md).');
  L.push('');
  return L.join('\n');
}

// JSON on one line, undefined dropped, long strings clipped so a single
// runaway payload cannot swamp the file.
function oneLine(params) {
  return JSON.stringify(params, (k, v) => {
    if (v === undefined) return undefined;
    if (typeof v === 'string' && v.length > 600) return v.slice(0, 600) + '…[clipped]';
    return v;
  });
}

export function fileBase(session) {
  const host = hostOf(session.header.page) || 'session';
  const d = new Date(session.header.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `pulsecheck-${host}-${d}`;
}
