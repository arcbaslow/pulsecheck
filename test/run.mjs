// node test/run.mjs
// Table-driven checks against captured wire formats. No live network, no
// framework. When a vendor changes its format, add a case - never edit one.

import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parse, toRequest, parseDataLayer } from '../extension/parsers.js';
import { redactEvent, looksLikePhone } from '../extension/redact.js';
import { buildSession, toJsonl, toMarkdown, fileBase } from '../extension/export.js';

let failed = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
};

const run = (url, method = 'GET', body = '') => parse(toRequest({ url, method, body }));

console.log('parsers');

t('ga4 GET single hit', () => {
  const [e] = run('https://www.google-analytics.com/g/collect?v=2&tid=G-ABC123&cid=1234567890.1234567890&en=page_view&ep.page_type=home&epn.value=10');
  assert.equal(e.vendor, 'ga4');
  assert.equal(e.event, 'page_view');
  assert.equal(e.params.page_type, 'home');
  assert.equal(e.params.value, 10);
  assert.equal(e.params.tid, 'G-ABC123');
});

t('ga4 sGTM custom domain, POST batch = N events', () => {
  const ev = run(
    'https://sgtm.example.kz/g/collect?v=2&tid=G-ABC123&cid=111.222',
    'POST',
    'en=view_item&epn.value=125000&ep.currency=KZT\nen=add_to_cart&epn.value=125000',
  );
  assert.equal(ev.length, 2);
  assert.deepEqual(ev.map((e) => e.event), ['view_item', 'add_to_cart']);
  assert.equal(ev[0].params.currency, 'KZT');
  assert.equal(ev[1].params.tid, 'G-ABC123', 'query params carry into every batch line');
});

t('ga4 debug traffic is flagged', () => {
  const [e] = run('https://sgtm.example.kz/g/collect?v=2&tid=G-ABC123&en=purchase&_dbg=1');
  assert.equal(e.params.debug_mode, true);
});

t('meta pixel GET with dedup key', () => {
  const [e] = run('https://www.facebook.com/tr/?id=1234567890123456&ev=Purchase&cd[value]=100&cd[currency]=KZT&eid=abc123');
  assert.equal(e.vendor, 'meta');
  assert.equal(e.event, 'Purchase');
  assert.equal(e.params.value, '100');
  assert.equal(e.params.eid, 'abc123');
  assert.equal(e.params.id, '1234567890123456');
});

t('meta CAPI gateway on a custom domain matches by signature', () => {
  const [e] = run('https://events.example.kz/x?id=1234567890123456&ev=Lead');
  assert.equal(e.vendor, 'meta');
  assert.equal(e.event, 'Lead');
});

t('metrica goal', () => {
  const [e] = run('https://mc.yandex.ru/watch/12345678?page-url=goal%3A%2F%2Fexample.kz%2Fform_submit&page-ref=https%3A%2F%2Fexample.kz%2F');
  assert.equal(e.vendor, 'metrica');
  assert.equal(e.event, 'form_submit');
  assert.equal(e.params.counter, '12345678');
});

t('metrica hit with site-info', () => {
  const [e] = run('https://mc.yandex.ru/watch/12345678?page-url=https%3A%2F%2Fexample.kz%2F&site-info=%7B%22plan%22%3A%22pro%22%7D');
  assert.equal(e.event, 'hit');
  assert.deepEqual(e.params.site_info, { plan: 'pro' });
});

t('metrica webvisor chunks are counted, not decoded', () => {
  const [e] = run('https://mc.yandex.ru/watch/12345678/webvisor?wv-type=1', 'POST', 'blob');
  assert.equal(e.event, 'webvisor');
});

t('amplitude batch = N events, dedup key kept', () => {
  const body = JSON.stringify({
    api_key: 'k1',
    events: [
      { event_type: 'checkout_start', event_properties: { value: 1 }, insert_id: 'i1' },
      { event_type: 'purchase', event_properties: { value: 2 }, insert_id: 'i2' },
    ],
  });
  const ev = run('https://api2.amplitude.com/2/httpapi', 'POST', body);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].vendor, 'amplitude');
  assert.equal(ev[1].event, 'purchase');
  assert.equal(ev[1].params.insert_id, 'i2');
});

t('amplitude behind a proxy matches by body signature', () => {
  const ev = run('https://collect.example.kz/ampl', 'POST', JSON.stringify({ api_key: 'k', events: [{ event_type: 'x' }] }));
  assert.equal(ev[0].vendor, 'amplitude');
});

t('tiktok pixel', () => {
  const body = JSON.stringify({ event: 'CompletePayment', pixel_code: 'C123', properties: { value: 1, currency: 'KZT' }, event_id: 'e1' });
  const [e] = run('https://analytics.tiktok.com/api/v2/pixel/track/', 'POST', body);
  assert.equal(e.vendor, 'tiktok');
  assert.equal(e.event, 'CompletePayment');
  assert.equal(e.params.event_id, 'e1');
  assert.equal(e.params.pixel_code, 'C123');
});

t('generic catches an unknown sender', () => {
  const [e] = run('https://unknown.example.com/collect', 'POST', JSON.stringify({ event: 'custom_thing', foo: 1 }));
  assert.equal(e.vendor, 'generic');
  assert.equal(e.event, 'custom_thing');
  assert.equal(e.params._host, 'unknown.example.com');
});

t('non-event traffic produces nothing', () => {
  assert.equal(run('https://cdn.example.com/app.js?t=1699999999').length, 0);
  assert.equal(run('https://example.kz/api/user?id=7').length, 0);
});

// Sanitized live captures (GA4 + GTM + two Metrica counters + a first-party
// collector). Domains and identifiers are examples; the wire formats are kept
// intact because several cases below were misparsed before entering this table.
console.log('live captures');

t('metrica: real hit, counter from path, page-url decoded', () => {
  const [e] = run('https://mc.yandex.ru/watch/1838272/1?page-url=https%3A%2F%2Fsite.example.kz%2F&charset=utf-8&hidv2=4584945988870864978&browser-info=pa%3A1%3Aar%3A1&t=gdpr(14)mc(h-1)clc');
  assert.equal(e.vendor, 'metrica');
  assert.equal(e.params.counter, '1838272');
  assert.equal(e.params.page_url, 'https://site.example.kz/');
});

t('metrica ad-sync pixel is not an event', () => {
  assert.equal(run('https://mc.yandex.ru/metrika/advert.gif?t=gdpr(14)ti(4)').length, 0);
});

t('ga4: real page_view on analytics.google.com', () => {
  const [e] = run('https://analytics.google.com/g/collect?v=2&tid=G-EKJ8741MGP&_p=1786357377731&gcd=13l3l3l3l1l1&npa=0&cid=1111111111.2222222222&sid=1786357381&dl=https%3A%2F%2Fsite.example.kz%2F&en=page_view&_ss=1');
  assert.equal(e.vendor, 'ga4');
  assert.equal(e.event, 'page_view');
  assert.equal(e.params.tid, 'G-EKJ8741MGP');
});

