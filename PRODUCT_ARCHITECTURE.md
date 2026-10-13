# Coach OS — Product & Architecture Foundation

Status: proposal for implementation planning  
Date: 2026-10-13  
Branch: `product/platform-foundation`  
Constraint: preserve `main`; no production code is changed by this document.

## 1. Product decision

Coach OS is intended to become an all-in-one management platform for BJJ, grappling and MMA academies, with the option to expand to other martial arts later. The existing weekly student brief remains a differentiating module, not the whole product.

The strategy has changed from the initial README thesis. This is a material scope increase. Before production implementation, define a usable vertical slice and validate it with a small number of clubs. Do not attempt to clone every feature from OSS Academy and MAAT in the first release.

## 2. Target users and roles

- **Academy owner / administrator:** academy settings, people, memberships, schedule, reporting, billing configuration and permissions.
- **Coach / instructor:** assigned sessions, attendance, student notes that are not medical, progression and weekly brief.
- **Adult member:** personal schedule, bookings, membership status, announcements and profile.
- **Parent / guardian:** future phase only; child profiles require a separate privacy and safeguarding review before implementation.
- **Platform operator:** limited support access, auditable and never implicitly granted access to all tenant data.

Initial sport coverage: BJJ, grappling and MMA. Discipline-specific fields should be configurable rather than hardcoded throughout the app.

## 3. MVP vertical slice

The first usable release should support this end-to-end journey:

1. An owner creates an academy and configures timezone, currency, disciplines and basic settings.
2. The owner imports or creates adult members.
3. The owner creates recurring classes and assigns instructors.
4. A coach opens today's session and records attendance.
5. The owner can review member attendance history and export data.
6. The existing weekly brief engine can consume a synthetic/imported attendance dataset and produce explainable suggestions.
7. Authentication, tenant isolation, error handling, audit events and basic backup/export are in place before real customer data is used.

Not in the first vertical slice: payment processing, full accounting, competition brackets, native mobile apps, AI chat over private member data, family/child accounts, complex multi-site/franchise controls. These can be planned after core usage is validated.

## 4. Proposed application structure

- `/dashboard` — today's classes, attendance summary and actionable items.
- `/members` — member list, profile, attendance history and membership state.
- `/schedule` — class types, recurring sessions, instructors and capacity.
- `/attendance` — session roster and quick check-in.
- `/brief` — weekly actionable student brief with factual explanations and feedback.
- `/reports` — attendance trends and CSV export.
- `/settings` — academy details, disciplines, roles and import options.

Each page must be backed by real application state. Avoid demo-only buttons and fabricated metrics; seed data must be clearly labelled as synthetic.

## 5. Architecture proposal (subject to validation)

- **Frontend:** Next.js App Router, TypeScript, Tailwind CSS and accessible component primitives.
- **Database / auth:** PostgreSQL with Supabase Auth and row-level security (RLS), if RLS policies can be tested and reviewed.
- **Validation:** schema validation at all API boundaries; server-side authorization for every tenant-owned resource.
- **Testing:** Node's built-in test runner for the existing CLI; frontend/unit tests and integration tests for tenant isolation and core workflows.
- **Hosting:** select a low-maintenance deployment after the initial vertical slice; avoid binding secrets or production data to a developer machine.
- **Observability:** error logging and basic product analytics with privacy-aware configuration.
- **Payments:** deferred until the membership and billing model is specified. Use a payment provider only after deciding whether clubs are merchants, whether the platform facilitates transactions, and how refunds, mandates and failed payments are handled.

Do not introduce microservices. Start with a modular monolith and clear domain boundaries.

## 6. Minimum domain model

