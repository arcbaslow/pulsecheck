// Panel: owns the session. Capture -> parse -> in-memory timeline -> export.
// Nothing is persisted, nothing leaves the machine. Closing DevTools ends the
// session on purpose: this is a recorder you run, not always-on surveillance.

import { parse, toRequest, parseDataLayer } from './parsers.js';
import { buildSession, liveChecks, toMarkdown, toJsonl, fileBase } from './export.js';
import { redactEvent } from './redact.js';

const state = {
  recording: true,
  allRequests: false,
  seq: 0,
  events: [],
  shown: 0,
  dropped: 0,
  startedAt: Date.now(),
  page: '',
  userAgent: '',
  filter: '',
  hidden: new Set(),
  focus: null,
  flags: new Map(),
  rows: new Map(),
  lastPage: null,
  list: [],
  pageNo: new Map(),
  selected: null,
};

const $ = (id) => document.getElementById(id);
const list = $('list');
const emptyState = $('empty').cloneNode(true);
const errors = new Map();

if (chrome.devtools.panels && chrome.devtools.panels.themeName === 'dark') document.documentElement.classList.add('dark');

// --- capture: network --------------------------------------------------
// Request payloads are what we need, so postData is enough - no getContent()
// round trip for response bodies we never read.
const TRANSPORT = { xhr: 'xhr', fetch: 'fetch', image: 'pixel', ping: 'beacon', beacon: 'beacon' };

