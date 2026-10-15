# Pointage des présences par QR code

Un adhérent connecté enregistre lui-même sa présence en scannant un QR code affiché par le coach. **Ce n'est pas un second système de présence** : un pointage est une ligne `attendance` ordinaire (`source = 'qr'`), soumise aux mêmes contraintes, au même historique, aux mêmes exports et aux mêmes corrections que la saisie manuelle.

## Parcours

**Coach** (page *Présences → Faire l'appel* d'une séance, rôle propriétaire/admin, ou coach affecté à la séance) :
1. *Ouvrir le pointage* → un QR s'affiche avec un compte à rebours ; il se renouvelle tout seul (toutes les ≤ 45 s, à mi-vie du jeton). Un « lien de pointage » texte est disponible si le scan est impossible.
2. La liste se met à jour toute seule (toutes les 4 s, au retour du réseau et de l'onglet) ; les pointés par QR portent le badge « Pointé par QR ».
3. Corrections libres à tout moment : changer un statut (la ligne redevient « manuelle »), effacer, ajouter un adhérent qui n'a pas de compte (la feuille complète reste la liste des membres actifs).
4. *Fermer le pointage* (révoque immédiatement tous les QR) ou *Valider la feuille d'appel* (ferme + révoque ; réversible par *Rouvrir la feuille*).

**Adhérent** (compte rattaché à sa fiche membre par l'invitation « fiche membre liée ») :
1. **Recommandé : le scanner intégré** — *Mon espace → Pointer ma présence* (ou l'onglet « Pointer », ou le raccourci de l'application installée). Ces entrées ouvrent `/checkin?scan=1` : la caméra démarre sans second appui. Il fonctionne dans l'application installée et garde votre session.
   **Secours** : l'écran ne propose plus l'appareil photo natif (session séparée sur iOS, lien qui sort de l'application). Si la caméra est bloquée, il donne la marche à suivre iPhone ou Android ; sinon, le membre se signale au coach, qui le marque présent à l'appel. Le lien de pointage texte reste accepté, replié sous « J'ai un lien de pointage ».
2. La caméra n'est demandée qu'après un geste explicite (bouton du scanner, ou « Pointer ma présence » ailleurs dans l'application) : une simple visite de `/checkin` ne la sollicite pas. Le décodage se fait dans le navigateur (aucune image n'est envoyée ni conservée).
3. Un écran affiche le cours concerné ; **rien n'est enregistré avant « Confirmer ma présence »**. La confirmation « Présence enregistrée » n'apparaît qu'après la réponse du serveur confirmant l'écriture.

## États et règles (migration `20261013000600_qr_checkin.sql`)

| Élément | Règle |
|---|---|
| Ouverture | `checkin_open` : staff habilité, séance non annulée, entre 2 h avant le début et 2 h après la fin ; fenêtre éteinte automatiquement 2 h après la fin |
| Jeton | 256 bits aléatoires (`randomBytes(32)`), **seul le SHA-256 est stocké**, durée 10–300 s (défaut 90 s), révocable ; table illisible et inaltérable par tout client |
| Fermeture / validation | révoquent tous les jetons ; plus aucun pointage |
| Pointage (`checkin_redeem`) | jeton valide + pointage ouvert + séance non annulée + feuille non validée + appelant **membre du club** + fiche membre **active liée à son compte** |
| Unicité | contrainte `unique (session_id, person_id)` + `ON CONFLICT DO NOTHING` : atomique, un seul pointage même en requêtes concurrentes |
| Pointage déjà présent | réponse « déjà enregistré » ; **rien n'est écrasé** (une correction du coach, ex. « absent », prévaut) |
| Séance annulée après émission | jetons inopérants (vérifié à chaque scan) |

## Modèle de menace

| Risque | Parade | Preuve |
|---|---|---|
| Deviner un jeton | 256 bits, expiration courte, limitation de débit (40 essais / 10 min / utilisateur) | `tests/db/checkin.test.ts`, e2e « jeton inventé » + limitation |
| Photographier/partager le QR | durée de vie ≤ 90 s + renouvellement ; ne sert que si le porteur a un **compte lié au club** ; le coach voit et corrige la liste | e2e expiration (10 s en test) |
| Pointer pour un autre | l'identité vient **uniquement** de la session ; aucun paramètre « personne » ; paramètres d'URL ignorés ; insertion directe interdite aux membres | `checkin.test.ts`, e2e « identifiant forgé » |
| Forger `source = 'qr'` | colonne absente des privilèges d'écriture ; seule la fonction définer l'écrit | `checkin.test.ts` (42501) |
| Rejeu après fermeture | révocation immédiate ; fenêtre bornée | `checkin.test.ts`, e2e |
| Double scan / concurrence | contrainte unique ; 12 requêtes parallèles = 1 ligne | `checkin.test.ts` |
| Oracle d'existence (club, compte, séance) | jeton inconnu, expiré, révoqué, séance close, **autre club** → même erreur, même message | `checkin.test.ts`, e2e (messages identiques) |
| Aperçu de lien / robot | l'ouverture du lien **ne modifie rien** ; confirmation par POST authentifié | e2e |
| Redirection / contenu malveillant d'un QR | seuls un jeton ou un lien `<ce site>/checkin/<jeton>` sont acceptés ; jamais de navigation ailleurs | `tests/unit/checkin.test.ts`, e2e |
| Fuite via journaux | jeton jamais stocké ni journalisé en clair ; audit : `checkin.opened/closed`, `roll.validated/reopened` (sans jeton ni nom) | `checkin.test.ts` |
| Atteinte à la vie privée | **aucune** géolocalisation, reconnaissance faciale, biométrie ; caméra limitée à ce site par `Permissions-Policy: camera=(self)` (jamais un cadre tiers) et demandée seulement après un geste explicite | e2e en-têtes, `qr-camera.spec.ts` |

## Limites connues

- **Pas de preuve de présence physique** : sans géolocalisation (volontairement), un adhérent complice pourrait relayer un QR vivant à quelqu'un d'absent pendant ≤ 90 s. Atténuations : durée courte, compte lié obligatoire, liste visible et corrigeable par le coach, validation de la feuille.
- Un adhérent **sans compte lié** ne peut pas pointer : le coach le saisit à la main.
- Le jeton figure dans l'URL (`/checkin/<jeton>`) : visible dans l'historique du navigateur de l'adhérent et dans d'éventuels journaux d'accès du serveur/CDN pendant sa courte validité. Les journaux applicatifs de Matnexa ne l'enregistrent pas ; configurer l'hébergeur pour ne pas conserver les chemins de requête si possible.
- Décodage par `jsQR` (JavaScript) : peut être lent sur un téléphone très ancien ; l'alternative « coller le lien » existe. Mauvaises conditions (reflets, QR trop petit) : agrandir le QR à l'écran du coach.
- Actualisation par **interrogation toutes les 4 s** (pas de push) : un pointage apparaît chez le coach en ≤ ~5 s ; hors ligne, la liste est figée et un avertissement l'indique.
- **Caméra et appareils** : testée par Chrome avec caméra simulée (motif de test) et avec des échecs simulés (refus, absence, caméra occupée, interruption, arrière-plan : `tests/e2e/qr-camera.spec.ts`, `tests/unit/camera.test.ts`) ; le décodage d'un QR réel est prouvé sur image (test unitaire jsQR) et filmé par la caméra simulée de Chrome (`tests/e2e/qr-real-decode.spec.ts`). Aucun essai sur iPhone/Android physique n'a été fait : voir la procédure ci-dessous.
- **Autres moteurs (Playwright `webkit` et `firefox`)** : les mêmes parcours caméra/QR, responsive, mobile et accessibilité sont rejoués dans le moteur de Safari (WebKit) et dans Firefox (`npx playwright test --project=webkit|firefox`, en CI à chaque push). Caméra simulée : préférences `media.navigator.streams.fake` / `media.navigator.permission.disabled` pour Firefox ; pour WebKit, la permission `camera` de Playwright et la caméra factice du moteur **si cette version en a une**. Faute de fichier vidéo de caméra simulée hors Chromium, le QR réel y est filmé depuis un `<canvas>` (getUserMedia remplacé). Un test qui a besoin d'un flux caméra est **sauté, avec sa raison dans le rapport**, quand le moteur n'en fournit pas (sondage getUserMedia brut, indépendant du scanner ; jamais pour Chromium). Constaté le 2026-10-16 : le WebKit de Playwright pour Windows n'expose pas `navigator.mediaDevices` ni `captureStream` ; le scanner y affiche le message « Aucune caméra utilisable ».
- **WebKit de Playwright n'est PAS un iPhone** : c'est le moteur de rendu de Safari compilé pour Windows ou Linux, sans iOS, sans la vraie caméra ni ses réglages (Réglages › Safari › Caméra), sans la fenêtre d'autorisation de Safari, sans le comportement de l'application installée sur l'écran d'accueil. Un test vert en `webkit` prouve la mise en page, le JavaScript et la gestion des erreurs dans ce moteur, rien de plus : l'étape 8 ci-dessous reste obligatoire.
- Les durées de test (jeton 10 s) viennent de `CHECKIN_TOKEN_TTL_SECONDS` ; ne pas la régler en production sans raison.

## Données

Aucune donnée supplémentaire sur la personne : un pointage est un statut de présence (finalité inchangée). Les jetons expirés sont purgés quotidiennement (`purge_expired_data`). Voir `docs/privacy-gdpr.md`.

## Mode QR fixe du club

En plus du QR tournant (un jeton court par séance, affiché par le coach), un club peut choisir dans **Paramètres → Pointage par QR code** le mode **QR fixe** : une affiche A4 imprimable (avec le nom et le logo du club) affichée dans la salle.

- Le QR encode `<SITE_URL>/checkin/club/<clé>` ; la clé (96 bits) est un secret du club, lisible du staff seulement (`academy_checkin_keys`). **Régénérer le QR** invalide immédiatement les affiches déjà imprimées.
- Au scan, la base retrouve les séances atteignables par l'heure : de `checkin_before_minutes` avant le début à `checkin_after_minutes` après (45 / 30 par défaut, réglables de 0 à 240), hors séances annulées ou dont la feuille est validée. Plusieurs séances qui se chevauchent : l'adhérent choisit, les cours qu'il a réservés en premier.
- Si aucune séance n'est pointable, la page indique le prochain cours et l'heure d'ouverture du pointage (`checkin_fixed_peek` renvoie `next` et `before_minutes`, après les mêmes contrôles de clé et d'appartenance).
- Mêmes règles que le QR tournant : l'identité est celle de la session, **la réservation est obligatoire** (« Réserver et confirmer ma présence » réserve puis pointe ; séance pleine : liste d'attente, pas de pointage), un pointage existant n'est jamais écrasé, et la page d'ouverture ne modifie rien avant confirmation.
- Compromis à connaître : un QR fixe peut être photographié ; il ne fonctionne que pour un adhérent connecté, réservé, dans la fenêtre horaire. Pour un contrôle plus strict, garder le QR tournant.

## Validation sur téléphone (procédure courte, à faire sur un vrai appareil)

Correctif du 2026-10-15 : la caméra était refusée quand le scanner était ouvert depuis l'onglet « Pointer » ou « Scanner à nouveau » (navigation interne : `Permissions-Policy: camera=()` hérité de la page précédente). Reproduit et corrigé dans Chrome ordinateur (même moteur que Chrome Android) ; **à confirmer sur Android**.

Prérequis : application déployée en **https** (la caméra n'existe pas en http, sauf `localhost`), un club avec un cours dans la fenêtre de pointage, un compte membre.

1. **Chrome Android, onglet** : se connecter, ouvrir *Mon espace*, toucher l'onglet **Pointer** (ne PAS recharger la page). Attendu : demande d'autorisation, puis aperçu vidéo de la caméra arrière.
2. Scanner le QR du coach (ou l'affiche du QR fixe) : écran de confirmation du cours, puis « Présence enregistrée ». Le voyant caméra s'éteint.
3. Revenir avec « Scanner à nouveau » ou l'onglet **Pointer** : la caméra redémarre sans message d'erreur.
4. **Refus** : réglages du site › Caméra › Bloquer, puis Pointer. Attendu : « L'accès à la caméra est refusé » avec la marche à suivre Android. Réautoriser dans les réglages puis revenir : le scanner redémarre seul (ou via « Réessayer la caméra »).
5. **Arrière-plan** : pendant le scan, passer sur une autre application puis revenir. Attendu : la caméra est coupée en arrière-plan et relancée au retour.
6. **Application installée (PWA)** : « Ajouter à l'écran d'accueil », l'ouvrir, refaire 1 à 3 ; tester aussi le raccourci « Pointer ma présence » (appui long sur l'icône).
7. **Caméra occupée** : ouvrir l'appareil photo natif, revenir sans le fermer, Pointer. Attendu : message « caméra déjà utilisée » ou démarrage normal selon l'appareil, jamais d'écran figé.
8. Recommencer 1 à 3 sur **Safari iPhone** et sur l'application installée iOS (non-régression).

Noter pour chaque étape : modèle, version d'Android, version de Chrome, résultat. En cas d'échec, `chrome://inspect` (débogage USB) donne la console et le nom exact de l'erreur.
