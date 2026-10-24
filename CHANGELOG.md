# Changelog

Pulsecheck is now available on the
[Chrome Web Store](https://chromewebstore.google.com/detail/pulsecheck-tracking-audit/fcdnmpffnfcbfhkokkfnilicjbpjdmnp).

## Unreleased

- Redact page URLs, URL-valued parameters, URL paths and fragments, event names and API secrets in exports; limit IP masking to whole addresses or IP-like keys, excluding version fields; clarify redaction limits and deliberate exceptions.
- Stop page-side recording and clear its buffer on pause, panel close or expiry of a 60-second fallback recording lease.

## 0.1.1 — 2026-09-05

Chrome Web Store preparation.

- Keep optional API context to method, host, path, status and MIME type; request
  bodies and query strings are excluded.
- Remove named credential and payment-secret fields before export.
- Add keyboard access to expandable event rows.
- Add a privacy policy, store listing material and upload-ready assets.
- Align the manifest description and store metadata.

## 0.1.0 — 2026-09-04

First public alpha.

- Record network hits, data-layer pushes, consent changes and page navigation in
  one DevTools timeline.
- Parse GA4, Meta Pixel, Yandex Metrica, Amplitude and TikTok traffic, with a
  generic fallback for event-shaped first-party collectors.
- Export a self-contained audit session as Markdown or JSONL.
- Check duplicate candidates, consent conflicts and detected PII.
- Redact detected identifiers in parameters, URLs, JSON bodies, form bodies and
  parser fallbacks before export.
