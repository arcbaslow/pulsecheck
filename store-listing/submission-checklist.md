# Chrome Web Store submission checklist

## Ready in the repository

- [x] Manifest V3 package with `manifest.json` at the ZIP root.
- [x] Description is no more than 132 characters.
- [x] 128×128 icon with transparent padding.
- [x] Three 1280×800 screenshots.
- [x] Required 440×280 small promo tile.
- [x] Optional 1400×560 marquee tile.
- [x] Detailed listing description.
- [x] Single-purpose and data-use answers.
- [x] Public privacy policy and support URL.
- [x] Reviewer instructions for the DevTools-only interface.
- [x] No requested permissions, remote code, telemetry or backend.
- [x] Automated test suite and version-consistency check.

## Manual dashboard work

- [ ] Register or open the Chrome Web Store developer account and confirm the
  publisher name.
- [ ] Verify the publisher email and enable two-step verification if requested.
- [ ] Upload `pulsecheck-chrome-web-store-0.1.1.zip`.
- [ ] Paste the detailed description and dashboard answers from this directory.
- [ ] Upload the icon, screenshots and promo tiles in the documented order.
- [ ] Choose distribution visibility and regions.
- [ ] Complete the privacy certifications exactly as documented.
- [ ] Add the reviewer notes before submitting for review.
- [ ] Confirm the publisher can legally accept the Developer Agreement and that
  the privacy policy matches the final dashboard answers.

## Validation before public visibility

The project plan still marks a full audit on at least three different sites as
unfinished. Use trusted testers or an unlisted release until those sessions have
been compared with Chrome's Network panel and the page's data layer. All
visibility modes receive the same policy review.
