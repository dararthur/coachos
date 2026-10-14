---
name: Matnexa
description: Gestion de club pour le JJB, le grappling et le MMA — système visuel « Ceinture ».
colors:
  canvas: "#f4f2ee"
  surface: "#ffffff"
  sunken: "#eeebe5"
  line: "#ddd8cf"
  line-strong: "#8a8378"
  hover: "#fbfaf8"
  selection: "#f8d3bd"
  scrollbar: "#b9b2a6"
  ink: "#16191d"
  ink-soft: "#585d64"
  ink-faint: "#6a6f76"
  bar: "#16191d"
  bar-raised: "#23272d"
  bar-text: "#ffffff"
  bar-muted: "#a3a9b1"
  bar-track: "#3b4047"
  accent: "#c2410c"
  accent-strong: "#a3360a"
  accent-bright: "#ea6a2a"
  accent-soft: "#fbeadf"
  accent-ink: "#9a3412"
  success: "#1e7a46"
  success-soft: "#e5f2ea"
  success-ink: "#14532d"
  warning: "#b45309"
  warning-soft: "#fcf0d9"
  warning-ink: "#6b3d04"
  danger: "#b42318"
  danger-strong: "#8f1c13"
  danger-soft: "#fbe9e7"
  danger-ink: "#7a1a12"
typography:
  figure:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: "2rem"
    fontVariation: "'wdth' 75"
    fontFeature: "'tnum'"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 700
    lineHeight: "1.875rem"
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 80"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: "1.5rem"
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5rem"
    fontFeature: "'tnum'"
  body-sm:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: "1.25rem"
  caption:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"
rounded:
  xs: "2px"
  sm: "4px"
  md: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.sunken}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
    height: "44px"
  button-danger-hover:
    backgroundColor: "{colors.danger-strong}"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "44px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "20px"
  badge:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.xs}"
    padding: "2px 8px"
  nav-item-active:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    height: "44px"
  nav-item:
    backgroundColor: "{colors.bar}"
    textColor: "{colors.bar-muted}"
    height: "44px"
  dialog:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "24px"
    width: "min(32rem, calc(100vw - 2rem))"
---

# Design System: Matnexa

Source normative : `src/app/globals.css` (`@theme`, `.field`, `.tally`), `src/components/ui/`, `src/components/layout/`, `src/components/brand/logo.tsx`. Ce document décrit ce qui est livré ; en cas d'écart, le code fait foi et ce fichier se corrige.

## Overview

**Creative North Star : « La Ceinture »**

Matnexa compte comme une ceinture : chaque présence est une bande de ruban blanc sur une barre noire. La structure est portée par la barre noire de navigation, les données sont comptées en bandes, et rien ne flotte. Fond coton chaud, panneaux blancs sur filets de 1 px, coins presque droits, un seul accent orange réservé à l'action principale et au focus.

