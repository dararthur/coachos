# Coach OS — audit initial

Date: 2026-10-13
Scope: inspection of repository contents and source files in the default branch. No application code was modified.

## Executive summary

The repository is currently a product-discovery and concierge-prototype project, not a complete web application for academy management. The core working artifact is a dependency-free Node.js CLI that reads attendance CSV exports and generates a weekly intervention brief (TXT, Markdown, JSON), plus local history and feedback files.

## Inventory observed on `main`

- `README.md`: product thesis, initial ICP, validation gates, planned product boundaries.
- `discovery/`: interview scripts, outreach scripts, research/scoring notes, empty interview and verbatim trackers.
- `ops/`: concierge pilot offer and weekly founder operating loop.
- `v0/brief.mjs`: CSV input, feature calculations, deterministic rules, ranking/anti-fatigue selection, report rendering, history and feedback persistence.
- `v0/make-demo.mjs`: synthetic dataset generator.
- `v0/RULES.md`: documented rule definitions and intended operating behavior.
- Synthetic demo CSV / legend files and a CSV template.
- No `package.json`, web frontend tree, database schema/migrations, auth setup, CI test suite or deployment configuration was found in the tracked tree.

## Key product finding

The README explicitly says the immediate experiment is whether a coach changes their behavior weekly because the brief prompts them to, and excludes payments, billing, CRM, timetable, website and native apps. This conflicts with the newly stated strategic ambition of a full all-in-one academy management product.

**Recommendation:** preserve the concierge brief as a differentiating product module and validation asset. Do not immediately expand it into a full all-in-one platform. First decide whether to (a) finish and validate the existing experiment, while preparing the broader product architecture, or (b) explicitly change the product strategy and accept the additional build and go-to-market cost.

## Technical risks to verify and address

1. **No automated tests found.** The brief engine's calculations and ranking should be covered with repeatable tests against synthetic fixtures before further changes.
2. **CSV parser is handwritten.** It supports quoted fields and escaped quotes, but malformed/unterminated quoted fields and inconsistent row widths do not appear to be explicitly rejected. Add fixture-based tests before deciding whether to keep or replace it.
3. **Date handling needs hardening.** `parseDate` accepts ISO-looking dates and numeric slash/dot/hyphen forms without validating calendar bounds; JavaScript can normalize impossible dates. Ambiguous US/EU dates default to month-first unless a day greater than 12 appears elsewhere in the file. The generic `Date.parse` fallback can also vary for nonstandard inputs. Prefer strict validation and an explicit date-format option or a safe ambiguity warning.
4. **Time-zone consistency needs review.** Some logic uses UTC day keys and some fallback date parsing uses local date fields. Tests should cover UTC boundaries and daylight-saving changes.
5. **Feedback CSV writing needs proper escaping.** Names are inserted into a CSV row using a quoted field but embedded quotes/newlines are not escaped. Use a dedicated CSV serializer and stable IDs.
6. **History and feedback are local files.** Acceptable for a founder-run concierge trial, but not suitable for concurrent multi-user production. Define retention, backup and access controls before handling real club exports.
7. **Privacy/data minimization.** The current plan says adult-only members, no health data, and removal of raw audio after transcription. Real attendance exports still contain identifiable data; establish data handling instructions, minimal retention, deletion procedures, and access controls before pilots.
8. **Potential output consistency issue.** The feedback file is selected by a user-supplied `--feedback` path when reading, but subsequent appended feedback always targets the default `out/<gym>-feedback.csv`. Verify whether that is intended.
9. **History semantics need tests.** The value report uses the latest history entry and attendance-derived return after the brief date; ensure its time window and matching ID semantics align with the pilot workflow.
10. **Product strategy mismatch.** Current ICP and pricing are for English-speaking commercial BJJ/MMA academies with adult memberships, at $29/month; the revised target says launch with BJJ/grappling/MMA then expand. Keep these assumptions explicit and test them rather than silently treating them as settled.

## Recommended sequence

### P0 — Protect and reproduce
- Keep `main` unchanged; work only on an isolated branch.
- Make a local clone and verify `git status`.
- Run the synthetic demo and brief using a fixed date; record Node version and outputs.
- Never commit real pilot CSVs, output reports, credentials, or `.env` files.

