// MAIN-world dataLayer tap. Injected by the panel via
// chrome.devtools.inspectedWindow.eval (runs in the page's main world, needs
// no host permissions). Buffers pushes; the panel drains it by polling.
(() => {
  if (window.__pulsecheck) {
    window.__pulsecheck.renew();
    return 'rearmed';
  }

  const buf = [];
  let dropped = 0;
  const RECORDING_LEASE_MS = 60000;
  let expiresAt = Date.now() + RECORDING_LEASE_MS;
  let timer = null;
  const stop = () => {
    expiresAt = 0;
    buf.length = 0;
    dropped = 0;
    clearInterval(timer);
    timer = null;
  };
  const recording = () => {
    if (expiresAt && Date.now() >= expiresAt) stop();
    return expiresAt > 0;
  };

  // JSON-safe clone: cuts cycles, DOM nodes, functions, and runaway depth.
  const safe = (v, clipping, depth = 0, seen = new Set()) => {
    if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
    if (v === undefined) return null;
    if (typeof v === 'function') return '[function ' + (v.name || 'anonymous') + ']';
    if (typeof v !== 'object') return String(v);
    if (v instanceof Date) return v.toISOString();
    if (typeof Node !== 'undefined' && v instanceof Node) return '[' + (v.nodeName || 'Node') + ']';
    if (depth > 6) { clipping.truncated = true; return '[depth]'; }
    if (seen.has(v)) return '[circular]';
    seen.add(v);
    if (Array.isArray(v)) {
      if (v.length > 200) clipping.truncated = true;
      return v.slice(0, 200).map((x) => safe(x, clipping, depth + 1, seen));
    }
    const out = {};
    const keys = Object.keys(v);
    if (keys.length > 200) clipping.truncated = true;
    for (const k of keys.slice(0, 200)) {
      try { out[k] = safe(v[k], clipping, depth + 1, seen); } catch { out[k] = '[unreadable]'; }
    }
    return out;
  };

  const record = (name, msg, historical) => {
    if (!recording()) return;
    if (buf.length >= 5000) { dropped++; return; } // panel drains every 500ms; this is a runaway guard
    try {
      const item = { ts: Date.now(), layer: name, page: location.href };
      item.msg = safe(msg, item);
      if (historical) item.historical = true;
      buf.push(item);
    } catch { /* never break the page */ }
  };

  const wrap = (arr, name, snapshot) => {
    if (!arr || typeof arr.push !== 'function' || arr.push.__pulsecheck) return;
    if (!arr.__pulsecheckSnapshot) {
      Object.defineProperty(arr, '__pulsecheckSnapshot', { value: true, enumerable: false });
      if (snapshot) for (const m of arr) record(name, m, true); // pushes that happened before injection
    }
    const orig = arr.push.bind(arr);
    const patched = function (...args) {
      // Wrappers nest: gtm.js captures whatever push exists at load time
      // (ours) and installs its own that calls it, then our re-arm wraps
      // GTM's. One push then travels through two of our wrappers. Only the
      // outermost records - otherwise every count in the audit is doubled.
      if (arr.__pulsecheckPatched === patched) for (const a of args) record(name, a);
      return orig(...args);
    };
    patched.__pulsecheck = true;
    Object.defineProperty(arr, '__pulsecheckPatched', { value: patched, writable: true, configurable: true, enumerable: false });
    // Native push is non-enumerable; an enumerable override would show up in
    // Object.keys(dataLayer) and for-in on the page. Capture must be invisible.
    try {
      Object.defineProperty(arr, 'push', { value: patched, writable: true, configurable: true, enumerable: false });
    } catch { /* frozen array, skip */ }
  };

  // GTM replaces dataLayer.push with its own after gtm.js loads, and SPAs
  // create layers late - so re-arm on a timer instead of hooking once.
  // ponytail: 1s poll; switch to a Proxy on window if a client ever needs sub-second fidelity.
  const scan = (snapshot = true) => {
    if (!recording()) return;
    for (const key of Object.keys(window)) {
      try {
        if (!/datalayer/i.test(key) && key !== 'digitalData') continue;
        if (Array.isArray(window[key])) wrap(window[key], key, snapshot);
      } catch { /* cross-origin or throwing getter */ }
    }
  };
  const renew = () => {
    const active = recording();
    expiresAt = Date.now() + RECORDING_LEASE_MS;
    if (timer === null) timer = setInterval(scan, 1000);
    // Do not replay entries accumulated while paused or without a panel.
    if (!active) scan(false);
  };

  window.__pulsecheck = {
    scan,
    renew,
    stop,
    drain: () => {
      renew();
      const batch = { page: location.href, items: buf.splice(0, buf.length), dropped };
      dropped = 0;
      return batch;
    },
  };
  scan();
  timer = setInterval(scan, 1000);
  return 'armed';
})();
