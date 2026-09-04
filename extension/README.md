# Pulsecheck

**Records what a page actually measures, and hands you one file to analyse.**

Open DevTools, walk through a scenario on the site, hit **Save .md**. You get
a single markdown file containing every tracking request, every dataLayer
push and every consent change - in order, with all parameters - ready to hand
to an LLM for an audit.

Built for the tracking audit: the deliverable is evidence, not a live view.

---

## Install

Not in the Chrome Web Store yet, so load it unpacked. There is no build step.

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** -> select this `extension/` folder
4. Open a website, press <kbd>F12</kbd>, click the **Pulsecheck** tab

Chrome shows **no permission warning** on install. The manifest requests
nothing at all beyond registering a DevTools page - no host access, no
`storage`, no `downloads`, no `webRequest`.

### If the panel is not there

- **Nothing happened when I clicked the toolbar icon.** Correct - Pulsecheck
  is a DevTools panel. The icon only shows a note telling you where to look.
- **No Pulsecheck tab in DevTools.** DevTools registers panels when it opens.
  If it was already open when you installed or reloaded the extension, close
  it and open it again.
- **Still nothing.** Check you are on a real `http(s)` site. Panels never load
  on `chrome://` pages, the New Tab page, or the Web Store. If it is still
  missing, `chrome://extensions` shows an **Errors** button on the card.

---

## Use

1. Open the panel **before** the page loads if the first seconds matter.
   Pushes from before that are recovered from a snapshot, but they carry the
   time the panel attached, not their real push time.
2. Type what you are about to do into **Scenario** - "cash loan application",
   "checkout with promo code". It lands in the dump and tells the analyst
   what the session covers.
3. Walk the site.
4. **Save .md**, or **Copy .md** to paste straight into a chat.

Capture runs from the moment the panel opens until DevTools closes. That is
deliberate: this is a recorder you consciously run, not something always on.

| Control | What it does |
|---|---|
| **Recording** | Red and pulsing while capturing. Click to pause and resume. |
| **Clear** | Drops the timeline and restarts the clock. |
| **All requests** | Off by default. Also records the site's own XHR/fetch calls that carry no tracking event, as `vendor:"request"` - use it when a finding needs anchoring to what the backend received. Static assets stay excluded. |
| **Scenario** | Free text, written into the dump header. |
| **Filter** | Substring match across event name, vendor, URL and parameters. |
| Vendor chips | Click to show or hide a vendor. |
| **Save .md** | The audit artifact. |
| **.jsonl** | The machine-readable version of the same session. |

Click any row to expand its full parameters.

---

## What it captures

- **Network** - fetch, XHR, sendBeacon and pixel requests. Parsers for GA4
  (including server-side GTM on custom domains, regional endpoints and
  batched hits), Meta Pixel, Yandex Metrica, Amplitude and TikTok, plus a
  generic parser that catches anything event-shaped - including home-grown
  first-party collectors, which are the usual blind spot.
- **dataLayer** - every push, including ones from before the panel opened,
  and custom-named layers. Capture is invisible to the page: no enumerable
  properties added, and `push` still returns what it should.
- **Consent** - Google Consent Mode defaults and updates, replayed over the
  timeline so every event carries the state that applied when it was sent.

## Output

Two files, same content, from one redaction pass:

- **`pulsecheck-<host>-<date>.md`** - the one you hand over. Session meta,
  vendor inventory, automatic checks, then the full timeline split by page.
  Self-contained: no tooling needed to read it, no schema to explain to a
  model.
- **`pulsecheck-<host>-<date>.jsonl`** - one event per line, schema v1, for
  diffing and linting.

The automatic checks cover duplicate suspects, events sent while consent was
denied, where PII appeared, and how much traffic no parser recognised. They
are mechanical starting points - the analysis is the LLM's job.

## Privacy

- **Nothing leaves your machine.** No backend, no telemetry, no API keys, no
  network calls of its own. Analysis happens outside the extension, on a file
  you choose to hand over.
- **PII is masked before the file exists**, never after. Emails, phone
  numbers, person names, national id numbers (ИИН/БИН, ИНН) and user
  identifiers are masked in parameters, URL query strings and captured
  request bodies. The unmasked value never reaches the export.
- **Masking preserves shape, not content** - `d***@***.kz`, `+7********78` -
  enough to prove a leak without carrying it.
- **Analysis identifiers survive on purpose.** `cid`, `sid`, `tid`,
  `insert_id`, `eid` and similar are not masked: they are what duplicate and
  stream checks are built on, and masking them would break the audit without
  protecting anyone.
- **Where PII was found is itself a finding**, reported with its location.
  PII in a URL query string is always high severity.

## Limits worth knowing

- Closing DevTools ends the session. There is no persistence by design.
- dataLayer pushes are drained a few times a second, so their timestamps are
  push time but their arrival can lag; the export sorts by send time to
  correct for it.
- Pushes from before the panel opened carry attach time, not push time.
- One session is one scenario. An event not appearing means "not observed
  here", never "not implemented".

---

Built by [Good Labs](https://goodlabs.kz) - conversion measurement and
analytics infrastructure for growth teams.
