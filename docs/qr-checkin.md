# Pointage des présences par QR code

Un adhérent connecté enregistre lui-même sa présence en scannant un QR code affiché par le coach. **Ce n'est pas un second système de présence** : un pointage est une ligne `attendance` ordinaire (`source = 'qr'`), soumise aux mêmes contraintes, au même historique, aux mêmes exports et aux mêmes corrections que la saisie manuelle.

## Parcours

**Coach** (page *Présences → Faire l'appel* d'une séance, rôle propriétaire/admin, ou coach affecté à la séance) :
1. *Ouvrir le pointage* → un QR s'affiche avec un compte à rebours ; il se renouvelle tout seul (toutes les ≤ 45 s, à mi-vie du jeton). Un « lien de pointage » texte est disponible si le scan est impossible.
2. La liste se met à jour toute seule (toutes les 4 s, au retour du réseau et de l'onglet) ; les pointés par QR portent le badge « Pointé par QR ».
3. Corrections libres à tout moment : changer un statut (la ligne redevient « manuelle »), effacer, ajouter un adhérent qui n'a pas de compte (la feuille complète reste la liste des membres actifs).
4. *Fermer le pointage* (révoque immédiatement tous les QR) ou *Valider la feuille d'appel* (ferme + révoque ; réversible par *Rouvrir la feuille*).

**Adhérent** (compte rattaché à sa fiche membre par l'invitation « fiche membre liée ») :
1. *Mon espace → Scanner le QR code* (ou scan natif de l'appareil photo : le lien s'ouvre dans Coach OS ; ou collage du lien si pas de caméra).
2. La caméra n'est demandée qu'après le clic ; le décodage se fait dans le navigateur (aucune image n'est envoyée ni conservée).
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
| Atteinte à la vie privée | **aucune** géolocalisation, reconnaissance faciale, biométrie ; caméra limitée à `/checkin` par `Permissions-Policy` | e2e en-têtes |

## Limites connues

- **Pas de preuve de présence physique** : sans géolocalisation (volontairement), un adhérent complice pourrait relayer un QR vivant à quelqu'un d'absent pendant ≤ 90 s. Atténuations : durée courte, compte lié obligatoire, liste visible et corrigeable par le coach, validation de la feuille.
- Un adhérent **sans compte lié** ne peut pas pointer : le coach le saisit à la main.
- Le jeton figure dans l'URL (`/checkin/<jeton>`) : visible dans l'historique du navigateur de l'adhérent et dans d'éventuels journaux d'accès du serveur/CDN pendant sa courte validité. Les journaux applicatifs de Coach OS ne l'enregistrent pas ; configurer l'hébergeur pour ne pas conserver les chemins de requête si possible.
- Décodage par `jsQR` (JavaScript) : peut être lent sur un téléphone très ancien ; l'alternative « coller le lien » existe. Mauvaises conditions (reflets, QR trop petit) : agrandir le QR à l'écran du coach.
- Actualisation par **interrogation toutes les 4 s** (pas de push) : un pointage apparaît chez le coach en ≤ ~5 s ; hors ligne, la liste est figée et un avertissement l'indique.
- **Caméra et appareils** : testée par Chrome avec caméra simulée (pas de décodage d'un vrai flux) ; le décodage d'un QR réel est prouvé sur image (test unitaire jsQR). Aucun essai sur iPhone/Android physique n'a été fait.
- Les durées de test (jeton 10 s) viennent de `CHECKIN_TOKEN_TTL_SECONDS` ; ne pas la régler en production sans raison.

## Données

Aucune donnée supplémentaire sur la personne : un pointage est un statut de présence (finalité inchangée). Les jetons expirés sont purgés quotidiennement (`purge_expired_data`). Voir `docs/privacy-gdpr.md`.