// "API context" records metadata for calls that carry no recognised event.
// Request bodies and query strings are deliberately excluded. Filtering uses
// URL and MIME rather than undocumented `_resourceType` values.
const STATIC_URL = /\.(js|mjs|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wasm|map)(\?|#|$)/i;
const STATIC_MIME = /^(image|font|video|audio)\/|javascript|text\/css|text\/html/i;

const isStatic = (req, entry) =>
  STATIC_URL.test(req.path) ||
  STATIC_MIME.test((entry.response && entry.response.content && entry.response.content.mimeType) || '');

chrome.devtools.network.onRequestFinished.addListener((entry) => {
  if (!state.recording) return;
  try {
    const ts = Date.parse(entry.startedDateTime) || Date.now();
    const req = toRequest({
      url: entry.request.url,
      method: entry.request.method,
      body: entry.request.postData ? entry.request.postData.text : '',
      transport: TRANSPORT[entry._resourceType] || 'other',
    });
    const events = parse(req);
    if (events.length) {
      for (const ev of events) add({ ...ev, source: 'network', ts });
    } else if (state.allRequests && !isStatic(req, entry)) {
      add({
        source: 'network',
        vendor: 'request',
        event: req.method + ' ' + req.path,
        params: { host: req.host, status: entry.response && entry.response.status, mime: entry.response && entry.response.content && entry.response.content.mimeType },
        url: new URL(req.url).origin + req.path,
        transport: req.transport,
        ts,
      });
    }
  } catch (err) {
    fail('capture', 'Request capture failed: ' + err.message);
  }
});

chrome.devtools.network.onNavigated.addListener((url) => {
  state.page = url;
  armedAt = 0; // a fresh document needs the tap now, throttle does not apply
  arm();
});

// --- capture: dataLayer ------------------------------------------------
let armedAt = 0;

async function arm() {
  if (!state.recording) return;
  if (Date.now() - armedAt < 1000) return; // pages we cannot eval into must not spin
  armedAt = Date.now();
  const src = await (await fetch('tap.js')).text();
  if (!state.recording) return;
  chrome.devtools.inspectedWindow.eval(src, (_res, err) => {
    fail('tap', err ? 'Could not attach the dataLayer tap: ' + (err.description || err.code || '') : '');
  });
}

function stopTap() {
  chrome.devtools.inspectedWindow.eval('window.__pulsecheck && window.__pulsecheck.stop()');
}

function drain() {
  if (!state.recording) return;
  chrome.devtools.inspectedWindow.eval(
    'window.__pulsecheck ? JSON.stringify(window.__pulsecheck.drain()) : ""',
    (res, err) => {
      if (!state.recording) return;
      if (err || res === undefined) return;
      if (!res) { arm(); return; } // tap gone (navigation, or first run) - re-arm
      let payload;
      try { payload = JSON.parse(res); } catch { return; }
      if (payload.page) state.page = payload.page;
      state.dropped += payload.dropped || 0;
      if (state.dropped > 0) fail('buffer', state.dropped + ' dataLayer pushes dropped: the tap buffer was full');
      for (const item of payload.items) {
        const d = parseDataLayer(item.msg);
        add({
          source: d.source || 'datalayer',
          vendor: d.source === 'consent' ? 'consent' : 'datalayer',
          event: d.event,
          params: item.layer === 'dataLayer' ? d.params : { ...d.params, _layer: item.layer },
          ts: item.ts,
          page: item.page,
          historical: item.historical,
          truncated: item.truncated,
        });
      }
    },
  );
}

// --- session -----------------------------------------------------------
function add(ev) {
  const e = {
    type: 'event',
    seq: ++state.seq,
    ts: ev.ts || Date.now(),
    source: ev.source,
    vendor: ev.vendor,
    event: ev.event,
    params: ev.params || {},
    page: ev.page || state.page,
  };
  if (ev.transport) e.transport = ev.transport;
  if (ev.url) e.url = ev.url;
  if (ev.raw) e.raw = ev.raw;
  if (ev.historical) e.historical = true;
  if (ev.truncated) e.truncated = true;
  state.events.push(e);
  if (!state.pageNo.has(e.page)) state.pageNo.set(e.page, state.pageNo.size + 1);
  // Consent stamping and final numbering happen in buildSession, over a
  // time-sorted timeline - `seq` here is only capture order for the UI.
  if (visible(e)) {
    const empty = $('empty');
    if (empty) empty.remove();
    append(e);
  } else if (!state.shown) renderEmpty();
  paint();
  scheduleChecks();
  drawStrip();
}

const matches = (e) =>
  !state.filter || (e.event + ' ' + e.vendor + ' ' + (e.url || '') + ' ' + JSON.stringify(e.params)).toLowerCase().includes(state.filter);

const visible = (e) =>
  !state.hidden.has(e.vendor) && matches(e) &&
  (!state.focus || (state.flags.get(e) || []).some((f) => f.check === state.focus && (f.sev !== 'note' || f.ref)));

const offset = (e) => (e.historical ? 'before' : '+' + (Math.max(0, e.ts - state.startedAt) / 1000).toFixed(1) + 's');

// The row preview leads with what an implementer checks (order, value,
// currency), keeps the stream id last and drops other transport keys; the
// expanded row keeps the full payload.
const TRANSPORT_KEYS = {
  ga4: ['v', 'gtm', 'cid', 'en', 'dl', 'dr', 'dt', 'gcs', 'gcd', 'sid', 'sct', 'seg', '_p', '_s', '_et', '_eu', 'tfd', 'npa', 'dma', 'are', 'frm', 'pscdl', 'ul', 'sr', 'uaa', 'uab', 'uafvl', 'uamb', 'uam', 'uap', 'uapv', 'uaw'],
  meta: ['ev', 'dl', 'rl', 'if', 'ts', 'sw', 'sh', 'v', 'r', 'ec', 'o', 'fbp', 'cdl', 'it', 'coo', 'rqm'],
};
const LEAD_KEYS = ['transaction_id', 'value', 'currency', 'cu', 'items', 'promotion_id', 'label', 'oid'];
const TAIL_KEYS = ['tid', 'id'];

function preview(e) {
  const drop = new Set(TRANSPORT_KEYS[e.vendor] || []);
  const entries = Object.entries(e.params || {}).filter(([k]) => !drop.has(k));
  if (!entries.length) return null;
  const rank = (k) => (LEAD_KEYS.includes(k) ? LEAD_KEYS.indexOf(k) : TAIL_KEYS.includes(k) ? LEAD_KEYS.length + 1 : LEAD_KEYS.length);
  return JSON.stringify(Object.fromEntries(entries.sort(([a], [b]) => rank(a) - rank(b))));
}

function pageLabel(url) {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url || 'unknown page';
  }
}