### P1 — Automated characterization tests
- Add tests for CSV quoting/BOM/delimiters, date formats and invalid dates, duplicate attendance, missing identifiers, every rule boundary, rule priority/quota, anti-fatigue, feedback escaping and value-report logic.
- Store only synthetic test fixtures.
- Capture expected output to avoid accidental behavioral changes.

### P2 — Product/architecture decision
- Decide whether the immediate objective remains validating the weekly brief or changes to building the full platform now.
- If the all-in-one ambition is confirmed, define the MVP modules and architecture in a separate product RFC before implementation.
- Likely modules: tenant/academy, identity and roles, members, schedule/sessions, attendance, memberships/billing, communications, progression, reporting, integrations.
- Design tenant isolation, audit logging, backups, import/export and GDPR processes from the start.

### P3 — Full platform architecture
- Only after P1/P2: select frontend/backend/database/deployment from the actual requirements and maintenance budget.
- Build one end-to-end vertical slice with synthetic data before building the whole feature catalogue.

## Current status / limitations

This audit was conducted by reading GitHub files via the connected integration. The code was not cloned or executed in a local Node.js environment during this review, so findings above are static-analysis observations, not a claim that runtime tests passed or failed.

No files on `main` were changed. This report is committed only to branch `audit/initial`.


## Additional findings from line-by-line static review

11. **Multiple classes on one day are collapsed.** `loadAttendance` stores attendance timestamps as date-only values and then deduplicates them with `new Set(dates)`. The detected class/program column is not used in attendance counting. A member who attends two sessions on the same date therefore counts as one class for `totalClasses` and the weekly frequency calculations. This can distort the very behavior signals the brief depends on. Decide whether metrics mean unique attendance days or actual sessions; the documented intent says classes/week, so session-level deduplication (stable event ID, or date + program/class where appropriate) is likely needed.
12. **Invalid explicit reference dates are not rejected.** `--date` uses `parseDate`, which may return `null` for an invalid input; the script does not fail fast before calculations and output generation. ISO and numeric-form dates also need calendar-bound validation to avoid JavaScript date normalization.
13. **Ambiguous date imports are unsafe by default for French exports.** When every numeric date is ambiguous (e.g. all dates have day and month <= 12), `inferDayFirst` returns false and silently interprets the data month-first. A French/European export can therefore have systematically incorrect dates without an error. Add an explicit option to select DMY/MDY and fail/warn when ambiguity cannot be resolved.
14. **Custom feedback input is inconsistently handled.** The `--feedback` path is used when reading feedback, but new rows are still appended to the default feedback path. Either append back to the selected file or make the CLI read-only for custom feedback paths.
15. **CSV output needs a complete serializer.** The current feedback writer places the student ID unquoted and the name in quotes without escaping embedded double quotes/newlines. Use a tested CSV serializer or escape fields correctly. Keep names and identifiers treated as untrusted input.
16. **The checked-in ignore policy deserves tightening.** `.gitignore` correctly ignores most attendance CSVs but explicitly re-includes `v0/data/weird-export.csv`. The current sample appears to follow the same synthetic ID/name pattern as the demo generator, but the broad exception is an avoidable future footgun: prefer a clearly named synthetic fixture and a documented synthetic-data allowlist only.
17. **No execution-based verification has been completed.** These are static findings only. They should be reproduced using Node >= 18 and isolated temporary directories before code fixes are made.

## Suggested first engineering ticket

**Ticket: characterize and harden attendance import.** Before adding web UI, build automated tests around CSV parsing, date parsing and attendance granularity. This is P0 because all subsequent retention signals rely on the import being correct.

Acceptance criteria:
- DMY and MDY date formats are explicitly configurable; ambiguous input cannot silently flip.
- Impossible dates and invalid `--date` arguments fail with actionable errors.
- Multiple sessions on one day are counted according to a documented rule, tested with fixtures.
- Quoted commas, escaped quotes, embedded newlines, UTF-8 BOM, semicolon and tab delimiters have tests.
- Feedback CSV handles commas, quotes, CR/LF and unusual IDs without corrupting rows.
- Running twice for the same fixed reference date is deterministic apart from generated-at metadata; history does not silently double-count.
- Tests only use invented members and fixtures.