t('ga4: the doubleclick sync ping is named, not "(unnamed)"', () => {
  // Fires with no `en` when Google Signals is on - the fact that it fires at
  // all is the audit signal, so it must be legible in the timeline.
  const [e] = run('https://stats.g.doubleclick.net/g/collect?v=2&tid=G-EKJ8741MGP&cid=1111111111.2222222222&aip=1&gcd=13l3l3l3l1l1&npa=0');
  assert.equal(e.vendor, 'ga4');
  assert.equal(e.event, '(google_ads_sync)');
});

t('generic: first-party collector with a JSON query payload', () => {
  // GET beacon to /api/collect/open?data={...}. Was silently dropped: no
  // `event` key anywhere, name only in the path.
  const [e] = run('https://telemetry.example.kz/api/collect/open?data=%7B%22host%22%3A%22https%3A%2F%2Fsite.example.kz%22%2C%22page_type%22%3A%22main%22%2C%22user_id%22%3A%2200000000-0000-0000-0000-000000000000%22%7D');
  assert.equal(e.vendor, 'generic');
  assert.equal(e.event, 'open', 'event name falls back to the last path segment');
  assert.equal(e.params.page_type, 'main');
  assert.equal(e.params._host, 'telemetry.example.kz');
});

t('meta: multipart/form-data POST (sanitized live capture)', () => {
  // The pixel POSTs multipart, not urlencoded. This landed as "(unnamed)" with
  // the raw boundary text as params until multipart parsing existed.
  const b = '------WebKitFormBoundaryr57edFq4asaV3Jgr';
  const body = [
    b, 'Content-Disposition: form-data; name="id"', '', '3695308604059935',
    b, 'Content-Disposition: form-data; name="ev"', '', 'Lead',
    b, 'Content-Disposition: form-data; name="eid"', '', '184d73fb-4cb4-468e-88b0-1dafaa5601d7',
    b, 'Content-Disposition: form-data; name="cd[value]"', '', '0',
    b + '--', '',
  ].join('\r\n');
  const [e] = run('https://www.facebook.com/tr/', 'POST', body);
  assert.equal(e.vendor, 'meta');
  assert.equal(e.event, 'Lead');
  assert.equal(e.params.id, '3695308604059935');
  assert.equal(e.params.eid, '184d73fb-4cb4-468e-88b0-1dafaa5601d7', 'dedup key for the CAPI pair');
  assert.equal(e.params.value, '0');
});

t('urlencoded bodies still parse after the multipart change', () => {
  const ev = run('https://sgtm.example.kz/g/collect?v=2&tid=G-A', 'POST', 'en=view_item&epn.value=1\nen=add_to_cart&epn.value=2');
  assert.deepEqual(ev.map((x) => x.event), ['view_item', 'add_to_cart']);
});

t('generic collector matcher does not fire on ordinary API traffic', () => {
  assert.equal(run('https://site.example.kz/api/events?page=2').length, 0, 'no payload, no event');
  assert.equal(run('https://site.example.kz/ajax/check-bot/?user_id=9c679272&timestamp=1786357377649').length, 0);
});

t('the first-party user_id in that payload is redacted', () => {
  const [e] = run('https://telemetry.example.kz/api/collect/open?data=%7B%22user_id%22%3A%2200000000-0000-0000-0000-000000000000%22%7D');
  const { event, hits } = redactEvent(e);
  assert.equal(event.redacted, true);
  assert.equal(hits[0].kind, 'identifier');
  assert.ok(!event.params.user_id.includes('0000-0000'));
});

console.log('dataLayer');

t('object push', () => {
  const d = parseDataLayer({ event: 'add_to_cart', ecommerce: { value: 1 } });
  assert.equal(d.event, 'add_to_cart');
  assert.deepEqual(d.params, { ecommerce: { value: 1 } });
});

t('gtag consent arguments object', () => {
  const d = parseDataLayer({ 0: 'consent', 1: 'default', 2: { ad_storage: 'denied', analytics_storage: 'granted' } });
  assert.equal(d.source, 'consent');
  assert.equal(d.event, 'consent_default');
  assert.equal(d.params.ad_storage, 'denied');
});

t('gtag event arguments object', () => {
  const d = parseDataLayer({ 0: 'event', 1: 'purchase', 2: { value: 10 } });
  assert.equal(d.event, 'purchase');
  assert.equal(d.params.value, 10);
});

t('message without an event key still lands', () => {
  assert.equal(parseDataLayer({ 'gtm.start': 1 }).event, '(message)');
});

console.log('tap (MAIN world, run in a vm sandbox)');

const TAP = readFileSync(new URL('../extension/tap.js', import.meta.url), 'utf8');

/** Fake page: `window` is the sandbox global, so Object.keys(window) sees our layers. */
function page(globals = {}) {
  const ctx = { location: { href: 'https://example.kz/' }, setInterval: () => 0, clearInterval: () => {}, JSON, Object, Array, Date, ...globals };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(TAP, ctx);
  return ctx;
}
// Values crossing the vm boundary carry the sandbox's prototypes, so pull them
// into this realm before comparing.
const drain = (ctx) => JSON.parse(JSON.stringify(ctx.window.__pulsecheck.drain())).items;

function leasedPage() {
  let now = 1000;
  let nextTimer = 0;
  const timers = new Map();
  const ctx = page({
    dataLayer: [],
    Date: class extends Date { static now() { return now; } },
    setInterval: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
    clearInterval: (id) => timers.delete(id),
  });
  return { ctx, timers, advance: (ms) => { now += ms; } };
}

for (const expireBy of ['timer', 'push', 'drain']) {
  t(`expired lease clears the buffer and stops recording (${expireBy})`, () => {
    const { ctx, timers, advance } = leasedPage();
    ctx.dataLayer.push({ event: 'before_expiry' });
    advance(60000);
    if (expireBy === 'timer') for (const fn of timers.values()) fn();
    if (expireBy !== 'drain') {
      ctx.dataLayer.push({ event: 'after_expiry' });
      assert.equal(timers.size, 0, 'scanning stops');
    }
    assert.deepEqual(drain(ctx), [], 'expired items never reach the panel');
    assert.equal(ctx.dataLayer.length, expireBy === 'drain' ? 1 : 2, 'page pushes still work');
  });
}

t('recording retains buffered and new events through a delay under 60 seconds', () => {
  const { ctx, advance } = leasedPage();
  ctx.dataLayer.push({ event: 'before_delay' });
  advance(59999);
  ctx.dataLayer.push({ event: 'after_delay' });
  assert.deepEqual(drain(ctx).map((item) => item.msg.event), ['before_delay', 'after_delay']);
});

