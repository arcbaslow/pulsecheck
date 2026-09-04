# Reviewer notes

Pulsecheck is a DevTools extension; its primary interface is not the toolbar
popup.

1. Open any ordinary HTTPS website.
2. Open Chrome DevTools.
3. Select **Pulsecheck** in the DevTools tab strip or the `»` overflow menu.
4. Reload the inspected page to see its initial tracking traffic.
5. Trigger a page interaction that sends analytics events.
6. Expand an event row or use **Save .md** to inspect the local export.

The toolbar popup only explains where to find the DevTools panel.

The extension requests no permissions and makes no extension-owned network
requests. It reads request information exposed to the open DevTools panel and
injects only the bundled `tap.js` through the DevTools inspected-window API. All
session state is in memory. The optional API-context mode is off by default and
does not retain request bodies or query strings.
