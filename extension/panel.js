// Panel: owns the session. Capture -> parse -> in-memory timeline -> export.
// Nothing is persisted, nothing leaves the machine. Closing DevTools ends the
// session on purpose: this is a recorder you run, not always-on surveillance.

import { parse, toRequest, parseDataLayer } from './parsers.js';
import { buildSession, toMarkdown, toJsonl, fileBase } from './export.js';

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
};

const $ = (id) => document.getElementById(id);
const list = $('list');
const emptyState = $('empty').cloneNode(true);
const errors = new Map();

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
    fail('capture', 'request capture failed: ' + err.message);
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
    fail('tap', err ? 'could not attach the dataLayer tap: ' + (err.description || err.code || '') : '');
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
      if (state.dropped > 0) fail('buffer', state.dropped + ' dataLayer pushes dropped: tap buffer full');
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
  // Consent stamping and final numbering happen in buildSession, over a
  // time-sorted timeline - `seq` here is only capture order for the UI.
  if (visible(e)) {
    const el = row(e);
    const empty = $('empty');
    if (empty) empty.remove();
    list.appendChild(el);
    state.shown++;
  } else if (!state.shown) renderEmpty();
  paint();
}

const visible = (e) =>
  !state.hidden.has(e.vendor) &&
  (!state.filter || (e.event + ' ' + e.vendor + ' ' + (e.url || '') + ' ' + JSON.stringify(e.params)).toLowerCase().includes(state.filter));

// ponytail: one DOM row per event, no virtualization. A capture big enough to
// hurt is a capture too big to audit by hand anyway - use the filter.
function row(e) {
  const el = document.createElement('div');
  el.className = 'row';
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-expanded', 'false');
  const t = ((e.ts - state.startedAt) / 1000).toFixed(1);
  const preview = JSON.stringify(e.params);
  for (const [cls, text, attr] of [['t', e.historical ? 'before' : '+' + t + 's'], ['v', e.vendor, e.vendor], ['e', e.event], ['p', preview]]) {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    if (attr) span.dataset.vendor = attr;
    if (cls === 't' && e.historical) span.title = 'dataLayer entry from before the panel opened; its time is the snapshot time';
    if (cls === 'p' && e.truncated) span.title = 'Payload clipped at 200 keys / depth 6';
    el.appendChild(span);
  }
  const toggle = () => {
    const open = el.classList.toggle('open');
    el.setAttribute('aria-expanded', String(open));
    const existing = el.querySelector('pre');
    if (existing) existing.remove();
    if (open) {
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify({ source: e.source, transport: e.transport, url: e.url, page: e.page, params: e.params }, null, 2);
      el.appendChild(pre);
    }
  };
  el.addEventListener('click', toggle);
  el.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    toggle();
  });
  return el;
}

function renderEmpty() {
  if (state.shown) return;
  const hint = emptyState.cloneNode(true);
  if (state.events.length) hint.textContent = 'Nothing matches the filter.';
  list.replaceChildren(hint);
}

function repaintList() {
  list.textContent = '';
  state.shown = 0;
  for (const e of state.events) if (visible(e)) { list.appendChild(row(e)); state.shown++; }
  renderEmpty();
  paint();
}

function setVendorVisible(vendor, chip, on) {
  on ? state.hidden.delete(vendor) : state.hidden.add(vendor);
  chip.classList.toggle('on', on);
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
    setVendorVisible(v, c, !state.hidden.has(v));
    c.textContent = v;
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
  $('err').textContent = [...errors.values()].join(' · ');
}

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

$('md').addEventListener('click', () => save(toMarkdown, '.md', 'text/markdown'));
$('jsonl').addEventListener('click', () => save(toJsonl, '.jsonl', 'application/x-ndjson'));

$('copy').addEventListener('click', async () => {
  const md = toMarkdown(session());
  let copied = false;
  try {
    await navigator.clipboard.writeText(md);
    copied = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = md;
    document.body.appendChild(ta);
    ta.select();
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    } finally {
      ta.remove();
    }
  }
  $('copy').textContent = copied ? 'Copied' : 'Copy failed';
  setTimeout(() => ($('copy').textContent = 'Copy .md'), 1500);
});

$('rec').addEventListener('click', () => {
  state.recording = !state.recording;
  if (state.recording) drain();
  else stopTap();
  $('rec').className = state.recording ? 'on' : 'off';
  $('recLabel').textContent = state.recording ? 'Recording' : 'Paused';
  $('rec').title = state.recording ? 'Pause recording' : 'Resume recording';
});

$('all').addEventListener('click', () => {
  if (!state.allRequests && !window.confirm(
    'API context records the method, host, path, status and MIME type for non-static site requests. Request bodies and query strings are excluded. Nothing is sent off-device. Enable it for this session?',
  )) return;
  state.allRequests = !state.allRequests;
  $('all').classList.toggle('on', state.allRequests);
  $('all').setAttribute('aria-pressed', String(state.allRequests));
});

$('clear').addEventListener('click', () => {
  state.events = [];
  state.seq = 0;
  state.dropped = 0;
  fail('buffer', '');
  state.startedAt = Date.now();
  $('chips').dataset.keys = '';
  $('chips').textContent = '';
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
const drainTimer = setInterval(drain, 500);
window.addEventListener('pagehide', () => {
  state.recording = false;
  clearInterval(drainTimer);
  stopTap();
});