La densité est celle d'un outil de travail : en-têtes de page compacts, lignes de liste de 44 à 56 px, chiffres tabulaires partout. Le téléphone du coach au bord du tatami est le cas prioritaire : navigation en bas, barre de progression de l'appel collée au-dessus, cibles de 44 px. Thème clair uniquement (salle éclairée, coups d'œil rapides).

Refus confirmés : barre latérale teintée, rangée de cartes KPI, cartes arrondies à ombre portée.

**Key Characteristics:**
- Barre noire (`bar`) pour la navigation ; l'élément actif est une bande blanche pleine largeur.
- Panneaux blancs, filet `line` de 1 px, coins de 4 px, aucune ombre.
- Un accent orange ceinture, une seule fois par écran, pour l'action principale.
- Couleurs sémantiques séparées de l'accent : vert présent, ambre retard, rouge absent.
- Archivo variable : titres et chiffres condensés en gras, données en chasse normale, chiffres tabulaires.
- Signature : la barrette (bandes de ruban sur barre noire) pour l'appel, l'assiduité, la nav active et le symbole.

## Colors

Neutres chauds et encre quasi noire ; un orange unique ; trois sémantiques indépendantes. Chaque paire texte/fond utilisée est vérifiée AA.

### Primary
- **Orange ceinture** (`accent`) : fond du bouton principal (texte blanc), anneau de focus, couleur du curseur de saisie. Survol et état pressé en `accent-strong`.
- **Orange ceinture vif** (`accent-bright`) : uniquement le trait de comptage du symbole, sur la barre noire.
- **Orange voile** (`accent-soft`) et **orange encre** (`accent-ink`) : badge « marque » et mise en avant légère d'une ligne (séance suivante du tableau de bord, `accent-soft` à 45 %). Jamais pour un état sémantique.

### Neutral
- **Coton** (`canvas`) : fond de page, pied des dialogues, fond de la barre d'appel collante sur mobile.
- **Blanc panneau** (`surface`) : panneaux, tableaux, champs, boutons secondaires.
- **Retrait** (`sunken`) : en-têtes de tableau, badge neutre, survol des boutons secondaires et fantômes, champ désactivé.
- **Survol de ligne** (`hover`) : lignes de tableau et cellules de compteur cliquables, à peine plus chaud que le blanc.
- **Sélection** (`selection`) et **défilement** (`scrollbar`) : texte sélectionné (orange très clair) et curseur des barres de défilement. Surfaces du navigateur thématisées, jamais laissées par défaut.
- **Filet** (`line`) : bordures de panneau, séparateurs de liste et de tableau.
- **Filet fort** (`line-strong`) : bordures de champs et de boutons de statut (3,75:1 sur blanc, seuil des composants d'interface).
- **Encre** (`ink`) : texte principal, onglet de filtre courant, segment actif.
- **Encre douce** (`ink-soft`) : texte secondaire, libellés de stat, en-têtes de colonne (5,9:1 sur coton).
- **Encre pâle** (`ink-faint`) : texte indicatif des champs uniquement (5,1:1 sur blanc).
- **Barre** (`bar`), **barre relevée** (`bar-raised`), **texte de barre** (`bar-text`), **texte de barre atténué** (`bar-muted`, 7,4:1) : barre latérale, barre d'onglets mobile, volet de marque des écrans d'authentification.

### Semantic
- **Vert présent** (`success`, `-soft`, `-ink`), **ambre retard** (`warning`, …), **rouge absent / danger** (`danger`, `danger-strong`, …). Version pleine pour le bouton de statut actif de l'appel et les segments de progression ; version `-soft` + `-ink` pour badges et alertes (bordure de l'alerte : couleur pleine à 30–35 %).

### Named Rules
**La règle de l'accent unique.** L'orange n'apparaît qu'une fois par écran, sur l'action principale (ex. « Faire l'appel » de la séance suivante ; les autres séances ont un bouton secondaire). Toute autre action est secondaire, fantôme ou discrète.

**La règle des sémantiques à part.** Vert, ambre et rouge disent un état (présent, retard, absent, succès, avertissement, erreur) ; l'orange ne dit jamais un état et une sémantique ne sert jamais de décoration.

## Typography

**Police unique :** Archivo variable (graisse 100–900, chasse 62–125 %), sous-ensemble latin auto-hébergé (`src/app/fonts/`, OFL), repli `ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica Neue, Arial`.

**Caractère :** une seule famille, deux chasses : condensée et grasse pour ce qui se lit d'un coup d'œil (titres, chiffres, heures), normale pour les données. `font-variant-numeric: tabular-nums` est posé sur `body`.

### Hierarchy
- **Chiffre** (700, 32 px, chasse 75 %) : valeurs de la bande de compteurs.
- **Titre de page** (700, 26 px, chasse 80 %, -0,01em, `text-wrap: balance`) : un seul `h1` par page, dans l'en-tête de page.
- **Titre de dialogue** (700, 18 px).
- **Titre de panneau** (700, 16 px) : `h2` des panneaux et des états vides.
- **Corps** (400, 16 px / 24 px) : texte courant et champs. Description sous un titre de panneau, en 14 px `ink-soft`.
- **Libellé** (600, 14 px) : boutons, libellés de champ, onglets, navigation.
- **Légende** (400–600, 12 px / 16 px) : badges, en-têtes de colonne, dates secondaires, rôle.
- Heures des séances : 20 px gras chasse 80 % ; noms de famille de l'appel en capitales (donnée, pas décoration).