t('each drain renews the recording lease', () => {
  const { ctx, advance } = leasedPage();
  for (let i = 0; i < 4; i++) {
    advance(45000);
    ctx.dataLayer.push({ event: 'still_recording' });
    assert.deepEqual(drain(ctx).map((item) => item.msg.event), ['still_recording']);
  }
});

t('explicit stop clears the buffer and resumes without replaying paused entries', () => {
  const { ctx, timers } = leasedPage();
  ctx.dataLayer.push({ event: 'discard' });
  ctx.__pulsecheck.stop();
  ctx.dataLayer.push({ event: 'paused' });
  ctx.digitalData = [{ event: 'created_while_paused' }];
  ctx.__pulsecheck.scan();
  assert.equal(timers.size, 0);
  assert.deepEqual(drain(ctx), []);
  ctx.digitalData.push({ event: 'resumed' });
  assert.deepEqual(drain(ctx).map((item) => item.msg.event), ['resumed']);
});

t('snapshots pushes that happened before injection', () => {
  const ctx = page({ dataLayer: [{ 'gtm.start': 1, event: 'gtm.js' }, { event: 'form_start' }] });
  const items = drain(ctx);
  assert.deepEqual(items.map((i) => i.msg.event), ['gtm.js', 'form_start']);
  assert.equal(items[0].page, 'https://example.kz/');
});

t('captures pushes after injection, and the page still gets them', () => {
  const ctx = page({ dataLayer: [] });
  drain(ctx);
  const len = ctx.dataLayer.push({ event: 'purchase', value: 1 });
  assert.equal(len, 1, 'push must return the real length - never break the page');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.dataLayer)), [{ event: 'purchase', value: 1 }]);
  const items = drain(ctx);
  assert.equal(items.length, 1);
  assert.equal(items[0].msg.event, 'purchase');
  assert.ok(items[0].ts > 0);
});

t('the tap is invisible to page code', () => {
  const ctx = page({ dataLayer: [{ event: 'a' }] });
  // Native push is non-enumerable; ours must be too, or every for-in and
  // Object.keys over the dataLayer on the page starts seeing it.
  assert.deepEqual([...ctx.Object.keys(ctx.dataLayer)], ['0']);
  assert.equal(ctx.dataLayer.length, 1);
});

t('nested wrappers record once, not twice', () => {
  // Seen live: every dataLayer event was captured twice. gtm.js grabs
  // the push that exists when it loads - ours - and installs its own that
  // calls it. Our re-arm then wraps GTM's. Two wrappers, one push.
  const ctx = page({ dataLayer: [] });
  drain(ctx);
  const inner = ctx.dataLayer.push;
  ctx.dataLayer.push = function (...a) { return inner.apply(ctx.dataLayer, a); };
  ctx.window.__pulsecheck.scan();
  ctx.dataLayer.push({ event: 'once' });
  const items = drain(ctx);
  assert.equal(items.length, 1, 'exactly one record per push');
  assert.equal(ctx.dataLayer.length, 1, 'and the page still got it exactly once');
});

t('re-arms after GTM replaces dataLayer.push', () => {
  const ctx = page({ dataLayer: [] });
  drain(ctx);
  const native = [].push;
  ctx.dataLayer.push = function (...a) { return native.apply(this, a); }; // what gtm.js does
  ctx.window.__pulsecheck.scan();
  ctx.dataLayer.push({ event: 'after_gtm' });
  assert.deepEqual(drain(ctx).map((i) => i.msg.event), ['after_gtm']);
});

t('re-arm does not re-snapshot already-seen entries', () => {
  const ctx = page({ dataLayer: [{ event: 'early' }] });
  ctx.window.__pulsecheck.scan();
  ctx.window.__pulsecheck.scan();
  assert.equal(drain(ctx).length, 1);
});

t('finds custom-named layers, ignores unrelated arrays', () => {
  const ctx = page({ dataLayerKZ: [{ event: 'x' }], someOtherArray: [{ event: 'noise' }] });
  assert.deepEqual(drain(ctx).map((i) => i.layer), ['dataLayerKZ']);
});

