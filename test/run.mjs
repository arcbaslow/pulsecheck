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
  const ctx = { location: { href: 'https://example.kz/' }, setInterval: () => 0, JSON, Object, Array, Date, ...globals };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(TAP, ctx);
  return ctx;
}
// Values crossing the vm boundary carry the sandbox's prototypes, so pull them
// into this realm before comparing.
const drain = (ctx) => JSON.parse(JSON.stringify(ctx.window.__pulsecheck.drain())).items;

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
  // "All requests" mode records the site's own API payloads - where the real
  // PII lives, embedded in JSON rather than as a whole param value.
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
