# Coach OS

> **Application (branche `feature/mvp-vertical-slice`)** — SaaS multi-tenant de gestion de club (JJB, grappling, MMA) : Next.js 16 · TypeScript strict · Tailwind · PostgreSQL/Supabase avec RLS. Premier parcours utilisable de bout en bout : compte → club → membres (saisie + import CSV validé) → cours et planning → appel → tableau de bord → historique et exports → droits RGPD.
>
> ```bash
> npm ci
> npm run check            # types, lint, tests unitaires + base de données (PostgreSQL réel), scan de secrets
> PW_CHANNEL=chrome npm run test:e2e   # parcours complet dans un navigateur (build inclus)
> ```
>
> Documentation : [démarrage et migrations](docs/setup.md) · [sécurité](docs/security.md) · [RGPD](docs/privacy-gdpr.md) · [rôles](docs/roles.md) · [architecture](docs/architecture.md) · vision produit : [PRODUCT_ARCHITECTURE.md](PRODUCT_ARCHITECTURE.md), audit : [AUDIT_INITIAL.md](AUDIT_INITIAL.md).
> Le CLI de brief hebdomadaire (`v0/`) reste un moteur autonome, non branché à l'application.

---

# CoachOS — nom de code interne

> **Le nom public sera choisi quand 3 coachs utiliseront le produit.** Pas avant.
> Candidats en attente : Senpai · Roll Call · Mat Check.

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
