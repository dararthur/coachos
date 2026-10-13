# Pilote du club — préparation et contrôles

**Règle absolue : aucune donnée personnelle réelle** (noms, e-mails de vrais membres) **tant que la section « Contrôles indispensables » n'est pas entièrement validée et signée.** Avant cela : comptes de test et données synthétiques (`npm run db:seed-demo`).

> Ce document ne crée, ne déploie et n'achète rien. Chaque étape qui touche un service externe ou le serveur est à exécuter volontairement par le responsable du projet, après autorisation explicite. **L'architecture auto-hébergée (Better Auth + PostgreSQL) n'est pas prête pour la production** : Nginx réel, HTTPS public, envoi réel d'e-mails et critères N1 à N6 (`docs/self-hosted-auth.md` §9) restent à valider.

## 1. Vérifier le dépôt depuis un clone propre

```bash
git clone https://github.com/dararthur/coachos.git && cd coachos
git checkout feature/self-hosted-infra
npm ci
npm run check                        # types, lint, tests unitaires + base de données, scan de secrets
PW_CHANNEL=chrome npm run test:e2e   # (ou npx playwright install chromium puis npm run test:e2e)
```

Cette séquence prouve le comportement de l'application, de la RLS et de Better Auth sur un PostgreSQL 17 embarqué avec une boîte d'envoi d'e-mails de test. Elle ne prouve rien sur Nginx, HTTPS, Resend ni le PostgreSQL du serveur : voir sections 3 et 4.

## 2. Variables d'environnement (noms uniquement — valeurs hors Git)

