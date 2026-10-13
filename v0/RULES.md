# Spécification des règles déterministes

> **Règle absolue : aucune de ces décisions ne passe par un LLM.**
> Tout est calculé en SQL/JS, testable, versionné, explicable au coach en une phrase.
> Le LLM n'interviendra jamais que pour : transcrire, extraire d'une note vocale, reformuler, rechercher.
> Il ne calcule rien, ne décide rien, n'invente aucun nom.

## Faits calculés par élève (à la date de référence)

| Fait | Définition | Pourquoi |
|---|---|---|
| `lastSeen` | Date du dernier cours | Ancrage |
| `daysSince` | Jours depuis `lastSeen` | Brut, insuffisant seul |
| `tenureDays` | Jours depuis le 1er cours | Un nouveau ne se juge pas comme un ancien |
| `totalClasses` | Nombre de présences | Évite de flaguer un curieux venu 2 fois |
| `baselinePerWeek` | Cours/semaine sur la fenêtre **J-70 → J-14** | **Exclut les 2 dernières semaines** : sinon la chute contamine sa propre référence |
| `recentPerWeek` | Cours/semaine sur les **14 derniers jours** | |
| `deltaPct` | `(recent − baseline) / baseline` | La baisse *relative*, pas absolue |
| `expectedGapDays` | `7 / baselinePerWeek` | Son rythme normal entre deux cours |
| `gapRatio` | `daysSince / expectedGapDays` | **Le fait central.** 10 jours d'absence ne veulent pas dire la même chose pour un 4×/sem. et un 1×/sem. |
| `isNew` | `tenureDays <= 42` | Les 6 premières semaines décident de tout |
| `isReturning` | Une coupure >= 21 j terminée dans les 7 derniers jours | |
| `streakWeeks` | Semaines consécutives avec >= 1 cours | |

## Les 6 règles

Chaque règle produit : un **motif factuel** (ce qui est vrai) et une **action** (ce que le coach fait).
Jamais de pourcentage, jamais de prédiction.

| Code | Déclencheur | Motif affiché | Action |
|---|---|---|---|
| `NEW_SLIPPING` | `isNew` ET `daysSince >= 7` ET `totalClasses >= 2` | « Nouveau depuis X sem., N cours, plus rien depuis Y jours » | Un message aujourd'hui. Un nouveau absent 7 jours est généralement déjà parti. |
| `FADING` | `baselinePerWeek >= 1.5` ET `deltaPct <= −0.5` ET `daysSince <= 10` | « Est passé de N à M cours/sem. » | **Il vient encore : parle-lui sur le tatami cette semaine.** Le rattrapage le moins cher qui existe. |
| `RETURNED` | `isReturning` | « De retour après X jours d'absence » | 30 secondes : « content de te revoir ». Le retour n°2 se joue sur le retour n°1. |
| `GHOST` | `gapRatio >= 3` ET `daysSince >= 10` ET `totalClasses >= 8` | « Venait N×/sem., plus rien depuis X jours » | Un message personnel, sans culpabilisation, sans offre commerciale. |
| `NEW_UNSEEN` | `isNew` ET `totalClasses >= 3` ET aucune note enregistrée | « Nouveau, N cours, aucun retour de ta part » | 2 minutes de feedback individuel après le cours. |
| `QUIET_RELIABLE` | `streakWeeks >= 8` ET `baselinePerWeek >= 2` ET aucune note depuis 60 j | « Assidu depuis X semaines, jamais eu de retour de ta part » | Ceux-là partent sans prévenir. Un mot suffit. |

## Sélection : 5 maximum, et un **mélange**

Un brief de 5 fantômes est démoralisant et inactionnable — il sera ignoré dès la semaine 2.
L'ordre de priorité est celui de **la probabilité de réussite × la valeur**, pas de la gravité :

```
1. NEW_SLIPPING    urgence maximale, effort minimal
2. FADING          il est encore là = tu peux lui parler en vrai
3. RETURNED        victoire gratuite, à ne jamais rater
4. GHOST           forte valeur, faible taux de réussite
5. NEW_UNSEEN      préventif
6. QUIET_RELIABLE  préventif
```

**Quota : 2 élèves maximum par règle** dans un même brief.
Départage à l'intérieur d'une règle : `baselinePerWeek` décroissant (on protège d'abord les plus engagés),
puis `daysSince` décroissant.

## Anti-fatigue (indispensable)

Un élève déjà signalé dans les **2 derniers briefs** et toujours absent **sort du top 5**
et passe dans une annexe « toujours sans nouvelles ».

Sans cette règle, le brief devient une liste de morts qui se répète, le coach arrête de l'ouvrir,
et le produit meurt en semaine 3.

## Ce qui est explicitement interdit

- ❌ Un score ou un pourcentage de risque de churn.
  Invérifiable avant ~200 départs étiquetés, destructeur de confiance au premier faux positif,
  et inconfortable juridiquement en Europe (profilage de personnes identifiées).
- ❌ Une recommandation de grade ou de passage de ceinture. **Le grade appartient au professeur.**
  Un logiciel qui suggère une ceinture se fait éjecter du club.
- ❌ Une phrase dans le brief qui ne soit pas rattachable à un fait calculé (`fact_id`).

## La boucle — la seule chose qui construit un moat

Chaque brief attend **une réponse en un geste** : `spoke` / `skipped` / `lost`.

La présence effective de l'élève **après** la date du brief est ensuite vérifiée
objectivement dans les données de présence — pas déclarée par le coach.

Au bout de 12 mois, ça produit le seul jeu de données au monde reliant
**action de coach → retour effectif** en sports de combat.
Un tableau de bord ne peut structurellement pas produire cette donnée.
