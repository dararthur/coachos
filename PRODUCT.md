# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Application Next.js installable en PWA (mode standalone, raccourci de pointage, guide d'installation intégré pour Android et iPhone), sans service worker ni cache hors ligne de données authentifiées. Sessions d'un an renouvelées à l'usage : coachs et adhérents ne se connectent qu'une fois par appareil. Pas d'application native.

## Users

- **Coach / encadrant — utilisateur prioritaire.** Téléphone en main, au bord du tatami ou entre deux cours : ouvrir la séance du jour, voir les inscrits, faire l'appel au doigt, afficher le QR de pointage, consulter une fiche. En cas d'arbitrage entre deux usages, y compris face aux besoins de l'adhérent, c'est son contexte qui l'emporte.
- **Responsable de club (propriétaire, administrateur).** Plutôt au bureau, sur ordinateur : membres, import et export CSV, planning récurrent, paramètres (logo, mode de pointage, code d'inscription), équipe et invitations, conformité RGPD. Doit aussi pouvoir présenter l'outil à un dirigeant de club.
- **Adhérent (membre connecté) — utilisateur secondaire.** Sur téléphone, en autonomie : s'inscrire avec le code ou le lien du club, compléter « Mon profil » (identité, téléphone, ceinture et barrettes, photo facultative ou silhouette), réserver ou annuler un cours, pointer sa présence avec le scanner intégré, voir ses présences et, s'il l'a choisi, le classement. Ses parcours doivent rester simples, y compris pour des adhérents peu à l'aise avec le téléphone.

Rôles : propriétaire > administrateur > coach > membre (`docs/roles.md`). Un compte peut appartenir à plusieurs clubs avec un rôle différent dans chacun.

## Product Purpose

Matnexa est l'outil de gestion des clubs de sports de combat (JJB, grappling, MMA) : membres, planning et réservations, présences et pointage QR, classement, rapports, équipe et invitations, droits RGPD. Il remplace le cahier d'appel et le tableur, et aide le club à garder ses adhérents.

Succès : un coach fait l'appel d'un cours en quelques secondes depuis son téléphone, le responsable sait chaque semaine quels membres décrochent et à qui parler, et les adhérents ont envie de revenir.

## Positioning

Quatre promesses, dans cet ordre, confirmées par le responsable du projet :

1. **Savoir à qui parler.** Le logiciel ne dit pas seulement qui est venu : il signale les membres qui décrochent (« Membres à recontacter », actifs sans présence depuis 30 jours) et permet de leur écrire en un geste (WhatsApp).
2. **Un appel fiable et rapide.** La feuille d'appel, les réservations et le pointage QR n'affichent jamais comme enregistré ce que la base n'a pas confirmé, même avec un réseau instable.
3. **Simplicité tout-en-un.** Un seul outil pour membres, planning, réservations, présences et rapports, sans configuration lourde.
4. **L'assiduité qui motive.** Le classement (semaine, mois, année), auquel l'adhérent choisit d'apparaître, et la progression visible (ceinture, barrettes, assiduité) donnent envie de revenir.

## Operating Context

- Cible prioritaire : **clubs moyens, 100 à 300 membres**, plusieurs coachs. Recherche, filtres et pagination sont des usages courants, pas des cas limites.
- Usage en séance : réseau parfois instable dans les salles, une main occupée, lumière variable, temps compté entre deux cours.
- Arrivée d'un adhérent : il s'inscrit avec le code permanent ou le lien du club (le code survit à la création de compte, à la confirmation d'e-mail et à la connexion) ; sa fiche est créée automatiquement, il complète « Mon profil ».
- Rituel de cours : réservation par l'adhérent (la capacité ne bloque jamais : le surplus part en liste d'attente, promu automatiquement et prévenu par e-mail si la place se libère avant le cours ; le coach peut accorder une place ; annulation possible jusqu'à la validation de la feuille) → séances du jour avec leurs inscrits → feuille d'appel (Présent / En retard / Absent, inscrits en premier) → pointage QR optionnel → validation de la feuille, qui marque absents les inscrits non venus.
- Pointage QR, deux modes au choix du club : **QR tournant** affiché sur l'écran du coach (jeton renouvelé toutes les 45 s au plus) ou **QR fixe** imprimé (affiche A4 avec le logo du club) qui retrouve le cours par l'heure (45 min avant à 30 min après le début par défaut, réglable) ; si des séances se chevauchent, l'adhérent choisit. La réservation est obligatoire pour pointer ; un adhérent non inscrit réserve et pointe en un geste. Le pointage passe par le scanner intégré à l'application, pas par l'appareil photo natif.
- Données importées depuis l'export CSV d'un ancien logiciel (colonne téléphone comprise) ; exports CSV des membres et des présences, réservations et champs de profil inclus.
- Interface et documentation en français ; dates et heures dans le fuseau du club.

## Capabilities and Constraints

- Fonctions existantes : création de compte, confirmation d'e-mail, connexion, mot de passe oublié et réinitialisation, changement de mot de passe ; création de club (onboarding) ; inscription autonome des adhérents par code ou lien permanent (régénérable par le staff) ; tableau de bord ; membres (liste paginée avec assiduité sur 8 semaines, recherche, statut actif/archivé, fiche, création, modification dont ceinture et barrettes par un administrateur, archivage, téléphone et contact WhatsApp, import CSV en deux étapes, export CSV) ; « Mon profil » (identité, téléphone, ceinture, barrettes, photo ou silhouette femme / homme / neutre) ; planning hebdomadaire, séances uniques ou récurrentes, capacité, modification, annulation, suppression ; réservations avec liste d'attente et e-mail à l'adhérent promu ; présences et feuille d'appel ; pointage QR tournant ou fixe (coach), scanner et confirmation (adhérent) ; classement par semaine, mois et année, sur consentement de l'adhérent ; rapports filtrables et export CSV ; paramètres (club, logo, mode et fenêtre de pointage, code d'inscription, disciplines, types de cours, équipe, invitations, journal d'audit, suppression du club) ; espace adhérent ; compte (profil, export JSON des données, suppression) ; notice de confidentialité.
- Adhérents **majeurs uniquement** (attesté par l'adhérent sur son profil, par le staff à la création ou à l'import) ; **aucune donnée de santé ni de blessure**. Le sexe n'est pas collecté : seule une silhouette d'avatar est choisie.
- Photos de profil et logo du club : toute image raster est normalisée côté serveur (256 px, WebP, sans métadonnées) et stockée en base ; une photo n'est visible que de son titulaire, du staff et des membres qui ont accepté le classement ; elle est supprimée avec l'identité lors d'un effacement.
- Contraintes techniques : la RLS PostgreSQL est la seule autorité d'accès ; Better Auth auto-hébergé ; CSP stricte avec nonce ; aucun service worker. Les identifiants techniques (rôles PostgreSQL, schémas, préfixes `coachos`, nom du dépôt) ne changent pas avec la marque.
- Pas encore fait : notification push (l'adhérent promu depuis la liste d'attente est prévenu par e-mail uniquement) ; écran pour qu'un coach ou un membre quitte un club ; grades de la ceinture noire.
- Hors périmètre actuel : paiements, facturation, comptes enfants ou parents, applications natives, IA sur les données des membres. Le moteur de brief hebdomadaire (`v0/`) n'est pas branché à l'application.

## Brand Commitments

- Nom affiché : **Matnexa**, exactement ainsi (pas de « MatNexa », « Mat Nexa » ni autre graphie). Il remplace « Coach OS » dans tout ce que voit l'utilisateur.
- Ton : français clair, factuel, rassurant sur les données ; aucun chiffre ni fonctionnalité inventés.

## Evidence on Hand

- Un pilote est en cours avec un club, mais rien n'en est montrable : ni nom, ni chiffre, ni citation. Ne pas le mentionner publiquement tant que le responsable du projet ne l'a pas autorisé.
- Aucun témoignage, aucun chiffre d'usage réel. Les entretiens de découverte (`discovery/`) ne sont pas encore menés. Ne jamais afficher de métriques, de clients ou de citations fictifs.
- Données de démonstration uniquement synthétiques (`npm run db:seed-demo`), clairement étiquetées.

## Product Principles

1. **L'usage en séance d'abord.** Ce qu'un coach fait debout avec un téléphone doit être le geste le plus rapide de l'application.
2. **Ne jamais mentir sur l'état.** Une donnée n'est affichée comme enregistrée qu'après confirmation du serveur ; une perte de connexion est dite, pas masquée.
3. **Agir, pas seulement constater.** Chaque indicateur mène à une action réelle (faire l'appel, recontacter, réserver, compléter son profil).
4. **Données minimales, visibilité choisie.** On ne collecte, n'affiche et n'exporte que ce qui sert le club ; ce qu'un adhérent montre aux autres (classement, photo) relève de son consentement.
5. **Pas de faux-semblant.** Aucun bouton sans action, aucune métrique ou donnée de démonstration présentée comme réelle.

## Accessibility & Inclusion

WCAG 2.1 AA vérifié automatiquement (axe) sur les pages principales ; navigation au clavier avec lien d'évitement ; cibles tactiles d'au moins 44 × 44 px ; champs à 16 px minimum (pas de zoom iOS) ; respect de `prefers-reduced-motion`. Les parcours adhérent (inscription, réservation, pointage) doivent rester faisables par des adhérents âgés ou peu à l'aise avec le téléphone, sans passer par l'appareil photo natif.