// Rows stay in send order. dataLayer pushes arrive in 500 ms drain batches,
// so a late push is slotted in before newer rows of the same page; one that
// lands on a page boundary rebuilds the list instead.
function append(e) {
  const shown = state.list;
  let i = shown.length;
  while (i > 0 && shown[i - 1].ts > e.ts) i--;
  if (i < shown.length) {
    const prev = shown[i - 1];
    const next = shown[i];
    if (next.page !== e.page || (prev && prev.page !== e.page)) {
      queueRepaint();
      return;
    }
    const el = row(e);
    state.rows.set(e, el);
    list.insertBefore(el, state.rows.get(next));
    shown.splice(i, 0, e);
    state.shown++;
    return;
  }
  if (e.page !== state.lastPage) {
    state.lastPage = e.page;
    const head = document.createElement('div');
    head.className = 'page';
    const n = document.createElement('span');
    n.textContent = 'Page ' + state.pageNo.get(e.page);
    const path = document.createElement('span');
    path.className = 'path';
    path.textContent = pageLabel(e.page);
    path.title = pageLabel(e.page);
    head.append(n, path);
    list.appendChild(head);
  }
  const el = row(e);
  state.rows.set(e, el);
  list.appendChild(el);
  shown.push(e);
  state.shown++;
}

let repaintQueued = false;
function queueRepaint() {
  if (repaintQueued) return;
  repaintQueued = true;
  requestAnimationFrame(() => {
    repaintQueued = false;
    repaintList(true);
  });
}

