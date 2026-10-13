# Sécurité

Résumé des contrôles **implémentés**, de l'endroit où ils sont prouvés, et des limites connues. Ce document décrit l'état du code, pas une certification.

## Modèle d'accès aux données

1. **Le navigateur n'accède jamais à la base ni à Supabase** : toutes les lectures/écritures passent par des Server Components, Server Actions ou Route Handlers. Aucune clé n'est exposée au client (`NEXT_PUBLIC_*` n'est pas utilisé). La clé `service_role` n'est utilisée nulle part.
2. **Le serveur se connecte avec `app_server`**, un rôle `NOINHERIT` sans aucun privilège sur les tables. Chaque requête utilisateur s'exécute dans une transaction qui fait `SET LOCAL ROLE authenticated` et pose `request.jwt.claims` (identité vérifiée auprès de Supabase Auth via `getUser()`). **La RLS PostgreSQL est donc la seule autorité** : oublier `withUser()` produit `permission denied`, pas une fuite.
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
| Configuration de préproduction (rôle, RLS, pooler, Auth) | `tests/db/preflight.test.ts` ; `npm run pilot:preflight` (jamais exécuté contre un vrai projet Supabase) |
| Secrets versionnés | `npm run audit:secrets`, gitleaks en CI |

Un bug réel a été trouvé et corrigé par ces tests : `NULL NOT IN (...)` laissait un non-membre passer la garde de `create_invitation`/`set_member_role` (corrigé par `coalesce`).

## Authentification et session

- Supabase Auth via `@supabase/ssr` ; cookies de session **HttpOnly**, `SameSite=Lax`, `Secure` en production ; identité toujours revérifiée côté serveur (`auth.getUser()`).
- Mots de passe ≥ 12 caractères (config Auth + validation) ; messages de connexion identiques pour compte inconnu / mauvais mot de passe ; réinitialisation sans énumération de comptes.
- Redirections (`next`) limitées aux chemins internes (`safeNext`).
- Invitations : jeton aléatoire 256 bits, **seul le hachage SHA-256 est stocké**, 7 jours, usage unique, liée à l'e-mail **confirmé** du compte.

## Protection des requêtes

- **CSRF** : Server Actions (contrôle Origin/Host de Next.js) + cookies `SameSite=Lax` ; les exports GET sont en lecture seule.
- **XSS** : React échappe par défaut ; aucune injection HTML brute ; validation stricte des noms (`<`, `>`, `=`, `@` refusés) ; **CSP** `script-src 'self' 'nonce-…' 'strict-dynamic'`, sans `unsafe-inline`/`unsafe-eval` en production.
- **Caméra** : `Permissions-Policy: camera=(self)` uniquement sur `/checkin` (posé par `src/proxy.ts`), `camera=()` partout ailleurs ; micro, géolocalisation, paiement, USB interdits partout.
- **En-têtes** : `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, HSTS, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store` sur les exports.
- **CORS** : aucune route n'émet d'en-tête CORS (même origine uniquement).
- **Limitation de débit** : compteurs en base (valables en serverless), clés pseudonymisées par HMAC ; connexion, inscription, réinitialisation, invitations, import, exports, effacement, suppression de compte, plafond d'écritures par utilisateur. Échec **fermé** si le compteur est indisponible.
- **Erreurs** : jamais de SQL ni de message interne vers l'UI (`AppError` + codes stables) ; journaux JSON redactés (`src/server/logger.ts`) sans mot de passe, jeton, e-mail ni nom.
- **Import CSV** : 1 Mo / 2 000 lignes max, UTF-8 strict, schéma validé ligne par ligne, rejet des guillemets non fermés, des caractères de contrôle et des préfixes `= + - @`, dates strictes (jour d'abord, `31/02` rejeté), doublons internes et existants ignorés, **revalidation complète côté serveur** à la confirmation, colonnes inconnues non conservées.
- **Export CSV** : toutes les cellules texte entre guillemets, préfixe `'` contre l'injection de formules, BOM UTF-8, nom de fichier assaini, exports journalisés (compteurs uniquement).

## Limites connues et risques restants

1. **Supabase Auth non testé de bout en bout** : l'e2e utilise un faux GoTrue. À valider sur un projet Supabase réel (confirmation d'e-mail, reset, refresh, limites SMTP).
2. **Pooler / rôle `app_server` sur Supabase hébergé non testés** (voir `docs/setup.md`) ; si le pooler refusait `set_config('role')`, utiliser la connexion directe.
3. **IP client** : `X-Forwarded-For` est cru tel quel ; à déployer derrière un proxy qui l'écrase. La limite par e-mail reste efficace sans cela.
4. **Pas de MFA**, pas de verrouillage de compte au-delà des limites de débit, pas de détection de mots de passe compromis côté application (Supabase offre HIBP en option payante).
5. **Pas de rôle « opérateur plateforme »** : l'accès support aux données d'un club n'est pas implémenté (et n'est donc pas accordé implicitement).
6. **Données dérivées** : les séances annulées/supprimées et statistiques ne sont pas chiffrées au niveau applicatif (chiffrement au repos géré par l'hébergeur de la base).
7. Audit d'accessibilité : contrôles automatisés (axe) et clavier de base seulement ; pas d'audit manuel avec lecteur d'écran.
8. Les actions GitHub de la CI sont référencées par tag majeur, pas par SHA ; à épingler avant production.

## Signaler une vulnérabilité

Ne pas ouvrir d'issue publique : contacter le responsable du projet par canal privé. [Adresse de contact sécurité : à définir.]
