---
name: Pulsecheck
description: DevTools panel that records one tracking scenario as an ordered, checked timeline.
colors:
  bg: "#ffffff"
  surface: "#f8f9fa"
  surface-2: "#f1f3f4"
  line: "#e3e5e8"
  line-strong: "#c7cacf"
  text: "#1f1f1f"
  text-2: "#5f6368"
  text-3: "#6f7378"
  blue: "#1a73e8"
  blue-strong: "#0b57d0"
  blue-tint: "#e8f0fe"
  blue-hover: "#d3e3fd"
  ok: "#137333"
  ok-tint: "#e6f4ea"
  warn: "#9a5300"
  warn-mark: "#f9ab00"
  warn-tint: "#fef7e0"
  bad: "#c5221f"
  bad-mark: "#d93025"
  bad-tint: "#fce8e6"
  rec: "#d93025"
  json: "#fbfbfc"
  v-consent: "#9334e6"
  v-datalayer: "#80868b"
  v-ga4: "#1a73e8"
  v-gads: "#12b5cb"
  v-floodlight: "#7cacf8"
  v-meta: "#e52592"
  v-metrica: "#e8710a"
  v-amplitude: "#00897b"
  v-tiktok: "#3c4043"
  v-generic: "#9aa0a6"
  v-unparsed: "#d93025"
  v-request: "#c4c7c5"
typography:
  title:
    fontFamily: "system-ui, \"Segoe UI Variable Text\", \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "system-ui, \"Segoe UI Variable Text\", \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "system-ui, \"Segoe UI Variable Text\", \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.45
  label-sm:
    fontFamily: "system-ui, \"Segoe UI Variable Text\", \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.45
  table-head:
    fontFamily: "system-ui, \"Segoe UI Variable Text\", \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.04em"
  caption:
    fontFamily: "system-ui, \"Segoe UI Variable Text\", \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "15px"
  mono:
    fontFamily: "ui-monospace, \"Cascadia Mono\", \"SF Mono\", Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "\"tnum\""
  mono-block:
    fontFamily: "ui-monospace, \"Cascadia Mono\", \"SF Mono\", Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.55
  count:
    fontFamily: "ui-monospace, \"Cascadia Mono\", \"SF Mono\", Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "20px"
    fontFeature: "\"tnum\""
rounded:
  swatch: "2px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "50%"
spacing:
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "14px"
components:
  button:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "30px"
  button-hover:
    backgroundColor: "{colors.surface-2}"
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.bg}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "30px"
  button-primary-hover:
    backgroundColor: "{colors.blue-strong}"
  button-ghost:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.blue-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "30px"
  button-ghost-hover:
    backgroundColor: "{colors.blue-tint}"
  button-toggle-on:
    backgroundColor: "{colors.blue-tint}"
    textColor: "{colors.blue-strong}"
  field:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "30px"
  field-focus:
    backgroundColor: "{colors.bg}"
  chip:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text-2}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.md}"
    padding: "0 10px 0 8px"
    height: "26px"
  chip-on:
    backgroundColor: "{colors.blue-tint}"
    textColor: "{colors.text}"
  check:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "26px"
  check-on:
    backgroundColor: "{colors.blue-tint}"
    textColor: "{colors.blue-strong}"
  check-count:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-2}"
    typography: "{typography.count}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
    height: "20px"
  check-count-ok:
    backgroundColor: "{colors.ok-tint}"
    textColor: "{colors.ok}"
  check-count-warn:
    backgroundColor: "{colors.warn-tint}"
    textColor: "{colors.warn}"
  check-count-bad:
    backgroundColor: "{colors.bad-tint}"
    textColor: "{colors.bad}"
  table-head:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-2}"
    typography: "{typography.table-head}"
    padding: "6px 14px"
  row:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    padding: "3px 14px"
    height: "24px"
  row-hover:
    backgroundColor: "{colors.surface}"
  row-open:
    backgroundColor: "{colors.blue-tint}"
  payload-block:
    backgroundColor: "{colors.json}"
    textColor: "{colors.text}"
    typography: "{typography.mono-block}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  popover:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "14px 16px 12px"
    width: "320px"
---

# Design System: Pulsecheck

## Overview

**Creative North Star: "The Instrument Strip"**

Pulsecheck is a DevTools panel that sits next to Elements and Network, so it borrows their material: white ground, cool grey surfaces separated by 1px hairlines, system sans at 13px, monospace for anything that is evidence. Google blue carries every action, selection and focus state. Green, amber and red appear only where a check has a result. Vendors get their own categorical palette, used on the pulse strip, the vendor chips and the swatch in each row.

