// PII redaction. Runs once, before export - never after, and never on the
// live panel view (the auditor sees their own session; the file does not).
// The mask preserves enough shape to prove the leak without carrying it.

const EMAIL = /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/g;
const HAS_EMAIL = new RegExp(EMAIL.source); // /g regexes are stateful in .test()

// Keys whose value is PII regardless of shape.
const PII_KEY = /^(user[._]?id|uid|device[._]?id|em|ph|fn|ln|e[-_]?mail|email|phone|tel|telephone|msisdn|customer[._]?id)$/i;

// Credentials and payment secrets must never survive an export. Unlike PII,
// preserving their shape has no audit value, so replace the entire value.
const SENSITIVE_KEY = /^(password|passwd|passcode|pin|secret|client[._-]?secret|token|access[._-]?token|refresh[._-]?token|auth[._-]?token|authorization|bearer|cookie|set[._-]?cookie|jwt|card[._-]?number|pan|cvv|cvc|iban|account[._-]?(?:number|no))$/i;

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

function redactInline(s, path, hits) {
  let out = s.replace(EMAIL, (m) => {
    hits.push({ path, kind: 'email' });
    return `${m[0]}***@***.${m.split('.').pop()}`;
  });
  out = out.replace(INLINE_PHONE, (m) => {
    if (!looksLikePhone(m)) return m;
    hits.push({ path, kind: 'phone' });
    return maskPhone(m);
  });
  return out;
}

// Request bodies and parser fallbacks often arrive as strings. Decode the two
// structured formats browsers commonly send so key-based rules (including IIN)
// still apply. Preserve the original byte-for-byte when nothing is redacted.
function redactEmbedded(s, path, hits) {
  const trimmed = s.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const before = hits.length;
      const value = walk(JSON.parse(s), path, hits);
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
      for (const [key, value] of [...form]) {
        const fieldPath = path ? `${path}.${key}` : key;
        const masked = redactValue(key, value, fieldPath, hits);
        if (masked !== value) form.set(key, masked);
      }
      if (hits.length > before) return form.toString();
    } catch {
      // Fall through to inline masking.
    }
  }

  return redactInline(s, path, hits);
}

function redactValue(key, value, path, hits) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object') return walk(value, path, hits);
  const s = String(value);
  if (KEEP.test(key)) return value;
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
  if (looksLikePhone(s)) { hits.push({ path, kind: 'phone' }); return maskPhone(s); }
  const inline = redactEmbedded(s, path, hits);
  if (inline !== s) return inline;
  return value;
}

function walk(obj, path, hits) {
  if (Array.isArray(obj)) return obj.map((v, i) => redactValue('', v, `${path}[${i}]`, hits));
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = redactValue(k, v, path ? `${path}.${k}` : k, hits);
  return out;
}

function redactUrl(url, hits) {
  let u;
  try { u = new URL(url); } catch { return url; }
  let touched = false;
  for (const [k, v] of [...u.searchParams]) {
    const masked = redactValue(k, v, `url.${k}`, hits);
    if (masked !== v) { u.searchParams.set(k, masked); touched = true; }
  }
  return touched ? u.toString() : url;
}

/**
 * @returns {{event: object, hits: Array<{path:string,kind:string}>}}
 * `hits` is the audit finding - PII in a URL query is high severity always.
 */
export function redactEvent(event) {
  const hits = [];
  const out = { ...event };
  if (out.params) out.params = walk(out.params, '', hits);
  if (out.url) out.url = redactUrl(out.url, hits);
  if (out.raw) out.raw = redactEmbedded(String(out.raw), 'raw', hits);
  out.redacted = hits.length > 0;
  return { event: out, hits };
}