### Named Rules
**La règle des deux chasses.** Condensé pour titres, chiffres et heures ; chasse normale pour tout ce qui se lit en phrase. Pas de deuxième famille, pas de police système en titre.

**La règle des 16 px.** Tout champ de saisie fait au moins 16 px (pas de zoom iOS).

## Layout

- **Coquille ≥ 768 px (md) :** grille `15rem | 1fr` ; barre latérale noire collante pleine hauteur (logo, club et rôle, navigation, compte en pied). Contenu centré, largeur max 72rem (1152 px), marges 16 / 24 / 32 px selon la largeur, 32 px en haut.
- **Coquille < 768 px :** bandeau blanc collant en haut (symbole, club, compte), barre d'onglets noire fixe en bas (56 px + zone de sécurité). La variable `--tabbar-h` donne sa hauteur ; les barres collantes du bas (feuille d'appel) se posent au-dessus.
- **Pages hors club :** cadre autonome (bandeau blanc + logo, colonne de 28 à 48rem). Authentification : à partir de 1024 px (lg), volet noir de la ceinture à gauche (5/11), formulaire à droite dans un panneau.
- **Rythme :** 24 px entre blocs de page ; panneau à 16 px de marge interne (20 px dès 640 px) ; lignes de liste 14 px vertical ; gouttières 8 à 16 px.
- **Grilles du tableau de bord :** bande de compteurs 2 colonnes puis 4 dès 1024 px ; deux panneaux 7/5 dès 1024 px.
- **Paliers :** 480 px (30rem, réagencement des lignes d'appel), 640 px (sm), 768 px (md, coquille), 1024 px (lg, colonnes).
- **Zones de sécurité :** `viewport-fit=cover` et `env(safe-area-inset-*)` sur le corps, les bandeaux et la barre d'onglets.

### Named Rules
**La règle tableau / rangées.** Les données tabulaires sont un tableau sur grand écran et des rangées empilées (liste à filets, une ligne cliquable de 44 px et plus) en dessous de 640 px. Une liste très large peut basculer plus tôt (membres : 768 px).

**La règle sans style en ligne.** La CSP interdit l'attribut `style` en production (`style-src` à nonce). Les tailles calculées (barres hebdomadaires, progression de l'appel) passent par des attributs SVG ; tout le reste par classes.

## Elevation & Depth

Système plat. La profondeur vient des filets de 1 px, du contraste coton / blanc / retrait et de la barre noire. Une seule ombre existe, pour ce qui flotte réellement.

### Shadow Vocabulary
- **Superposition** (`box-shadow: 0 18px 40px -12px rgb(22 25 29 / 0.35), 0 2px 8px rgb(22 25 29 / 0.12)`) : dialogues modaux uniquement, sur un voile `rgb(22 25 29 / 0.6)`.

### Named Rules
**La règle rien ne flotte.** Aucune ombre sur panneaux, boutons, champs ou listes. Une ombre signifie « au-dessus de la page » : seuls les dialogues la portent.

**La règle pas de carte dans la carte.** Un panneau ne contient jamais un autre panneau ; un tableau ou une liste posé dedans va bord à bord (variante `flush`), séparé par des filets.

## Shapes

Des bandes, pas des pastilles. Coins de 4 px (`sm`) pour panneaux, boutons, champs et alertes ; 2 px (`xs`) pour badges, barrette et segments ; 6 px (`md`) pour les dialogues ; 7/32 du côté pour le carré du symbole. Aucun rayon complet, aucun badge en pilule. Icônes maison sur grille de 24, trait de 1,75, extrémités carrées et angles vifs, toujours accompagnées d'un libellé ou d'un nom accessible.

## Components

### Buttons
Bandes nettes, 44 px de haut minimum, libellé 14 px graisse 600, icône 18 px optionnelle, coins de 4 px, transition de couleur 150 ms.
- **Principal :** orange ceinture, texte blanc ; survol / pression `accent-strong`. Un par écran.
- **Secondaire :** blanc, filet d'encre à 80 %, texte encre ; survol `sunken`. Action par défaut.
- **Danger :** rouge plein, texte blanc ; survol `danger-strong`. Toujours derrière un dialogue de confirmation.
- **Fantôme :** sans fond ni bordure, survol `sunken` (ex. « Écrire » dans une liste).
- **Discret :** lien souligné à 40 % dans une ligne, même cible de 44 px.
- **Désactivé :** opacité 55 %, curseur interdit. Pendant un envoi, le libellé passe à sa forme en cours (« Traitement… »).