The signature is the session pulse strip: a canvas timeline across the top where every event is a 3px bar, coloured by vendor and sized by source, with dashed page boundaries and finding marks under the baseline. Live checks sit to its right, and each count rolls when it changes. Clicking a count filters the table to the rows behind it. The table below is dense (24px rows), grouped by page under sticky headers, with a Check column that states each finding in plain words.

Density is the default. Decoration is limited to tonal fills, hairlines and the vendor swatches; there are no gradients, no illustrations inside the panel and no shadows on resting surfaces. Light and dark follow the DevTools theme.

**Key Characteristics:**
- White first, cool grey tonal layers, 1px hairlines between every band.
- One action colour (Google blue) for actions, selection and focus.
- Semantic green, amber and red reserved for check results and finding rows.
- A categorical vendor palette, separate from the semantic one.
- Monospace with tabular figures for times, counts and payloads.
- 8px corners on every control; tonal fills instead of borders for on states.

## Colors

A neutral Google-grey system with one blue voice, three semantic hues for findings and a categorical set for vendors.

### Primary
- **Google Blue** (`blue`): filled primary button (Save .md), focus outline, field focus border, selection highlight on the strip. The only filled colour in the toolbar.
- **Deep Blue** (`blue-strong`): primary hover, ghost button text, link text, text on an on-state tint.
- **Blue Tint** (`blue-tint`): on state of toggles, chips and checks, the open row, the selected column behind strip bars, ghost hover.
- **Blue Hover** (`blue-hover`): text selection.

### Semantic
- **Pass Green** (`ok`, `ok-tint`): a live check count when the check is clean.
- **Amber** (`warn`, `warn-mark`, `warn-tint`): warning text in the Check column, warning counts, the banner for capture errors (`#err`), and the amber mark under the strip baseline. `warn-mark` is the strip mark only; `warn` is the text colour.
- **Finding Red** (`bad`, `bad-mark`, `bad-tint`): failing check text and counts, failing row tint, red strip mark, unparsed vendor text.
- **Record Red** (`rec`): the recording dot.

Finding rows are tinted with `color-mix(in srgb, <tint> 55%, bg)` so a hit row reads lighter than the check count badge.

### Vendor (categorical)
- **Consent Violet** (`v-consent`), **dataLayer Grey** (`v-datalayer`), **GA4 Blue** (`v-ga4`), **Google Ads Cyan** (`v-gads`), **Floodlight Sky** (`v-floodlight`), **Meta Magenta** (`v-meta`), **Metrica Orange** (`v-metrica`), **Amplitude Teal** (`v-amplitude`), **TikTok Graphite** (`v-tiktok`), **Generic Grey** (`v-generic`), **Unparsed Red** (`v-unparsed`), **Request Grey** (`v-request`, API context bars).

Vendor colours appear only as the 3px strip bars and the 8px square swatch (2px corners) in chips and rows. A vendor without a token falls back to `v-generic`.

### Neutral
- **White** (`bg`): page ground, buttons at rest, sticky page headers, popovers.
- **Mist** (`surface`): table header band, row hover, popup notes.
- **Fog** (`surface-2`): input fields, default button hover, neutral count badges.
- **Hairline** (`line`): every band divider and row divider.
- **Strong Hairline** (`line-strong`): button and chip borders, strip baseline and ticks, scrollbar thumb.
- **Ink** (`text`), **Slate** (`text-2`, secondary text, vendor names, parameters, page paths), **Pewter** (`text-3`, tick labels, legend, note-severity checks).
- **Payload Paper** (`json`): background of the expanded JSON block.

### Dark mode
Applied as `:root.dark` when `chrome.devtools.panels.themeName` is `dark`; the popup uses `prefers-color-scheme`. Same token names, values: bg `#1f1f1f`, surface `#262729`, surface-2 `#2d2f31`, line `#3a3c3f`, line-strong `#55585c`, text `#e3e3e3`, text-2 `#a8abaf`, text-3 `#8e9196`, blue and blue-strong `#a8c7fa`, blue-tint `#1f3760`, blue-hover `#284a80`, ok `#6dd58c`, ok-tint `#1b3a26`, warn and warn-mark `#fdd663`, warn-tint `#3d3212`, bad `#f2b8b5`, bad-mark `#ee675c`, bad-tint `#4a2020`, rec `#ee675c`, json `#232426`, v-datalayer `#9aa0a6`, v-ga4 `#8ab4f8`, v-tiktok `#e3e3e3`, v-request `#5f6368`. The filled primary button switches to dark text (`#062e6f`) on the light blue fill.

