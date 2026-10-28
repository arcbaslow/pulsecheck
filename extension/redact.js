// PII redaction. Runs once, before export - never after, and never on the
// live panel view (the auditor sees their own session; the file does not).
// The mask preserves enough shape to prove the leak without carrying it.

const EMAIL = /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/g;
const HAS_EMAIL = new RegExp(EMAIL.source); // /g regexes are stateful in .test()

// Keys whose value is PII regardless of shape.
const PII_KEY = /^(user[._]?id|uid|device[._]?id|em|ph|fn|ln|e[-_]?mail|email|phone|tel|telephone|msisdn|customer[._]?id)$/i;

// Credentials and payment secrets must never survive an export. Unlike PII,
// preserving their shape has no audit value, so replace the entire value.
const SENSITIVE_KEY = /^(password|passwd|passcode|pin|secret|api[._-]?secret|client[._-]?secret|token|access[._-]?token|refresh[._-]?token|auth[._-]?token|authorization|bearer|cookie|set[._-]?cookie|jwt|card[._-]?number|pan|cvv|cvc|iban|account[._-]?(?:number|no))$/i;

// National id numbers, matched on token boundaries so `iin_bin` and `bin_iin`
// are caught but `binary` and `join` are not. A KZ ИИН identifies a person
// outright; for an ИП the BIN is the same number.
const NATIONAL_ID_KEY = /(^|[._])(iin|bin|inn|snils|passport|iin[._]?bin|tax[._]?id)([._]|$)/i;

// Person-name keys only. `event_name`, `item_name`, `product_name` and
// `page_name` are the audit's subject matter and must survive - which is why
// this is a list and not a `*_name` wildcard. `organization_name` is here
// because a KZ sole trader's org name is their surname.
const NAME_KEY = /^(first[._]?name|last[._]?name|full[._]?name|user[._]?name|display[._]?name|organization[._]?name|company[._]?name|client[._]?name|customer[._]?name|contact[._]?name|holder[._]?name|name|surname|patronymic|fio|имя|фамилия|отчество)$/i;

// Identifiers the audit needs intact: stream/dedup checks are built on them
// and masking them would break the analysis without protecting anyone.
const KEEP = /^(cid|sid|tid|_p|_s|seq|ts|gcs|gtm|insert_id|event_id|eid|message_id|pixel_code|api_key|en|ev|value|price|counter|_host|_path)$/i;

const maskEmail = (s) => s.replace(EMAIL, (m) => `${m[0]}***@***.${m.split('.').pop()}`);

const maskPhone = (s) => {
  const d = s.replace(/\D/g, '');
  const head = s.trim().startsWith('+') ? '+' + d[0] : d[0];
  return `${head}${'*'.repeat(Math.max(1, d.length - 3))}${d.slice(-2)}`;
};

/** Phone-shaped, not id-shaped. Deliberately conservative - see KEEP. */
export function looksLikePhone(v) {
  const s = String(v).trim();
  if (!/^\+?[\d\s().-]{9,20}$/.test(s)) return false;
  const d = s.replace(/\D/g, '');
  if (d.length < 10 || d.length > 15) return false;
  if (s.startsWith('+')) return true;
  if (/\d[\s().-]\d/.test(s)) return true;
  return d.length === 11 && /^[78]/.test(d); // bare KZ/RU mobile
}

const maskName = (s) => (s.length > 1 ? s[0] + '*'.repeat(s.length - 1) : '*');

// Captured request bodies are JSON blobs, so PII hides inside a longer string
// rather than being the whole value. Scanning inside one needs a stricter
// phone rule than looksLikePhone: a loose one eats timestamps and ids that
// merely sit next to separators. Require a literal `+`, or a bare 11-digit
// KZ/RU mobile with no digit either side.
const INLINE_PHONE = /(?<!\d)(?:\+\d[\d\s().-]{7,17}\d|[78]\d{10})(?!\d)/g;
const KEEP_PHONE = /(?<!\d)\+\d[\d\s().-]{7,17}\d(?!\d)/g;
const IPV4 = /(?<![\w.])\d{1,3}(?:\.\d{1,3}){3}(?![\w]|\.\d)/g;
const IPV6 = /(?<![\w:])[a-f\d]*:[a-f\d:.]+(?![\w:])/gi;
const IP_KEY = /^(ip|ip_address|client_ip|remote_addr|x-forwarded-for|uip|_uip)$/i;
const VERSION_KEY = /^(uafvl|uapv)$|version/i;

function redactIps(s, path, hits, key = '') {
  if (VERSION_KEY.test(key)) return s;
  if (!IP_KEY.test(key)) {
    const value = s.trim().replace(/^\[|\]$/g, '');
    const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) && value.split('.').every((part) => Number(part) <= 255);
    let ipv6 = false;
    if (/^[a-f\d:.]+$/i.test(value) && value.includes(':')) {
      try { new URL(`http://[${value}]/`); ipv6 = true; } catch { /* not IPv6 */ }
    }
    if (!ipv4 && !ipv6) return s;
  }
  const out = s.replace(IPV6, (m) => {
    const address = m.replace(/\.+$/, '');
    try { new URL(`http://[${address}]/`); } catch { return m; }
    hits.push({ path, kind: 'ip' });
    return '[redacted]' + m.slice(address.length);
  });
  return out.replace(IPV4, (m) => {
    if (m.split('.').some((part) => Number(part) > 255)) return m;
    hits.push({ path, kind: 'ip' });
    return '[redacted]';
  });
}