// ponytail: one DOM row per event, no virtualization. A capture big enough to
// hurt is a capture too big to audit by hand anyway - use the filter.
function row(e) {
  const el = document.createElement('div');
  el.className = 'row grid';
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-expanded', 'false');
  const t = span('t', offset(e));
  if (e.historical) t.title = 'dataLayer entry from before the panel opened; its time is the snapshot time';
  const v = span('v', e.vendor);
  v.dataset.vendor = e.vendor;
  const sw = document.createElement('i');
  sw.style.setProperty('--ink', `var(--v-${e.vendor}, var(--v-generic))`);
  v.prepend(sw);
  const text = preview(e);
  const p = span('p', text ?? (e.params.dl ? 'page ' + pageLabel(e.params.dl) : 'transport keys only'));
  if (text === null) p.classList.add('muted');
  if (e.truncated) p.title = 'Payload clipped at 200 keys / depth 6';
  el.append(t, v, span('e', e.event), p, span('c', ''));
  paintFlags(e, el);
  el.addEventListener('click', () => toggle(e, el));
  el.addEventListener('keydown', (ev) => {
    if (ev.target !== el || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    ev.preventDefault();
    toggle(e, el);
  });
  return el;
}

function span(cls, text) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function paintFlags(e, el) {
  const flags = state.flags.get(e) || [];
  const top = flags.find((f) => f.sev === 'bad') || flags.find((f) => f.sev === 'warn') || flags[0];
  const c = el.querySelector('.c');
  c.textContent = top ? top.text + (flags.length > 1 ? ` +${flags.length - 1}` : '') : '';
  c.title = flags.map((f) => f.text).join('\n');
  if (top) c.dataset.sev = top.sev;
  else delete c.dataset.sev;
  const hit = !!top && top.sev !== 'note';
  el.classList.toggle('hit', hit);
  if (hit) el.style.setProperty('--flag-tint', top.sev === 'bad' ? 'var(--bad-tint)' : 'var(--warn-tint)');
  const why = el.querySelector('.why');
  if (why) why.textContent = flags.map((f) => f.why || f.text).join(' ');
}

function toggle(e, el, force) {
  const open = force ?? !el.classList.contains('open');
  el.classList.toggle('open', open);
  el.setAttribute('aria-expanded', String(open));
  const existing = el.querySelector('.detail');
  if (existing) existing.remove();
  if (open) {
    const box = document.createElement('div');
    box.className = 'detail';
    box.addEventListener('click', (ev) => ev.stopPropagation());
    const pre = document.createElement('pre');
    const view = (x) => JSON.stringify({ source: x.source, transport: x.transport, url: x.url, page: x.page, params: x.params }, null, 2);
    pre.textContent = view(e);
    const side = document.createElement('div');
    side.className = 'side';
    const why = document.createElement('p');
    why.className = 'why';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'ghost';
    copy.textContent = 'Copy redacted JSON';
    copy.title = 'Copies this event with the same redaction as the export';
    copy.addEventListener('click', async () => {
      copy.textContent = (await copyText(view(redactEvent(e).event))) ? 'Copied' : 'Copy failed';
      setTimeout(() => (copy.textContent = 'Copy redacted JSON'), 1500);
    });
    side.append(why);
    for (const f of state.flags.get(e) || []) {
      if (!f.ref) continue;
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'ghost';
      go.textContent = 'Go to ' + offset(f.ref);
      go.addEventListener('click', () => reveal(f.ref));
      side.append(go);
    }
    side.append(copy);
    box.append(pre, side);
    el.appendChild(box);
    paintFlags(e, el);
    state.selected = e;
  } else if (state.selected === e) state.selected = null;
  drawStrip();
}

function renderEmpty() {
  if (state.shown) return;
  const hint = emptyState.cloneNode(true);
  if (state.events.length) hint.replaceChildren(Object.assign(document.createElement('b'), { textContent: 'Nothing matches the current filters' }));
  list.replaceChildren(hint);
}

function repaintList(keep) {
  const top = list.scrollTop;
  const focused = [...state.rows].find(([, el]) => el === document.activeElement);
  list.textContent = '';
  state.shown = 0;
  state.lastPage = null;
  state.rows.clear();
  state.list = [];
  for (const e of [...state.events].sort((a, b) => a.ts - b.ts || a.seq - b.seq)) if (visible(e)) append(e);
  if (state.selected && state.rows.has(state.selected)) toggle(state.selected, state.rows.get(state.selected), true);
  renderEmpty();
  paint();
  drawStrip();
  if (keep) {
    list.scrollTop = top;
    if (focused && state.rows.has(focused[0])) state.rows.get(focused[0]).focus({ preventScroll: true });
  }
}

function setVendorVisible(vendor, chip, on) {
  on ? state.hidden.delete(vendor) : state.hidden.add(vendor);
  chip.setAttribute('aria-pressed', String(on));
}

function paint() {
  const total = state.events.length;
  $('count').textContent = (state.shown === total ? '' : state.shown + ' of ') + total + (total === 1 ? ' event' : ' events');
  const vendors = [...new Set(state.events.map((e) => e.vendor))];
  const chips = $('chips');
  if (chips.dataset.keys === vendors.join()) return;
  chips.dataset.keys = vendors.join();
  chips.textContent = '';
  for (const v of vendors) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip';
    c.style.setProperty('--ink', `var(--v-${v}, var(--v-generic))`);
    c.append(document.createElement('i'), v);
    setVendorVisible(v, c, !state.hidden.has(v));
    c.addEventListener('click', () => {
      setVendorVisible(v, c, state.hidden.has(v));
      repaintList();
    });
    chips.appendChild(c);
  }
}

