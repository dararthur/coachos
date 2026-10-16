# Passages de ceinture et éligibilité

Mis en place le 16/10/2026 (migration `20261016000700_rank_promotions.sql`, règles dans `src/domain/graduation.ts`).

## Ce que fait la fonction

- Chaque changement de ceinture ou de barrette d'une fiche est daté dans un **historique** (`rank_promotions`).
- L'équipe (propriétaire, administrateur, coach) peut **enregistrer un passage** à la date réelle, et **confirmer la date** à laquelle la personne a reçu sa ceinture actuelle.
- L'application calcule une **date d'éligibilité indicative** à la ceinture suivante, d'après les minimums de l'IBJJF, et signale sur le tableau de bord les adhérents qui l'atteignent (ou l'atteindront dans 30 jours).

**Rien n'est automatique** : aucun passage n'est jamais posé ni suggéré comme obligatoire, sauf l'information « un enfant de 16 ans doit passer aux ceintures adultes » (règle IBJJF). Le coach reste seul juge. L'IBJJF le dit elle-même : le temps passé à chaque ceinture est « à la discrétion du professeur » ; ses minimums conditionnent seulement la reconnaissance du grade par la fédération.

## Qui voit quoi

| | Équipe du club | Adhérent |
|---|---|---|
| Historique des passages | oui | non (dans l'écran) ; oui, dans **l'export de ses données** (droit d'accès) |
| Date d'éligibilité, liste « Passages à évaluer » | oui | **jamais** |
| Sa ceinture et ses barrettes actuelles | oui | oui (comme avant) |

La table n'est lisible que par le staff (RLS). La date d'éligibilité n'est **stockée nulle part** : elle est recalculée à chaque affichage pour le staff. Un adhérent, même en interrogeant l'API, ne peut ni lire l'historique ni appeler `record_promotion` / `set_belt_since` (testé dans `tests/db/rank-promotions.test.ts`).

## D'où viennent les dates (et pourquoi certaines sont « à confirmer »)

- Passage enregistré par l'équipe : date choisie, **confirmée**.
- Changement fait par l'adhérent dans « Mon profil », ou fiche créée avec une ceinture : la date vaut « aujourd'hui » et n'est **pas confirmée**. Elle ne sert **pas** au calcul : l'écran demande à l'équipe de confirmer la date de la ceinture actuelle. On évite ainsi qu'une ceinture déclarée le jour de l'inscription fasse croire à une durée fausse.
- Les barrettes ne remettent pas la durée à zéro : la durée court depuis la couleur de ceinture.

## Règles reprises de l'IBJJF (General System of Graduation, version de juin 2026)

Source : [ibjjf.com/graduation-system](https://ibjjf.com/graduation-system), art. 2 (âges minimums) et art. 3 (durées minimales).

| Ceinture visée | Âge minimum | Durée minimale à la ceinture précédente |
|---|---|---|
| Bleue | 16 ans | aucune (blanche) |
| Violette | 16 ans | **2 ans** à la bleue (1 an si l'athlète a été gris, jaune ou orange ; aucune s'il a été vert) |
| Marron | 18 ans | **1 an et demi** à la violette |
| Noire | **19 ans** (18 ans seulement pour un champion du monde adulte à la marron) | **1 an** à la marron |

Enfants (4 à 15 ans) : **aucune durée minimale**. Groupes gris (dès 4 ans), jaune (7), orange (10), vert (13). À partir de l'année des 16 ans, passage aux ceintures adultes : bleue, ou bleue / violette depuis la verte, au choix du professeur.

**Âge IBJJF** : année en cours moins année de naissance. Une personne devient donc éligible le **1er janvier** de l'année de ses 16, 18 ou 19 ans, quel que soit son anniversaire.

## Limites connues (affichées à l'équipe)

- **Âge d'un adulte** : Matnexa efface la date de naissance à la majorité. Pour un adulte, seul l'âge de la ceinture noire (19 ans) n'est pas vérifiable : l'écran le rappelle.
- **Non calculé** : l'exception « champion du monde adulte » (aucune durée minimale), les réductions liées à une ceinture bleue ou violette « juvénile », les degrés de la ceinture noire (3, 3, 3, 5 ans…).
- Les durées sont celles des **adultes (18 ans et plus)** ; pour 16 et 17 ans, l'IBJJF n'impose aucune durée à la bleue et traite la violette dans la division adulte : le calcul reste prudent (il peut annoncer une date plus tardive que la règle).
- La règle des 19 ans pour la noire est déduite de l'article 2.1.2 (la mention « 18 ans » est limitée aux champions du monde adultes) ; l'ancienne version du système la fixait à 19 ans. À revérifier à chaque nouvelle version du document IBJJF.

## Évolution

À chaque nouvelle version du système de graduation, relire art. 2 et 3 et mettre à jour `MIN_AGE` et `MIN_MONTHS_AT` (`src/domain/graduation.ts`) et `tests/unit/graduation.test.ts`. Un club qui voudrait d'autres règles (présences minimales, durées plus longues) demande une évolution : la fonction actuelle n'a pas de réglage par club.

## RGPD

Donnée personnelle ordinaire (grade et date), visible du staff seulement, **effacée à l'anonymisation** de la fiche (et en cascade à la suppression), gardée avec la fiche archivée. Incluse dans les exports. Aucun profilage : la date d'éligibilité est un calcul déterministe à partir de durées et d'âges publics, sans effet automatique. Voir [registre](rgpd/registre.md).
