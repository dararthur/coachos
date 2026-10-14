# Authentification auto-hébergée (Better Auth) — architecture, risques, limites

> Statut : **implémentée et testée en local** (PostgreSQL 17 embarqué, Chrome, adaptateur d'e-mail de test). **Non validée en production** : Nginx réel, HTTPS public, envoi réel d'e-mails (Resend) et critères N1 à N6 (section 9) restent à valider séparément. Rien n'est déployé.

## 1. Composants

| Composant | Rôle | Fichiers |
|---|---|---|
| Better Auth 1.7.7 | inscription, connexion, sessions, vérification d'e-mail, réinitialisation, changement de mot de passe | `src/server/auth/factory.ts` (configuration pure, testée), `auth.ts` (instance Next.js), `session.ts` (`getSessionUser()`), `src/app/api/auth/[...all]/route.ts` |
| PostgreSQL | tables d'authentification (`auth.users|sessions|accounts|verifications`) **et** données métier (RLS) | `db/migrations/20261013000000_platform_bootstrap.sql`, `…0007_better_auth_adaptation.sql` |
| Deux rôles de connexion distincts | `app_server` : données métier, `SET LOCAL ROLE authenticated` + RLS (inchangé). `auth_runtime` : DML sur `auth.*` **uniquement** | `DATABASE_URL`, `AUTH_DATABASE_URL` |
| Interface `Mailer` | seul point d'envoi d'e-mails ; adaptateurs `outbox` (tests), `resend` (production) | `src/server/mail/*` |
| Limiteur de débit | `app_private.hit_rate_limit` (fenêtre fixe, atomique), clés HMAC | `src/server/rate-limit.ts`, hook dans `factory.ts` |

Le contrat applicatif ne change pas : `getSessionUser()` renvoie `{ id, email, emailConfirmed, displayName }`, `withUser()` pose les claims et `SET LOCAL ROLE authenticated`, les politiques RLS lisent `auth.uid()`. L'isolation entre clubs est donc celle de l'application d'origine, et les 114 tests d'isolation/RLS d'origine passent sans modification de leurs assertions (sauf : un rôle `service_role` inexistant remplacé par `auth_runtime` dans le test d'élévation de rôle, ce qui est plus strict).

## 2. Parcours

- **Inscription** → e-mail de confirmation (lien valable 24 h) → *aucune connexion automatique* → connexion → onboarding. Connexion refusée tant que l'e-mail n'est pas confirmé. Adresse déjà inscrite : même réponse, aucun doublon, aucun second e-mail.
- **Mot de passe oublié** → réponse neutre (adresse connue ou non) → e-mail (lien valable 1 h, usage unique) → page « Nouveau mot de passe » → **toutes les sessions du compte sont révoquées** → connexion.
- **Changement de mot de passe** (compte) : mot de passe actuel exigé ; les autres appareils sont déconnectés ; l'appareil courant reçoit une nouvelle session.
- **Suppression du compte** : `public.delete_my_account()` supprime l'utilisateur ; sessions et comptes d'authentification partent en cascade.
- **Invitation** : inchangée (lien transmis à la main). `accept_invitation` exige `email_verified` et l'adresse du compte = adresse invitée. L'envoi d'invitations par e-mail n'est **pas** implémenté.

## 3. Cookies et sessions

- Cookie `better-auth.session_token` (préfixe `__Secure-` en HTTPS) : `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` dès que `SITE_URL` est en https. Valeur = `jeton.signature` (HMAC avec `BETTER_AUTH_SECRET`).
- Session d'**un an**, prolongée d'un jour à l'usage **en base** (cookie persistant, plafond de 400 jours des navigateurs respecté) : sur un téléphone, l'application installée ne demande de se reconnecter qu'après une très longue absence ou une révocation. Le cookie lui-même n'est renouvelé que lors d'une action serveur. Pas de cache de cookie : la révocation est immédiate (testé).
- Validation côté serveur à chaque requête : lecture de la session en base + vérification de la signature. Aucun test de simple présence de cookie.
- Contrôle d'origine (CSRF) de Better Auth sur les requêtes portant un cookie (testé en e2e, serveur de production) ; les Server Actions Next.js ont leur propre contrôle d'origine.

## 4. RISQUE RÉSIDUEL — jetons de session stockés en clair