function redactInline(s, path, hits, key = '', keep = false) {
  let out = s.replace(EMAIL, (m) => {
    hits.push({ path, kind: 'email' });
    return `${m[0]}***@***.${m.split('.').pop()}`;
  });
  out = (keep ? out : redactIps(out, path, hits, key)).replace(keep ? KEEP_PHONE : INLINE_PHONE, (m) => {
    if (!looksLikePhone(m)) return m;
    hits.push({ path, kind: 'phone' });
    return maskPhone(m);
  });
  return out;
}

// Request bodies and parser fallbacks often arrive as strings. Decode the two
// structured formats browsers commonly send so key-based rules (including IIN)
// still apply. Preserve the original byte-for-byte when nothing is redacted.
function redactEmbedded(s, path, hits, key = '', urlValues = false, urlDepth = 0) {
  const trimmed = s.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const before = hits.length;
      const value = walk(JSON.parse(s), path, hits, urlDepth);
      if (hits.length > before) return JSON.stringify(value);
      return s;
    } catch {
      // A partial body is still eligible for conservative inline masking.
    }
  }

  if (trimmed.includes('=')) {
    try {
      const form = new URLSearchParams(s);
      const before = hits.length;
      const maskedForm = new URLSearchParams();
      const keys = new Map();
      for (const [key, value] of [...form]) {
        const maskedKey = redactKey(key, path, hits, keys);
        const fieldPath = path ? `${path}.${maskedKey}` : maskedKey;
        const masked = urlValues && KEEP.test(key)
          ? redactEmbedded(value, fieldPath, hits, key, true, urlDepth)
          : redactValue(key, value, fieldPath, hits, urlDepth);
        maskedForm.append(maskedKey, masked);
      }
      if (hits.length > before) return maskedForm.toString();
    } catch {
      // Fall through to inline masking.
    }
  }

  return redactInline(s, path, hits, key, KEEP.test(key));
}

function redactValue(key, value, path, hits, urlDepth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object') return walk(value, path, hits, urlDepth);
  const s = String(value);
  if (KEEP.test(key)) return typeof value === 'string' ? redactInline(value, path, hits, key, true) : value;
  if (SENSITIVE_KEY.test(key)) {
    if (!s) return value;
    hits.push({ path, kind: 'secret' });
    return '[redacted]';
  }
  if (PII_KEY.test(key) || NAME_KEY.test(key) || NATIONAL_ID_KEY.test(key)) {
    if (!s) return value;
    hits.push({ path, kind: NATIONAL_ID_KEY.test(key) ? 'national_id' : NAME_KEY.test(key) ? 'name' : 'identifier' });
    return HAS_EMAIL.test(s) ? maskEmail(s) : looksLikePhone(s) ? maskPhone(s) : maskName(s);
  }
  if (typeof value !== 'string') return value;
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return redactUrl(s, hits, path, urlDepth);
  } catch { /* not an absolute HTTP(S) URL */ }
  if (looksLikePhone(s)) {
    const ip = redactIps(s, path, hits, key);
    if (ip !== s) return ip;
    hits.push({ path, kind: 'phone' });
    return maskPhone(s);
  }
  const inline = redactEmbedded(s, path, hits, key, false, urlDepth);
  if (inline !== s) return inline;
  return value;
}

function redactKey(key, path, hits, keys) {
  const before = hits.length;
  const masked = redactInline(key, path, hits);
  let unique = masked;
  for (let n = 2; keys.has(unique) && keys.get(unique) !== key; n++) unique = `${masked}#${n}`;
  keys.set(unique, key);
  for (let i = before; i < hits.length; i++) hits[i].path = path ? `${path}.${unique}` : unique;
  return unique;
}

function walk(obj, path, hits, urlDepth = 0) {
  if (Array.isArray(obj)) return obj.map((v, i) => redactValue('', v, `${path}[${i}]`, hits, urlDepth));
  const out = {};
  const keys = new Map();
  for (const [k, v] of Object.entries(obj)) {
    const key = redactKey(k, path, hits, keys);
    out[key] = redactValue(k, v, path ? `${path}.${key}` : key, hits, urlDepth);
  }
  return out;
}

function redactSegments(s, field, hits, urlDepth = 0) {
  const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  const encoded = s.split('/');
  const parts = encoded.map(decode);
  return parts.map((part, i) => {
    const key = parts[i - 1] || '';
    const masked = redactValue(KEEP.test(key) ? '' : key, part, `${field}.${i}`, hits, urlDepth);
    return masked === part ? encoded[i] : encodeURIComponent(masked);
  }).join('/');
}

