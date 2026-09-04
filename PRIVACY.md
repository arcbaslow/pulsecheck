# Pulsecheck privacy policy

Effective date: 5 September 2026

Pulsecheck has one purpose: record a website's measurement activity in Chrome
DevTools and let the user export that session for a tracking audit.

## Data the extension handles

While the Pulsecheck DevTools panel is open, it can process:

- the inspected page URL and page changes;
- outgoing tracking-request URLs and payloads;
- `dataLayer`, custom data-layer and `digitalData` messages;
- Google Consent Mode values;
- timestamps, request methods, status codes and MIME types;
- the scenario note entered by the user; and
- the browser user-agent string.

This information can include website content, browsing activity, user activity
and identifiers placed in tracking payloads by the inspected site.

## How data is used

The data is used only to show the local timeline, run local audit checks and
create the Markdown or JSONL file requested by the user. Pulsecheck has no
account system, backend, analytics or telemetry. The developer does not receive
the inspected data.

The optional **API context** control records only method, host, path, response
status and MIME type for non-static site requests. It excludes request bodies
and query strings.

## Storage and deletion

A session stays in the DevTools panel's memory. Closing DevTools or clearing the
timeline removes it. Pulsecheck does not use extension storage or cloud storage.

An export is created only when the user clicks a save or copy control. Files and
clipboard contents are then under the user's control and can be deleted through
the operating system or overwritten in the clipboard.

## Redaction

Before export, Pulsecheck masks detected emails, phone numbers, person-name
fields, national-ID fields and user or device identifiers. Named password,
token, cookie, card-number, CVV, IBAN and similar secret fields are replaced with
`[redacted]`.

Automated redaction cannot classify every arbitrary value. Users should review
alpha exports before sharing them.

## Sharing, selling and advertising

Pulsecheck does not sell, share or transfer user data. It does not use data for
advertising, profiling, creditworthiness or any purpose unrelated to its single
tracking-audit function. No developer employee or contractor can read a session
unless a user independently chooses to send an already-reviewed export for
support.

Pulsecheck's use of information received from Chrome APIs complies with the
Chrome Web Store User Data Policy, including the Limited Use requirements.

## Contact

For a privacy question, open a public issue without attaching session data:
[GitHub issues](https://github.com/arcbaslow/pulsecheck/issues)

For a possible vulnerability or data exposure, use private vulnerability
reporting:
[private vulnerability reporting](https://github.com/arcbaslow/pulsecheck/security/advisories/new)
