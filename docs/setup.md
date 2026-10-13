# Démarrage, migrations et exploitation

> Statut de vérification : les commandes **npm** de ce document (installation, typecheck, lint, tests unitaires, tests base de données, build, e2e) ont été exécutées avec succès sur Windows 11 / Node 24 avec un PostgreSQL 17 embarqué. Les commandes **psql / serveur réel** (création des rôles, base distante, Nginx) sont écrites d'après la documentation de PostgreSQL et marquées *(non vérifié)*. Rien n'a été déployé.

## Prérequis

- Node.js ≥ 22 (développé avec 24) et npm.
- PostgreSQL 17 (testé en 17.10 embarqué) pour un environnement réel ; aucun Docker n'est requis pour les tests.
- Pour les e2e en local : Chrome ou Edge installé (`PW_CHANNEL=chrome`), sinon `npx playwright install chromium`.

```bash
npm ci
```

## Vérifier le dépôt (sans Docker, sans serveur externe, sans compte)

```bash
npm run typecheck        # TypeScript strict
npm run lint
npm run test:unit        # règles métier, modèles d'e-mail, adaptateur Resend (faux fetch), journal assaini
npm run test:db          # PostgreSQL 17 embarqué : migrations + RLS + isolation + RGPD + Better Auth
npm run audit:secrets    # aucun secret dans les fichiers versionnés
npm run audit:deps       # npm audit (dépendances de production)
PW_CHANNEL=chrome npm run test:e2e   # build + parcours complet dans un vrai navigateur
```

`npm run test:db` et `npm run test:e2e` démarrent un **vrai PostgreSQL** (binaires `embedded-postgres`) et appliquent **toutes** les migrations de `db/migrations/` (le socle de plateforme — rôles, schéma `auth`, tables Better Auth — est la migration `…0000`). Better Auth y est exécuté pour de vrai ; seule la boîte d'envoi d'e-mails est remplacée par un fichier (`MAIL_PROVIDER=outbox`). Ces tests ne prouvent rien sur Resend, Nginx, HTTPS public ni le PostgreSQL de votre serveur : voir `docs/self-hosted-auth.md` §9.

## Lancer l'application en local *(non vérifié sur un PostgreSQL externe)*

1. Créer une base, puis appliquer les migrations avec le **lanceur** (transactionnel, suivi, vérifié) et l'URL d'un rôle **administrateur** (la migration 0000 crée des rôles ; jamais `app_server` ni `auth_runtime`) :

```bash
createdb coachos
MIGRATION_DATABASE_URL=postgresql://<admin>:<mot-de-passe>@127.0.0.1:5432/coachos npm run db:migrate -- --dry-run   # liste ce qui serait appliqué, n'écrit rien
MIGRATION_DATABASE_URL=postgresql://<admin>:<mot-de-passe>@127.0.0.1:5432/coachos npm run db:migrate
```

2. Créer les mots de passe des deux rôles de connexion — **hors Git**, une fois par base :

```sql
alter role app_server  login password '<mot de passe généré, 32+ caractères>';
alter role auth_runtime login password '<autre mot de passe généré, 32+ caractères>';
```

`app_server` est `NOINHERIT` et n'a aucun droit sur les tables : il ne peut qu'exécuter `SET ROLE authenticated` (RLS appliquée) et appeler le limiteur de débit et les purges. `auth_runtime` n'a que le DML sur `auth.*`. Aucun des deux n'est superutilisateur.

3. Configurer l'environnement : `cp .env.example .env.local` puis renseigner :

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | connexion du rôle `app_server` |
| `AUTH_DATABASE_URL` | connexion du rôle `auth_runtime` (différent) |
| `SITE_URL` | URL publique exacte (https en production) |
| `APP_SECRET` | ≥ 32 caractères, pseudonymise IP et e-mails (compteurs, sessions) |
| `BETTER_AUTH_SECRET` | ≥ 32 caractères, **distinct** d'`APP_SECRET`, signe les cookies de session. **Jamais avec la base ni ses sauvegardes** (`docs/self-hosted-auth.md` §4) |
| `APP_ENV` | **obligatoire**, sans valeur par défaut : `development` | `test` | `staging` | `production`. Ne se déduit pas de `NODE_ENV` (les tests e2e tournent aussi en mode production) |
| `MAIL_PROVIDER` | `resend` (+ `RESEND_API_KEY`, `MAIL_FROM`) pour `staging`/`production` ; `outbox` (aucun envoi, liens écrits **en clair** dans un fichier) **uniquement** avec `APP_ENV=development` ou `test` **et** une `SITE_URL` locale. Sinon le serveur refuse de démarrer |
| `MAIL_OUTBOX_FILE` | avec `outbox` : fichier recevant les liens (développement uniquement) |
| `CRON_SECRET` | optionnel, active `POST /api/cron/purge` |
| `CHECKIN_TOKEN_TTL_SECONDS` | optionnel, durée du QR de pointage (10–300 s, défaut 90) |
| `DATABASE_SSL`, `DATABASE_POOL_SIZE` | `disable` interdit pour une base distante ; taille du pool. Base **distante** (staging/production) : `?sslmode=require` obligatoire dans `DATABASE_URL` **et** `AUTH_DATABASE_URL`, sinon refus au démarrage |
| `MIGRATION_DATABASE_URL` | URL d'un rôle **administrateur**, réservée à `npm run db:migrate` et au préflight ; **jamais** dans l'environnement du service |

