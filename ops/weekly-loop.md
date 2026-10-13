# Ton rituel hebdomadaire de fondateur

**Durée cible : 40 minutes par semaine, tous coachs confondus.**
Si ça dépasse une heure, tu es en train de faire du service, pas de la validation.

## Dimanche soir — 20 min

Pour chaque coach pilote :

```bash
cd /d/Projects/coachos/v0
node brief.mjs data/<coach>.csv --gym "<Nom du club>" --lang fr --arpu 95
```

1. **Lis le brief avant de l'envoyer.** Tu es le garde-fou : si un nom te semble absurde,
   ne l'envoie pas — note pourquoi dans `notes-produit.md`. C'est le vrai travail produit.
2. Copie le `.txt` dans WhatsApp. Tel quel. Ne l'embellis pas, n'ajoute pas de contexte.
3. Programme l'envoi pour **lundi 7h**.

## Lundi — 0 min

Tu n'envoies rien d'autre. Tu ne relances pas. **Le silence est une donnée.**

## Mercredi — 10 min

Tu notes les réponses reçues dans `out/<coach>-feedback.csv`, colonne `action` :

| Valeur | Sens |
|---|---|
| `spoke` | il a parlé à la personne |
| `skipped` | il n'a pas eu le temps |
| `lost` | la personne a explicitement arrêté |

**Ne remplis rien à sa place.** Une case vide = il n'a pas répondu, et c'est le signal le plus important du produit.

## Dimanche suivant

Le script vérifie tout seul, **dans les présences**, qui est effectivement revenu après le brief.
C'est objectif, ce n'est pas déclaratif. Ça devient la première ligne du brief suivant.

---

## Les 3 chiffres à suivre (rien d'autre)

| # | Métrique | Seuil de survie |
|---|---|---|
| **1** | **Taux de réponse au brief** | >= 60 % à la semaine 3 |
| **2** | **Actions par brief** (`spoke` / 5) | >= 1,5 en moyenne |
| **3** | **Retours vérifiés** (revenus / `spoke`) | >= 25 % |

Le n°1 est le seul qui compte vraiment. **Un coach qui ne répond plus a déjà churné**,
même s'il te dit que c'est super quand tu le croises au club.

## Ton journal produit

Un seul fichier : `notes-produit.md`. Une ligne par observation, datée. Trois choses seulement :

- **Faux positifs** : un nom qui n'aurait pas dû sortir, et pourquoi (→ ajuster RULES.md)
- **Faux négatifs** : « ah mais tu ne m'as pas parlé de X, lui il décroche » (→ **le plus précieux**)
- **Verbatims** : ce que le coach dit spontanément du brief, au mot près

## Le piège

Tu vas vouloir ajouter des features parce qu'un coach te dira « ce serait bien si ».
**Note-le, ne le construis pas.** Pendant ces 4 semaines, la seule question ouverte est :

> Est-ce qu'il ouvre, et est-ce qu'il agit ?

Tout le reste est une distraction déguisée en travail.