- `academies`: tenant and configuration.
- `profiles`: authenticated identity, with minimal personal information.
- `academy_memberships`: links a profile to an academy and role; a profile may belong to multiple academies.
- `people`: adult member record and contact/preferences, separate from auth identity where needed.
- `disciplines` and `class_types`: academy-configured sport and class categories.
- `sessions`: scheduled class instances with instructor, start/end, capacity and status.
- `attendance`: one member/session record, with status and timestamps; enforce uniqueness for the same member/session.
- `membership_plans` and `member_subscriptions`: initially represent membership status/periods; actual collection is deferred.
- `student_notes`: minimal non-medical coaching notes, restricted to authorized roles and subject to retention controls.
- `brief_runs`, `brief_items`, `coach_actions`: provenance of each suggestion and feedback loop.
- `audit_events`: security-relevant changes and administrative actions.

All tenant-owned records must have an academy boundary enforced in the database, not just hidden in the UI. Define foreign keys, deletion rules and retention before implementation.

## 7. Non-functional requirements

- Tenant isolation verified with negative tests (a user from academy A cannot read or mutate academy B's records).
- Role-based access control enforced server-side and in database policies.
- Secure authentication, session handling, rate limits and input validation.
- GDPR principles: data minimization, purpose limitation, export/deletion workflows, retention rules and a privacy notice before pilots use real personal data.
- Adult-only MVP; do not import children's data or health/injury information.
- Accessible keyboard navigation, responsive layouts and useful loading/empty/error states.
- Database migrations, reproducible local setup, synthetic seed data and CI checks.
- Backup and restore procedure documented before production use.

## 8. Existing prototype integration

The current `v0/brief.mjs` remains a standalone deterministic engine initially. First add characterization tests and fix import/date/session-count correctness. Then extract its business logic behind a module boundary so it can be invoked by the app without coupling the web layer to filesystem paths or console output.

Do not directly expose arbitrary file paths, shell commands or raw CSV data to an AI model. The brief's student selection must remain deterministic and explainable; AI may later assist with phrasing, not decide which person is flagged.

## 9. Delivery sequence

### Milestone 0 — Foundation
- Confirm runtime/tooling and reproducible local setup.
- Add tests for CSV parsing, dates, attendance granularity, rules, cooldown, feedback escaping and value report.
- Define schema, role matrix and tenant isolation tests.
- Add CI checks and synthetic fixtures.

### Milestone 1 — App shell
- Create responsive navigation and login/onboarding states.
- Add academy creation and protected routes.
- Establish a minimal design system and reusable table/form/dialog patterns.
- No fabricated business data outside an explicitly labelled demo seed.

### Milestone 2 — First vertical slice
- Members CRUD and CSV import preview/validation.
- Class/session management.
- Attendance recording and history.
- Dashboard derived from database queries.
- Export and error states.

### Milestone 3 — Retention brief
- Integrate deterministic brief engine.
- Display factual reasons and recommended actions.
- Record coach feedback and verify return from later attendance.
- Measure whether coaches actually use the brief.

### Milestone 4 — Commercial readiness
- Membership lifecycle and billing requirements.
- Payment provider integration only after explicit decision.
- Support tooling, privacy documentation, backups, monitoring and onboarding.

## 10. Definition of done for the first vertical slice

- A new academy can be created through the UI.
- An owner can add/import members, create a session and record attendance.
- Data persists after refresh and a new login.
- Tenant and role tests pass.
- Invalid CSV rows are reported rather than silently mis-imported.
- No secrets or real personal data are committed.
- The application has documented local setup and deployment steps.
- A clean checkout can run tests and start the app using documented commands.

## 11. Decisions still open

1. First deployment language/market: French-first, English-first, or bilingual.
2. Commercial model: commercial academies only at first, or associations too.
3. Whether bookings by members are part of MVP or a later milestone.
4. Whether memberships in MVP are informational only or include payment collection.
5. Whether to retain Supabase or use a different managed PostgreSQL/auth solution based on budget and deployment needs.

Default recommendation: bilingual-ready architecture, launch with one clear ICP, informational memberships before payments, and keep the first slice focused on members → sessions → attendance → useful brief.
