# Architecture de l'application

Monolithe modulaire Next.js 16 (App Router) + PostgreSQL/Supabase. Complète `PRODUCT_ARCHITECTURE.md` (vision) par ce qui est **réellement implémenté**.

## Structure

```
src/
  domain/            logique métier pure, sans I/O, testée unitairement
    roles.ts           matrice des permissions (source de vérité côté app)
    validation.ts      schémas zod (formulaires, filtres) + messages en français
    csv-import.ts      analyse défensive d'un CSV de membres + plan d'import
    csv-export.ts      sérialisation CSV sûre (injection de formules)
    dates.ts, schedule.ts   dates calendaires strictes, récurrence
    errors.ts          codes d'erreur stables et ActionResult
  server/            exécuté côté serveur uniquement (import "server-only")
    db/client.ts       withUser() : transaction soumise à la RLS ; withApp() ; mapDbError()
    auth/              client Supabase Auth (cookies), gardes d'autorisation, runAction()
    repositories/      requêtes SQL paramétrées par domaine (une fonction = une requête)
    actions/           Server Actions : autorisent, valident, appellent un dépôt, renvoient un ActionResult
    rate-limit.ts, logger.ts, env.ts
  components/ui, layout   primitives accessibles (formulaires, dialogues <dialog>, tableaux)
  app/                 routes : (auth), onboarding, academies, account, a/[academyId]/*
  proxy.ts             rafraîchissement de session + CSP à nonce
supabase/migrations/   schéma, RLS, fonctions (versionnés)
tests/{unit,db,e2e,support}
```

Flux d'une écriture : `Server Action` → `authorizeAcademy(id, permission)` (session vérifiée, appartenance lue sous RLS, rate limit) → `parseForm(schema)` → `inAcademy(ctx, tx => repository…)` → PostgreSQL (RLS + contraintes) → `ActionResult` typé → UI (jamais de succès supposé).

## Décisions

- **SQL direct plutôt que PostgREST** (`postgres.js`, rôle `app_server` → `SET LOCAL ROLE authenticated`) : mêmes politiques RLS que le client Supabase, mais transactions multi-étapes, requêtes typées, et surtout **tests d'intégration exécutables sans Docker** sur un vrai PostgreSQL. Compromis : une connexion base à protéger (rôle sans privilège, pooler transactionnel) et l'obligation de passer par `withUser()` — imposée par les privilèges, pas par la discipline.
- **Fonctions `SECURITY DEFINER` seulement quand la règle dépasse la RLS** (création d'académie, hiérarchie des rôles, invitations, effacement/export) ; chacune re-vérifie l'appelant et fixe `search_path = ''`.
- **Pas de bibliothèque de composants** : primitives maison minimales (≈ 600 lignes) construites sur des éléments natifs (`<dialog>`, `<select>`, validation HTML) pour l'accessibilité et la CSP stricte.
- **Français uniquement** pour l'instant ; les libellés métier sont regroupés (`domain/*`), l'internationalisation viendra avec un second marché (voir questions ouvertes dans `PRODUCT_ARCHITECTURE.md`).
- **Paiements, réservations par les membres, IA : volontairement absents** (hors du premier parcours).

## Points d'extension (Coach Briefing, rétention, progression)

Rien de ce qui suit n'est implémenté ; la structure l'anticipe sans écran factice :

1. **Données prêtes** : présences par membre/séance avec horodatage et statut (`attendance`), dernière présence, inactivité 30 jours (`repositories/dashboard.ts › listInactiveMembers` est déjà un premier signal factuel et explicable).
2. **Module `src/domain/briefing/`** (à créer) : règles déterministes pures `(historique de présences, date de référence, fuseau) → signaux explicables`, testées par caractérisation contre `v0/brief.mjs` (à d'abord corriger : séances multiples par jour, dates ambiguës — voir `AUDIT_INITIAL.md`).
3. **Tables** (migration future) : `brief_runs`, `brief_items` (raison factuelle + règle + données sources), `coach_actions` (retour du coach : parlé / revenu / perdu), avec `academy_id`, clés composites et RLS identiques aux tables existantes. Le test `schema-invariants` les imposera.
4. **Page `/a/[id]/brief`** : lecture seule des `brief_items` ; l'IA, si elle est un jour utilisée, ne fait que **reformuler** un signal déjà choisi, sans données personnelles (voir `docs/privacy-gdpr.md`).
5. **Progression / grades** : `member_discipline_ranks` rattachée à `people` et `disciplines` (déjà configurables par club).