### Named Rules
**The One Blue Rule.** Blue means action, selection or focus. Nothing decorative is blue; a blue thing can be clicked or is the current selection.

**The Findings Own Colour Rule.** Green, amber and red appear only where a check has a result: count badges, the Check column, finding row tints, strip marks and the capture error banner. Never use them for chrome or emphasis.

**The Two Palettes Rule.** Vendor colours identify the sender; semantic colours judge the event. A vendor swatch never carries a verdict and a verdict never takes a vendor colour.

## Typography

**Body Font:** system-ui (with Segoe UI Variable Text, Segoe UI, Roboto, Helvetica Neue)
**Mono Font:** ui-monospace (with Cascadia Mono, SF Mono, Menlo, Consolas)

**Character:** The platform sans of the DevTools host, so the panel reads as part of Chrome. Monospace marks evidence: times, counts, URLs, paths and payloads.

### Hierarchy
- **Title** (600, 14px): popover heading, empty-state heading. The popup heading is 15px.
- **Body** (400, 13px, 1.45): base text, event table, field input, check labels. Explanations in the detail view cap at 46ch; empty-state paragraphs at 56ch.
- **Label** (500, 13px): buttons and event names. Page headers in the table are 600.
- **Label small** (500, 12px): vendor chips, Check column text.
- **Table head** (600, 11px, 0.04em, uppercase): column headers only.
- **Caption** (400, 11px, 15px line): strip legend; strip page labels are 500 11px on the canvas.
- **Mono** (400, 12px, tabular figures): row times, parameters, page paths, record timer, strip tick labels (11px).
- **Mono block** (400, 12px, 1.55): expanded JSON, pre-wrapped.
- **Count** (600, 12px mono, tabular, 20px line): live check numbers.

### Named Rules
**The Evidence Is Mono Rule.** Anything copied from the wire (timestamps, payloads, URLs, IDs, counts) is set in monospace with tabular figures. Prose and labels never are.

**The Chrome-Only Uppercase Rule.** Uppercase appears only in the table header: sans, 11px, 600, 0.04em tracking. No other label, page title or meta line is uppercase.

## Layout

Full-height flex column inside the DevTools frame. Bands from top: toolbar (`#bar`, 7px 10px padding, wraps), overview (pulse strip plus a 280px checks column), vendor chips, capture error banner, table header, scrolling event list. Each band ends with a 1px `line` border.

- **Toolbar order:** record toggle, Clear, API context, scenario field (grows, `flex: 1 1 200px`), filter field (`0 1 240px`), then event count and export actions pushed right. Save .md is the only filled button.
- **Pulse strip:** 108px tall, 14px side padding, canvas drawn at device pixel ratio. Page labels at 14px from top, bars grow upward from a baseline 26px above the bottom, tick labels below, finding marks (4px squares) just under the baseline.
- **Event table:** CSS grid, columns 74px time (right-aligned), 112px vendor, 140 to 240px event, flexible parameters, 150 to 220px check; 14px column gap and side padding. Page headers are sticky and indent to the event column (102px).
- **Spacing rhythm:** 6, 8, 10, 12 and 14px. Controls are 30px tall; chips and checks 26px; rows at least 24px.
- **Narrow (max-width 860px):** checks drop below the strip and lay out in a row, the parameters column is hidden, time and vendor columns shrink to 64px and 96px.
- **Popup:** 300px wide, 16px padding, numbered steps on a 22px grid column.

## Elevation & Depth

Flat by default. Depth comes from tonal layering (`bg`, `surface`, `surface-2`) and hairlines. Shadows exist only on floating layers that cover content.

### Shadow Vocabulary
- **Popover** (`box-shadow: 0 2px 6px rgba(60, 64, 67, .15), 0 8px 24px rgba(60, 64, 67, .18)`): the API context confirm dialog.
- **Tooltip** (`box-shadow: 0 4px 12px rgba(0, 0, 0, .2)`): the strip hover tooltip.

### Named Rules
**The Float-Only Shadow Rule.** A shadow means the layer floats over content and will go away. Bars, rows, chips, buttons and fields never cast one.

## Shapes

