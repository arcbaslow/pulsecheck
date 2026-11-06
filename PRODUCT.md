# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: implementers and analysts on client teams (web developers, analytics and marketing engineers) who run Pulsecheck themselves to check what a site's tracking actually sends during one user flow, often without Good Labs in the room. Secondary: Good Labs on its own tracking audits, and viewers of goodlabs.kz demos.

## Product Purpose

A Chrome DevTools extension that records one tracking scenario: network hits, `dataLayer` pushes and consent changes in one ordered timeline, exported as Markdown (the primary artifact, readable by a person or an LLM) and JSONL (schema v1, the machine contract). Success: a typical express tracking audit drops from hours to minutes, and the export is good enough to hand over without editing.

## Positioning

One recorded scenario, ordered by send time, with consent replayed over it and redaction applied before anything is exported, built for handing to an LLM or the companion analysis skill. No backend, no account, no extension permissions.

## Operating Context

- Runs as a DevTools panel next to Elements and Network, on a normal website; not on `chrome://` pages, the New Tab page or the Web Store.
- Recording starts when the panel opens and ends when DevTools closes; the session lives in memory only.
- Workflow: name the scenario, walk through the flow, filter and inspect events, save or copy the Markdown, optionally save JSONL.
- The export feeds `skill/SKILL.md`, which can compare a session against a figma-taxonomy-gen plan or a Markdown plan.
- Published on the Chrome Web Store; store screenshots are captured from the scripted demo session in `tools/demo/`.

## Capabilities and Constraints

- Vendors: GA4 (including batched hits, regional endpoints and custom-domain sGTM), Meta Pixel, Yandex Metrica, Amplitude, TikTok, Google Ads conversion, Floodlight, generic fallback, `unparsed` kept rather than dropped.
- Optional API context records method, host, path, status and MIME type for non-static site requests; bodies and query strings excluded; enabled per session after a confirm.
- Export checks: duplicate suspects, consent observations (sent while the storage they answer to was denied), masked sensitive fields, unparsed and generic counts.
- Constraints: MV3, plain ES modules, no build step, no framework or bundler, the manifest has no `permissions` array and keeps none, no network calls from the extension, no `chrome.debugger`, no persistent session state. Tests are `node test/run.mjs`.

## Brand Commitments

- Name: Pulsecheck. Built by Good Labs (goodlabs.kz). MIT license.
- Icon: Good Labs teal (`#1D9E75`). Panel UI: white first, Google blue for actions and selection, semantic colours for findings (decided 2026-11-05).
- README hero: risograph-style robot illustration shared with the other Good Labs open-source tools.
- Voice: plain, factual, no marketing copy, no emoji.

## Evidence on Hand

- Anonymized sample session: `examples/sample-session.md`.
- Store screenshots: `store/`; listing text: `store-listing/`.
- No user counts, testimonials or audit timings are recorded yet; do not invent them.

## Product Principles

1. The timeline is evidence: order, timestamps and payloads stay exact and inspectable.
2. Privacy is structural: nothing leaves the machine, redaction runs before export, permissions stay at zero.
3. A client implementer without Good Labs should understand every state and finding on their own.
4. Findings point at rows: every check leads back to the events behind it.
5. Density over decoration: a session with hundreds of events stays scannable.
