// Export: session.md (primary - the artifact you hand to an LLM) and
// session.jsonl (the contract - docs/dump-format.md, schema 1).
// Both are built from the same redacted event list. Redaction runs here,
// once, before either file exists.

import { redactEvent } from './redact.js';

const SCHEMA = 1;
const TOOL_VERSION = '0.1.1';

// Which consent signal each vendor is supposed to respect.
const CONSENT_KEY = { ga4: 'analytics_storage', metrica: 'analytics_storage', amplitude: 'analytics_storage', meta: 'ad_storage', tiktok: 'ad_storage' };

// Per-event override: GA4 is an analytics vendor, but its Google Signals ping
// sets an ad cookie and answers to ad_storage. Checking it against
// analytics_storage silently passes the exact violation worth catching.
const consentKey = (e) => (e.event === '(google_ads_sync)' ? 'ad_storage' : CONSENT_KEY[e.vendor]);

// The stream a hit belongs to. Two purchases on one GA4 property are a
// duplicate; the same hit to two different Metrica counters is not.
const streamId = (p) => (p && (p.tid || p.id || p.counter || p.pixel_code || p.api_key)) || '';

// What makes two events "the same event fired twice". Network hits carry a
// stream id or a value to compare on. dataLayer pushes carry neither, so six
// section_view pushes with six different section_ids would otherwise all
// collide - fall back to the payload, which is what actually distinguishes
// them. A genuine double-push has an identical payload and still collides.
function dupeKey(e) {
  const sid = streamId(e.params);
  const value = e.params?.value ?? '';
  if (sid || value !== '') return [e.vendor, e.event, sid, value, e.params?.currency ?? ''].join('|');
  return [e.vendor, e.event, JSON.stringify(e.params ?? {})].join('|');
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
  const out = [...events]
    .sort((a, b) => a.ts - b.ts || a.seq - b.seq)
    .map((e, i) => {
      const stamped = { ...e, seq: i + 1 };
      if (Object.keys(consent).length) stamped.consent = { ...consent };
      else delete stamped.consent;
      if (e.source === 'consent') Object.assign(consent, e.params);
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
    page: (out.length && out[0].page) || page,
    userAgent,
    notes,
    // What the recorder was set to. Without this, "no API calls in the dump"
    // is ambiguous between "none happened" and "we were not recording them".
    capture: { allRequests: !!capture.allRequests },
  };
  return { header, events: out, checks: checks(out, hits) };
}

export function toJsonl(session) {
  return [session.header, ...session.events].map((o) => JSON.stringify(o)).join('\n') + '\n';
}

// --- checks ------------------------------------------------------------
// Cheap, mechanical, and every number derivable from the dump. The skill
// does the real analysis; this exists so a dump is legible without tooling.
function checks(events, hits) {
  const byVendor = new Map();
  const byName = new Map();
  for (const e of events) {
    const v = byVendor.get(e.vendor) || { count: 0, names: new Set(), ids: new Set() };
    v.count++;
    v.names.add(e.event);
    for (const k of ['tid', 'id', 'counter', 'pixel_code', 'api_key']) {
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

  // Duplicate suspects: same vendor+event+value inside 2s.
  const seen = new Map();
  const dupes = [];
  for (const e of events) {
    if (e.vendor === 'request') continue; // context traffic; polling is not a double-count
    const key = dupeKey(e);
    const prev = seen.get(key);
    if (prev && e.ts - prev.ts <= 2000) dupes.push({ key, a: prev.seq, b: e.seq, gap: e.ts - prev.ts });
    seen.set(key, e);
  }

  // Consent violations: vendor fired while the storage it answers to was denied.
  const violations = events
    .map((e) => ({ e, key: consentKey(e) }))
    .filter(({ e, key }) => key && e.consent && e.consent[key] === 'denied');

  const piiByPath = new Map();
  for (const h of hits) {
    const p = piiByPath.get(h.path) || { path: h.path, kind: h.kind, count: 0, seqs: [], inUrl: h.path.startsWith('url.') };
    p.count++;
    if (p.seqs.length < 5) p.seqs.push(h.seq);
    piiByPath.set(h.path, p);
  }

  return {
    vendors: [...byVendor.entries()].map(([vendor, v]) => ({ vendor, count: v.count, names: v.names.size, ids: [...v.ids] })).sort((a, b) => b.count - a.count),
    top: [...byName.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 15),
    dupes,
    violations,
    pii: [...piiByPath.values()].sort((a, b) => b.count - a.count),
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

  L.push('# Pulsecheck - session dump', '');
  L.push(table(['Field', 'Value'], [
    ['Page', header.page],
    ['Scenario', header.notes || '(not stated)'],
    ['Started', new Date(header.startedAt).toISOString()],
    ['Duration', dur(last - header.startedAt)],
    ['Events', events.length],
    ['Site requests (non-tracking)', header.capture.allRequests ? 'recorded' : 'NOT recorded - the "All requests" toggle was off'],
    ['User agent', header.userAgent],
    ['Dump schema', `v${header.schema} (Pulsecheck ${header.version})`],
  ]));
  L.push('', 'PII was masked before this file was written. Every number below is derivable from the timeline at the end of the document.', '');

  L.push('## Inventory', '');
  L.push(c.vendors.length
    ? table(['Vendor', 'Events', 'Unique names', 'Identifiers'], c.vendors.map((v) => [v.vendor, v.count, v.names, v.ids.join(', ') || '-']))
    : '_Nothing captured._');
  L.push('');

  if (c.top.length) {
    L.push('## Top events', '');
    L.push(table(['Event', 'Count'], c.top.map((t) => [t.name, t.count])));
    L.push('');
  }

  L.push('## Automatic checks', '');
  L.push(`- Duplicate suspects (same vendor+event+value within 2s): **${c.dupes.length}**` +
    (c.dupes.length ? '\n' + c.dupes.slice(0, 20).map((d) => `  - \`${d.key}\` - seq ${d.a} and ${d.b}, ${d.gap}ms apart`).join('\n') : ''));
  L.push(`- Events sent while the relevant storage was denied: **${c.violations.length}**` +
    (c.violations.length ? '\n' + c.violations.slice(0, 20).map(({ e, key }) => `  - seq ${e.seq}: ${e.vendor} \`${e.event}\` with \`${key}=denied\``).join('\n') : ''));
  L.push(`- Sensitive fields (masked): **${c.pii.length}**` +
    (c.pii.length ? '\n' + c.pii.map((p) => `  - \`${p.path}\` - ${p.kind}, ${p.count}x${p.inUrl ? ', **in the URL query string**' : ''} (seq ${p.seqs.join(', ')})`).join('\n') : ''));
  L.push(`- Not recognised by any parser: **${c.unparsed}**, caught by the generic parser: **${c.generic}**`);
  L.push('');

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
    L.push(`- \`+${t}s\` **${e.seq}** · ${src} · \`${e.event}\`${params}`);
  }

  L.push('', '---', '');
  L.push('## What to do with this', '');
  L.push('Hand this file to Claude Code with the `pulsecheck-analyze` skill (`skill/SKILL.md`),');
  L.push('or just ask: "analyse this tracking dump as an audit".');
  L.push('The machine-readable version of the same session is the `.jsonl` next to it');
  L.push('(schema v1, docs/dump-format.md).');
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
