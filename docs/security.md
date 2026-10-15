# Sécurité

Résumé des contrôles **implémentés**, de l'endroit où ils sont prouvés, et des limites connues. Ce document décrit l'état du code, pas une certification.

## Modèle d'accès aux données

1. **Le navigateur n'accède jamais à la base** : toutes les lectures/écritures passent par des Server Components, Server Actions ou Route Handlers. Aucune clé n'est exposée au client (`NEXT_PUBLIC_*` n'est pas utilisé). La clé `service_role` n'est utilisée nulle part.
2. **Le serveur se connecte avec `app_server`**, un rôle `NOINHERIT` sans aucun privilège sur les tables. Chaque requête utilisateur s'exécute dans une transaction qui fait `SET LOCAL ROLE authenticated` et pose `request.jwt.claims` (identité validée côté serveur par Better Auth : session lue en base, signature du cookie vérifiée). **La RLS PostgreSQL est donc la seule autorité** : oublier `withUser()` produit `permission denied`, pas une fuite.
3. **Isolation multi-tenant dans le schéma** : toute table tenant porte `academy_id NOT NULL` ; les références entre tables utilisent des **clés étrangères composites `(id, academy_id)`** (une séance de A ne peut pas référencer un type de cours de B, même avec un UUID forgé) ; `academy_id` est immuable (trigger + privilèges de colonnes).
4. **Moindre privilège** : `anon` n'a aucun privilège ; `authenticated` n'a que des `GRANT` colonne par colonne ; pas de `INSERT/DELETE` direct sur `academies`, `academy_memberships`, `audit_events` (fonctions `SECURITY DEFINER` à `search_path` vide qui re-vérifient le rôle). `created_by`, `recorded_by` et l'horodatage de l'attestation de majorité sont imposés par la base.
5. **Autorisation en trois couches** : `requireAcademy()` / `authorizeAcademy()` (membre + permission, 404 pour un non-membre), matrice `src/domain/roles.ts`, RLS. `tests/db/roles-workflows.test.ts` vérifie que la matrice applicative et la base **donnent la même réponse** pour chaque rôle.

## Preuves automatisées (toutes exécutées)

| Menace | Test |
|---|---|
| Lecture/écriture inter-club par identifiant forgé | `tests/db/tenant-isolation.test.ts` (22 cas : SELECT, INSERT, UPDATE, DELETE, FK composites, déplacement de tenant, fonctions métier, rôles) |
| Escalade de rôle, hiérarchie owner/admin, dernier propriétaire | `tests/db/roles-workflows.test.ts` |
| Invitation volée / rejouée / non confirmée | `tests/db/roles-workflows.test.ts`, `tests/e2e/security.spec.ts` |
| Schéma durci (RLS partout, `anon` vide, `search_path`) | `tests/db/schema-invariants.test.ts` |
| Isolation vue par un vrai navigateur (pages, exports) | `tests/e2e/security.spec.ts` |
| En-têtes, CSP à nonce, cookies HttpOnly, pas d'erreur CSP | `tests/e2e/security.spec.ts` |
| Brute force de connexion | `tests/e2e/security.spec.ts` (limitation de débit) |
| CSV malveillant, formules, binaire, doublons | `tests/unit/csv-import.test.ts`, `tests/unit/domain.test.ts`, e2e |
| Injection SQL | requêtes paramétrées exclusivement (aucune concaténation) ; `tests/db/repositories.test.ts` |
| Pointage QR : jetons devinés/expirés/révoqués/rejoués, double scan et concurrence, pointer pour autrui, forger `source`, oracle d'existence, isolation entre clubs | `tests/db/checkin.test.ts` (17 cas), `tests/unit/checkin.test.ts`, `tests/e2e/qr-checkin.spec.ts` ; détail dans `docs/qr-checkin.md` |
| E-mail de place confirmée : file fermée à tous les rôles applicatifs, envoi réservé à `app_server`, aucun envoi pour une place plus d'actualité, pas de doublon entre envois simultanés | `tests/db/booking-notifications.test.ts` ; détail dans `docs/bookings.md` |
| Configuration de préproduction (rôles, RLS, authentification fermée, secrets, e-mail) | `tests/db/preflight.test.ts` ; `npm run pilot:preflight` (jamais exécuté contre l'environnement de préproduction) |
| Better Auth sur PostgreSQL réel : parcours, jetons falsifiés/expirés/rejoués, révocation des sessions, limites de débit (HTTP et `auth.api`, concurrence), IP pseudonymisées, jetons hachés, journaux sans fuite sur exception SQL, schéma versionné, privilèges, invitation, suppression | `tests/db/auth-integration.test.ts` (20 cas), `tests/db/migrations-replay.test.ts`, `tests/unit/mail.test.ts` |
| Parcours d'authentification dans un vrai navigateur (confirmation, récupération, changement/suppression de compte, abus, surface HTTP, contrôle d'origine) | `tests/e2e/auth-flows.spec.ts` |
| Secrets versionnés | `npm run audit:secrets`, gitleaks en CI |

Un bug réel a été trouvé et corrigé par ces tests : `NULL NOT IN (...)` laissait un non-membre passer la garde de `create_invitation`/`set_member_role` (corrigé par `coalesce`).

## Authentification et session

Détail, risques et limites : [`docs/self-hosted-auth.md`](self-hosted-auth.md).

- Better Auth (sessions en base, PostgreSQL) ; cookie de session **HttpOnly**, `SameSite=Lax`, `Secure` dès que `SITE_URL` est en https (préfixe `__Secure-`) ; valeur signée par HMAC (`BETTER_AUTH_SECRET`) ; identité toujours revalidée côté serveur (session lue en base à chaque requête, sans cache de cookie : révocation immédiate).
- Mots de passe ≥ 12 caractères ; connexion refusée tant que l'e-mail n'est pas confirmé ; messages de connexion identiques pour compte inconnu / mauvais mot de passe ; inscription et réinitialisation sans énumération de comptes.
- La réinitialisation et le changement de mot de passe **révoquent les autres sessions** ; le lien de réinitialisation est à usage unique (1 h) et son identifiant est haché en base ; le lien de vérification (24 h) ne connecte jamais automatiquement.
- Redirections (`next`) limitées aux chemins internes (`safeNext`). Surface HTTP de Better Auth réduite à quatre routes (`GET /verify-email`, `GET /reset-password/<jeton>`, `/ok`, `/error`) : les 25 autres chemins, dont toutes les opérations déjà faites par les Server Actions, répondent 404 — la validation applicative ne peut donc pas être contournée par HTTP direct ; contrôle d'origine sur les redirections des deux liens d'e-mail.
- Invitations : jeton aléatoire 256 bits, **seul le hachage SHA-256 est stocké**, 7 jours, usage unique, liée à l'e-mail **confirmé** du compte (`email_verified`).
- **Risque résiduel documenté : les jetons de session sont stockés en clair dans `auth.sessions`** (aucune option documentée de hachage dans Better Auth ; aucune modification interne non documentée n'a été introduite). Le cookie exige la signature HMAC, donc une copie de la base seule ne permet pas de détourner une session ; **le secret de session ne doit jamais être stocké avec la base ni ses sauvegardes** (`docs/self-hosted-auth.md` §4).

## Protection des requêtes

- **CSRF** : Server Actions (contrôle Origin/Host de Next.js) + cookies `SameSite=Lax` ; les exports GET sont en lecture seule.
- **XSS** : React échappe par défaut ; aucune injection HTML brute ; validation stricte des noms (`<`, `>`, `=`, `@` refusés) ; **CSP** `script-src 'self' 'nonce-…' 'strict-dynamic'`, sans `unsafe-inline`/`unsafe-eval` en production.
- **Caméra** : `Permissions-Policy: camera=(self)` uniquement sur `/checkin` (posé par `src/proxy.ts`), `camera=()` partout ailleurs ; micro, géolocalisation, paiement, USB interdits partout.
- **En-têtes** : `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, HSTS, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store` sur les exports et sur `/api/auth/*` ; HSTS émis par l'application seule (docs/nginx.md).
- **CORS** : aucune route n'émet d'en-tête CORS (même origine uniquement).
- **Limitation de débit** : compteurs atomiques en base, clés pseudonymisées par HMAC (aucune IP ni e-mail en clair) ; connexion, inscription, réinitialisation, vérification (hook Better Auth : HTTP **et** appels serveur `auth.api`), invitations, import, exports, effacement, suppression de compte, plafond d'écritures par utilisateur. Échec **fermé** si le compteur est indisponible.
- **Erreurs** : jamais de SQL ni de message interne vers l'UI (`AppError` + codes stables) ; journaux JSON redactés (`src/server/logger.ts`) sans mot de passe, jeton, e-mail ni nom.
- **Import CSV** : 1 Mo / 2 000 lignes max, UTF-8 strict, schéma validé ligne par ligne, rejet des guillemets non fermés, des caractères de contrôle et des préfixes `= + - @`, dates strictes (jour d'abord, `31/02` rejeté), doublons internes et existants ignorés, **revalidation complète côté serveur** à la confirmation, colonnes inconnues non conservées.
- **Export CSV** : toutes les cellules texte entre guillemets, préfixe `'` contre l'injection de formules, BOM UTF-8, nom de fichier assaini, exports journalisés (compteurs uniquement).

## Limites connues et risques restants

1. **Architecture auto-hébergée non validée en production** : Nginx réel, HTTPS public, envoi réel d'e-mails (adaptateur Resend jamais exécuté), PostgreSQL du serveur et critères N1 à N6 restent à valider (`docs/self-hosted-auth.md` §9, `docs/pilot.md`).
2. **Jetons de session en clair en base** (voir ci-dessus) : à accepter explicitement, avec la séparation du secret et des sauvegardes.
3. **IP client** : lue dans `X-Real-IP`, que le reverse proxy de confiance doit **écraser** ; sans cela la limite par IP est contournable (testé et documenté) ; la limite par e-mail reste efficace. IPv6 : un /64 permet de changer d'IP à volonté.
4. **Pas de MFA**, pas de verrouillage de compte au-delà des limites de débit, pas de détection de mots de passe compromis.
5. **Pas de rôle « opérateur plateforme »** : l'accès support aux données d'un club n'est pas implémenté (et n'est donc pas accordé implicitement).
6. **Données dérivées** : les séances annulées/supprimées et statistiques ne sont pas chiffrées au niveau applicatif (chiffrement au repos géré par l'hébergeur de la base).
7. Audit d'accessibilité : contrôles automatisés (axe) et clavier de base seulement ; pas d'audit manuel avec lecteur d'écran.
8. **CodeQL** est désactivé tant que la variable de dépôt `ENABLE_CODEQL=true` n'est pas définie : sur un dépôt privé sans GitHub Advanced Security, l'envoi des résultats échoue (constaté sur le run du commit 4fcf863). Aucune analyse statique CodeQL n'a donc tourné ; ESLint strict et les tests restent les seuls contrôles de code.
9. Les actions GitHub de la CI sont référencées par tag majeur, pas par SHA ; à épingler avant production.

## Signaler une vulnérabilité

Ne pas ouvrir d'issue publique : contacter le responsable du projet par canal privé. Adresse : contact@matnexa.fr.