t('unserialisable payloads never throw', () => {
  const ctx = page({ dataLayer: [] });
  drain(ctx);
  const cyclic = { event: 'weird', fn() {} };
  cyclic.self = cyclic;
  ctx.dataLayer.push(cyclic);
  const items = drain(ctx); // drain must survive the JSON hop to the panel
  assert.equal(items[0].msg.self, '[circular]');
  assert.match(items[0].msg.fn, /^\[function/);
});

console.log('redaction');

t('email in params is masked and flagged', () => {
  const { event, hits } = redactEvent({ params: { user_email_field: 'alice@example.com' } });
  assert.equal(event.params.user_email_field, 'a***@***.com');
  assert.equal(event.redacted, true);
  assert.equal(hits[0].kind, 'email');
});

t('phone is masked', () => {
  const { event } = redactEvent({ params: { contact: '+7 701 234 56 78' } });
  assert.equal(event.params.contact, '+7********78');
});

t('name-like key is masked', () => {
  const { event } = redactEvent({ params: { first_name: 'Дилшат' } });
  assert.equal(event.params.first_name, 'Д*****');
});

t('user_id and device_id are masked', () => {
  const { event } = redactEvent({ params: { user_id: 'u-12345', device_id: 'abc-def' } });
  assert.equal(event.params.user_id, 'u******');
  assert.equal(event.params.device_id, 'a******');
});

t('analysis identifiers survive redaction', () => {
  // Regression guard: masking these would break dedup and stream checks
  // without protecting anyone. See KEEP in redact.js.
  const { event, hits } = redactEvent({
    params: { cid: '1234567890.1234567890', sid: '1754812803', tid: 'G-ABC123', insert_id: 'i1', eid: 'e1', value: 125000, _p: '1234567890' },
  });
  assert.deepEqual(event.params, { cid: '1234567890.1234567890', sid: '1754812803', tid: 'G-ABC123', insert_id: 'i1', eid: 'e1', value: 125000, _p: '1234567890' });
  assert.equal(hits.length, 0);
  assert.equal(event.redacted, false);
});

t('PII in the URL query is masked and located', () => {
  const { event, hits } = redactEvent({ url: 'https://sgtm.example.kz/g/collect?en=lead&customer=a.person@mail.ru' });
  assert.ok(!event.url.includes('a.person@mail.ru'));
  assert.ok(hits.some((h) => h.path.startsWith('url.')));
});

for (const key of ['api_secret', 'apiSecret', 'api-secret', 'secret']) {
  t(`${key} is fully masked`, () => {
    const { event } = redactEvent({ params: { [key]: 'synthetic-secret' } });
    assert.equal(event.params[key], '[redacted]');
  });
}

for (const ip of ['192.0.2.1', '2001:db8::1', '::1', '2001:db8:0:0:0:0:0:1', '::ffff:192.0.2.1']) {
  t(`IP address ${ip} is masked in string values`, () => {
    const { event, hits } = redactEvent({
      params: { ip, bare: ` ${ip} `, text: `address [${ip}]`, body: JSON.stringify({ ip, cid: ip }) },
      raw: `ip=${encodeURIComponent(ip)}&cid=${encodeURIComponent(ip)}`,
    });
    assert.equal(event.params.ip, '[redacted]');
    assert.equal(event.params.bare, ' [redacted] ');
    assert.equal(event.params.text, `address [${ip}]`, 'ordinary text is not scanned for embedded IPs');
    assert.equal(JSON.parse(event.params.body).ip, '[redacted]');
    assert.equal(JSON.parse(event.params.body).cid, ip, 'deliberate exceptions also apply in JSON');
    assert.equal(new URLSearchParams(event.raw).get('ip'), '[redacted]');
    assert.equal(new URLSearchParams(event.raw).get('cid'), ip);
    assert.ok(hits.some((hit) => hit.kind === 'ip'));
  });
}

for (const text of ['192.0.2.1:443', 'address:192.0.2.1', 'address 192.0.2.1.', 'address 2001:db8::1.']) {
  t(`IP addresses next to punctuation are masked only under IP-like keys: ${text}`, () => {
    const { event } = redactEvent({ params: { ip: text, text } });
    assert.ok(!event.params.ip.includes('192.0.2.1'));
    assert.ok(!event.params.ip.includes('2001:db8::1'));
    assert.equal(event.params.text, text);
  });
}

for (const key of ['ip', 'ip_address', 'client_ip', 'remote_addr', 'x-forwarded-for', 'uip', '_uip']) {
  t(`IP-like key ${key} masks addresses within its value`, () => {
    const { event, hits } = redactEvent({ params: { [key]: '203.0.113.5, 2001:db8::1' } });
    assert.equal(event.params[key], '[redacted], [redacted]');
    assert.equal(hits.filter((hit) => hit.kind === 'ip').length, 2);
  });
}

for (const [key, value] of Object.entries({ uafvl: 'Not_A Brand;8.0.0.0', uapv: '8.0.0.0', app_version: '5.12.0.3', client_version: '203.0.113.5' })) {
  t(`version field ${key} survives without IP findings`, () => {
    const [e] = run('https://www.google-analytics.com/g/collect?v=2&tid=G-ABC123&en=page_view&' + new URLSearchParams({ [key]: value }));
    const s = buildSession({ startedAt: 1, page: 'https://shop.example/', events: [{ ...e, seq: 1, ts: 1, source: 'network' }] });
    assert.equal(s.events[0].params[key], value);
    assert.equal(new URL(s.events[0].url).searchParams.get(key), value);
    assert.equal(s.checks.pii.length, 0, 'no false high-severity IP-in-URL findings');
  });
}

t('bare IPv4 and GA4 uip values are masked', () => {
  const { event, hits } = redactEvent({ params: { other: '203.0.113.5' }, url: 'https://www.google-analytics.com/g/collect?uip=203.0.113.5' });
  assert.equal(event.params.other, '[redacted]');
  assert.equal(new URL(event.url).searchParams.get('uip'), '[redacted]');
  assert.equal(hits.filter((hit) => hit.kind === 'ip').length, 2);
});

for (const name of ['lead_jane@example.com', 'lead +77012345678', '203.0.113.5', 'Lead']) {
  t(`event names undergo inline detection: ${name}`, () => {
    const { event, hits } = redactEvent({ event: name });
    assert.equal(event.redacted, name !== 'Lead');
    assert.equal(hits.length, name === 'Lead' ? 0 : 1);
    if (name !== 'Lead') assert.notEqual(event.event, name);
  });
}

for (const [path, kind] of [['/pin/123456789', 'secret'], ['/order/87771234567', 'phone']]) {
  t(`path segment context trade-off: ${path}`, () => {
    const { event, hits } = redactEvent({ event: 'GET ' + path, url: 'https://shop.example' + path });
    assert.equal(event.event, 'GET ' + new URL(event.url).pathname);
    assert.equal(hits.filter((hit) => hit.kind === kind).length, 2);
  });
}

for (const host of ['192.0.2.1', '[2001:db8::1]']) {
  t(`IP address URL host is masked: ${host}`, () => {
    const { event } = redactEvent({ page: `https://${host}/checkout` });
    assert.equal(new URL(event.page).hostname, 'redacted.invalid');
  });
}

t('bracketed IPv6 request host is masked alongside its URL', () => {
  const req = toRequest({ url: 'https://[2001:db8::1]/profile' });
  const { event, hits } = redactEvent({ url: req.url, params: { host: req.host } });
  assert.equal(event.params.host, '[[redacted]]');
  assert.equal(new URL(event.url).hostname, 'redacted.invalid');
  assert.ok(hits.some((hit) => hit.path === 'host' && hit.kind === 'ip'));
});

for (const [query, key, values] of [
  ['jane@example.com', 'j***@***.com', ['']],
  ['jane@example.com=1', 'j***@***.com', ['1']],
  ['+77012345678', ' 7********78', ['']],
  ['jane@example.com=1&jane@example.com=2', 'j***@***.com', ['1', '2']],
]) {
  t(`URL-valued parameters mask query keys: ${query}`, () => {
    const { event, hits } = redactEvent({ params: { page_location: 'https://shop.example/?' + query + '&cid=123.456' } });
    const params = new URL(event.params.page_location).searchParams;
    assert.deepEqual([...params.keys()], [...values.map(() => key), 'cid']);
    assert.deepEqual(params.getAll(key), values);
    assert.equal(params.get('cid'), '123.456');
    assert.equal(hits.length, values.length);
    assert.ok(!JSON.stringify({ event, hits }).includes(query.split('=')[0]));
  });
}

for (const [authority, kind] of [
  ['jane@example.com', 'name'], ['jane@example.com:8443', 'name'],
  ['admin@shop.example', 'name'], ['user:synthetic-secret@shop.example', 'name'],
  ['8701-234-56-78', 'phone'],
]) {
  t(`URL authority patterns are masked in parameters, JSON and nested queries: ${authority}`, () => {
    const location = `https://${authority}/profile`;
    const { event, hits } = redactEvent({
      params: { page_location: location, body: JSON.stringify({ location }) },
      url: 'https://shop.example/?' + new URLSearchParams({ next: location }),
      page: location,
    });
    for (const masked of [event.params.page_location, JSON.parse(event.params.body).location,
      new URL(event.url).searchParams.get('next'), event.page]) {
      assert.ok(!masked.includes(authority));
      assert.equal(new URL(masked).pathname, '/profile');
      assert.equal(new URL(masked).host, kind === 'phone' ? 'redacted.invalid' : new URL(location).host);
      if (new URL(location).password) assert.equal(decodeURIComponent(new URL(masked).password), '[redacted]');
    }
    assert.equal(event.redacted, true);
    assert.equal(hits.filter((hit) => hit.kind === kind).length, 4);
    if (new URL(location).password) assert.equal(hits.filter((hit) => hit.kind === 'secret').length, 4);
  });
}

for (const [suffix, key, expected, kind] of [
  ['?ev=a%3D1%26iin%3D900101300123', 'ev', 'a=1&iin=9***********', 'national_id'],
  ['?_p=a%3D1%26iin%3D900101300123', '_p', 'a=1&iin=9***********', 'national_id'],
  ['?ev=%7B%22name%22%3A%22Jane%22%7D', 'ev', '{"name":"J***"}', 'name'],
  ['?ev=fn%3DJane', 'ev', 'fn=J***', 'identifier'],
  ['?value=password%3Dsecretpw', 'value', 'password=%5Bredacted%5D', 'secret'],
  ['?en={"iin":"900101300123"}', 'en', '{"iin":"9***********"}', 'national_id'],
  ['?cid={"user_id":"user-123"}', 'cid', '{"user_id":"u*******"}', 'identifier'],
  ['#value=a%3D1%26iin%3D900101300123', 'value', 'a=1&iin=9***********', 'national_id'],
  ['#/a?ev={"iin":"900101300123"}', 'ev', '{"iin":"9***********"}', 'national_id'],
]) {
  t(`KEEP URL values receive embedded key-based redaction: ${suffix}`, () => {
    const { event, hits } = redactEvent({ url: 'https://shop.example/' + suffix });
    const url = new URL(event.url);
    const params = suffix.startsWith('?') ? url.searchParams
      : new URLSearchParams(url.hash.slice(url.hash.includes('?') ? url.hash.indexOf('?') + 1 : 1));
    assert.equal(params.get(key), expected);
    assert.ok(hits.some((hit) => hit.kind === kind));
    assert.ok(hits.every((hit) => hit.inUrl));
  });
}

for (const suffix of [
  '/p',
  '/#value=jane%40example.com',
  '/#value=%5B%5Djane%2540example.com%5B%5D&safe=%2B%5B%5D',
]) {
  t(`URL inline fallback preserves authority and unrelated encoding: ${suffix}`, () => {
    const location = 'https://user@shop.example.kz' + suffix;
    const { event, hits } = redactEvent({ url: location, page: location });
    assert.equal(event.url, event.page);
    assert.equal(new URL(event.url).host, 'shop.example.kz');
    assert.ok(event.url.startsWith('https://'));
    assert.equal(new URL(event.url).pathname, suffix === '/p' ? '/p' : '/');
    assert.ok(!decodeURIComponent(event.url).includes('jane@example.com'));
    if (suffix.includes('safe=')) {
      assert.ok(event.url.endsWith('&safe=%2B%5B%5D'));
      assert.ok(event.url.includes('value=%5B%5Dj***%40***.com%5B%5D'));
    }
    assert.ok(hits.every((hit) => hit.inUrl));
  });
}

for (const carrier of ['object', 'JSON', 'form']) {
  t(`colliding masked ${carrier} keys preserve both values and distinct hit paths`, () => {
    const payload = { 'jane@example.com': 'first', 'john@example.com': 'second' };
    const { event, hits } = redactEvent({ params: { payload: carrier === 'object' ? payload
      : carrier === 'JSON' ? JSON.stringify(payload) : new URLSearchParams(payload).toString() } });
    const masked = carrier === 'object' ? event.params.payload
      : carrier === 'JSON' ? JSON.parse(event.params.payload) : Object.fromEntries(new URLSearchParams(event.params.payload));
    assert.deepEqual(masked, { 'j***@***.com': 'first', 'j***@***.com#2': 'second' });
    assert.deepEqual(hits.map((hit) => hit.path), ['payload.j***@***.com', 'payload.j***@***.com#2']);
  });
}

t('METHOD path findings are flagged as in-URL alongside request URL findings', () => {
  const { hits } = redactEvent({ event: 'POST /api/u/jane@example.com', url: 'https://shop.example/api/u/jane@example.com' });
  for (const path of ['event.path.3', 'url.path.3']) {
    assert.ok(hits.some((hit) => hit.path === path && hit.kind === 'email' && hit.inUrl === true));
  }
});

for (const suffix of [
  '/jane%40example.com?api_secret=synthetic-secret#access_token=abc123&cid=123.456',
  '/access_token/abc123#jane%40example.com',
  '/192.0.2.1#2001:db8::1',
  '/checkout#/reset?email=jane%40example.com&token=abc123',
]) {
  t(`request and page URLs redact paths and fragments: ${suffix}`, () => {
    const url = 'https://shop.example' + suffix;
    const { event } = redactEvent({ url, page: url });
    assert.equal(event.url, event.page);
    const decoded = decodeURIComponent(event.url);
    for (const secret of ['jane@example.com', 'synthetic-secret', 'abc123', '192.0.2.1', '2001:db8::1']) {
      assert.ok(!decoded.includes(secret), secret);
    }
    if (suffix.includes('cid=')) assert.ok(decoded.includes('cid=123.456'));
  });
}

t('credentials and payment secrets are removed completely', () => {
  const { event, hits } = redactEvent({
    params: {
      body: '{"access_token":"live-token","card_number":"4111111111111111","value":129}',
    },
    url: 'https://api.example.kz/submit?authorization=Bearer%20live-token',
  });
  assert.ok(!event.params.body.includes('live-token'));
  assert.ok(!event.params.body.includes('4111111111111111'));
  assert.ok(!event.url.includes('live-token'));
  assert.ok(event.params.body.includes('"value":129'));
  assert.equal(hits.filter((h) => h.kind === 'secret').length, 3);
});

t('KZ national id and sole-trader name are masked (sanitized live capture)', () => {
  const { event, hits } = redactEvent({
    params: { entity: { entity_type: 'ip', iin_bin: '920422300185', organization_name: 'ИП РАХИМОВ', registry_status: '1' } },
  });
  assert.equal(event.params.entity.iin_bin, '9***********');
  assert.equal(event.params.entity.organization_name, 'И*********');
  assert.equal(event.params.entity.registry_status, '1', 'non-PII fields untouched');
  assert.equal(event.params.entity.entity_type, 'ip');
  assert.ok(hits.some((h) => h.kind === 'national_id' && h.path === 'entity.iin_bin'));
});

t('audit-subject *_name fields are not treated as person names', () => {
  const { event, hits } = redactEvent({
    params: { event_name: 'Lead', item_name: 'Онлайн-кредит', product_name: 'ИП кредит', page_name: 'loans' },
  });
  assert.equal(event.params.item_name, 'Онлайн-кредит');
  assert.equal(event.params.product_name, 'ИП кредит');
  assert.equal(hits.length, 0);
});

t('PII inside a captured request body is masked', () => {
  // Tracking payloads can carry PII embedded in JSON rather than as a whole
  // parameter value.
  const body = '{"iin":"920422300185","phone":"+7 701 234 56 78","email":"a.person@mail.ru","created_at":"2024-01-15 10:30:45","amount":1250000}';
  const { event, hits } = redactEvent({ params: { body } });
  assert.ok(!event.params.body.includes('920422300185'));
  assert.ok(!event.params.body.includes('a.person@mail.ru'));
  assert.ok(!event.params.body.includes('+7 701 234 56 78'));
  assert.ok(event.params.body.includes('"created_at":"2024-01-15 10:30:45"'), 'timestamps must survive');
  assert.ok(event.params.body.includes('"amount":1250000'), 'amounts must survive');
  assert.equal(event.redacted, true);
  assert.ok(hits.some((h) => h.kind === 'national_id' && h.path === 'body.iin'));
});

t('PII inside form-encoded request bodies is masked', () => {
  const body = 'iin=920422300185&phone=%2B77012345678&amount=1250000';
  const { event, hits } = redactEvent({ params: { body } });
  assert.ok(!event.params.body.includes('920422300185'));
  assert.ok(!event.params.body.includes('%2B77012345678'));
  assert.ok(event.params.body.includes('amount=1250000'));
  assert.ok(hits.some((h) => h.path === 'body.iin'));
});

t('masking in a raw parser fallback is reported', () => {
  const { event, hits } = redactEvent({ raw: '{"email":"alice@example.com"}' });
  assert.ok(!event.raw.includes('alice@example.com'));
  assert.equal(event.redacted, true);
  assert.ok(hits.some((h) => h.kind === 'identifier' && h.path === 'raw.email'));
});

t('inline scan does not eat ids that merely sit near separators', () => {
  const body = '{"ts":1786357377649,"cid":"1234567890.1234567890","order":"2024-01-15","pixel":"3695308604059935"}';
  const { event, hits } = redactEvent({ params: { body } });
  assert.equal(event.params.body, body);
  assert.equal(hits.length, 0);
});

t('phone detector rejects id-shaped numbers', () => {
  assert.equal(looksLikePhone('+77012345678'), true);
  assert.equal(looksLikePhone('87012345678'), true);
  assert.equal(looksLikePhone('1754812803217'), false, '13-digit epoch ms');
  assert.equal(looksLikePhone('1234567890.1234567890'), false, 'GA4 cid');
  assert.equal(looksLikePhone('1234567890123456'), false, 'Meta pixel id');
});

console.log('export');

for (const [key, location, path] of [
  ['page_location', 'https://jane@example.com:8443/p', 'authority'],
  ['dl', 'https://8701-234-56-78/p', 'host'],
  ['dl', 'https://shop.example/jane%40example.com', 'path.1'],
  ['dl', 'https://shop.example/#jane%40example.com', 'fragment.0'],
  ['dl', 'https://shop.example/?jane%40example.com=1', 'query'],
]) {
  t(`URL-valued ${key}.${path} is flagged as in-URL`, () => {
    const s = buildSession({ startedAt: 1, page: 'https://shop.example/', events: [
      { seq: 1, ts: 1, source: 'network', vendor: 'ga4', event: 'page_view', params: { [key]: location } },
    ] });
    assert.equal(s.checks.pii.find((hit) => hit.path === `${key}.${path}`)?.inUrl, true);
  });
}

for (const suffix of [
  '/en/jane@example.com',
  '/#/en/jane@example.com',
  '/value/%2B77012345678',
  '/?value=jane@example.com',
  '/?ev=jane@example.com&cid=1.2',
  '/?en=%2B77012345678',
  '/?_p=jane@example.com',
  // KEEP in a fragment form receives embedded and inline detection.
  '/#value=jane%40example.com',
  '/#en=%2B77012345678',
]) {
  const location = 'https://shop.example' + suffix;
  for (const [carrier, fields] of [
    ['request URL', { url: location }],
    ['page URL', { page: location }],
    ['parameter', { params: { dl: location } }],
    ['JSON body', { params: { body: JSON.stringify({ dl: location }) } }],
    ['form body', { params: { body: new URLSearchParams({ dl: location }).toString() } }],
    ['raw JSON', { raw: JSON.stringify({ dl: location }) }],
    ['raw form', { raw: new URLSearchParams({ dl: location }).toString() }],
  ]) {
    t(`URL inline patterns in ${carrier} are absent from both exports: ${suffix}`, () => {
      const s = buildSession({ startedAt: 1, page: 'https://shop.example/', events: [
        { seq: 1, ts: 1, source: 'network', vendor: 'ga4', event: 'page_view', ...fields },
      ] });
      assert.ok(s.checks.pii.length > 0);
      assert.ok(s.checks.pii.every((hit) => hit.inUrl));
      for (const output of [toMarkdown(s), toJsonl(s)]) {
        // Decode body and URL layers so encoded PII cannot evade the assertion.
        let decoded = output;
        for (let i = 0; i < 3; i++) decoded = decodeURIComponent(decoded);
        assert.ok(!decoded.includes('jane@example.com'));
        assert.ok(!decoded.includes('77012345678'));
      }
    });
  }
}

for (const key of ['host', 'hostname', 'host_id', 'fragments', 'path']) {
  t(`non-URL payload.${key} is not flagged as in-URL`, () => {
    const s = buildSession({ startedAt: 1, page: 'https://shop.example/', events: [
      { seq: 1, ts: 1, source: 'dataLayer', vendor: 'dataLayer', event: 'lead', params: { payload: { [key]: 'jane@example.com' } } },
    ] });
    assert.equal(s.checks.pii.find((hit) => hit.path === `payload.${key}`)?.inUrl, false);
    assert.ok(!toMarkdown(s).includes('**in a URL**'));
  });
}

for (const fields of [
  { params: { payload: { 'jane@example.com': 'jane@example.com' } } },
  { params: { body: '{"jane@example.com":"jane@example.com"}' } },
  { params: { body: 'jane%40example.com=jane%40example.com&jane%40example.com=1' } },
  { params: { dl: 'https://shop.example/#jane@example.com=1' } },
  { raw: '{"jane@example.com":1}' },
  { raw: 'jane%40example.com=1' },
]) {
  t(`PII in object and form keys is absent from exports and hit paths: ${JSON.stringify(fields)}`, () => {
    const s = buildSession({ startedAt: 1, page: 'https://shop.example/', events: [
      { seq: 1, ts: 1, source: 'network', vendor: 'ga4', event: 'page_view', ...fields },
    ] });
    assert.ok(s.checks.pii.length > 0);
    for (const output of [toMarkdown(s), toJsonl(s), JSON.stringify(s.checks.pii)]) {
      assert.ok(!decodeURIComponent(output).includes('jane@example.com'));
    }
  });
}

t('PII findings collect email and phone kinds sharing dl.query', () => {
  const s = buildSession({ startedAt: 1, page: 'https://shop.example/', events: [
    { seq: 1, ts: 1, source: 'network', vendor: 'ga4', event: 'page_view', params: {
      dl: 'https://shop.example/?' + new URLSearchParams([['jane@example.com', '1'], ['+77012345678', '1']]),
    } },
  ] });
  const hit = s.checks.pii.find((hit) => hit.path === 'dl.query');
  assert.equal(hit.kind, 'email, phone');
  assert.equal(hit.count, 2);
  assert.equal(hit.inUrl, true);
  assert.ok(toMarkdown(s).includes('`dl.query` - email, phone, 2x, **in a URL**'));
});

for (const [base, key] of [
  ['https://www.facebook.com/tr/?id=1234567890123456&ev=PageView', 'dl'],
  ['https://www.google-analytics.com/g/collect?v=2&tid=G-ABC123&en=page_view', 'page_location'],
  ['https://www.google-analytics.com/g/collect?v=2&tid=G-ABC123&en=page_view', 'page_referrer'],
]) {
  t(`URL-valued ${key} masks query and fragment secrets in both exports`, () => {
    const location = 'https://shop.example/checkout?token=abc123#access_token=frag999';
    const [e] = run(base + '&' + new URLSearchParams({ [key]: location }));
    const s = buildSession({ startedAt: 1, page: 'https://shop.example/', events: [{ ...e, seq: 1, ts: 1, source: 'network' }] });
    const masked = new URL(s.events[0].params[key]);
    assert.equal(masked.searchParams.get('token'), '[redacted]');
    assert.equal(new URLSearchParams(masked.hash.slice(1)).get('access_token'), '[redacted]');
    for (const output of [toMarkdown(s), toJsonl(s)]) {
      assert.ok(!output.includes('abc123'));
      assert.ok(!output.includes('frag999'));
    }
  });
}

t('API-context event paths mask emails and secrets in both exports', () => {
  const path = '/api/users/jane@example.com/token/abc123';
  const s = buildSession({ startedAt: 1, page: 'https://shop.example/', events: [
    { seq: 1, ts: 1, source: 'network', vendor: 'request', event: 'GET ' + path, url: 'https://shop.example' + path, params: {} },
  ] });
  assert.equal(s.events[0].event, 'GET ' + new URL(s.events[0].url).pathname);
  for (const output of [toMarkdown(s), toJsonl(s)]) {
    assert.ok(!output.includes('jane@example.com'));
    assert.ok(!output.includes('abc123'));
  }
});

t('release versions agree', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const session = buildSession({ startedAt: 1, page: 'https://example.kz/', events: [] });
  assert.equal(manifest.version, pkg.version);
  assert.equal(session.header.version, pkg.version);
});

