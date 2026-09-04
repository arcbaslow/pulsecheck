# Architecture - pulsecheck

MV3 extension, DevTools-panel-first. No background logic beyond what MV3
requires, no state outside the panel except the session buffer.

## Components

```
extension/                             # loads unpacked as-is, no build step
├── manifest.json                      # zero permissions (see below)
├── devtools.html / devtools.js        # registers the panel
├── panel.html / panel.js              # UI + session state (owns everything)
├── parsers.js                         # vendor table + dataLayer message parser
├── redact.js                          # PII masking, runs before export
├── export.js                          # session.md + session.jsonl
└── tap.js                             # MAIN world: wraps dataLayer.push
test/run.mjs                           # node test/run.mjs - no deps, no framework
skill/SKILL.md                         # Claude Code analysis skill
```

Plain ES modules, loaded natively by the panel page. No TypeScript and no
bundler in v0.1: a build step buys types at the cost of the "clone and load
unpacked" install, and the panel is ~700 lines. Revisit if the parser table
outgrows what JSDoc can describe.

## Data flow

1. **Network**: `chrome.devtools.network.onRequestFinished` fires per
   request; the event payload is in `request.postData` / the query string,
   both already on the HAR entry - `getContent()` is never called because we
   never read response bodies. Parsers run in the panel, synchronously per
   request; one request may yield N events (GA4/Amplitude batches).
2. **dataLayer**: the panel injects `tap.js` with
   `chrome.devtools.inspectedWindow.eval`, which runs in the inspected page's
   MAIN world and needs no permissions at all. The tap snapshots existing
   entries, then wraps `push` (non-enumerably - page code must not see it).
   The panel drains the tap's buffer every 500 ms; timestamps are taken at
   push time, not at drain time. Re-armed on navigation and once a second,
   because gtm.js replaces `dataLayer.push` with its own after it loads.
3. **Consent**: derived in the panel from GCM `default`/`update` messages
   seen in the dataLayer stream; current consent state is stamped onto every
   subsequent event.
4. **Export**: redaction pass -> `session.md` (the artifact you hand to an
   LLM: inventory, mechanical checks, full timeline) + `session.jsonl`
   (contract: docs/dump-format.md), saved via a blob download or copied to
   the clipboard. Nothing is persisted anywhere else.

## Why these choices

- **DevTools panel, not chrome.debugger**: debugger API shows a scary
  banner on every tab and breaks user trust; devtools.network gives bodies
  without extra permissions beyond the devtools page itself.
- **inspectedWindow.eval, not registerContentScripts**: a MAIN-world content
  script needs `scripting` plus host permissions, which is the "read and
  change all your data on all websites" install warning - on a tool whose
  whole pitch is that it does not exfiltrate anything. DevTools eval reaches
  the same world with an empty permissions array. Cost: the tap only exists
  while the panel is open, which matches the recorder model anyway.
- **Not webRequest**: MV3 webRequest has no response bodies and request
  bodies are awkward; we need request payloads (that is where events live).
- **Parsers in the panel, declarative**: matchers are data (host/path/query
  signatures), so adding a vendor is a table row + param map, not a code
  path. Custom sGTM domains make host-only matching insufficient - GA4 is
  detected by query signature (`v=2` + `tid=G-...`) on any host.
- **Session state lives in the panel**: closing DevTools ends the session.
  That is a feature - the tool is a recorder you consciously run, not
  surveillance that is always on.

## Permissions budget

`manifest.json` declares `devtools_page` and **no `permissions` array at
all** - not `scripting`, not `activeTab`, not `downloads`, not `storage`.
Chrome shows no install warning. Downloads go through a blob URL and an
`<a download>`; injection goes through DevTools eval. Every permission
addition needs a written reason in the PR, and "it was easier" is not one.

## Failure policy

Capture must never break the page. Parser exceptions are caught per event,
logged to the panel's own error strip, and the raw request is kept as
`vendor: "unparsed"` - losing decode is acceptable, losing the record is not.