function fail(source, msg) {
  if (msg) errors.set(source, msg);
  else errors.delete(source);
  $('err').textContent = [...errors.values()].join('. ');
}

// --- live checks -------------------------------------------------------
// The export's duplicate and consent rules, rerun on the whole session a
// moment after it changes. liveChecks numbers events in time order, so its
// seq values index a copy sorted the same way. Redaction runs once per event
// and is cached, not once per pass.
const CONSENT_TEXT = {
  mismatch: 'Claims consent that was denied',
  unsigned: 'Sent while consent denied',
  ungated: 'Sent while denied, not gated',
};
const KIND = { email: 'email', phone: 'phone', ip: 'IP address', secret: 'secret', national_id: 'national ID', name: 'name', identifier: 'identifier' };
const masked = new WeakMap();

function maskedHits(e) {
  if (!masked.has(e)) masked.set(e, redactEvent(e).hits);
  return masked.get(e);
}

let checkTimer = 0;
let focusKey = '';
function scheduleChecks() {
  if (!checkTimer) checkTimer = setTimeout(runChecks, 400);
}

function runChecks() {
  checkTimer = 0;
  const ordered = [...state.events].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  const c = liveChecks(state.events);
  const flags = new Map();
  const put = (e, check, sev, text, why, ref) => {
    if (!e) return;
    if (!flags.has(e)) flags.set(e, []);
    flags.get(e).push({ check, sev, text, why, ref });
  };
  const SAME = { order_id: 'the same order ID', dedup_key: 'the same deduplication key', payload: 'the same payload' };
  for (const d of c.dupes) {
    const first = ordered[d.a - 1];
    const repeat = ordered[d.b - 1];
    const at = first ? offset(first) : 'an earlier hit';
    put(repeat, 'dupe', 'warn', `Duplicate of ${at}`,
      `Sent with ${SAME[d.kind] || 'the same key'} as the hit at ${at}, ${d.gap} ms apart. The vendor may count both.`, first);
    if (repeat) put(first, 'dupe', 'note', `Repeated at ${offset(repeat)}`,
      `The hit at ${offset(repeat)} repeats this one with ${SAME[d.kind] || 'the same key'}.`, repeat);
  }
  let consent = 0;
  for (const o of c.consent) {
    const e = ordered[o.seq - 1];
    if (o.kind === 'cookieless') {
      put(e, 'consent', 'note', 'Cookieless ping, expected', `Sent while ${o.key} was denied with gcs ${o.gcs}: a cookieless ping that Consent Mode allows.`);
      continue;
    }
    consent++;
    const why = {
      mismatch: `Sent while ${o.key} was denied, but its gcs ${o.gcs} claims consent was granted.`,
      ungated: `${{ meta: "Meta Pixel", tiktok: "TikTok Pixel" }[o.vendor] || o.vendor} does not read Google Consent Mode, so this hit went out while ${o.key} was denied.`,
    }[o.kind] || `Sent while ${o.key} was denied, ${o.gcs ? 'with an unrecognised gcs ' + o.gcs : 'without a consent signal'}.`;
    put(e, 'consent', 'bad', CONSENT_TEXT[o.kind] || CONSENT_TEXT.unsigned, why);
  }
  const paths = new Set();
  for (const e of state.events) {
    const hits = maskedHits(e);
    for (const h of hits) paths.add(h.path);
    const kinds = [...new Set(hits.map((h) => KIND[h.kind] || h.kind))];
    if (kinds.length) put(e, 'pii', 'warn', 'Masked in export: ' + kinds.join(', '),
      `This payload carries a value that looks like ${kinds.join(', ')}. The export masks it; check whether the site should send it at all.`);
  }
  state.flags = flags;
  setCheck('dupe', c.dupes.length, 'warn');
  setCheck('consent', consent, 'bad');
  setCheck('pii', paths.size, 'warn');
  const key = state.focus ? state.events.filter(visible).map((e) => e.seq).join() : '';
  if (state.focus && key !== focusKey) repaintList(true);
  else for (const [e, el] of state.rows) paintFlags(e, el);
  focusKey = key;
  drawStrip();
}

