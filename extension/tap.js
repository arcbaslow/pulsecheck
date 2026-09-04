// MAIN-world dataLayer tap. Injected by the panel via
// chrome.devtools.inspectedWindow.eval (runs in the page's main world, needs
// no host permissions). Buffers pushes; the panel drains it by polling.
(() => {
  if (window.__pulsecheck) {
    window.__pulsecheck.scan();
    return 'rearmed';
  }

  const buf = [];

  // JSON-safe clone: cuts cycles, DOM nodes, functions, and runaway depth.
  const safe = (v, depth = 0, seen = new Set()) => {
    if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
    if (v === undefined) return null;
    if (typeof v === 'function') return '[function ' + (v.name || 'anonymous') + ']';
    if (typeof v !== 'object') return String(v);
    if (v instanceof Date) return v.toISOString();
    if (typeof Node !== 'undefined' && v instanceof Node) return '[' + (v.nodeName || 'Node') + ']';
    if (depth > 6) return '[depth]';
    if (seen.has(v)) return '[circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.slice(0, 200).map((x) => safe(x, depth + 1, seen));
    const out = {};
    for (const k of Object.keys(v).slice(0, 200)) {
      try { out[k] = safe(v[k], depth + 1, seen); } catch { out[k] = '[unreadable]'; }
    }
    return out;
  };

  const record = (name, msg) => {
    if (buf.length > 5000) return; // panel drains every 500ms; this is a runaway guard
    try { buf.push({ ts: Date.now(), layer: name, page: location.href, msg: safe(msg) }); } catch { /* never break the page */ }
  };

  const wrap = (arr, name) => {
    if (!arr || typeof arr.push !== 'function' || arr.push.__pulsecheck) return;
    if (!arr.__pulsecheckSnapshot) {
      Object.defineProperty(arr, '__pulsecheckSnapshot', { value: true, enumerable: false });
      for (const m of arr) record(name, m); // pushes that happened before injection
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
  const scan = () => {
    for (const key of Object.keys(window)) {
      try {
        if (!/datalayer/i.test(key) && key !== 'digitalData') continue;
        if (Array.isArray(window[key])) wrap(window[key], key);
      } catch { /* cross-origin or throwing getter */ }
    }
  };

  window.__pulsecheck = {
    scan,
    drain: () => ({ page: location.href, items: buf.splice(0, buf.length) }),
  };
  scan();
  setInterval(scan, 1000);
  return 'armed';
})();
