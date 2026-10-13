# PWA et usage mobile

## Ce qui est implémenté

- **Manifeste** (`src/app/manifest.ts` → `/manifest.webmanifest`) : `display: standalone`, `start_url: /`, `scope: /`, thème `#134e4a`, langue `fr`, icônes 192/512 (`any`) et 512 (`maskable`).
- **Icônes** : `public/icons/` (générées de façon déterministe par `node scripts/generate-icons.mjs`, aucune dépendance), dont `apple-touch-icon.png` 180×180.
- **Métadonnées** (`src/app/layout.tsx`) : `viewport-fit=cover`, `theme-color`, `apple-mobile-web-app-capable`/`mobile-web-app-capable`, titre iOS, désactivation de la détection automatique de numéros/adresses.
- **Zones de sécurité** : `env(safe-area-inset-*)` appliqué à l'en-tête, à la barre d'onglets et aux pages hors club.
- **Navigation mobile** : barre d'onglets fixe en bas (< 768 px), menu latéral sur grand écran ; « Mon compte » (avec déconnexion) dans l'en-tête.
- **Tactile** : cibles ≥ 44 × 44 px (vérifié par test), champs ≥ 16 px (pas de zoom automatique iOS), `touch-action: manipulation`.

## Ce qui n'est volontairement PAS implémenté : le hors ligne

**Aucun service worker, aucun cache de données.** Une page authentifiée contient des données personnelles de membres ; la mettre en cache sur l'appareil ou dans un cache partagé exigerait une stratégie validée (chiffrement, purge à la déconnexion, invalidation à la révocation d'un accès, appareils partagés). Tant qu'elle n'existe pas :

- l'application exige du réseau ; hors ligne, le navigateur affiche sa page d'erreur habituelle ;
- les pages authentifiées sont servies `no-store` (testé) ;
- `tests/e2e/mobile-pwa.spec.ts` vérifie qu'aucun service worker n'est enregistré.

## Installation : différences iOS / Android

> **Statut de test : aucun appareil physique n'a été utilisé.** Les parcours mobiles sont testés par émulation Chrome (viewport 390×844, tactile, user-agent mobile) et par inspection du manifeste. Les instructions ci-dessous viennent de la documentation des plateformes et doivent être vérifiées sur un iPhone et un Android réels avant le pilote (liste de contrôle en bas).

| | Android (Chrome) | iOS / iPadOS (Safari) |
|---|---|---|
| Installer | Menu ⋮ → « Installer l'application » (ou « Ajouter à l'écran d'accueil ») ; une invite peut apparaître d'elle-même | Bouton Partager → « Sur l'écran d'accueil » (**Safari uniquement** ; Chrome/Firefox iOS peuvent aussi le proposer selon la version) |
| Source de l'icône | Manifeste (icône `maskable` rognée en forme adaptative) | `apple-touch-icon` 180×180 (iOS arrondit lui-même ; pas de transparence) |
| Mode d'affichage | `standalone` du manifeste | `standalone` via `apple-mobile-web-app-capable` |
| Barre d'état | `theme-color` | `statusBarStyle: default` ; contenu sous l'encoche géré par `safe-area-inset-*` |
| Session / cookies | Partagés avec Chrome | **Stockage séparé du navigateur** : une session Safari n'est pas reprise dans l'app installée → se reconnecter une fois après l'installation |
| Liens ouverts depuis l'extérieur (invitation, e-mail de reset) | S'ouvrent dans Chrome ou, selon la version, dans l'app installée | S'ouvrent dans Safari, **pas** dans l'app installée : terminer l'action dans Safari puis se reconnecter dans l'app |
| Caméra (pointage par QR, `/checkin`) | Demande de permission du navigateur ; en app installée, permission du site conservée | Demande possible à chaque ouverture ; nécessite HTTPS ; le scan natif de l'appareil photo ouvre le lien dans Safari, **pas** dans l'app installée (la session de l'app est séparée : se reconnecter dans Safari) |
| Notifications push | Non implémenté | Non implémenté (iOS ne les autorise qu'aux PWA installées) |
| Mise à jour | Immédiate (pas de cache d'application) | Immédiate |

## Liste de contrôle sur appareils réels (à faire avant le pilote)

Sur un **iPhone (Safari)** et un **Android (Chrome)**, avec l'environnement de **préproduction** en HTTPS :

1. Ouvrir le site, installer sur l'écran d'accueil ; vérifier icône, nom, plein écran sans barre d'adresse.
2. Se connecter dans l'app installée ; fermer/rouvrir : la session est-elle conservée ?
3. Créer un compte via un lien d'invitation reçu par e-mail ; vérifier où s'ouvre le lien et comment revenir dans l'app.
4. Faire un appel complet (7 membres) en conditions réelles de salle (une main, lumière forte) ; vérifier la lisibilité et les cibles tactiles.
5. Vérifier que rien ne passe sous l'encoche ou la barre d'accueil, en portrait et en paysage.
6. Mode avion : confirmer que l'app affiche une erreur claire et ne montre aucune donnée périmée.
7. Pointage QR (`docs/qr-checkin.md`) : refuser puis accepter la permission caméra, scanner en lumière de salle, ouvrir le lien par le scan natif, tester « coller le lien ».
8. Noter tout écart dans ce document.
