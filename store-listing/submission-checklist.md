# Chrome Web Store submission checklist

Pulsecheck is published on the
[Chrome Web Store](https://chromewebstore.google.com/detail/pulsecheck-tracking-audit/fcdnmpffnfcbfhkokkfnilicjbpjdmnp).
Use this checklist for future updates to that listing. Unchecked items are
repeatable release tasks, not the status of the initial submission.

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

## Manual dashboard work for each update

- [ ] Open the existing Pulsecheck listing in the publisher dashboard
  (extension ID `fcdnmpffnfcbfhkokkfnilicjbpjdmnp`).
- [ ] Build and validate the upload package for the new version.
- [ ] Upload the versioned `pulsecheck-chrome-web-store-<version>.zip`.
- [ ] Paste the detailed description and dashboard answers from this directory.
- [ ] Upload the icon, screenshots and promo tiles in the documented order.
- [ ] Choose distribution visibility and regions.
- [ ] Complete the privacy certifications exactly as documented.
- [ ] Add the reviewer notes before submitting for review.
- [ ] Confirm the publisher can legally accept the Developer Agreement and that
  the privacy policy matches the final dashboard answers.

## Validation for each release

- [ ] Record full audit sessions on at least three sites with different tracking
  stacks and compare the exports with Chrome's Network panel and the page's
  data layer.
- [ ] Inspect both exports for unmasked values.
- [ ] Test install, panel registration, navigation, pause/resume, clear, filters,
  copy and downloads in the target Chrome version.
- [ ] Confirm that the store privacy disclosure matches the final manifest and
  runtime behavior.
