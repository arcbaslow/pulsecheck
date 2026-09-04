# Changelog

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