| Variable | Obligatoire | Secrète | Rôle / comment la produire |
|---|:-:|:-:|---|
| `DATABASE_URL` | ✅ | **oui** | connexion du rôle `app_server` (données métier, RLS). SSL (`?sslmode=require`) pour une base distante |
| `AUTH_DATABASE_URL` | ✅ | **oui** | connexion du rôle `auth_runtime` (tables d'authentification seulement) — différent d'`app_server` |
| `SITE_URL` | ✅ | non | URL publique **https** exacte du pilote (liens d'e-mail, d'invitation et de pointage ; origine de confiance) |
| `APP_SECRET` | ✅ | **oui** | ≥ 32 caractères aléatoires (`openssl rand -base64 48`) ; pseudonymise IP et e-mails |
| `BETTER_AUTH_SECRET` | ✅ | **oui** | ≥ 32 caractères, **distinct** d'`APP_SECRET` ; signe les cookies de session ; **jamais avec la base ni ses sauvegardes** |
| `MAIL_PROVIDER` | ✅ | non | `resend` pour un pilote. `outbox` est **refusé au démarrage du serveur** avec `APP_ENV=staging`/`production` (et avec toute `SITE_URL` non locale) et par le préflight |
| `RESEND_API_KEY`, `MAIL_FROM` | avec `resend` | clé : **oui** | clé API Resend (gestionnaire de secrets) ; expéditeur d'un domaine vérifié |
| `CRON_SECRET` | ✅ avant données réelles | **oui** | ≥ 32 caractères ; active `POST /api/cron/purge` (rétention + sessions expirées) |
| `APP_ENV` | ✅ | non | `staging` (puis `production`) : rôle explicite de l'instance, sans valeur par défaut ; lu **au démarrage** (refus si incohérent) et par le préflight pour refuser un contrôle accidentel de la production |
| `DATABASE_SSL`, `DATABASE_POOL_SIZE` | non | non | `disable` uniquement pour une base locale ; taille du pool (défaut 10) |
| `CHECKIN_TOKEN_TTL_SECONDS` | non | non | durée du QR (10–300 s, défaut 90) |

Le gestionnaire de secrets / l'environnement du service porte ces valeurs ; elles ne figurent ni dans Git, ni dans les journaux, ni dans les captures d'écran. Aucune variable `SUPABASE_*` ni `*SERVICE_ROLE*` ne doit exister.

## 3. Environnement de préproduction (distinct de toute production)

À faire par le responsable (aucune ressource n'a été créée, aucun accès au serveur n'a été pris) :

1. Base PostgreSQL **dédiée** à la préproduction, en écoute locale uniquement (jamais exposée sur Internet), jamais de données de production dedans.
2. Appliquer les migrations avec un rôle administrateur : `for f in db/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -d <base> -f "$f"; done` (8 migrations).
3. Créer les mots de passe des deux rôles (jamais dans Git) : `alter role app_server login password '…'; alter role auth_runtime login password '…';` puis construire `DATABASE_URL` et `AUTH_DATABASE_URL`.
4. Domaine d'envoi chez le fournisseur d'e-mails, vérifié (SPF, DKIM), DMARC progressif, **suivi des ouvertures/clics désactivé** ; DPA du fournisseur archivé (`docs/privacy-gdpr.md`).
5. Hébergement : processus Node ≥ 22 sous un utilisateur dédié, écoute sur `127.0.0.1`, derrière un reverse proxy TLS qui **écrase** `X-Real-IP`/`X-Forwarded-For` (`ops/nginx-self-hosted.example.conf`). Planifier chaque jour `POST $SITE_URL/api/cron/purge` avec `Authorization: Bearer $CRON_SECRET`.
6. **Sauvegardes** chiffrées hors du serveur, avec une clé et un secret de session séparés ; **tester une restauration** sur une base jetable (D5).

## 4. Contrôles indispensables avant toute donnée réelle

### 4.1 Automatisés — `npm run pilot:preflight`

```bash
node --env-file=.env.staging scripts/pilot-preflight.mjs        # fichier d'environnement hors Git
```

Vérifie, **sans afficher de secret** : variables requises et cohérentes (https, rôles `app_server` et `auth_runtime` et non `postgres`, secrets de 32+ caractères et distincts, fournisseur d'e-mail réel, aucune variable `SUPABASE_*`/service_role) ; connexion `app_server` (NOINHERIT, ni superuser ni BYPASSRLS, **aucun droit direct sur les tables**) ; RLS active sur toutes les tables ; `anon` sans accès ; `SET LOCAL ROLE authenticated` + claims fonctionnels ; un utilisateur inconnu ne lit rien et ne peut rien écrire ; toutes les migrations présentes ; SSL ; connexion `auth_runtime` (ni superuser, aucun droit métier, aucun DDL, tables d'authentification présentes, **fermées à tout autre rôle**). Sortie ≠ 0 au moindre échec.

Statut : le script et ses règles sont testés (`tests/db/preflight.test.ts`, contre un vrai PostgreSQL). **Il n'a jamais été exécuté contre l'environnement de préproduction** : c'est le premier contrôle à faire.

### 4.2 Manuels — à cocher, avec date et initiales

| # | Contrôle | Comment | OK |
|---|---|---|:-:|
| A1 | Inscription + e-mail de confirmation **réellement reçu** (fournisseur réel, domaine vérifié, SPF/DKIM/DMARC « pass » dans les en-têtes) | adresse de test | ☐ |
| A2 | Connexion refusée tant que l'e-mail n'est pas confirmé ; lien falsifié/expiré refusé | tenter avant de cliquer | ☐ |
| A3 | Réinitialisation de mot de passe de bout en bout ; les autres appareils sont déconnectés | lien reçu → nouveau mot de passe → connexion | ☐ |
| A4 | Session conservée entre deux visites, déconnexion effective, cookie `__Secure-…` `Secure` `HttpOnly` en HTTPS public | navigateur réel | ☐ |
| A5 | Quotas d'envoi du fournisseur compatibles avec ~30 invitations/jour et les pics d'inscription | consulter l'offre en vigueur | ☐ |
| P1 | L'application fonctionne de bout en bout derrière Nginx (écriture + lecture + import CSV de 200 lignes) | parcours réel en préproduction | ☐ |
| P2 | Deux utilisateurs alternent rapidement sans fuite de rôle entre requêtes | 2 navigateurs, actions rapides | ☐ |
| N1 | `X-Real-IP` / `X-Forwarded-For` falsifiés écrasés par Nginx (la limite par IP s'applique) | requêtes avec en-têtes forgés | ☐ |
| N2–N6 | HTTPS/HSTS, ports fermés, journaux Nginx sans jeton, journaux Next.js, rotation | `docs/self-hosted-auth.md` §9 | ☐ |
| R1 | **Isolation** : club A et club B, deux comptes ; chacun tente les URL de l'autre (pages, exports, fiche) → 404/403 | voir `tests/e2e/security.spec.ts` comme script | ☐ |
| R2 | Rôles : un coach n'a ni Paramètres, ni import, ni export ; un membre ne voit que son espace | comptes de chaque rôle | ☐ |
| I1 | **Invitation** : lien ouvert sur **iPhone (Safari)** et **Android (Chrome)**, compte créé et confirmé, rattachement à la fiche | adresse de test | ☐ |
| I2 | Invitation à usage unique, expirée après 7 jours, inopérante avec une autre adresse ou un e-mail non confirmé | rejouer le lien | ☐ |
| D1 | **Effacement d'un membre** (anonymiser puis supprimer) : plus aucune trace du nom dans l'app et les exports | membre de test | ☐ |
| D2 | **Suppression de compte** : l'utilisateur disparaît de `auth.users`, `auth.sessions`, `auth.accounts` et `profiles` ; refus s'il est seul propriétaire | compte de test, requêtes SQL de contrôle | ☐ |
| D3 | **Suppression du club** : toutes les tables vides pour ce club | club de test, requêtes SQL de contrôle | ☐ |
| D4 | Purge : `curl -X POST -H "Authorization: Bearer $CRON_SECRET" $SITE_URL/api/cron/purge` renvoie les compteurs (dont `auth_sessions_deleted`) ; sans jeton → 404 | commande | ☐ |
| D5 | **Restauration d'une sauvegarde chiffrée** testée sur une base jetable ; `BETTER_AUTH_SECRET` absent de la sauvegarde | procédure documentée | ☐ |
| Q1 | Pointage QR sur **vrais téléphones** : permission caméra, scan en lumière de salle, expiration, lien de secours | séance de test avec 3 personnes | ☐ |
| Q2 | Installation écran d'accueil (iOS et Android) selon `docs/pwa.md` | deux appareils | ☐ |
| L1 | Notice `/privacy` complétée et validée juridiquement ; registre des traitements fait ; DPA des sous-traitants signés (hébergeur, fournisseur d'e-mails, stockage de sauvegardes) | `docs/privacy-gdpr.md` | ☐ |
| L2 | Information des adhérents (mention + contact) prête | modèle du club | ☐ |

**Go / No-Go** : tout ☐ coché et signé par le responsable du projet **et** la personne en charge de la protection des données du club. Un seul ✘ = No-Go. Aucun adhérent n'est inscrit avant.

## 5. Déroulé du pilote (une fois le Go donné)

1. **Semaine 0 — mise en place** : le propriétaire crée le club, les disciplines et types de cours réels, les séances récurrentes du trimestre (≤ 6 mois, ≤ 200 séances par lot), invite les coachs (un compte chacun).
2. **Semaine 0 — adhérents** : adultes uniquement, **sans donnée de santé**. Importer le CSV de l'ancien outil (colonnes inutiles ignorées ; relire le rapport de rejets), puis inviter par e-mail les adhérents qui pointeront eux-mêmes (rôle « membre » + fiche liée). **Parcours réel d'un nouvel adhérent** (le lien d'invitation est transmis à la main, l'application n'envoie pas d'e-mail d'invitation) : ouvrir le lien → « Créer un compte » avec **la même adresse que l'invitation** → cliquer le lien de confirmation reçu par e-mail (il mène à la connexion) → se connecter → **rouvrir le lien d'invitation** → accepter. Prévoir de l'expliquer aux adhérents (ou de les accompagner la première fois).
3. **Semaines 1–2 — appel sur téléphone par un seul coach** ; vérifier chaque soir la liste, corriger, valider la feuille. Noter dans `notes-produit.md` les frictions (temps d'appel, scans ratés, adhérents sans compte, e-mails de confirmation perdus).
4. **Semaines 3–4 — pointage QR** sur un cours de confiance, puis généralisation si ≥ 80 % des présents pointent sans aide.
5. **Rétrospective** : garder/jeter chaque fonction selon l'usage réel ; mesurer le temps d'appel avant/après.
6. **Fin ou arrêt** : exporter (CSV), puis supprimer les données de test ; purge automatique des archivés selon `retention_months`.

## 6. Incidents et retour arrière

- Aucun déploiement automatique : l'application tourne sur un environnement de préproduction nommé ; en cas de doute, couper l'accès (retirer l'URL) et conserver les journaux.
- Suspicion de fuite : suivre la procédure de `docs/privacy-gdpr.md` (confinement : changer `BETTER_AUTH_SECRET` — toutes les sessions sont invalidées —, supprimer `auth.sessions` si la table a fuité, faire tourner `APP_SECRET`, `CRON_SECRET`, `RESEND_API_KEY` et les mots de passe `app_server`/`auth_runtime`).
- Les migrations sont **additives** ; ne jamais modifier une migration déjà appliquée sur un environnement partagé.
