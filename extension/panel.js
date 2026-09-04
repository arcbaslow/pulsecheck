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
  startedAt: Date.now(),
  page: '',
  userAgent: '',
  filter: '',
  hidden: new Set(),
};

const $ = (id) => document.getElementById(id);
const list = $('list');

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
    fail('request capture failed: ' + err.message);
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
  if (Date.now() - armedAt < 1000) return; // pages we cannot eval into must not spin
  armedAt = Date.now();
  const src = await (await fetch('tap.js')).text();
  chrome.devtools.inspectedWindow.eval(src, (_res, err) => {
    fail(err ? 'could not attach the dataLayer tap: ' + (err.description || err.code || '') : '');
  });
}

function drain() {
  chrome.devtools.inspectedWindow.eval(
    'window.__pulsecheck ? JSON.stringify(window.__pulsecheck.drain()) : ""',
    (res, err) => {
      if (err || res === undefined) return;
      if (!res) { arm(); return; } // tap gone (navigation, or first run) - re-arm
      let payload;
      try { payload = JSON.parse(res); } catch { return; }
      if (payload.page) state.page = payload.page;
      // Paused: still drain, or the page-side buffer fills and dumps stale
      // events with stale timestamps the moment recording resumes.
      if (!state.recording) return;
      for (const item of payload.items) {
        const d = parseDataLayer(item.msg);
        add({
          source: d.source || 'datalayer',
          vendor: d.source === 'consent' ? 'consent' : 'datalayer',
          event: d.event,
          params: item.layer === 'dataLayer' ? d.params : { ...d.params, _layer: item.layer },
          ts: item.ts,
          page: item.page,
        });
      }
    },
  );
}

// --- session -----------------------------------------------------------
function add(ev) {
  const empty = $('empty');
  if (empty) empty.remove();
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
  state.events.push(e);
  // Consent stamping and final numbering happen in buildSession, over a
  // time-sorted timeline - `seq` here is only capture order for the UI.
  if (visible(e)) list.appendChild(row(e));
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
  for (const [cls, text, attr] of [['t', '+' + t + 's'], ['v', e.vendor, e.vendor], ['e', e.event], ['p', preview]]) {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    if (attr) span.dataset.vendor = attr;
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

function repaintList() {
  list.textContent = '';
  let shown = 0;
  for (const e of state.events) if (visible(e)) { list.appendChild(row(e)); shown++; }
  if (!shown) {
    const hint = document.createElement('div');
    hint.id = 'empty';
    hint.textContent = state.events.length ? 'Nothing matches the filter.' : 'Walk through your scenario on the page and events appear here.';
    list.appendChild(hint);
  }
  paint();
}

function paint() {
  $('count').textContent = state.events.length + (state.events.length === 1 ? ' event' : ' events');
  const vendors = [...new Set(state.events.map((e) => e.vendor))];
  const chips = $('chips');
  if (chips.dataset.keys === vendors.join()) return;
  chips.dataset.keys = vendors.join();
  chips.textContent = '';
  for (const v of vendors) {
    const c = document.createElement('span');
    c.className = 'chip' + (state.hidden.has(v) ? '' : ' on');
    c.textContent = v;
    c.addEventListener('click', () => {
      state.hidden.has(v) ? state.hidden.delete(v) : state.hidden.add(v);
      c.classList.toggle('on');
      repaintList();
    });
    chips.appendChild(c);
  }
}

const fail = (msg) => { $('err').textContent = msg; };

// --- export ------------------------------------------------------------
function session() {
  return buildSession({
    startedAt: state.startedAt,
    page: state.page,
    notes: $('notes').value.trim(),
    userAgent: state.userAgent,
    events: state.events,
    capture: { allRequests: state.allRequests },
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
  try {
    await navigator.clipboard.writeText(md);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = md;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  $('copy').textContent = 'Copied';
  setTimeout(() => ($('copy').textContent = 'Copy .md'), 1500);
});

$('rec').addEventListener('click', () => {
  state.recording = !state.recording;
  $('rec').className = state.recording ? 'on' : 'off';
  $('recLabel').textContent = state.recording ? 'Recording' : 'Paused';
  $('rec').title = state.recording ? 'Pause capture' : 'Resume capture';
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
  state.startedAt = Date.now();
  $('chips').dataset.keys = '';
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
setInterval(drain, 500);