### Inputs / Fields
- **Style :** blanc, bordure `line-strong`, 4 px, 44 px de haut, 16 px, marge 8 × 12 px. Une seule définition (`.field`) pour tous les formulaires et filtres ; `select` à chevron SVG ; fichier avec bouton à filet d'encre.
- **Survol :** bordure `ink-soft`. **Focus :** bordure encre + anneau double (2 px blanc, 2 px orange).
- **Erreur :** `aria-invalid` → bordure rouge, message relié au champ. **Désactivé :** fond `sunken`, texte `ink-soft`.
- Libellé visible au-dessus (14 px, 600), jamais remplacé par le texte indicatif.

### Panels (cartes)
- Blanc, filet `line`, 4 px, sans ombre, marge 16 / 20 px. En-tête : titre 16 px gras, description 14 px `ink-soft`, actions à droite.
- **Bord à bord (`flush`) :** l'en-tête prend un filet bas, le contenu (liste, tableau) touche les bords.

### Bande de compteurs
Un seul panneau divisé par des filets de 1 px (grille sur fond `line`), jamais une rangée de cartes. Cellule : libellé 14 px `ink-soft`, chiffre condensé 32 px, indication 12 px. Une cellule peut être un lien qui couvre toute la surface.

### Tables
Cadre panneau ; en-tête `sunken`, 12 px graisse 600 `ink-soft`, filet bas ; lignes séparées par filets, survol `hover` ; colonnes numériques alignées à droite ; légende masquée pour les lecteurs d'écran ; défilement horizontal si nécessaire. Première cellule en `th scope="row"` avec lien de 44 px.

### Badges
Bande rectangulaire de 2 px de rayon, 12 px graisse 600, marge 2 × 8 px. Tons : neutre, succès, avertissement, danger, marque, encre.

### Alerts
Filet + fond `-soft` + texte `-ink` du ton, icône 18 px, 14 px ; titre en gras. Rôle `alert` pour danger / avertissement, `status` sinon. Info : blanc sur filet `line`.

### Navigation
- **Barre latérale (≥ 768 px) :** fond `bar`, entrées de 44 px, 14 px graisse 600, icône 20 px, texte `bar-muted` ; survol `bar-raised` + blanc ; **active : bande blanche pleine largeur, texte encre**.
- **Barre d'onglets (< 768 px) :** fixe en bas, entrées de 56 px, icône 22 px, libellé court 11 px ; **active : trait blanc de 3 px en haut**, texte blanc.
- Sur la barre noire (`data-surface="bar"`), l'anneau de focus passe en blanc.
- **Onglets de filtre :** liens de 44 px, trait bas de 3 px encre sur l'onglet courant (`aria-current`).
- **Lien d'évitement** « Aller au contenu » en premier élément focalisable.