export function redactUrl(url, hits, path = 'url', urlDepth = 0) {
  if (!url) return url;
  const before = hits.length;
  const structured = urlDepth < 3 ? redactStructuredUrl(url, hits, path, urlDepth + 1) : url;
  // The authority is already handled. Scan individual tail components so URL
  // delimiters cannot become part of an email's local part.
  const masked = structured.replace(/^([a-z][a-z\d+.-]*:\/\/[^/?#]*)([\s\S]*)$/i, (_url, prefix, tail) =>
    prefix + tail.split(/([/?#&=])/).map((part, i, parts) =>
      redactEncodedInline(part, path, hits, parts[i - 1] === '=' ? parts[i - 2] : '')).join(''));
  for (let i = before; i < hits.length; i++) hits[i].inUrl = true;
  return masked;
}

function redactEncodedInline(s, path, hits, key = '') {
  // Keep offsets into the original so decoding nested markers never changes
  // the encoding of text outside a masked match.
  const offsets = [];
  const decoded = s.replace(/%(?:25){0,2}(?:2b|40|5b|5d|3a|2f|3f|23|26|3d)|[\s\S]/gi, (m, offset) => {
    offsets.push(offset);
    return m.length === 1 ? m : String.fromCharCode(parseInt(m.slice(-2), 16));
  });
  offsets.push(s.length);
  const prefix = decoded.match(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i)?.[0].length || 0;
  let out = '', end = 0;
  const tail = decoded.slice(prefix);
  for (const component of tail.matchAll(/[^/?#&=]+/g)) {
    // A value decoded out of a nested URL answers to its own `key=`, not to
    // the outer parameter's - otherwise `next=https%3A...%3Fcid%3D7701...`
    // masks a cid that would survive at the top level.
    const own = component.index && tail[component.index - 1] === '=' ? tail.slice(0, component.index - 1).match(/[^/?#&=]*$/)[0] : key;
    for (const match of component[0].matchAll(new RegExp(`${EMAIL.source}|${INLINE_PHONE.source}`, 'g'))) {
      const masked = redactInline(match[0], path, hits, own, KEEP.test(own));
      if (masked === match[0]) continue;
      const start = prefix + component.index + match.index;
      out += s.slice(offsets[end], offsets[start]) + encodeURIComponent(masked);
      end = start + match[0].length;
    }
  }
  return out + s.slice(offsets[end]);
}

function redactStructuredUrl(url, hits, path, urlDepth) {
  let u;
  try { u = new URL(url); } catch { return redactEmbedded(String(url), path, hits, '', false, urlDepth); }
  const before = hits.length;
  const hostname = u.hostname.replace(/^\[|\]$/g, '');
  if (redactValue('', hostname, `${path}.host`, hits) !== hostname) u.hostname = 'redacted.invalid';
  if (u.username || u.password) {
    hits.push({ path: `${path}.authority`, kind: 'secret' });
    u.username = '';
    u.password = '';
  }
  u.pathname = redactSegments(u.pathname, `${path}.path`, hits, urlDepth);
  const search = new URLSearchParams();
  let searchChanged = false;
  for (const [k, v] of u.searchParams) {
    const key = redactInline(k, `${path}.query`, hits);
    const masked = KEEP.test(k) ? redactEmbedded(v, `${path}.${key}`, hits, k, false, urlDepth) : redactValue(k, v, `${path}.${key}`, hits, urlDepth);
    search.append(key, masked);
    if (key !== k || masked !== v) searchChanged = true;
  }
  if (searchChanged) u.search = search.toString();
  const hash = u.hash.slice(1);
  const query = hash.indexOf('?');
  if (query >= 0) {
    u.hash = redactSegments(hash.slice(0, query), `${path}.fragment`, hits, urlDepth) + '?' +
      redactEmbedded(hash.slice(query + 1), `${path}.fragment`, hits, '', true, urlDepth);
  } else if (hash.includes('=')) {
    u.hash = redactEmbedded(hash, `${path}.fragment`, hits, '', true, urlDepth);
  } else {
    u.hash = redactSegments(hash, `${path}.fragment`, hits, urlDepth);
  }
  return hits.length > before ? u.toString() : url;
}

/**
 * @returns {{event: object, hits: Array<{path:string,kind:string,inUrl?:boolean}>}}
 * `hits` is the audit finding - PII in a URL is high severity always.
 */
export function redactEvent(event) {
  const hits = [];
  const out = { ...event };
  if (typeof out.event === 'string') {
    out.event = out.event.replace(/^([A-Z]+ )(\/.*)$/, (_name, method, path) => {
      const before = hits.length;
      const masked = redactSegments(path, 'event.path', hits);
      for (let i = before; i < hits.length; i++) hits[i].inUrl = true;
      return method + masked;
    });
    out.event = redactInline(out.event, 'event', hits);
  }
  if (out.params) out.params = walk(out.params, '', hits);
  if (out.consent) out.consent = walk(out.consent, 'consent', hits);
  if (out.url) out.url = redactUrl(out.url, hits);
  if (out.page) out.page = redactUrl(out.page, hits, 'page');
  if (out.raw) out.raw = redactEmbedded(String(out.raw), 'raw', hits);
  out.redacted = hits.length > 0;
  return { event: out, hits };
}
