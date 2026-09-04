---
name: pulsecheck-analyze
description: Analyze a pulsecheck session dump (pulsecheck-*.md or session.jsonl) and produce a tracking audit report. Use when the user provides a pulsecheck dump, asks to analyze a tracking session, audit captured analytics events, check a dump against a tracking plan, or mentions session.jsonl or a pulsecheck markdown dump.
---

# pulsecheck-analyze

Turn a pulsecheck dump into an audit report in the Good Labs deliverable
format. Input, either form (see docs/dump-format.md):

- `pulsecheck-<host>-<date>.md` - the usual case. Carries session meta, a
  vendor inventory, mechanical checks the panel already ran, and the full
  timeline with every parameter.
- `pulsecheck-<host>-<date>.jsonl` - schema v1, one event per line. Prefer
  this when both are present: it is exact, and `seq` numbers are the
  evidence you cite.

Optional second input: a tracking plan (JSON Schema from figma-taxonomy-gen
or a markdown plan).

## Procedure

1. **Validate**: for JSONL, line 1 is a `type:"session"` header with
   `schema:1` and every line parses as JSON; report and skip bad lines, do
   not abort. `tool` reads `"pulsecheck"`, or `"signal-tap"` on dumps from
   the pre-rename alpha - both are valid v1, do not reject either. For the `.md`, read the meta table and the timeline; each
   timeline line is `+Ns · seq · source · vendor · event · params`.
   The panel's own "Automatic checks" section is a starting point, not the
   answer - re-derive its numbers from the timeline and say so if they
   disagree (a mismatch means the dump was edited).
2. **Inventory**: events per vendor, unique event names with counts,
   dataLayer messages vs network hits, `unparsed`/`generic` share (a high
   share is itself a finding: unknown senders on the page).
3. **Checks** (each produces findings with severity high/medium/low):
   - **Duplicates**: same vendor + event + value within 2s; missing or
     colliding dedup keys (`eid` for Meta, `insert_id` for Amplitude,
     `event_id` for TikTok). For Meta: pixel + CAPI pairs without matching
     `eid` = high (double counting).
   - **Consent**: events sent while the relevant GCM storage was `denied`;
     vendors firing before any consent default was set.
   - **PII**: `redacted:true` lines - report field and location (already
     masked); PII in URL query = high severity always.
   - **Naming**: event names against snake_case `{object}_{action}`
     convention (or the plan's convention if a plan is provided); mixed
     languages, spaces, camelCase mixed with snake_case.
   - **Coverage vs plan** (only if a plan is given): planned events never
     seen; seen events not in the plan; param mismatches (missing required,
     type drift). State clearly that absence of an event in ONE session is
     "not observed in this scenario", not "not implemented".
   - **Infrastructure**: GA4 via sGTM custom domain or direct; `debug_mode`
     traffic in a production capture; regional endpoints; multiple GA4 `tid`,
     Metrica `counter` or Meta pixel ids on one page (why?).
     `(google_ads_sync)` on a doubleclick host means Google Signals is
     active - cross-check it against the consent state, it is an ad cookie.
     `vendor:"generic"` with a first-party `_host` is a home-grown collector:
     name it, say what it sends, and flag it if it carries identifiers the
     client did not mention.
     `vendor:"request"` lines are the site's own API traffic, present only
     when the auditor enabled it. They are context, never tracking events:
     never count them in the inventory totals, never call them duplicates.
     Use them to anchor findings - which backend call carried the data that
     a pixel then sent onward, and how many ms apart.
4. **Report** (Russian by default, match the user's language if they asked
   in English). Structure:
   - Сводка: 3-5 предложений, самое дорогое - первым.
   - Инвентарь: таблица вендор / события / количество.
   - Находки: по severity, каждая - что, где (seq/URL), чем грозит, что
     сделать. Ссылайся на seq конкретных строк дампа как на доказательство.
   - Покрытие плана (если план дан): таблица план vs факт.
   - Следующие шаги: максимум 5, приоритезированы.

## Rules

- Every number in the report must be derivable from the dump. No estimates
  presented as measurements.
- Do not unmask redacted values or attempt to reconstruct PII.
- One session is one scenario: never claim site-wide conclusions from a
  single dump; say what scenario the dump covers (from header `page` and
  navigation events).
- Findings without a fix recommendation are not findings.
