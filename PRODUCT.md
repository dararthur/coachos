# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Application Next.js installable en PWA (mode standalone, sans service worker ni cache hors ligne de données authentifiées). Pas d'application native.

## Users

- **Coach / encadrant — utilisateur prioritaire.** Téléphone en main, au bord du tatami ou entre deux cours : ouvrir la séance du jour, faire l'appel au doigt, afficher le QR de pointage, consulter une fiche. En cas d'arbitrage entre deux usages, c'est son contexte qui l'emporte.
- **Responsable de club (propriétaire, administrateur).** Plutôt au bureau, sur ordinateur : membres, import et export CSV, planning récurrent, paramètres, équipe et invitations, conformité RGPD. Doit aussi pouvoir présenter l'outil à un dirigeant de club.
- **Adhérent (membre connecté).** Sur téléphone : pointer sa présence par QR, voir le planning à venir et ses propres présences.

Rôles : propriétaire > administrateur > coach > membre (`docs/roles.md`). Un compte peut appartenir à plusieurs clubs avec un rôle différent dans chacun.

## Product Purpose

Matnexa est l'outil de gestion des clubs de sports de combat (JJB, grappling, MMA) : membres, planning des cours, présences et pointage QR, rapports, équipe et invitations, droits RGPD. Il remplace le cahier d'appel et le tableur, et aide le club à garder ses adhérents.

Succès : un coach fait l'appel d'un cours en quelques secondes depuis son téléphone, et le responsable sait chaque semaine quels membres décrochent et à qui parler.

## Positioning

Trois promesses, dans cet ordre, confirmées par le responsable du projet :

1. **Savoir à qui parler.** Le logiciel ne dit pas seulement qui est venu : il signale les membres qui décrochent (aujourd'hui : « Membres à recontacter », actifs sans présence depuis 30 jours).
2. **Un appel fiable et rapide.** La feuille d'appel et le pointage QR n'affichent jamais comme enregistré ce que la base n'a pas confirmé, même avec un réseau instable.
3. **Simplicité tout-en-un.** Un seul outil pour membres, planning, présences et rapports, sans configuration lourde.

## Operating Context

- Cible prioritaire : **clubs moyens, 100 à 300 membres**, plusieurs coachs. Recherche, filtres et pagination sont des usages courants, pas des cas limites.
- Usage en séance : réseau parfois instable dans les salles, une main occupée, lumière variable, temps compté entre deux cours.
- Rituel d'appel : séances du jour → feuille d'appel (Présent / En retard / Absent) → pointage QR optionnel (QR renouvelé toutes les quelques secondes, affiché sur l'écran du coach) → validation de la feuille.
- Données importées depuis l'export CSV d'un ancien logiciel ; exports CSV des membres et des présences.
- Interface et documentation en français ; dates et heures dans le fuseau du club.

## Capabilities and Constraints

- Fonctions existantes : création de compte, confirmation d'e-mail, connexion, mot de passe oublié et réinitialisation, changement de mot de passe ; création de club (onboarding) ; tableau de bord ; membres (liste paginée, recherche, statut actif/archivé, fiche, création, modification, archivage, import CSV en deux étapes, export CSV) ; planning hebdomadaire, séances uniques ou récurrentes, modification, annulation, suppression ; présences et feuille d'appel ; pointage QR (coach) et scanner/confirmation (adhérent) ; rapports filtrables et export CSV ; paramètres (club, disciplines, types de cours, équipe, invitations, journal d'audit, suppression du club) ; espace adhérent ; compte (profil, export JSON des données, suppression) ; notice de confidentialité.
- Adhérents **majeurs uniquement** ; **aucune donnée de santé ni de blessure**.
- Contraintes techniques : la RLS PostgreSQL est la seule autorité d'accès ; Better Auth auto-hébergé ; CSP stricte avec nonce ; aucun service worker. Les identifiants techniques (rôles PostgreSQL, schémas, préfixes `coachos`, nom du dépôt) ne changent pas avec la marque.
- Hors périmètre actuel : paiements, facturation, comptes enfants ou parents, applications natives, IA sur les données des membres. Le moteur de brief hebdomadaire (`v0/`) n'est pas branché à l'application.

## Brand Commitments

- Nom affiché : **Matnexa**, exactement ainsi (pas de « MatNexa », « Mat Nexa » ni autre graphie). Il remplace « Coach OS » dans tout ce que voit l'utilisateur.
- Ton : français clair, factuel, rassurant sur les données ; aucun chiffre ni fonctionnalité inventés.

## Evidence on Hand

- Aucun club pilote, aucun témoignage, aucun chiffre d'usage réel. Les entretiens de découverte (`discovery/`) ne sont pas encore menés. Ne jamais afficher de métriques, de clients ou de citations fictifs.
- Données de démonstration uniquement synthétiques (`npm run db:seed-demo`), clairement étiquetées.

## Product Principles

1. **L'usage en séance d'abord.** Ce qu'un coach fait debout avec un téléphone doit être le geste le plus rapide de l'application.
2. **Ne jamais mentir sur l'état.** Une donnée n'est affichée comme enregistrée qu'après confirmation du serveur ; une perte de connexion est dite, pas masquée.
3. **Agir, pas seulement constater.** Chaque indicateur mène à une action réelle (faire l'appel, recontacter, compléter).
4. **Données minimales.** On ne collecte, n'affiche et n'exporte que ce qui sert le club.
5. **Pas de faux-semblant.** Aucun bouton sans action, aucune métrique ou donnée de démonstration présentée comme réelle.

## Accessibility & Inclusion

WCAG 2.1 AA vérifié automatiquement (axe) sur les pages principales ; navigation au clavier avec lien d'évitement ; cibles tactiles d'au moins 44 × 44 px ; champs à 16 px minimum (pas de zoom iOS) ; respect de `prefers-reduced-motion`.