function setCheck(name, n, sev) {
  const btn = document.querySelector(`.check[data-check="${name}"]`);
  const num = btn.querySelector('.num');
  btn.dataset.state = !state.events.length ? '' : n ? sev : 'ok';
  if (num.dataset.n === String(n)) return;
  const first = num.dataset.n === undefined;
  num.dataset.n = String(n);
  num.replaceChildren(span('', String(n)));
  num.classList.remove('roll');
  if (!first) {
    void num.offsetWidth;
    num.classList.add('roll');
  }
}

for (const btn of document.querySelectorAll('.check')) {
  btn.addEventListener('click', () => {
    state.focus = state.focus === btn.dataset.check ? null : btn.dataset.check;
    for (const b of document.querySelectorAll('.check')) b.setAttribute('aria-pressed', String(b.dataset.check === state.focus));
    repaintList();
  });
}

// --- pulse strip -------------------------------------------------------
const canvas = $('pulse');
const ctx = canvas.getContext('2d');
const tip = $('tip');
const SOURCE_HEIGHT = { network: 1, consent: 0.72, datalayer: 0.52 };
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];
let marks = [];
let queued = false;

function drawStrip() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    draw();
  });
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const css = getComputedStyle(document.documentElement);
  const col = (name) => css.getPropertyValue(name).trim();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const top = 24;
  const base = h - 26;
  const height = base - top;
  const t0 = state.startedAt;
  const last = state.events.reduce((m, e) => Math.max(m, e.ts), t0);
  const range = Math.max(10000, (last - t0) * 1.04);
  const x = (ts) => Math.max(0, Math.min(w - 2, ((ts - t0) / range) * (w - 2)));

  ctx.font = `11px ${col('--mono')}`;
  ctx.textBaseline = 'alphabetic';
  const step = STEPS.find((s) => (range / 1000 / s) <= Math.max(3, w / 90)) || 3600;
  for (let s = 0; s * 1000 <= range; s += step) {
    const px = x(t0 + s * 1000);
    ctx.fillStyle = col('--line-strong');
    ctx.fillRect(Math.round(px), base, 1, 4);
    ctx.fillStyle = col('--text-3');
    const label = s < 60 ? s + 's' : Math.floor(s / 60) + 'm' + (s % 60 ? ' ' + (s % 60) + 's' : '');
    const tw = ctx.measureText(label).width;
    ctx.fillText(label, Math.min(Math.max(0, px - tw / 2), w - tw), h - 6);
  }
  ctx.fillStyle = col('--line-strong');
  ctx.fillRect(0, base, w, 1);

  const ordered = [...state.events].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  const pages = [];
  for (const e of ordered) if (!pages.length || pages[pages.length - 1].page !== e.page) pages.push({ page: e.page, ts: e.ts });
  ctx.font = `500 11px ${col('--sans')}`;
  pages.forEach((p, i) => {
    const px = i === 0 ? 0 : Math.round(x(p.ts));
    const next = i + 1 < pages.length ? x(pages[i + 1].ts) : w;
    if (i > 0) {
      ctx.fillStyle = col('--text-3');
      for (let y = 4; y < base; y += 5) ctx.fillRect(px, y, 1, 3);
    }
    let label = pageLabel(p.page);
    const room = next - px - 14;
    if (room < 30) return;
    while (label.length > 4 && ctx.measureText(label).width > room) label = label.slice(0, -2);
    if (label !== pageLabel(p.page)) label = label.slice(0, -1) + '…';
    ctx.fillStyle = col('--text-2');
    ctx.fillText(label, px + (i === 0 ? 0 : 6), 14);
  });

  if (!ordered.length) {
    ctx.fillStyle = col('--text-3');
    ctx.font = `12px ${col('--sans')}`;
    ctx.fillText('Waiting for the first event', 0, base - 10);
    canvas.setAttribute('aria-label', 'Session timeline: no events yet');
    marks = [];
    return;
  }

  const slots = new Map();
  for (const e of ordered) {
    const k = Math.round(x(e.ts) / 4);
    if (!slots.has(k)) slots.set(k, []);
    slots.get(k).push(e);
  }
  marks = [];
  const sel = state.selected;
  for (const [k, evs] of slots) {
    const px = Math.min(k * 4, w - 3);
    const gap = evs.length * 4 > height ? 0 : 2;
    const want = evs.map((e) => height * (e.vendor === 'request' ? 0.3 : SOURCE_HEIGHT[e.source] || 1));
    const total = want.reduce((a, b) => a + b, 0) + (evs.length - 1) * gap;
    const scale = total > height ? (height - (evs.length - 1) * gap) / (total - (evs.length - 1) * gap) : 1;
    let y = base;
    const hasSel = sel && evs.includes(sel);
    if (hasSel) {
      ctx.fillStyle = col('--blue-tint');
      ctx.fillRect(px - 3, top - 4, 9, height + 4);
    }
    evs.forEach((e, i) => {
      const bh = gap ? Math.max(2, want[i] * scale) : want[i] * scale;
      const shown = visible(e);
      ctx.globalAlpha = shown ? 1 : 0.22;
      ctx.fillStyle = e === sel ? col('--text') : col(`--v-${e.vendor}`) || col('--v-generic');
      ctx.fillRect(px, y - bh, 3, bh);
      marks.push({ x: px + 1.5, top: y - bh, bottom: y, e });
      y -= bh + gap;
    });
    ctx.globalAlpha = 1;
    const worst = evs.flatMap((e) => state.flags.get(e) || []).filter((f) => f.sev !== 'note');
    if (worst.length) {
      ctx.fillStyle = worst.some((f) => f.sev === 'bad') ? col('--bad-mark') : col('--warn-mark');
      ctx.fillRect(px - 0.5, base + 5, 4, 4);
    }
  }
  const secs = Math.round((last - t0) / 1000);
  canvas.setAttribute('aria-label', `Session timeline: ${ordered.length} events over ${secs} seconds on ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`);
}

