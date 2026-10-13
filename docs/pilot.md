# Pilote du club — préparation et contrôles

**Règle absolue : aucune donnée personnelle réelle** (noms, e-mails de vrais membres) **tant que la section « Contrôles indispensables » n'est pas entièrement validée et signée.** Avant cela : comptes de test et données synthétiques (`npm run db:seed-demo`).

> Ce document ne crée, ne déploie et n'achète rien. Chaque étape qui touche un service externe est à exécuter volontairement par le responsable du projet. Les écrans/boutons Supabase cités peuvent évoluer : se fier à la documentation officielle courante.

## 1. Vérifier le dépôt depuis un clone propre

```bash
git clone https://github.com/dararthur/coachos.git && cd coachos
git checkout feature/mvp-vertical-slice
npm ci
npm run check                        # types, lint, tests unitaires + base de données, scan de secrets
PW_CHANNEL=chrome npm run test:e2e   # (ou npx playwright install chromium puis npm run test:e2e)
```

Cette séquence a été exécutée depuis un clone neuf lors de la préparation (résultats dans le compte rendu de livraison). Elle ne prouve rien sur Supabase : voir section 4.

## 2. Variables d'environnement (noms uniquement — valeurs hors Git)

| Variable | Obligatoire | Secrète | Rôle / comment la produire |
|---|:-:|:-:|---|
| `SUPABASE_URL` | ✅ | non | URL du projet de préproduction (`https://<ref>.supabase.co`) |
| `SUPABASE_PUBLISHABLE_KEY` | ✅ | non (publique) | clé « publishable/anon » du projet. **Jamais la clé `service_role`/secrète** (le préflight le contrôle) |
| `DATABASE_URL` | ✅ | **oui** | connexion du rôle `app_server` via le **pooler transactionnel** (port 6543, SSL). Utilisateur de la forme `app_server.<ref>` |
| `SITE_URL` | ✅ | non | URL publique https du pilote (liens d'e-mail, d'invitation et de pointage) |
| `APP_SECRET` | ✅ | **oui** | ≥ 32 caractères aléatoires (ex. `openssl rand -base64 48`) |
| `CRON_SECRET` | ✅ avant données réelles | **oui** | ≥ 32 caractères ; active `POST /api/cron/purge` (purge de rétention) |
| `APP_ENV` | conseillé | non | `staging` ; lu par le préflight pour refuser un contrôle accidentel de la production |
| `DATABASE_SSL`, `DATABASE_POOL_SIZE` | non | non | `disable` uniquement pour une base locale ; taille du pool (défaut 10) |
| `CHECKIN_TOKEN_TTL_SECONDS` | non | non | durée du QR (10–300 s, défaut 90) |

Le gestionnaire de secrets de l'hébergeur porte ces valeurs ; elles ne figurent ni dans Git, ni dans les journaux, ni dans les captures d'écran. Une variable `*SERVICE_ROLE*` ne doit **pas** exister.

## 3. Projet Supabase de préproduction (distinct de toute production)

