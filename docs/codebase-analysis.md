# Codebase notes

Reviewed 4 September 2026. `npm test` passes all 62 checks.

## Structure

Pulsecheck is a small Manifest V3 DevTools extension with no dependencies or
build step.

- `panel.js` owns capture and the in-memory session.
- `tap.js` runs in the inspected page and records data-layer pushes.
- `parsers.js` decodes network requests and data-layer messages.
- `redact.js` masks detected PII.
- `export.js` sorts the session, replays consent, runs redaction and writes
  Markdown or JSONL.
- `test/run.mjs` covers the pure modules and runs the data-layer tap in a VM.

There is no background worker or persistent storage. Closing DevTools ends the
session.

## Good decisions

- The manifest has no `permissions` array.
- Capture reads request URLs and request bodies from the DevTools HAR entry. It
  does not read response bodies.
- Parser failures produce an `unparsed` row instead of losing the request.
- GA4 matching includes custom-domain sGTM and batched requests.
- The generic parser keeps event-shaped first-party traffic that would otherwise
  be missed.
- Export sorts by send time before applying consent state and sequence numbers.
- Duplicate checks include vendor stream IDs and do not count ordinary site
  requests.
- The tests include sanitized captures for cases that previously parsed badly.

## Privacy fixes in v0.1.0

### Structured request bodies

Key-based masking now applies inside JSON and form-encoded strings as well as
already-parsed parameters. A body such as:

```js
redactEvent({ params: { body: '{"iin":"920422300185"}' } })
```

is decoded and the identifier is masked before export.

### Parser fallbacks

Masking inside `raw` now emits located redaction hits. The event's `redacted`
flag and the export's PII check therefore agree with the masked output.

## Other issues

| Issue | Effect | Suggested change |
|---|---|---|
| No Chrome integration test | DevTools registration, navigation, downloads and clipboard are only tested manually. | Add a release checklist now and an unpacked-extension browser test later. |
| Silent data-layer overflow | `tap.js` stops buffering after roughly 5,000 queued items without recording that anything was dropped. | Count dropped items and include a warning in the panel and export. |
| Version is duplicated | `manifest.json` and `export.js` both contain `0.1.1`; the suite fails when either differs from `package.json`. | Read `chrome.runtime.getManifest().version` in a later refactor. |
| Stale plan | `docs/PLAN.md` still mentions esbuild and `getContent()`, although the final architecture uses neither. | Mark the document historical or update completed items. |
| Whole-window scan every second | `tap.js` calls `Object.keys(window)` to find late data layers. | Keep it unless profiling on real audit targets shows a problem. |

## Release check

Before a Chrome Web Store submission:

1. Record three real flows on sites with different tracking stacks.
2. Compare the dump with the Network panel and the page's data layer.
3. Inspect both exports for unmasked values.
4. Test install, panel registration, navigation, pause/resume, clear, filters,
   copy and downloads in the target Chrome version.
5. Make the store privacy disclosure match the final manifest and runtime
   behavior.