const fixtureSession = () => {
  const t0 = 1754812800000;
  return buildSession({
    startedAt: t0,
    page: 'https://example.kz/loan',
    notes: 'заявка на кредит',
    userAgent: 'test',
    events: [
      { type: 'event', seq: 1, ts: t0 + 100, source: 'consent', vendor: 'consent', event: 'consent_default', params: { ad_storage: 'denied', analytics_storage: 'granted' }, page: 'https://example.kz/loan' },
      { type: 'event', seq: 2, ts: t0 + 900, source: 'network', transport: 'beacon', vendor: 'ga4', event: 'purchase', params: { value: 125000, currency: 'KZT', tid: 'G-ABC' }, url: 'https://sgtm.example.kz/g/collect?v=2', page: 'https://example.kz/loan', consent: { ad_storage: 'denied', analytics_storage: 'granted' } },
      { type: 'event', seq: 3, ts: t0 + 1400, source: 'network', transport: 'pixel', vendor: 'ga4', event: 'purchase', params: { value: 125000, currency: 'KZT', tid: 'G-ABC' }, url: 'https://sgtm.example.kz/g/collect?v=2', page: 'https://example.kz/loan', consent: { ad_storage: 'denied', analytics_storage: 'granted' } },
      { type: 'event', seq: 4, ts: t0 + 2000, source: 'network', transport: 'pixel', vendor: 'meta', event: 'Lead', params: { id: '1234567890123456', em: 'client@mail.ru' }, url: 'https://www.facebook.com/tr/', page: 'https://example.kz/thanks', consent: { ad_storage: 'denied', analytics_storage: 'granted' } },
    ],
  });
};