### Dialogs
`<dialog>` natif (focus piégé, Échap) : 32rem max, coins de 6 px, ombre de superposition ; titre 18 px gras (icône d'alerte rouge si destructif) ; pied coton à filet haut, « Annuler » secondaire puis l'action.

### Empty states
Centrés, sans cadre pointillé : quatre bâtons gris (glyphe de comptage), titre 16 px gras, explication 14 px, puis l'action qui remplit le vide.

### La barrette (signature)
- **Assiduité :** barre noire de 2 px de rayon, marge 4 px, bandes de 8 × 20 px espacées de 3 px ; bande blanche (`bar-text`) = semaine avec au moins une venue, `bar-track` sinon. Fiche membre et espace adhérent (`Assiduity`).
- **Assiduité en liste (`TallyBar`, `.tally-sm`) :** même barrette en cases de 5 × 14 px, dans chaque ligne de la liste des membres (colonne « Assiduité (8 sem.) », à droite de la ligne sur mobile) ; nom accessible « Venu(e) N semaines sur 8 ». Les membres qui décrochent se lisent sans ouvrir les fiches.
- **Présences par semaine :** barres SVG noires remplies de ruban blanc, un filet noir tous les 10 présents ; la semaine en cours, incomplète, en `sunken` / `line-strong`.
- **Feuille d'appel :** trois boutons de statut de 44 px par membre (filet `line-strong` au repos, plein vert / ambre / rouge quand actif) ; barre collante au bas avec progression segmentée (vert, ambre, rouge sur `line`), compteurs en texte et bouton « Valider ».

### Grade et silhouettes
- **Ceinture (`BeltIcon`, `BeltLabel`) :** ceinture de JJB vue de dessus, 72 × 18, toile avec deux coutures, barre de grade à droite (noire ; rouge pour la ceinture noire) et 0 à 4 barrettes blanches. Teintes sombres et saturées (bleu `#1f56a8`, violet `#6d3fa8`, marron `#6b4226`) ; la blanche porte un filet `line-strong`. Hauteurs 14 / 18 / 24 px. Nom accessible « Ceinture bleue, 2 barrettes » ; décorative quand le libellé est écrit à côté.
- **Silhouettes (`Silhouette`, `Avatar`) :** tuile `sunken` à coins de 4 px, buste en deux tons (`ink-faint` pour cheveux et vêtement, `scrollbar` pour la peau), sans visage : femme (cheveux mi-longs, épaules étroites), homme (cheveux courts, épaules larges), neutre (tête ronde). Remplacent la photo tant qu'il n'y en a pas ; mêmes tailles 36 / 48 / 96 px.

### Marque
- Nom écrit exactement **« Matnexa »** (jamais « MatNexa », « Mat Nexa »), en texte réel : Archivo gras, chasse 87,5 %, -0,015em.
- **Symbole :** carré noir `#16191d` à coins de 7/32, quatre bandes de ruban blanc verticales, barrées d'un trait orange `#ea6a2a` (le bâton de comptage) détouré de noir. Source vectorielle unique : `public/icons/icon.svg` ; les PNG en sont des rendus.
- Tailles du logotype : 24 / 28 / 40 px ; version claire sur la barre noire avec un filet blanc à 15 %. Couleur de thème du navigateur : `#16191d`.

## Do's and Don'ts

### Do:
- **Do** utiliser l'orange ceinture (`#c2410c`) pour une seule action principale par écran ; tout le reste en secondaire, fantôme ou discret.
- **Do** poser les données dans des panneaux blancs à filet de 1 px et 4 px de coin, et aller bord à bord (`flush`) pour une liste ou un tableau.
- **Do** afficher un tableau sur grand écran et des rangées empilées sous 640 px.
- **Do** garder toute cible tactile à 44 × 44 px minimum et tout champ à 16 px minimum.
- **Do** souligner les liens dans le texte (1 px à 45 %, 2 px plein au survol) : la couleur seule ne suffit pas.
- **Do** laisser le focus visible : contour orange de 2 px décalé de 2 px, blanc sur la barre noire.
- **Do** passer les dimensions calculées par des attributs SVG ou des classes : aucun `style` en ligne (CSP).
- **Do** réutiliser la barrette (bandes blanches sur barre noire) pour tout ce qui se compte.
- **Do** respecter `prefers-reduced-motion` ; les transitions restent des changements de couleur de 100 à 150 ms.

### Don't:
- **Don't** mettre d'ombre ailleurs que sur un dialogue.
- **Don't** imbriquer un panneau dans un panneau.
- **Don't** utiliser l'orange pour un état, ni vert / ambre / rouge pour décorer.
- **Don't** arrondir en pilule ni dépasser 6 px de rayon (hors carré du symbole).
- **Don't** écrire la marque autrement que « Matnexa », ni la dessiner en image de texte.
- **Don't** aligner une rangée de cartes KPI : les compteurs vont dans une seule bande divisée par des filets.
- **Don't** ajouter de surtitre (petit libellé en capitales au-dessus d'un titre) ni d'icône sans libellé.
- **Don't** ajouter de thème sombre ni de seconde famille de caractères.
