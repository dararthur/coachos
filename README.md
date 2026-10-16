# Matnexa

**Matnexa** est l'application de gestion des clubs de sports de combat (jiu-jitsu brésilien, grappling, MMA) : membres, planning des cours, réservations, présences et pointage par QR code, classement, rapports, équipe et droits RGPD. Elle remplace le cahier d'appel et le tableur, et aide le club à garder ses adhérents (« à qui parler »).

> Nom public : **Matnexa**. `coachos` reste le nom de code interne (dépôt, rôles PostgreSQL, services, scripts). Adhérents **majeurs uniquement**, **aucune donnée de santé**.

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Technologies utilisées](#technologies-utilisées)
3. [Architecture](#architecture)
4. [Sécurité et vie privée](#sécurité-et-vie-privée)
5. [Application mobile (PWA)](#application-mobile-pwa)
6. [Démarrage rapide](#démarrage-rapide)
7. [Tests et qualité](#tests-et-qualité)
8. [Structure du dépôt](#structure-du-dépôt)
9. [Documentation](#documentation)
10. [Contexte produit et pilote](#contexte-produit-et-pilote)

## Fonctionnalités

**Pour le coach et le responsable de club**

- **Membres** : liste paginée avec recherche et statut, fiche complète (grade, assiduité, historique), création, modification, archivage, import CSV validé en deux étapes, export CSV, contact WhatsApp en un geste.
- **Planning** : séances uniques ou récurrentes, capacité, coach affecté, annulation ; **réservations avec liste d'attente** (la capacité ne bloque jamais : le surplus est mis en attente et promu automatiquement ; le coach peut aussi accorder une place ; l'adhérent promu est **prévenu par e-mail**).
- **Appel** : feuille d'appel (Présent / En retard / Absent) avec les inscrits en premier, filtre « Inscrits », validation finale qui marque absents les inscrits non venus.
- **Pointage par QR code**, deux modes au choix du club : **QR tournant** affiché par le coach (jeton court renouvelé), ou **QR fixe** imprimé (affiche A4 avec le logo du club) qui retrouve le cours par l'heure (par défaut de 45 min avant à 30 min après le début, réglable). Le scanner est **intégré à l'application** (pas besoin de l'appareil photo natif). La réservation est obligatoire pour pointer ; un membre non inscrit réserve et pointe en un geste.
- **Tableau de bord** et **rapports** filtrables avec deux exports CSV : l'historique des présences, et le **classement d'une période** (nombre de présences de chaque membre entre deux dates) ; membres à recontacter (actifs sans présence depuis 30 jours).
- **Équipe** (propriétaire, administrateur, coach, membre), invitations par e-mail, **inscription autonome des adhérents par code ou lien permanent** du club, journal d'audit. **Mode membre** pour l'équipe (réserver d'autres cours) ; le coach affecté à une séance y est inscrit d'office.
- **Accès maîtrisé** : un compte ne se crée qu'avec un code de club, une invitation, l'adresse d'un responsable légal enregistrée par un club ou une demande de club approuvée ; **un club ne se crée qu'après approbation par l'administrateur de la plateforme** (e-mail de demande, page d'administration réservée, adresse de l'administrateur uniquement dans l'environnement du serveur).
- **Identité du club** : logo (affiché dans la navigation et sur l'affiche), réglages du pointage, fuseau horaire, durée de conservation des données.

**Pour l'adhérent**

- Inscription par le code ou le lien du club ; la fiche est créée automatiquement, le membre complète « Mon profil » : identité, téléphone, **ceinture et barrettes**, **photo** (facultative) ou silhouette (femme / homme / neutre).
- Planning, réservation et annulation (jusqu'à la validation de la feuille), e-mail « Votre place est confirmée » quand une place lui est attribuée depuis la liste d'attente, « Mon espace », ses présences, **classement** (semaine, mois, année) auquel il choisit d'apparaître ou non.
- Pointage de sa présence par QR, export et suppression de ses données.

## Technologies utilisées

| Domaine | Choix |
|---|---|
| Framework | **Next.js 16** (App Router, Server Components, Server Actions, `proxy.ts`), **React 19**, **TypeScript** strict |
| Interface | **Tailwind CSS 4** (jetons de conception, système visuel « Ceinture » décrit dans [DESIGN.md](DESIGN.md)), primitives maison accessibles (éléments natifs `<dialog>`, `<select>`, validation HTML), police variable **Archivo** auto-hébergée, icônes, ceintures et silhouettes en SVG dessinés à la main |
| Base de données | **PostgreSQL 17** standard, **RLS** (Row Level Security) comme seule autorité d'accès, fonctions `SECURITY DEFINER` pour les règles qui dépassent la RLS, migrations SQL versionnées (`db/migrations`, lanceur transactionnel `scripts/migrate.mjs`) |
| Accès aux données | **postgres.js** (SQL paramétré, transactions soumises à la RLS via `SET LOCAL ROLE`), **pg** pour Better Auth |
| Authentification | **Better Auth** auto-hébergé : e-mail + mot de passe, confirmation d'e-mail obligatoire, sessions en base (un an, renouvelées à l'usage), cookies HttpOnly / SameSite / Secure |
| Validation | **Zod 4** (formulaires, filtres, messages en français) |
| Images | **sharp** : toute image (JPEG, PNG, WebP, GIF, AVIF, HEIF, TIFF) est recadrée / réduite à 256 px, ré-encodée en WebP sans métadonnées, puis stockée **en base** (photos de profil, logo du club) |
| QR codes | **qrcode** (génération SVG), **jsQR** (décodage dans le navigateur, aucune image envoyée au serveur) |
| E-mails | **Resend** en production ; boîte d'envoi fichier en développement et en test |
| CSV | **PapaParse**, import défensif et export protégé contre l'injection de formules |
| Mobile | **PWA** installable (manifeste, icônes, mode standalone, raccourci de pointage), sans service worker ni cache de données authentifiées |
| Tests | **Vitest** (unitaires et base de données sur un vrai PostgreSQL embarqué), **Playwright** + **axe** (parcours et accessibilité), scan de secrets, audit des dépendances |
| Exploitation | Nginx en reverse proxy, CSP stricte à nonce, limiteurs de débit en base, journal assaini, sondes `/api/live` et `/api/health` |

## Architecture

Monolithe modulaire : un flux d'écriture unique `Server Action` → autorisation (session, appartenance sous RLS, limite de débit) → validation Zod → dépôt SQL dans une transaction RLS → `ActionResult` typé → interface (jamais de succès supposé). Détails et décisions dans [docs/architecture.md](docs/architecture.md).

Points notables : une migration par fonctionnalité (réservations, photos, logo, QR fixe…) avec ses tests de base et de RLS ; erreurs métier stables `coachos:<code>` mappées vers des messages français ; données personnelles minimales ; aucune dépendance à Docker pour tester.

## Sécurité et vie privée

RLS partout (isolation entre clubs testée), rôles PostgreSQL sans privilège superflu, CSP à nonce sans style inline, jetons de QR hachés et éphémères (clé du QR fixe lisible du staff seulement et régénérable), codes d'inscription limités en débit, photos servies derrière la session avec `nosniff`, export et effacement RGPD (anonymisation : la photo est supprimée avec l'identité). Voir [docs/security.md](docs/security.md) et [docs/privacy-gdpr.md](docs/privacy-gdpr.md).

## Application mobile (PWA)

Matnexa s'installe sur l'écran d'accueil des téléphones (Android : bouton « Installer l'application » ; iPhone : « Partager → Sur l'écran d'accueil », avec mode d'emploi intégré). La session dure un an et se prolonge à chaque usage : coachs et adhérents ne se connectent qu'une fois par appareil. Détails et liste de contrôle sur appareils réels : [docs/pwa.md](docs/pwa.md).

## Démarrage rapide

```bash
npm ci
npm run check                         # types, lint, tests unitaires + base de données (PostgreSQL réel), scan de secrets
PW_CHANNEL=chrome npm run test:e2e -- --project=chromium   # parcours complets dans Chrome (build inclus)
```

Lancer l'application en local (base, rôles, variables d'environnement) : [docs/setup.md](docs/setup.md). Les tests démarrent leur propre PostgreSQL embarqué ; aucun serveur externe n'est nécessaire.

## Tests et qualité

- `npm run typecheck`, `npm run lint`
- `npm run test:unit` : règles métier, normalisation d'images, analyse des QR
- `npm run test:db` : migrations, RLS, isolation entre clubs, réservations, QR, photos, RGPD, Better Auth
- `npm run test:e2e` : inscription, réservation, pointage (QR tournant et fixe), photo, logo, accessibilité (axe), mobile
  - projets Playwright : `chromium` (suite complète), `webkit` (moteur de Safari) et `firefox` (caméra/QR, responsive, mobile, accessibilité) ; `npx playwright install webkit firefox` puis `npm run test:e2e -- --project=webkit`. Le WebKit de Playwright n'est pas un iPhone : voir [docs/qr-checkin.md](docs/qr-checkin.md).
- `npm run audit:secrets`, `npm run audit:deps`

## Structure du dépôt

```
src/domain/        logique métier pure (rôles, validation, import CSV, QR, profil, classement)
src/server/        base de données, authentification, dépôts SQL, Server Actions, image, limiteurs
src/components/    primitives d'interface, mise en page, marque
src/app/           routes (auth, onboarding, adhésion, pointage, espace du club a/[academyId]/*)
db/migrations/     schéma, RLS, fonctions (une migration par fonctionnalité)
tests/             unit, db (PostgreSQL embarqué), e2e (Playwright)
docs/              exploitation, sécurité, RGPD, PWA, QR, rôles, architecture
v0/, discovery/, ops/   moteur de brief hebdomadaire autonome et matériel de découverte (non branchés à l'application)
```

## Documentation

[Pilote du club](docs/pilot.md) · [PWA mobile](docs/pwa.md) · [pointage QR](docs/qr-checkin.md) · [réservations et liste d'attente](docs/bookings.md) · [démarrage et migrations](docs/setup.md) · [sécurité](docs/security.md) · [RGPD](docs/privacy-gdpr.md) · [rôles](docs/roles.md) · [architecture](docs/architecture.md) · [exploitation](docs/operations.md) · [Nginx](docs/nginx.md) · [déploiement sur le VPS](docs/deploy-vps.md) · vision produit : [PRODUCT_ARCHITECTURE.md](PRODUCT_ARCHITECTURE.md) · audit : [AUDIT_INITIAL.md](AUDIT_INITIAL.md).

---

# Contexte produit et pilote

## CoachOS — nom de code interne

> **Nom public : Matnexa** (depuis le 13/10/2026). `coachos` reste le nom de code interne : dépôt, rôles PostgreSQL, services et scripts.

## La thèse en une phrase

> Ton logiciel te dit qui est venu. Nous te disons à qui parler.

## La seule question à laquelle ce dépôt doit répondre

**Est-ce qu'un coach change son comportement une fois par semaine parce qu'un logiciel le lui a demandé ?**

Si oui → il y a une entreprise. Si non → rien d'autre n'a d'importance (ni la stack, ni le pricing, ni le moat).

## Ce qu'on construit — et ce qu'on ne construit pas

| On construit | On ne construit PAS |
|---|---|
| Le Brief hebdo : 5 noms, 5 raisons factuelles, 5 actions | Paiements, facturation, CRM, planning, site web |
| La boucle de retour en 1 geste (Parlé / Revenu / Perdu) | Score de churn en pourcentage |
| Le rapport de valeur hebdo | Apps natives iOS / Android |
| Une fiche élève minimale (timeline) | Curriculum intelligence, progression automatique de grade |
| L'import CSV | Intégrations API avec les logiciels existants (phase 3 au plus tôt) |

**Élèves mineurs : hors périmètre du MVP.** RGPD art. 8 + art. 9 (mentions de blessure = donnée de santé).
Adultes uniquement, pas de donnée de santé, audio transcrit puis supprimé, hébergement UE.

## Phase actuelle

```
[ EN COURS ] PHASE 1 — Discovery         J1 → J14   → discovery/
[ PRÊT     ] PHASE 2 — V0 concierge      J15 → J45  → v0/
[ BLOQUÉ   ] PHASE 3 — MVP logiciel      Mois 2     ← interdit avant le GO de la phase 2
```

## Critères GO / NO-GO (écrits avant d'être amoureux du projet)

| Étape | Critère GO | Échéance |
|---|---|---|
| Discovery | 15 entretiens ; **>= 10 décrivent spontanément** « je perds des élèves sans le voir », **sans que tu le suggères** | J+21 |
| Engagement | **>= 5 coachs** donnent un export CSV **et** un créneau hebdo de 15 min | J+28 |
| V0 concierge | **>= 3 coachs ouvrent le brief 3 semaines sur 4** ET citent **au moins un nom** de personne à qui ils ont parlé grâce à lui | J+56 |
| Premier euro | **>= 1 paiement de 29 $** via un lien Stripe, **avant** que le produit existe | J+45 |
| Rétention | À S12 : **>= 60 % des pilotes** encore actifs **sans relance de ta part** | Mois 3 |

**STOP si** : moins de 6 entretiens sur 15 nomment le problème spontanément ; ou aucun coach ne peut citer un élève sauvé après 4 semaines ; ou personne ne paie 29 $ après 15 entretiens.

**PIVOT si** : le problème est confirmé mais le brief est ignoré → le signal doit venir des élèves, pas du coach. (Terrain occupé par BJJ Notes — à évaluer sérieusement avant de s'y engager.)

## ICP v1

Propriétaire-coach d'une académie **JJB / MMA commerciale anglophone** (US/UK/AU/IE/NL),
**80–200 membres adultes**, qui enseigne lui-même 4+ cours/semaine
et **paie déjà un logiciel qu'il ne changera pas**.

> Rappel inconfortable : tes pilotes seront français, tes clients payants seront anglophones.
> La France est le laboratoire, pas le marché. (Cotisation 100–300 €/an, modèle associatif, HelloAsso gratuit.)

## Prix

**29 $/mois flat par académie**, coachs et élèves illimités. 290 $/an.
Pas d'essai gratuit en libre-service — un **pilote nominatif de 4 semaines avec date de fin**.
Palier « Academy » à 79 $ au mois 9, **seulement** si le rapport de valeur prouve des retours.

## Arborescence

```
discovery/   Phase 1 — tout ce qu'il faut pour les 14 prochains jours
  01-verbatim-hunt.md    2 h de chasse aux verbatims (le signal Reddit/Facebook)
  02-outreach.md         Scripts de recrutement (Insta / WhatsApp / e-mail / en salle) FR + EN
  03-interview-script.md Le script d'entretien 20 min
  04-scoring.md          Comment scorer un entretien sans se mentir
  interviews.csv         Le tracker

v0/          Phase 2 — le concierge (TON outil, pas le produit du client)
  RULES.md               Spécification des règles déterministes
  brief.mjs              Générateur de brief : CSV -> WhatsApp + Markdown + JSON
  make-demo.mjs          Génère une académie synthétique pour tester
  data/                  Les CSV des coachs pilotes
  out/                   Les briefs générés

ops/
  pilot-offer.md         L'offre pilote 4 semaines (à envoyer telle quelle)
  weekly-loop.md         Ton rituel hebdomadaire de fondateur
```

## Démarrage rapide

```bash
cd /d/Projects/coachos/v0
node make-demo.mjs                     # crée une académie synthétique de test
node brief.mjs data/demo-academy.csv   # génère le brief
```
