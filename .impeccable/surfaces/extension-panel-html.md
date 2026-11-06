---
version: 1
slug: "extension-panel-html"
primary_target: "extension/panel.html"
related_targets: ["extension/panel.js","extension/popup.html"]
---

# Surface brief: Pulsecheck DevTools panel

Scope: `extension/panel.html` and `extension/panel.js`, the recording panel inside Chrome DevTools; the toolbar popup follows the same tokens. Mode: Operate.

Audience and task: client implementers record one tracking scenario, scan what fired, see what is wrong, and export Markdown or JSONL. Findings must be understandable without Good Labs.

Constraints: plain ES modules, no build step, no manifest permissions, no network calls, works in light and dark DevTools, hundreds of rows stay scannable.

Unresolved: none.

## Direction contract

THESIS: A white, Google-native recording panel whose session pulse strip and live checks turn a raw event log into an answer; it refuses the plain zebra log table with every finding hidden until export.

OWN-WORLD: White ground, cool grey surfaces and hairlines, Google blue for actions, selection and focus, semantic green, amber and red reserved for findings and state, a separate categorical palette for vendors in the strip. System UI sans, tabular monospace for times and payloads, 8px rounded controls and tonal filter chips.

STORY: The implementer sees events land on the strip as they walk the flow, notices a count change in live checks, clicks it, and lands on the rows behind it with the reason spelled out, then saves the Markdown.

FIRST VIEWPORT: Toolbar with record state, scenario and filter, export actions at the right; below it the pulse strip spanning the width with page boundaries and findings marked, live checks to its right; vendor chips; then the event table grouped by page with a Check column. Primary action Save .md, filled blue, top right.

FORM: User-pinned direction (modern, sleek, white first, Google blue and semantic colours) over the category standard; signature move: the session pulse strip, with count changes rolling in live checks. seed:260ede55ed673ef8

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