À faire par le responsable (création potentiellement payante — **autorisation explicite requise**, rien n'a été créé) :

1. Créer un projet **dédié à la préproduction**, région **UE**, nom explicite (`coachos-staging`). Ne jamais réutiliser un projet destiné à la production ; ne jamais copier de données de production dedans.
2. Appliquer les migrations : `supabase link --project-ref <ref>` puis `supabase db push` (6 migrations de `supabase/migrations/`).
3. Créer le mot de passe du rôle applicatif (jamais dans Git) : dans l'éditeur SQL, `alter role app_server login password '<32+ caractères aléatoires>';` puis construire `DATABASE_URL` avec l'utilisateur `app_server.<ref>` et l'URL du pooler transactionnel.
4. **Auth** : confirmation d'e-mail **obligatoire** ; mot de passe ≥ 12 ; URL du site = `SITE_URL` ; redirections autorisées = `SITE_URL/auth/callback` ; **SMTP personnalisé** (le SMTP par défaut est très limité et peu fiable pour un pilote) ; durée de session et rotation des jetons de rafraîchissement actives.
5. **API** : désactiver la Data API (PostgREST) — non utilisée par l'application — ou vérifier qu'aucun schéma n'est exposé inutilement.
6. **Sauvegardes** : activer les sauvegardes quotidiennes (PITR si disponible) ; noter la durée de rétention (à mentionner dans la notice).
7. Hébergement de l'application (au choix, Node 22+) : variables de la section 2 ; planifier chaque jour `POST $SITE_URL/api/cron/purge` avec `Authorization: Bearer $CRON_SECRET` ; vérifier que le proxy écrase `X-Forwarded-For`.

## 4. Contrôles indispensables avant toute donnée réelle

### 4.1 Automatisés — `npm run pilot:preflight`

```bash
node --env-file=.env.staging scripts/pilot-preflight.mjs        # fichier d'environnement hors Git
```

Vérifie, **sans afficher de secret** : variables requises et cohérentes (https, rôle `app_server` et non `postgres`, clé publique et non `service_role`, même projet pour l'Auth et la base, aucune variable service_role) ; connexion `app_server` (NOINHERIT, ni superuser ni BYPASSRLS, **aucun droit direct sur les tables**) ; RLS active sur toutes les tables ; `anon` sans accès ; `SET LOCAL ROLE authenticated` + claims fonctionnels **à travers le pooler** ; un utilisateur inconnu ne lit rien et ne peut rien écrire ; toutes les migrations présentes ; SSL ; réglages Auth (**confirmation d'e-mail exigée**, e-mail activé, inscriptions ouvertes). Sortie ≠ 0 au moindre échec.

Statut : le script et ses règles sont testés (`tests/db/preflight.test.ts`, contre un vrai PostgreSQL et un faux serveur d'Auth). **Il n'a jamais été exécuté contre un projet Supabase** : c'est le premier contrôle à faire.

### 4.2 Manuels — à cocher, avec date et initiales

| # | Contrôle | Comment | OK |
|---|---|---|:-:|
| A1 | Inscription + e-mail de confirmation réellement reçu (SMTP) | créer un compte avec une adresse de test | ☐ |
| A2 | Connexion refusée tant que l'e-mail n'est pas confirmé | tenter avant de cliquer | ☐ |
| A3 | Réinitialisation de mot de passe de bout en bout | lien reçu → nouveau mot de passe → connexion | ☐ |
| A4 | Session conservée après rafraîchissement du jeton (> 1 h) puis déconnexion effective | laisser une session ouverte, recharger | ☐ |
| A5 | Limites d'envoi d'e-mails du SMTP compatibles avec ~30 invitations/jour | consulter les quotas | ☐ |
| P1 | L'application fonctionne via le **pooler transactionnel** (écriture + lecture + import CSV de 200 lignes) | parcours réel en préproduction | ☐ |
| P2 | Pas d'erreur « prepared statement » ni de fuite de rôle entre requêtes (deux utilisateurs alternent) | 2 navigateurs, actions rapides | ☐ |
| R1 | **Isolation** : club A et club B, deux comptes ; chacun tente les URL de l'autre (pages, exports, fiche) → 404/403 | voir `tests/e2e/security.spec.ts` comme script | ☐ |
| R2 | Rôles : un coach n'a ni Paramètres, ni import, ni export ; un membre ne voit que son espace | comptes de chaque rôle | ☐ |
| I1 | **Invitation** réelle par e-mail : lien ouvert sur **iPhone (Safari)** et **Android (Chrome)**, compte créé, rattachement à la fiche | adresse de test | ☐ |
| I2 | Invitation à usage unique, expirée après 7 jours, inopérante avec une autre adresse | rejouer le lien | ☐ |
| D1 | **Effacement d'un membre** (anonymiser puis supprimer) : plus aucune trace du nom dans l'app et les exports | membre de test | ☐ |
| D2 | **Suppression de compte** : l'utilisateur disparaît de Supabase Auth (*Authentication → Users*) et de `profiles` ; refus s'il est seul propriétaire | compte de test | ☐ |
| D3 | **Suppression du club** : toutes les tables vides pour ce club | club de test, requêtes SQL de contrôle | ☐ |
| D4 | Purge : `curl -X POST -H "Authorization: Bearer $CRON_SECRET" $SITE_URL/api/cron/purge` renvoie les compteurs ; sans jeton → 404 | commande | ☐ |
| D5 | **Restauration d'une sauvegarde** testée sur un projet jetable | procédure du fournisseur | ☐ |
| Q1 | Pointage QR sur **vrais téléphones** : permission caméra, scan en lumière de salle, expiration, lien de secours | séance de test avec 3 personnes | ☐ |
| Q2 | Installation écran d'accueil (iOS et Android) selon `docs/pwa.md` | deux appareils | ☐ |
| L1 | Notice `/privacy` complétée et validée juridiquement ; registre des traitements fait ; DPA des sous-traitants signés (Supabase, hébergeur, SMTP) | `docs/privacy-gdpr.md` | ☐ |
| L2 | Information des adhérents (mention + contact) prête | modèle du club | ☐ |

**Go / No-Go** : tout ☐ coché et signé par le responsable du projet **et** la personne en charge de la protection des données du club. Un seul ✘ = No-Go. Aucun adhérent n'est inscrit avant.

## 5. Déroulé du pilote (une fois le Go donné)

1. **Semaine 0 — mise en place** : le propriétaire crée le club, les disciplines et types de cours réels, les séances récurrentes du trimestre (≤ 6 mois, ≤ 200 séances par lot), invite les coachs (un compte chacun).
2. **Semaine 0 — adhérents** : adultes uniquement, **sans donnée de santé**. Importer le CSV de l'ancien outil (colonnes inutiles ignorées ; relire le rapport de rejets), puis inviter par e-mail les adhérents qui pointeront eux-mêmes (rôle « membre » + fiche liée). **Parcours réel d'un nouvel adhérent** (le lien d'invitation est transmis à la main, l'application n'envoie pas d'e-mail d'invitation) : ouvrir le lien → « Créer un compte » avec **la même adresse que l'invitation** → cliquer le lien de confirmation reçu par e-mail (il mène à « Créer votre club » : ignorer) → **rouvrir le lien d'invitation** → accepter. Prévoir de l'expliquer aux adhérents (ou de les accompagner la première fois).
3. **Semaines 1–2 — appel sur téléphone par un seul coach** ; vérifier chaque soir la liste, corriger, valider la feuille. Noter dans `notes-produit.md` les frictions (temps d'appel, scans ratés, adhérents sans compte).
4. **Semaines 3–4 — pointage QR** sur un cours de confiance, puis généralisation si ≥ 80 % des présents pointent sans aide.
5. **Rétrospective** : garder/jeter chaque fonction selon l'usage réel ; mesurer le temps d'appel avant/après.
6. **Fin ou arrêt** : exporter (CSV), puis supprimer les données de test ; purge automatique des archivés selon `retention_months`.

## 6. Incidents et retour arrière

- Aucun déploiement automatique : l'application tourne sur un environnement de préproduction nommé ; en cas de doute, couper l'accès (retirer l'URL) et conserver les journaux.
- Suspicion de fuite : suivre la procédure de `docs/privacy-gdpr.md` (confinement : révoquer les sessions Auth, faire tourner `APP_SECRET`, `CRON_SECRET` et le mot de passe `app_server`).
- Les migrations sont **additives** ; ne jamais modifier une migration déjà appliquée sur un environnement partagé.
