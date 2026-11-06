// Stands in for chrome.devtools so panel.html can run as a normal page with a
// synthetic checkout session. Used for screenshots and UI checks only; the
// extension never loads this file.
import { demoSession, cart, checkout, navigateAt } from './session.js';

const q = new URLSearchParams(location.search);
const t0 = Date.now();
const step = Number(q.get('step') || 600);
const timeline = demoSession(t0);
const listeners = { request: [], nav: [] };
let pending = [];
let navigated = false;

window.chrome = {
  devtools: {
    panels: { themeName: q.get('theme') === 'dark' ? 'dark' : 'default' },
    network: {
      onRequestFinished: { addListener: (fn) => listeners.request.push(fn) },
      onNavigated: { addListener: (fn) => listeners.nav.push(fn) },
    },
    inspectedWindow: {
      eval(src, cb) {
        if (!cb) return;
        if (src.includes('location.href')) return cb(JSON.stringify({ href: cart, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0.0.0' }));
        if (src.includes('drain()')) {
          const items = pending;
          pending = [];
          return cb(JSON.stringify({ page: navigated ? checkout : cart, dropped: 0, items }));
        }
        cb(undefined);
      },
    },
  },
};

timeline.forEach((item, i) => setTimeout(() => {
  if (!navigated && item.dt >= navigateAt) {
    navigated = true;
    for (const fn of listeners.nav) fn(checkout);
  }
  if (item.msg) {
    pending.push({ msg: item.msg, ts: t0 + item.dt, page: item.page, layer: 'dataLayer' });
    return;
  }
  const entry = {
    startedDateTime: new Date(t0 + item.dt).toISOString(),
    request: { url: item.url, method: 'GET' },
    response: { status: 204, content: { mimeType: 'image/gif' } },
    _resourceType: 'ping',
  };
  for (const fn of listeners.request) fn(entry);
}, 50 + i * step));

const clicks = (q.get('click') || '').split('|').filter(Boolean);
setTimeout(() => clicks.forEach((sel, i) => setTimeout(() => document.querySelector(sel)?.click(), i * 300)), 50 + timeline.length * step + 1200);
if (q.get('notes')) addEventListener('DOMContentLoaded', () => (document.getElementById('notes').value = q.get('notes')));
