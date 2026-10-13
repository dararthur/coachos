# 01 — Chasse aux verbatims (2 h, jours 1–2)

**Pourquoi toi et pas moi :** reddit.com bloque les robots d'IA. Ce signal ne peut être récupéré qu'à la main.
**Objectif :** 30 verbatims bruts, copiés-collés, non reformulés. Ce sont eux qui valident ou tuent la thèse.

## Règle n°1

Tu cherches des gens qui **décrivent le problème sans connaître la solution**.
Un post qui dit « quel logiciel me recommandez-vous ? » ne vaut rien.
Un post qui dit « un gars que je voyais 3× par semaine a disparu, je m'en suis rendu compte un mois après » vaut de l'or.

## Où chercher (par ordre de valeur décroissante)

| # | Terrain | Pourquoi | Attention |
|---|---|---|---|
| 1 | **Groupes Facebook de propriétaires** : « Martial Arts School Owners », « BJJ Gym Owners », « Martial Arts Business » | **L'argent est ici.** Ce sont les décideurs. | Demande à rejoindre le J1, l'approbation prend 24–72 h |
| 2 | r/bjj (filtre : posts de coachs/propriétaires) | Volume énorme | 95 % sont des élèves, pas des acheteurs |
| 3 | r/martialarts, r/MMA, r/GymOwners, r/smallbusiness | Signal secondaire | |
| 4 | Avis App Store / Google Play de : BJJLink, Gymdesk, Kicksite, Zen Planner, Spark, Martialytics | Frustrations produit très concrètes | Filtre 1–3 étoiles uniquement |
| 5 | Avis Capterra / G2 des mêmes | Rédigés par des propriétaires vérifiés | |
| 6 | Commentaires YouTube sur « how to run a BJJ gym », « martial arts school retention » | Voix brutes | |

## Requêtes exactes à coller

Sur Google (la recherche interne de Reddit est mauvaise) :

```
site:reddit.com bjj gym owner "students just" disappear
site:reddit.com "martial arts" school owner retention "quit without"
site:reddit.com bjj instructor "keep track of" students progress
site:reddit.com gym owner "i had no idea" member stopped coming
site:reddit.com "martial arts" "attendance" "i forget" students
site:reddit.com bjj gym "how do you know" who is about to quit
```

Dans les groupes Facebook (barre de recherche du groupe) :

```
retention · churn · "stopped coming" · "disappeared" · "how do you track"
"who to talk to" · "falling off" · "haven't seen" · notes on students
```

Sur les stores et Capterra, cherche dans les avis :

```
"I wish" · "I hate" · "too complicated" · "we still use" · "spreadsheet"
"can't keep track" · "my biggest problem" · "clunky" · "support"
```

## Comment noter (ne reformule JAMAIS)

Un fichier, une ligne par verbatim, dans `discovery/verbatims.csv` :

```csv
date,source,url,role,verbatim_exact,probleme_code,intensite_1_5
```

`role` : owner / head_coach / assistant / student / unknown — **ne compte que owner et head_coach dans le scoring**.

`probleme_code`, un seul par verbatim, choisis dans cette liste fermée :

| Code | Problème |
|---|---|
| `INVISIBLE_CHURN` | « Ils partent et je ne m'en rends compte qu'après » ← **notre thèse** |
| `NO_MEMORY` | « Je ne me souviens plus de qui a besoin de quoi » |
| `ADMIN_TIME` | Temps administratif, paperasse |
| `BILLING_LEAK` | Impayés, prélèvements ratés |
| `LEAD_FOLLOWUP` | Essais non relancés, conversion |
| `SOFTWARE_UX` | Le logiciel est mauvais / lent / cher |
| `STAFF` | Coachs, plannings, remplacements |
| `OTHER` | Autre |

`intensite_1_5` : 1 = évoqué en passant · 5 = raconte une histoire précise avec un nom, une date, une somme.

## Ce que tu cherches vraiment

**Le ratio.** Sur 30 verbatims de owners/head coachs :

- `INVISIBLE_CHURN` + `NO_MEMORY` >= **12/30** → le problème est réel, tu continues.
- Entre **6 et 11** → le problème existe mais n'est pas le n°1. Tu continues les entretiens en gardant l'esprit ouvert sur un pivot.
- **< 6** → **arrête-toi et relis.** Le problème dominant est ailleurs (probablement `BILLING_LEAK` ou `LEAD_FOLLOWUP`), et il est déjà bien servi par BJJLink et Spark. Ce n'est pas ton marché.

## Piège à éviter

Tu vas trouver beaucoup de `SOFTWARE_UX` (« Mindbody est nul »). C'est du bruit :
les gens se plaignent toujours de leur logiciel, et ils n'en changent pas
(coût de migration estimé à 3 000–15 000 $, raison n°1 de l'immobilisme).
Une plainte sur l'UX n'est **pas** une intention d'achat.
