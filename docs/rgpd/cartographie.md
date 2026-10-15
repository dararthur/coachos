# Cartographie des données et des flux

État du code au 15/10/2026 (migrations jusqu'à `20261015000300`). Toutes les tables métier sont sous RLS avec `academy_id` et clés étrangères composites (`docs/security.md`, `tests/db/schema-invariants.test.ts`).

## Personnes concernées

| Catégorie | Qui | Remarques |
|---|---|---|
| Membres d'un club | Adultes inscrits (fiche créée par le staff, par import CSV, ou à l'inscription par code club) | Majorité **attestée**, pas vérifiée ; aucune date de naissance |
| Staff d'un club | Propriétaire, administrateurs, coachs | Ont un compte |
| Demandeurs de club | Personne qui remplit `/request-club` | Peut ne jamais avoir de compte |
| Administrateur de la plateforme | Désigné par `PLATFORM_ADMIN_EMAIL` (variable d'environnement) | Adresse jamais stockée en base |

Aucune catégorie particulière (art. 9) n'est collectée par conception : ni santé, ni blessure, ni biométrie. Aucun champ libre sur un membre. Le seul champ libre est la note facultative d'une demande de club (500 caractères) ; il peut contenir n'importe quoi : **à mentionner sur le formulaire** (« n'indiquez pas de données sensibles »).

## Données par table

| Table | Données personnelles | Qui lit (RLS) | Effacement |
|---|---|---|---|
| `auth.users`, `public.profiles` | e-mail, nom affiché, e-mail confirmé | l'utilisateur ; le staff de ses clubs voit nom/e-mail | `delete_my_account` |
| `auth.accounts` | hachage du mot de passe | aucun rôle applicatif | cascade compte |
| `auth.sessions` | jeton de session (**en clair**, risque documenté), IP **pseudonymisée HMAC**, navigateur (user-agent) | aucun rôle applicatif | expiration (1 an glissant) + purge quotidienne ; cascade compte |
| `auth.verifications` | jetons de vérification / réinitialisation (hachés) | aucun | expiration + purge |
| `public.people` | prénom, nom, e-mail, téléphone E.164, date d'inscription, réf. externe, ceinture/barrettes, silhouette, consentement classement, attestation de majorité, lien compte | staff du club (toutes colonnes) ; le membre sa fiche | anonymisation (manuelle ou rétention), suppression |
| `public.person_photos` | photo (WebP ≤ 200 Ko, ~256 px) | staff ; le membre ; autres membres **si** consentement classement | retrait, anonymisation, suppression de fiche ou de compte |
| `public.attendance` | présence d'une personne à une séance, auteur, origine (manuel/QR) | staff ; le membre les siennes | conservée anonymisée après anonymisation ; supprimée avec la fiche |
| `public.session_bookings` | réservation / liste d'attente | staff ; le membre les siennes | retirées à l'archivage/anonymisation ; cascade |
| `public.booking_notifications` | identifiants seuls (file d'envoi) | aucun rôle applicatif | supprimée à l'envoi ou à l'abandon |
| `public.invitations` | e-mail invité, rôle, hachage du jeton | admins | purge 30 j après expiration/acceptation |
| `public.academy_requests` | nom du club, nom et e-mail du demandeur, note | administrateur de la plateforme | purge 90/180 j ; suppression du compte du demandeur |
| `public.audit_events` | identifiant de l'acteur, action, objet, compteurs (jamais de nom/e-mail) | propriétaire, admins | purge 24 mois ; pseudonymisé à la suppression du compte |
| `app_private.rate_limits` | HMAC d'IP / e-mail | aucun | purge > 24 h |
| `public.checkin_tokens`, `academy_checkin_keys`, `academy_join_codes` | aucune donnée de personne | staff (clés) | — |
| `public.academy_logos` | logo du club (pas une donnée de personne en principe) | membres du club | suppression du club |

## Flux

| Flux | Données | Destinataire | Déclencheur | Statut |
|---|---|---|---|---|
| Navigateur → serveur | toutes les saisies | serveur de l'éditeur chez OVHcloud, Gravelines (HTTPS, Nginx) | utilisation | Nginx de production **non validé** (`docs/nginx.md`) |
| E-mails transactionnels | adresse du destinataire, lien à usage limité ; avis de place : nom du club, du cours, date/heure | Resend, région d'envoi Irlande | inscription, réinitialisation, invitation, promotion de liste d'attente | activé par l'éditeur (non constaté dans cette session) |
| E-mail de demande de club | nom et e-mail du demandeur, nom du club | administrateur de la plateforme, via le fournisseur d'e-mails | `/request-club` | idem |
| Lien WhatsApp (tableau de bord) | numéro du membre + message pré-rempli contenant son prénom | Meta/WhatsApp, **depuis l'appareil du coach** quand il clique | action volontaire du staff | à mentionner dans la notice du club (fait dans `/privacy`) |
| Exports CSV / JSON | fiches, présences, réservations, photo (JSON) | poste de l'admin / du membre | action volontaire, journalisée, limitée en débit | une fois téléchargé, le fichier sort du périmètre de l'application |
| Import CSV | prénom, nom, e-mail, téléphone, date, réf. | serveur | admin | colonnes inconnues ignorées |
| Sauvegardes | base complète | stockage distant chiffré (`age`, clé publique seulement sur le serveur) | quotidien (prévu) | chaîne **jamais exécutée** (`docs/operations.md`) |
| Journaux applicatifs | événements JSON redactés (`src/server/logger.ts`) | sortie standard du service (journald) | continu | durée de conservation journald **à fixer** |
| Journaux Nginx | IP, URL, user-agent | disque du serveur (OVHcloud) | chaque requête | durée et rotation **à fixer** ; les URL contiennent des identifiants (UUID), pas de noms |
| Fournisseur d'IA | — | **aucun** | — | aucune intégration IA dans le code |

Aucun outil d'analyse d'audience, traceur ou script tiers (CSP `script-src 'self'` + nonce). Seuls des cookies de session strictement nécessaires.