function nearest(ev) {
  const r = canvas.getBoundingClientRect();
  const mx = ev.clientX - r.left;
  const my = ev.clientY - r.top;
  let best = null;
  for (const m of marks) {
    const dx = Math.abs(m.x - mx);
    if (dx > 6) continue;
    const d = dx + Math.max(0, m.top - my, my - m.bottom);
    if (!best || d < best.d) best = { d, m };
  }
  return best && best.m;
}

canvas.addEventListener('mousemove', (ev) => {
  const m = nearest(ev);
  if (!m) { tip.hidden = true; return; }
  const e = m.e;
  const flags = (state.flags.get(e) || []).map((f) => f.text);
  tip.replaceChildren(span('tt', offset(e)), Object.assign(document.createElement('b'), { textContent: e.vendor + ' ' }), e.event, ...(flags.length ? [' - ' + flags[0]] : []));
  tip.hidden = false;
  const box = $('strip').getBoundingClientRect();
  const left = Math.min(Math.max(8, ev.clientX - box.left + 12), box.width - tip.offsetWidth - 8);
  tip.style.left = left + 'px';
  tip.style.top = '28px';
});
canvas.addEventListener('mouseleave', () => (tip.hidden = true));
function reveal(e) {
  let el = state.rows.get(e);
  if (!el) {
    state.filter = '';
    $('filter').value = '';
    state.focus = null;
    for (const b of document.querySelectorAll('.check')) b.setAttribute('aria-pressed', 'false');
    state.hidden.delete(e.vendor);
    $('chips').dataset.keys = '';
    repaintList();
    el = state.rows.get(e);
  }
  if (!el) return;
  toggle(e, el, true);
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
}