4. `npm run dev`. Avec `MAIL_PROVIDER=outbox`, les liens de confirmation et de réinitialisation sont écrits dans `MAIL_OUTBOX_FILE` (une ligne JSON par message). Créez un compte sur `/signup`, ouvrez le lien trouvé dans ce fichier, connectez-vous, puis créez votre club. Données de démonstration **synthétiques** (base locale uniquement) :

```bash
SEED_DATABASE_URL=postgresql://postgres:<mdp-local>@127.0.0.1:5432/coachos npm run db:seed-demo -- --academy <uuid-du-club>
npm run db:seed-demo -- --academy <uuid> --purge     # les retirer
```

## Pilote et préproduction

Voir [`docs/pilot.md`](pilot.md) et `npm run pilot:preflight`. Authentification : [`docs/self-hosted-auth.md`](self-hosted-auth.md). Mobile/PWA : [`docs/pwa.md`](pwa.md). Pointage QR : [`docs/qr-checkin.md`](qr-checkin.md).

## Migrations

- Fichiers SQL versionnés et ordonnés : `db/migrations/AAAAMMJJHHMMSS_nom.sql`, appliqués par `npm run db:migrate` (`scripts/migrate.mjs`, rôle administrateur, `MIGRATION_DATABASE_URL` jamais affichée). Le lanceur : applique **chaque fichier dans une transaction avec son suivi** (un échec n'en laisse rien ; la correction puis la relance reprennent au fichier fautif) ; enregistre version, nom et **empreinte SHA-256** dans `coachos_migrations.applied` (schéma fermé aux rôles applicatifs) ; **refuse** un fichier appliqué puis modifié, un fichier appliqué disparu et une migration en attente plus ancienne qu'une appliquée ; prend un verrou (pas de double exécution) ; **refuse une base vierge si `anon`, `authenticated`, `app_server` ou `auth_runtime` existent déjà dans le cluster sans le marqueur Coach OS** (rôles globaux d'une autre application : migration 0008 pose le marqueur) ; évalue la version de PostgreSQL (cible 17, minimum 15, 15/16/18 signalées « non testées »). **Ne jamais modifier une migration déjà appliquée** sur un environnement partagé : en ajouter une nouvelle. (Les migrations 0001–0006 n'ont jamais été appliquées ailleurs qu'en test ; 0007 les adapte à Better Auth.)
- Chaque migration est rejouée par `npm run test:db`, et une seconde fois sur une base vierge (`tests/db/migrations-replay.test.ts`) ; la CI les rejoue aussi sur PostgreSQL 17 standard (job `postgres-migrations`). Les invariants de sécurité (RLS partout, `anon` sans privilège, fonctions `SECURITY DEFINER` à `search_path` vide, liste blanche des fonctions exposées, tables d'authentification fermées) échouent si une migration les viole.
- Le schéma de Better Auth est versionné dans la migration 0000 ; le test `tests/db/auth-integration.test.ts` échoue si une mise à jour de Better Auth attend un schéma différent.

## Environnements

| | Développement | Préproduction | Production |
|---|---|---|---|
| Base PostgreSQL | locale | base dédiée | base dédiée |
| Données | synthétiques | synthétiques | réelles (après revue juridique et validation de `docs/pilot.md`) |
| Secrets | `.env.local` | gestionnaire de secrets / environnement du service | idem, rotation documentée |
| E-mails | `outbox` | `resend` (domaine de test) | `resend` |

Ne partagez **aucun** secret entre environnements. Pas de données de production en préproduction.

## Déploiement *(non vérifié, aucun déploiement n'a été effectué)*

1. Processus Node (≥ 22) sous un utilisateur système dédié, lancé par `npm run start` (= `next start -H 127.0.0.1`, **écoute locale imposée par le script**, vérifiée par `tests/e2e/startup-guards.spec.ts` ; ne pas la contourner dans l'unité de service). Le port se fixe avec `PORT` ou `-- -p <port>`. **Au démarrage**, le serveur valide toute sa configuration (`src/instrumentation.ts`) et **s'arrête avec le code 1** si elle est absente, incohérente ou interdite (ex. `MAIL_PROVIDER=outbox` avec `APP_ENV=production`) : aucun port ne reste ouvert, le message ne cite que des noms de variables.
2. Reverse proxy (Nginx) terminant TLS et **écrasant** `X-Real-IP` / `X-Forwarded-For` : exemple non appliqué dans `ops/nginx-self-hosted.example.conf`. Critères N1–N6 de `docs/self-hosted-auth.md` §9 à valider.
3. PostgreSQL en écoute locale uniquement (jamais sur Internet), base et rôles dédiés ; `pg_hba.conf` restreint.
4. Planifier chaque jour `POST $SITE_URL/api/cron/purge` (en-tête `Authorization: Bearer $CRON_SECRET`) — purge de rétention métier **et** des sessions/jetons d'authentification expirés.
5. Sauvegardes chiffrées hors du serveur, **secret de session séparé**, restauration testée avant la production.

## Dépannage

- `Configuration invalide ou incomplète : …` : une variable d'environnement manque (seuls les noms sont affichés).
- `permission denied for table …` côté app : normal si une requête n'est pas passée par `withUser()` (voir `src/server/db/client.ts`) — c'est le garde-fou voulu.
- Les liens de confirmation n'arrivent pas : avec `MAIL_PROVIDER=outbox`, ouvrir `MAIL_OUTBOX_FILE` ; avec `resend`, voir les journaux (`auth.mail_failed`, sans donnée personnelle) et le tableau de bord du fournisseur.
- `embedded-postgres` refuse de démarrer en administrateur : lancer les tests avec un utilisateur normal.