t('jsonl: header first, every line parses, seq gap-free', () => {
  const lines = toJsonl(fixtureSession()).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].type, 'session');
  assert.equal(lines[0].schema, 1);
  assert.equal(lines[0].notes, 'заявка на кредит');
  assert.deepEqual(lines.slice(1).map((l) => l.seq), [1, 2, 3, 4]);
  assert.ok(lines.slice(1).every((l) => l.type === 'event'));
});

t('checks: duplicate suspects, consent violation, PII', () => {
  const s = fixtureSession();
  assert.equal(s.checks.dupes.length, 1, 'two identical ga4 purchases 500ms apart');
  assert.equal(s.checks.violations.length, 1, 'meta fired while ad_storage=denied');
  assert.equal(s.checks.violations[0].e.vendor, 'meta');
  assert.equal(s.checks.violations[0].key, 'ad_storage');
  assert.equal(s.checks.pii.length, 1);
  assert.equal(s.checks.vendors.find((v) => v.vendor === 'ga4').count, 2);
});

t('the ads sync ping is checked against ad_storage, not analytics_storage', () => {
  // GA4 is an analytics vendor, so the vendor-level map passed this silently.
  const t0 = 1754812800000;
  const s = buildSession({
    startedAt: t0, page: 'https://x.kz/', events: [
      { seq: 1, ts: t0, source: 'consent', vendor: 'consent', event: 'consent_default', params: { ad_storage: 'denied', analytics_storage: 'granted' }, page: 'https://x.kz/' },
      { seq: 2, ts: t0 + 500, source: 'network', vendor: 'ga4', event: '(google_ads_sync)', params: { tid: 'G-A' }, page: 'https://x.kz/' },
    ],
  });
  assert.equal(s.checks.violations.length, 1);
  assert.equal(s.checks.violations[0].key, 'ad_storage');
});