canvas.addEventListener('click', (ev) => {
  const m = nearest(ev);
  if (m) reveal(m.e);
});
new ResizeObserver(drawStrip).observe(canvas);

// --- export ------------------------------------------------------------
function session() {
  return buildSession({
    startedAt: state.startedAt,
    page: state.page,
    notes: $('notes').value.trim(),
    userAgent: state.userAgent,
    events: state.events,
    capture: { allRequests: state.allRequests, dropped: state.dropped },
  });
}

// One session build per click: buildSession runs the redaction pass over the
// whole timeline, so calling it for the body and again for the filename would
// redact everything twice.
function save(serialize, ext, mime) {
  const s = session();
  const url = URL.createObjectURL(new Blob([serialize(s)], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileBase(s) + ext;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }
}

$('md').addEventListener('click', () => save(toMarkdown, '.md', 'text/markdown'));
$('jsonl').addEventListener('click', () => save(toJsonl, '.jsonl', 'application/x-ndjson'));

$('copy').addEventListener('click', async () => {
  const copied = await copyText(toMarkdown(session()));
  $('copy').textContent = copied ? 'Copied' : 'Copy failed';
  setTimeout(() => ($('copy').textContent = 'Copy .md'), 1500);
});

$('rec').addEventListener('click', () => {
  state.recording = !state.recording;
  if (state.recording) drain();
  else stopTap();
  $('rec').className = state.recording ? 'on' : 'off';
  $('rec').setAttribute('aria-pressed', String(state.recording));
  $('recLabel').textContent = state.recording ? 'Recording' : 'Paused';
  $('rec').title = state.recording ? 'Pause recording' : 'Resume recording';
});

const pop = $('apiConfirm');
function closePop(focusBack) {
  if (pop.hidden) return;
  pop.hidden = true;
  if (focusBack) $('all').focus();
}
function setApi(on) {
  state.allRequests = on;
  $('all').setAttribute('aria-pressed', String(on));
}
$('all').addEventListener('click', (ev) => {
  ev.stopPropagation();
  if (state.allRequests) { setApi(false); return; }
  pop.hidden = !pop.hidden;
  if (!pop.hidden) $('apiOk').focus();
});
$('apiOk').addEventListener('click', () => { setApi(true); closePop(true); });
$('apiCancel').addEventListener('click', () => closePop(true));
pop.addEventListener('click', (ev) => ev.stopPropagation());
document.addEventListener('click', () => closePop(false));
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closePop(true); });

$('clear').addEventListener('click', () => {
  state.events = [];
  state.seq = 0;
  state.dropped = 0;
  state.flags = new Map();
  state.pageNo = new Map();
  state.selected = null;
  fail('buffer', '');
  state.startedAt = Date.now();
  elapsed();
  $('chips').dataset.keys = '';
  $('chips').textContent = '';
  runChecks();
  repaintList();
});

$('filter').addEventListener('input', (ev) => {
  state.filter = ev.target.value.trim().toLowerCase();
  repaintList();
});

// --- boot --------------------------------------------------------------
chrome.devtools.inspectedWindow.eval('JSON.stringify({href: location.href, ua: navigator.userAgent})', (res) => {
  if (!res) return;
  const { href, ua } = JSON.parse(res);
  state.page = href;
  state.userAgent = ua;
});
arm();
drawStrip();
const elapsed = () => {
  const s = Math.floor((Date.now() - state.startedAt) / 1000);
  $('recTime').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
elapsed();
const clockTimer = setInterval(() => state.recording && elapsed(), 1000);
const drainTimer = setInterval(drain, 500);
window.addEventListener('pagehide', () => {
  state.recording = false;
  clearInterval(drainTimer);
  clearInterval(clockTimer);
  stopTap();
});