Soft, consistent corners. Controls (buttons, fields, chips, checks, JSON block, popup notes) use 8px. Count badges and the tooltip use 6px; the popover uses 12px. Vendor swatches are 8px squares with 2px corners; strip bars and finding marks are square-cut. The record dot and popup step numbers are circles. An off state is drawn as an inset ring (1.5px) rather than a fill: the paused record dot and an off vendor chip swatch.

## Components

### Buttons
Quiet, flat, and dense.
- **Shape:** 8px corners, 30px tall, 12px side padding, 1px `line-strong` border, 500 weight, 16px inline SVG icons with a 6px gap.
- **Primary:** `blue` fill, white text; hover to `blue-strong`. One per surface (Save .md, Enable for this session).
- **Ghost:** transparent border, `blue-strong` text, `blue-tint` on hover. Secondary exports, Clear, Cancel, detail actions.
- **Toggle:** default button that takes `blue-tint` fill and `blue-strong` text when `aria-pressed="true"` (API context).
- **Record toggle:** red dot plus label plus mono timer while recording; paused shows a hollow ring, secondary text and no timer.
- **Transitions:** background and border colour, 120ms ease-out; none under reduced motion.

### Inputs / Fields
- **Style:** `surface-2` fill, transparent 1px border, 8px corners, 30px tall, 16px leading icon in `text-2`.
- **Focus:** fill returns to `bg` and the border turns `blue`.

### Chips
- **Style:** vendor filter chips, 26px, 12px 500 text, `line-strong` border on `bg`, 8px vendor swatch.
- **State:** on takes `blue-tint` fill and border with `text` colour; off keeps the border and shows the swatch as an outline ring.

### Live checks
- **Style:** full-width rows of 26px in the checks column: count badge then label. Badge is a 20px mono count on a tint that follows the check state (neutral, ok, warn, bad).
- **State:** pressed check takes `blue-tint` with `blue-strong` text and filters the table.
- **Motion:** when a count changes, the number rolls up from 45% below at 0.35 opacity over 320ms, `cubic-bezier(.16, 1, .3, 1)`. Off under reduced motion.

### Event table
- **Header:** `surface` band, table-head type, `text-2`.
- **Page header:** sticky, `bg`, 600 page number plus mono path in `text-2`.
- **Row:** 24px minimum, hairline divider, vendor swatch and name in `text-2`, event name 500, parameters mono truncated with an ellipsis, Check column text coloured by severity (bad, warn, note in `text-3`).
- **States:** hover `surface`; finding rows tinted from their severity; open row `blue-tint` with the detail view below.
- **Detail:** JSON block (`json` fill, hairline, 8px corners, max 360px tall) beside a side column with the plain-language reason and ghost actions.

### Popover
API context confirm: 320px, 12px corners, hairline border, popover shadow, 14px 600 title, `text-2` body, right-aligned ghost then primary action.

### Pulse strip (signature)
Canvas timeline. Each event is a 3px bar in its vendor colour; bar height by source (network 100%, consent 72%, dataLayer 52%, API request 30%). Events within 4px stack upward with a 2px gap; a slot too crowded to fit drops the gap and scales its bars to the plot height. Page boundaries are dashed `text-3` verticals with the page label in `text-2`. Filtered-out events drop to 0.22 opacity. The selected event is drawn in `text` (ink) on a 9px `blue-tint` column, so selection never reads as a GA4 bar. A 4px square under the baseline marks a slot with a warning (`warn-mark`) or a failure (`bad-mark`). Tick labels are mono 11px `text-3`. The legend under the checks explains bar height.

## Do's and Don'ts

### Do:
- **Do** use `blue` for one filled primary action per surface and `blue-strong` text for every other action.
- **Do** separate bands and rows with 1px `line` hairlines and layer with `surface` and `surface-2`.
- **Do** set times, counts, paths and payloads in monospace with tabular figures.
- **Do** tie every semantic colour to a check result that a user can click through to rows.
- **Do** show on states with a `blue-tint` fill and off states with an outline ring.
- **Do** define every colour for both the light and the dark theme under the same token name.

### Don't:
- **Don't** use green, amber or red for chrome, emphasis or vendor identity.
- **Don't** use vendor colours for anything other than strip bars and swatches.
- **Don't** add shadows to resting surfaces; only popovers and tooltips float.
- **Don't** use uppercase outside the table header, and never above 0.06em tracking.
- **Don't** set any text below 4.5:1 against `bg` or `surface`; `text-3` is the floor of the text ramp, not a starting point for lighter greys.
