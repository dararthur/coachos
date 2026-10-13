---
version: 1
slug: "src-components-layout-app-shell-tsx"
primary_target: "src/components/layout/app-shell.tsx"
related_targets: ["src/app/a/[academyId]/dashboard/page.tsx","src/app/a/[academyId]/attendance/[sessionId]/roster.tsx","src/app/(auth)/layout.tsx"]
---

# Surface brief — Matnexa application (shell and all routes)

Scope: every authenticated and public screen of the app (shell, dashboard, members, schedule, attendance and roll, reports, settings, member space, check-in, auth, account, onboarding, privacy). Mode: Operate.

Audience and job: coach on the mat with a phone (priority), owner/admin at a desk, adult members checking in. Clubs of 100–300 members. Task first: open today's session, take the roll, know whom to talk to.

Constraints: no backend logic, schema, RLS, auth or deploy change; e2e labels, roles and landmarks preserved; WCAG 2.1 AA; 44 px targets; 16 px inputs; light theme only (bright gym, quick glances).

## Direction contract

THESIS: Matnexa counts like a belt does: every presence is a stripe of white tape on a black bar. The app refuses the category default of a teal sidebar, a KPI-card row and rounded shadowed cards; structure is a black bar, data is tallied, and nothing floats.

OWN-WORLD: warm cotton ground (#F4F2EE) and white panels on 1 px warm hairlines, square 4 px corners, no decorative shadow. The black bar (#16191D) carries navigation; the active item is a full-width white tape stripe. One accent, orange belt (#C2410C), only on the primary action and focus. Semantics apart: green present, amber late, red absent. Archivo variable: condensed bold for titles and numerals, normal width for data; tabular figures everywhere.

STORY: the coach opens Matnexa, sees today's sessions with the next one ready to call, takes the roll one-handed with the tally filling at the bottom, and sees who has stopped coming with a way to write to them.

FIRST VIEWPORT: dashboard. Compact condensed title and date; a single tally strip of four counts on one hairline-divided panel; below, "Aujourd'hui" (sessions as time-led rows, "Faire l'appel" as the orange button) beside "À recontacter" (names, last visit, "Écrire"); weekly presences as tape bars beneath. On the phone the black bar sits at the bottom, the roll's tally bar sticks above it.

FORM: Ceinture — the BJJ rank bar and its tape stripes; position 1 of the ordered grounded list (chosen as Impeccable's pick over the rolled direction); seed key 837744a0. Signature move: the tally bar (roll progress, member assiduity, nav active stripe, logo mark of four strokes and one orange crossing stroke).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