**Constat.** `auth.sessions.token` contient la valeur brute du jeton de session. Better Auth ne propose, dans sa documentation officielle, **aucune option pour le hacher** (le paramètre `storeToken: "hashed"` n'existe que pour les plugins magic-link et one-time-token ; `verification.storeIdentifier: "hashed"` est utilisé pour les jetons de réinitialisation). Nous n'avons volontairement **pas** contourné cela par une modification interne non documentée (stockage secondaire dont les clés et les valeurs embarquent le jeton, ou adaptateur de base réécrivant les requêtes).

**Conséquence.** Quiconque lit la table `auth.sessions` voit des jetons valides *mais ne peut pas en faire des cookies valides* : le cookie exige la signature HMAC calculée avec `BETTER_AUTH_SECRET`, que la base ne contient pas (test : un jeton brut, ou avec une fausse signature, est refusé — `tests/db/auth-integration.test.ts`). Une session ne peut donc être détournée qu'avec **les deux** : la table (ou une sauvegarde) **et** le secret.

**Séparation obligatoire du secret de session et des sauvegardes.**
1. `BETTER_AUTH_SECRET` vit uniquement dans le gestionnaire de secrets / l'environnement du processus, **jamais** dans la base, ses dumps, ses sauvegardes, le dépôt Git, ni le même coffre que les sauvegardes.
2. Sauvegardes de la base **chiffrées** (clé distincte, hors du VPS), accès restreint, durée de rétention courte.
3. Seul le rôle `auth_runtime` (et le propriétaire des migrations) a un droit sur `auth.*` : aucun rôle applicatif ni `anon`/`authenticated`/`app_server` (test de privilèges, préflight `auth.closed`, CI).
4. **Rotation** : en cas de doute (fuite de sauvegarde, de secret), changer `BETTER_AUTH_SECRET` invalide tous les cookies (tout le monde se reconnecte) ; si la table a fuité, exécuter en plus `delete from auth.sessions` pour détruire les jetons en clair.
5. Les journaux ne contiennent jamais de jeton (tests de journaux). L'adresse IP des sessions est pseudonymisée (HMAC).
6. Purge quotidienne des sessions et jetons expirés (`/api/cron/purge` → `app_private.purge_expired_auth()`).

À réévaluer à chaque mise à jour de Better Auth : si le hachage des jetons de session devient une option documentée, l'activer.

## 5. Limitation de débit et confidentialité

Un hook unique s'exécute pour **tout** appel d'endpoint : requête HTTP **et** `auth.api.*` côté serveur. Règles (alignées sur `LIMITS`) : connexion 10 essais / 15 min par e-mail et 30 par IP ; inscription 5 / h par IP ; réinitialisation 3 / h par e-mail et 5 / h par IP ; jetons de réinitialisation 10 / 15 min par IP ; etc. La limite par e-mail s'applique que le compte existe ou non (aucune différence observable). Compteur atomique en base (25 requêtes parallèles → exactement 10 passent). Le filet par défaut de Better Auth (rafales de 3 requêtes / 10 s par IP et chemin, plus 100 / min) reste actif et utilise lui aussi des clés HMAC.

- Clés de limitation, IP de session : **HMAC-SHA-256 de `APP_SECRET`** (32 hex). Aucune adresse IP ni e-mail en clair dans `app_private.rate_limits`. Le pseudonyme étant déterministe, une IP est ré-identifiable par quiconque détient `APP_SECRET` : le garder secret.
- **L'IP vient de `X-Real-IP`, que Nginx doit ÉCRASER** (jamais le client). Sans cela la limite par IP est contournable (test de caractérisation) ; la limite par e-mail reste le rempart. IPv6 : un attaquant disposant d'un /64 change d'IP à volonté (risque résiduel).
- Surface HTTP réduite à quatre routes : `GET /api/auth/verify-email` et `GET /api/auth/reset-password/<jeton>` (liens d'e-mail, redirections externes refusées en 403), `/ok` et `/error`. Les 25 autres chemins (`DISABLED_PATHS` dans `factory.ts`) répondent 404 : inscription, connexion, déconnexion, demande de réinitialisation, changement de mot de passe, mise à jour du profil, renvoi de confirmation, sessions, connexion sociale, etc. Les Server Actions appellent `auth.api.*` en processus, ce que cette désactivation n'affecte pas ; la validation applicative (zod), les limites du hook et le contrôle de session restent donc la seule porte d'entrée. Better Auth compare le chemin **exact** (pas de motif) : variantes de casse, barre finale ou encodage testées sans contournement.
- Journaux : `safeLog` n'émet que niveau, message assaini (e-mails, IP et longs jetons masqués) et code d'erreur. Jamais de trace, de SQL ni d'argument. Les messages d'erreur PostgreSQL ne sont jamais journalisés (testé avec une exception SQL provoquée). Hors périmètre : les traces que Next.js écrit pour une exception non gérée (voir N5).

## 6. E-mails (Resend derrière une interface)

`src/server/mail/types.ts` définit `Mailer.send(message)`. Aucun autre module ne connaît le fournisseur.
- `MAIL_PROVIDER=outbox` (développement et tests **uniquement**) : une ligne JSON par message, liens en clair, dans `MAIL_OUTBOX_FILE`. **Le serveur refuse de démarrer** avec `outbox` si `APP_ENV` est `staging` ou `production`, ou si `SITE_URL` n'est pas locale (`localhost`/`127.0.0.1`) : la dérogation des tests e2e (`APP_ENV=test`, posée par `tests/e2e/support/run-stack.mjs`) ne peut donc pas servir une instance publique. `NODE_ENV=production` ne suffit pas à distinguer : les e2e l'utilisent aussi. Le préflight le refuse aussi.
- `MAIL_PROVIDER=resend` : `POST https://api.resend.com/emails` avec `RESEND_API_KEY` (variable d'environnement serveur uniquement) et `MAIL_FROM`. **Cet adaptateur n'a jamais été exécuté contre l'API réelle** : aucun compte n'a été créé et aucun appel n'a été émis ; la forme de la requête est figée par des tests avec un faux `fetch`. Les erreurs ne portent ni destinataire, ni contenu, ni réponse du fournisseur.
- Envoi sans attente de la réponse (anti-timing) ; échec = événement `auth.mail_failed` sans donnée personnelle. Pas de file d'attente ni de relance automatique : l'utilisateur peut redemander un lien (limites 3 / h).
- Contenu minimal : destinataire, lien, texte générique ; ni nom de club ni donnée métier.
- Prérequis fournisseur (documentation Resend, à effectuer avant tout envoi réel) : domaine/sous-domaine vérifié, SPF/DKIM, DMARC progressif, suivi des ouvertures/clics **désactivé** (sinon les liens sont réécrits par un tiers). Voir `docs/privacy-gdpr.md` pour les implications RGPD (stockage aux États-Unis, conservation 30 jours du contenu).

## 7. Base de données

- Migration 0000 : rôles `anon`, `authenticated`, `auth_runtime` (sans mot de passe), schéma `auth`, tables Better Auth (DDL généré par Better Auth 1.7.7, versionné), `auth.uid()`. Migration 0007 : `handle_new_user` (profil depuis `name`), `accept_invitation` (lit `email_verified`), `purge_expired_auth`.
- `tests/db/auth-integration.test.ts` échoue si une mise à jour de Better Auth demande un schéma différent de celui versionné (aucune table ni colonne à créer).
- Les migrations 0001–0006 n'ont jamais été appliquées à un environnement partagé : elles restent inchangées et 0007 les corrige (additif).
- Pas de pooler requis ; `prepare: false` reste sans effet en connexion directe et permet PgBouncer en mode transaction si besoin.

## 8. Ce qui a été testé

Voir le compte rendu de livraison et `docs/security.md`. En résumé : tests unitaires (modèles d'e-mail, adaptateur Resend à faux `fetch`, journal assaini), tests DB (parcours Better Auth sur PostgreSQL réel, limites, journaux, confidentialité, schéma, privilèges, invitation, suppression, purge, rejeu des migrations), tests e2e Playwright (parcours réels avec boîte d'envoi de test, abus, surface HTTP).

## 9. À valider séparément avant tout pilote (non faits)

| ID | Critère |
|---|---|
| N1 | Derrière **Nginx réel** : `X-Real-IP` / `X-Forwarded-For` falsifiés écrasés (exemple non appliqué : `ops/nginx/coachos.conf`) |
| N2 | HTTPS public : cookies `__Secure-…; Secure`, HSTS, redirection 80→443, `SITE_URL` = URL publique exacte |
| N3 | PostgreSQL et l'application joignables uniquement en local/pare-feu |
| N4 | Journaux d'accès Nginx **sans jeton** (réinitialisation, vérification, invitation, pointage voyagent dans l'URL) |
| N5 | Journaux des exceptions non gérées de Next.js sans donnée personnelle |
| N6 | Rotation et rétention des journaux ; volume en cas d'attaque (une ligne par requête refusée) |
| R1 | Envoi réel d'e-mails via Resend (domaine vérifié, SPF/DKIM/DMARC, réception, suivi désactivé) |
| R2 | Sauvegarde chiffrée hors VPS **et restauration testée**, secret de session séparé |
| R3 | Version de PostgreSQL du VPS (migrations testées en 17.10) ; mémoire disponible ; mots de passe de `app_server` / `auth_runtime` posés hors Git |
| R4 | Aucune donnée réelle avant la validation de tout ce qui précède |

## 10. Limites connues

- Pas de renvoi du lien de confirmation depuis l'écran de connexion (l'utilisateur peut se réinscrire avec la même adresse : aucun doublon, mais aucun nouvel e-mail ; à traiter avant le pilote si les e-mails se perdent).
- Pas de détection de mots de passe compromis, pas de MFA.
- Le lien de vérification d'e-mail est un jeton signé de 24 h **rejouable** (idempotent, sans effet ni session — testé) ; le lien de réinitialisation est à usage unique.
- Cookie de session non renouvelé hors action serveur (voir §3).
- IPv6 /64 (voir §5). Journaux de Next.js pour exceptions non gérées (N5).
