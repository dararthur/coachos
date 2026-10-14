---
target: member journey (Mon espace and member screens)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:D:\\Projects\\coachos\\src\\app\\a\\[academyId]\\me\\page.tsx"
target_fingerprint: "sha256:bb6dd87d540f3a1d2f35875cfe8f67a31349f2d080f9dc9f94f3125cefd7b7e6"
target_path: "D:\\Projects\\coachos\\src\\app\\a\\[academyId]\\me\\page.tsx"
timestamp: 2026-10-14T13-11-33Z
slug: src-app-a-academyid-me-page-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

Target: member journey (join → profile → Mon espace → booking → check-in → ranking). Files: src/app/join/*, src/app/(auth)/signup, src/app/a/[academyId]/{profile,me,schedule,ranking}/page.tsx, src/app/checkin/**, src/app/account, src/components/ui/{booking,image-field,belt,avatar,silhouette,attendance-history,assiduity,install-app}.tsx, src/components/layout/{app-shell,nav-links}.tsx.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Server-confirmed check-in; waitlist promotion never signalled; past sessions show "Inscrit" with no outcome |
| 2 | Match System / Real World | 3 | "QR code affiché par le coach" (me/page.tsx:44, scanner.tsx:120,142) wrong in fixed-poster mode |
| 3 | User Control and Freedom | 2 | One-tap "Annuler" of a waitlist place, no undo (booking.tsx:19); photo uploads on pick without preview |
| 4 | Consistency and Standards | 2 | 9 orange buttons on /me; 3 labels for check-in; booking button left on /me, right on /schedule; ink vs orange focus rings |
| 5 | Error Prevention | 2 | Full class still says "Réserver"; fixed-QR confirm disabled without reason (club/[key]/confirm.tsx:107) |
| 6 | Recognition Rather Than Recall | 3 | Silhouette is a text select; belt preview doesn't follow the selects (profile/page.tsx:45) |
| 7 | Flexibility and Efficiency | 2 | ~5 taps per check-in incl. a second "Scanner un QR code" (scanner.tsx:125); one-gesture book+check-in, PWA shortcut, 1-year sessions are wins |
| 8 | Aesthetic and Minimalist Design | 2 | /me 3085 px on mobile; install banner + 9 equal rows push the next class below the fold |
| 9 | Error Recovery | 3 | Specific messages; "Aucun cours à pointer" (club/[key]/confirm.tsx:31) gives no next time; no "le coach peut vous marquer présent" |
| 10 | Help and Documentation | 2 | Nothing on camera permission, waitlist mechanics, or what a stripe means |
| **Total** | | **24/40** | **Acceptable** |

## Design Specificity Verdict

Coherent with Ceinture, only partly authored for the member. Shell and ranking (avatar + BeltIcon, condensed rank) are Matnexa; join and check-in are generic centred white cards, Mon espace a stack of identical orange "Réserver" buttons, check-in success a 14 px pale-green sentence. Belt absent from /me and check-in. DESIGN.md departures: font-mono on the join code (join/[code]/page.tsx:41), ink focus ring (image-field.tsx:86, club/[key]/confirm.tsx:86), bg-bar as a content panel (me/page.tsx:44), scanner manual input not .field (scanner.tsx:184).

Deterministic: CLI exit 0, 0 primary + 7 advisories — 4 false positives (11 px tab label nav-links.tsx:63 documented; belt fills belt.tsx:7-9 documented), 3 true low-stakes (belt edge strokes #173f7d/#512d80/#4c2e1a undocumented). Browser: cream-palette everywhere (the brief's "Coton" canvas, intentional, not an issue), nested-cards on table thead (false positive), em-dash-overuse 25 on /me (all from class-type name "JJB — Tous niveaux", a data default in db/migrations/20261013000200_members_catalog.sql:183), text-overflow at 0×0 viewport (false positive). Overlay user-visible in the in-app browser tab "[Human] Mon espace · Matnexa".

## Priority Issues

1. [P1] Waitlist promise the product doesn't keep: full class still "Réserver" (booking.tsx:18); "Une place vous sera attribuée si elle se libère" (server/actions/bookings.ts:34) while promotion is not notified; one-tap "Annuler" loses n°3; 8 identical "Réserver" accessible names. Fix: "Rejoindre la liste d'attente (n°4)" when full, honest post-booking copy, ConfirmAction on leaving the waitlist, contextual accessible names. → clarify, harden
2. [P1] Check-in without a working camera is a dead end and contradicts PRODUCT: fallback recommends the native camera (scanner.tsx:165) or pasting an untypable link; "QR du coach" in fixed mode; no "le coach peut vous marquer présent"; two Scanner taps; "Aucun cours à pointer" without next time. Fix: mode-aware copy, auto-start camera, iOS/Android permission steps, coach-roll fallback instead of paste box, next session + opening time. → harden, clarify
3. [P1] Accent overload on Mon espace: 9 orange buttons (/me), 2 (/schedule), 2 (/account); first class at y≈770 behind the tab bar; 3085 px page with 17 history rows. Fix: one contextual orange action (Pointer during window, else Réserver next class), secondary row buttons, next 3 sessions + "Voir le planning", history grouped by month. → distill, layout
4. [P2] 4th promise invisible at its peaks: no BeltLabel on /me; flat check-in success ([token]/confirm.tsx:54-58, club/[key]/confirm.tsx:64-68); joining lands on a 9-field form. Fix: "Ma ceinture" strip on /me; check-in success with condensed title, tally with this week's stripe, visit count, ranking link. → delight, bolder
5. [P2] Join landing doesn't build trust: signed-out /join/<code> doesn't name the club, monospace code; login loses join context (login/page.tsx:19); name asked twice (Nom affiché vs Prénom/Nom). Fix: public club name + logo (rate-limited), join banner on login for next=/join/, single name capture, auth layout. → onboard

## Persona Red Flags

- Jordan: can't confirm the club before signup; 4-step plan held across the e-mail; first screen a form ("Barrettes" unexplained, "Neutre" without visual); waitlist n°3 never says what happens next.
- Casey: install banner × top-right; first class behind the tab bar; "Annuler" adjacent to the waitlist badge; early at the poster → "Aucun cours" without time → retries → "Trop de tentatives".
- Sam: 8 "Réserver" + "Annuler" without context; "Assiduité" not a heading; fixed-QR confirm disabled with no reason; 10 rows "4e" without "ex æquo".
- Gérard, 64 (project persona): 11 px "Pointer" tab vs poster wording "Pointer ma présence" (accessible name only); two Scanner taps then an unannounced permission sheet; refusal gives no steps; never told the coach can mark them; small green success not trusted.

## Minor Observations

- Belt edge colours undocumented in DESIGN.md.
- Parenthetical forms: "Venu(e)" (assiduity.tsx:27), "1 présent(s)" (schedule/page.tsx:91), "invité(e)", "majeur(e)".
- Past sessions today show "Inscrit" with no outcome; 14 Oct 19:00 shows "Présent" and "Liste d'attente · n°3" at once (likely demo-data artefact, unguarded).
- No active tab on /profile; role "Membre" in the mobile top bar; club name wraps.
- Existing member on /join/<code> sees "Rejoindre…" instead of "Déjà membre".
- Ranking: "Membres venus 34" low value; consent card after 34 rows.
- Photo hint doesn't say who sees the photo.

## Questions to Consider

- Why does check-in end on a sentence and "Terminer" rather than a stripe being taped on?
- Should Mon espace be a single "Ton prochain cours" card that turns into "Pointer" during the window?
- Should "le coach te marque présent" be the endorsed fallback for older members?
- Keep (build the notification) or drop (change the copy) "Une place vous sera attribuée"?