t('timeline is ordered by send time and renumbered, consent replayed over it', () => {
  // dataLayer arrives in 500ms drain batches, so capture order lies. Here the
  // consent update really happened first but was appended last.
  const t0 = 1754812800000;
  const s = buildSession({
    startedAt: t0, page: 'https://x.kz/', events: [
      { seq: 1, ts: t0 + 900, source: 'network', vendor: 'meta', event: 'Lead', params: { id: '1' }, page: 'https://x.kz/' },
      { seq: 2, ts: t0 + 100, source: 'consent', vendor: 'consent', event: 'consent_default', params: { ad_storage: 'denied' }, page: 'https://x.kz/' },
    ],
  });
  assert.deepEqual(s.events.map((e) => e.event), ['consent_default', 'Lead'], 'sorted by ts');
  assert.deepEqual(s.events.map((e) => e.seq), [1, 2], 'renumbered gap-free in that order');
  assert.equal(s.events[1].consent.ad_storage, 'denied', 'the earlier consent applies');
  assert.equal(s.checks.violations.length, 1, 'caught only because the order was fixed first');
});

t('hits to different streams are not duplicates of each other', () => {
  // Two Metrica counters on one page fire the same hit type ~simultaneously.
  // Without the stream id in the key, every such pair was a "duplicate".
  const t0 = 1754812800000;
  const ev = (seq, counter, dt) => ({ seq, ts: t0 + dt, source: 'network', vendor: 'metrica', event: 'hit_pv', params: { counter }, page: 'https://x.kz/' });
  const s = buildSession({ startedAt: t0, page: 'https://x.kz/', events: [ev(1, '111', 0), ev(2, '222', 200), ev(3, '111', 400)] });
  assert.equal(s.checks.dupes.length, 1, 'only the two hits on counter 111 collide');
  assert.deepEqual([s.checks.dupes[0].a, s.checks.dupes[0].b], [1, 3]);
});

