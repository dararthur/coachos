# Démarrage, migrations et exploitation

> Statut de vérification : les commandes **npm** de ce document (installation, typecheck, lint, tests unitaires, tests base de données, build, e2e) ont été exécutées avec succès sur Windows 11 / Node 24. Les commandes **Supabase CLI / Docker** n'ont **pas** pu être exécutées lors du développement (Docker absent) : elles sont écrites d'après la documentation officielle et marquées *(non vérifié)*.

## Prérequis

- Node.js ≥ 22 (développé avec 24) et npm.
- Pour la pile Supabase locale : Docker + [Supabase CLI](https://supabase.com/docs/guides/local-development) *(non vérifié ici)*.
- Pour les e2e en local : Chrome ou Edge installé (`PW_CHANNEL=chrome`), sinon `npx playwright install chromium`.

```bash
npm ci
```

## Vérifier le dépôt (sans Docker ni compte Supabase)

```bash
npm run typecheck        # TypeScript strict
npm run lint
npm run test:unit        # règles métier : dates, CSV, permissions, validation
npm run test:db          # PostgreSQL 17 embarqué : migrations + RLS + isolation + RGPD
npm run audit:secrets    # aucun secret dans les fichiers versionnés
npm run audit:deps       # npm audit (dépendances de production)
PW_CHANNEL=chrome npm run test:e2e   # build + parcours complet dans un vrai navigateur
```

`npm run test:db` et `npm run test:e2e` démarrent un **vrai PostgreSQL** (binaires `embedded-postgres`), appliquent **toutes** les migrations de `supabase/migrations/` puis exécutent les tests. Le schéma `auth` et les rôles Supabase (`anon`, `authenticated`) y sont imités par `tests/support/supabase-shim.sql`. Pour l'e2e, un **faux GoTrue** (`tests/e2e/support/mock-auth.mjs`, tests uniquement) remplace Supabase Auth. Conséquence : ces tests prouvent le comportement de la RLS et de l'application, **pas** celui de Supabase Auth ni du pooler Supabase ; la CI rejoue les migrations sur la pile Supabase officielle (job `supabase-migrations`).

## Lancer l'application en local avec Supabase *(non vérifié)*

```bash
supabase start                      # Postgres, Auth, boîte mail de dev (Inbucket :54324)
supabase db reset                   # applique supabase/migrations/* + seed.sql (vide)
cp .env.example .env.local          # puis renseigner :
```

Variables (`.env.example` documente chaque valeur) :

| Variable | Rôle |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | API Auth. Clé *publishable/anon* uniquement. **Jamais la clé `service_role`.** |
| `DATABASE_URL` | Connexion du rôle `app_server` (voir ci-dessous) |
| `SITE_URL` | URL publique (https en production) pour les liens d'e-mail et d'invitation |
| `APP_SECRET` | ≥ 32 caractères aléatoires, pseudonymise les clés de limitation de débit |
| `CRON_SECRET` | optionnel, active `POST /api/cron/purge` |
| `APP_ENV` | optionnel (`staging`), lu par `npm run pilot:preflight` |
| `CHECKIN_TOKEN_TTL_SECONDS` | optionnel, durée du QR de pointage (10–300 s, défaut 90) |

Créer le mot de passe du rôle applicatif — **hors Git**, une fois par base (SQL editor Supabase ou `psql`) :

```sql
alter role app_server login password '<mot de passe généré, 32+ caractères>';
```

`app_server` est `NOINHERIT` et n'a aucun droit sur les tables ; il ne peut qu'exécuter `SET ROLE authenticated` (RLS appliquée) et appeler le limiteur de débit et la purge. Ensuite :

```bash
npm run dev
```

Créez un compte sur `/signup` (confirmez par l'e-mail Inbucket), puis votre club. Données de démonstration **synthétiques** (base locale uniquement) :

```bash
SEED_DATABASE_URL=postgresql://postgres:<mdp-local>@127.0.0.1:54322/postgres npm run db:seed-demo -- --academy <uuid-du-club>
npm run db:seed-demo -- --academy <uuid> --purge     # les retirer
```

## Pilote et préproduction

Voir [`docs/pilot.md`](pilot.md) (variables, projet Supabase de préproduction, contrôles avant toute donnée réelle) et `npm run pilot:preflight`. Mobile/PWA : [`docs/pwa.md`](pwa.md). Pointage QR : [`docs/qr-checkin.md`](qr-checkin.md).

## Migrations

- Fichiers SQL versionnés et ordonnés : `supabase/migrations/AAAAMMJJHHMMSS_nom.sql`. **Ne jamais modifier une migration déjà appliquée** sur un environnement partagé : en ajouter une nouvelle.
- Local : `supabase db reset` (rejoue tout), `supabase migration new <nom>` pour en créer une *(non vérifié)*.
- Distant : `supabase link --project-ref <ref>` puis `supabase db push` *(non vérifié)*. Tester d'abord sur un projet de **préproduction**.
- Chaque migration est rejouée par `npm run test:db` ; les invariants de sécurité (RLS partout, `anon` sans privilège, fonctions `SECURITY DEFINER` à `search_path` vide, liste blanche des fonctions exposées) sont dans `tests/db/schema-invariants.test.ts` et échouent si une migration les viole.

## Environnements

| | Développement | Préproduction | Production |
|---|---|---|---|
| Projet Supabase | `supabase start` local | projet dédié | projet dédié, région UE |
| Données | synthétiques | synthétiques | réelles (après revue juridique) |
| Secrets | `.env.local` | gestionnaire de secrets de l'hébergeur | idem, rotation documentée |

Ne partagez **aucune** clé entre environnements. Pas de données de production en préproduction.

## Déploiement *(non vérifié, aucun déploiement n'a été effectué)*

1. Hébergeur Node (ex. Vercel) : variables ci-dessus ; `DATABASE_URL` = **pooler transactionnel** (port 6543, SSL actif ; l'app utilise `prepare: false`).
2. Désactiver la **Data API** (PostgREST) du projet Supabase : elle n'est pas utilisée.
3. Auth : activer la confirmation d'e-mail, mots de passe ≥ 12, URL de redirection = `SITE_URL/auth/callback`, SMTP personnalisé (limites du SMTP par défaut très basses).
4. Planifier `POST $SITE_URL/api/cron/purge` (en-tête `Authorization: Bearer $CRON_SECRET`) **chaque jour** — c'est la purge de rétention (docs/privacy-gdpr.md).
5. Derrière un proxy/CDN, s'assurer que `X-Forwarded-For` est **écrasé** par le proxy (la limitation de débit par IP s'y fie).
6. Sauvegardes : activer les sauvegardes quotidiennes + PITR du projet ; **tester une restauration** avant la mise en production.

## Dépannage

- `Configuration invalide ou incomplète : …` : une variable d'environnement manque (seuls les noms sont affichés).
- `permission denied for table …` côté app : normal si une requête n'est pas passée par `withUser()` (voir `src/server/db/client.ts`) — c'est le garde-fou voulu.
- `embedded-postgres` refuse de démarrer en administrateur : lancer les tests avec un utilisateur normal.