t('markdown: complete, self-contained, carries no raw PII', () => {
  const md = toMarkdown(fixtureSession());
  for (const section of ['# Pulsecheck', '## Inventory', '## Automatic checks', '## Timeline', 'pulsecheck-analyze']) {
    assert.ok(md.includes(section), 'missing ' + section);
  }
  assert.ok(md.includes('https://example.kz/thanks'), 'page changes appear in the timeline');
  assert.ok(!md.includes('client@mail.ru'), 'raw PII must never reach the file');
  assert.ok(md.includes('125000'), 'params are carried in full');
});

for (const withEvents of [false, true]) {
  t(`page URLs are masked in Markdown and JSONL (${withEvents ? 'events' : 'header only'})`, () => {
    const page = 'https://shop.example/checkout?email=jane@example.com#access_token=abc123';
    const s = buildSession({
      startedAt: 1, page,
      events: withEvents ? [
        { seq: 1, ts: 1, source: 'datalayer', vendor: 'datalayer', event: 'checkout', page, params: { cid: '123.456', page_name: 'checkout' } },
        { seq: 2, ts: 2, source: 'datalayer', vendor: 'datalayer', event: 'purchase', page: page.replace('/checkout', '/thanks'), params: {} },
      ] : [],
    });
    assert.ok(!decodeURIComponent(s.header.page).includes('jane@example.com'));
    for (const output of [toMarkdown(s), toJsonl(s)]) {
      assert.ok(!output.includes('jane@example.com'));
      assert.ok(!output.includes('abc123'));
    }
    if (withEvents) {
      assert.equal(s.events[0].params.cid, '123.456');
      assert.equal(s.events[0].params.page_name, 'checkout');
    }
  });
}

t('same-named dataLayer pushes with different payloads are not duplicates', () => {
  // Live capture: six section_view pushes in the same millisecond,
  // one per section. All six collided because dataLayer pushes carry no stream
  // id and no value, so the key was identical for all of them.
  const t0 = 1754812800000;
  const view = (seq, id, dt) => ({ seq, ts: t0 + dt, source: 'datalayer', vendor: 'datalayer', event: 'section_view', params: { section_id: id }, page: 'https://x.kz/' });
  const s = buildSession({
    startedAt: t0, page: 'https://x.kz/',
    events: [view(1, 'gtm_basics', 0), view(2, 'ga4_events', 1), view(3, 'ecommerce', 67)],
  });
  assert.equal(s.checks.dupes.length, 0);
});

t('a genuinely doubled push is still caught', () => {
  const t0 = 1754812800000;
  const push = (seq, dt) => ({ seq, ts: t0 + dt, source: 'datalayer', vendor: 'datalayer', event: 'lead_submit', params: { form_id: 'contact' }, page: 'https://x.kz/' });
  const s = buildSession({ startedAt: t0, page: 'https://x.kz/', events: [push(1, 0), push(2, 30)] });
  assert.equal(s.checks.dupes.length, 1, 'identical payload 30ms apart');
});

t('context traffic does not take over the Top events table', () => {
  const t0 = 1754812800000;
  const noise = (seq) => ({ seq, ts: t0 + seq * 10, source: 'network', vendor: 'request', event: 'POST /youtubei/v1/log_event', params: { host: 'www.youtube.com' }, page: 'https://x.kz/' });
  const s = buildSession({
    startedAt: t0, page: 'https://x.kz/', capture: { allRequests: true },
    events: [...Array.from({ length: 16 }, (_, i) => noise(i + 1)),
      { seq: 17, ts: t0 + 500, source: 'datalayer', vendor: 'datalayer', event: 'form_start', params: {}, page: 'https://x.kz/' }],
  });
  assert.deepEqual(s.checks.top.map((t) => t.name), ['datalayer · form_start']);
  assert.equal(s.checks.vendors.find((v) => v.vendor === 'request').count, 16, 'still counted in the inventory');
});

t('header page is where the session started, not where it ended', () => {
  // Recording began on one page, then navigated to another origin. The header
  // incorrectly used to claim the final page and the filename followed it.
  const t0 = 1754812800000;
  const s = buildSession({
    startedAt: t0, page: 'https://docs.example.kz/guide/',
    events: [
      { seq: 1, ts: t0, source: 'datalayer', vendor: 'datalayer', event: 'gtm.js', params: {}, page: 'https://shop.example.kz/' },
      { seq: 2, ts: t0 + 13500, source: 'datalayer', vendor: 'datalayer', event: 'gtm.js', params: {}, page: 'https://docs.example.kz/guide/' },
    ],
  });
  assert.equal(s.header.page, 'https://shop.example.kz/');
  assert.match(fileBase(s), /^pulsecheck-shop\.example\.kz-/);
});

t('the dump records whether request capture was on', () => {
  // "No API calls in the dump" must not be ambiguous between "none happened"
  // and "the toggle was off".
  const off = buildSession({ startedAt: 1, page: 'https://x.kz/', events: [] });
  assert.equal(off.header.capture.allRequests, false);
  assert.ok(toMarkdown(off).includes('NOT recorded'));
  const on = buildSession({ startedAt: 1, page: 'https://x.kz/', events: [], capture: { allRequests: true } });
  assert.equal(on.header.capture.allRequests, true);
  assert.ok(toMarkdown(on).includes('| Site requests (non-tracking) | recorded |'));
});

t('empty session still exports', () => {
  const s = buildSession({ startedAt: 1754812800000, page: 'https://example.kz/', events: [] });
  assert.ok(toMarkdown(s).includes('Nothing captured'));
  assert.equal(toJsonl(s).trim().split('\n').length, 1);
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
