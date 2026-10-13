# Rôles et permissions

Hiérarchie : **propriétaire > administrateur > coach > membre**. Un compte peut appartenir à plusieurs clubs avec un rôle différent dans chacun. Source applicative : `src/domain/roles.ts` ; application dans la base : RLS + fonctions (`tests/db/roles-workflows.test.ts` vérifie l'égalité des deux).

| Action | Propriétaire | Admin | Coach | Membre |
|---|:-:|:-:|:-:|:-:|
| Voir le tableau de bord, les rapports | ✅ | ✅ | ✅ | — |
| Voir le planning | ✅ | ✅ | ✅ | ✅ |
| Créer / modifier / annuler des séances | ✅ | ✅ | — | — |
| Enregistrer des présences | ✅ | ✅ | séances qui lui sont affectées ou sans coach | — |
| Voir les présences | toutes | toutes | toutes | les siennes |
| Ouvrir/fermer le pointage QR, valider la feuille d'appel | ✅ | ✅ | séances qui lui sont affectées ou sans coach | — |
| Pointer sa propre présence par QR | — (sauf fiche liée) | — (sauf fiche liée) | — (sauf fiche liée) | ✅ (compte lié à sa fiche) |
| Voir les fiches membres | ✅ | ✅ | ✅ | la sienne |
| Créer un membre | ✅ | ✅ | ✅ (nouvel arrivant) | — |
| Modifier / archiver un membre | ✅ | ✅ | — | — |
| Importer un CSV, exporter (CSV) | ✅ | ✅ | — | — |
| Exporter / effacer les données d'un membre | ✅ | ✅ | — | — |
| Disciplines et types de cours | ✅ | ✅ | — | — |
| Paramètres du club, journal d'audit | ✅ | ✅ | — | — |
| Inviter coachs/membres, changer leur rôle, les retirer | ✅ | ✅ | — | — |
| Inviter / nommer / retirer un **admin ou propriétaire** | ✅ | — | — | — |
| Supprimer le club | ✅ | — | — | — |

Règles : un club conserve toujours au moins un propriétaire ; on ne change pas son propre rôle ; la base permet à chacun de quitter un club (`remove_member`, sauf dernier propriétaire) — pas encore d'écran dédié pour les coachs et membres ; un accès retiré est effectif immédiatement (la RLS relit l'appartenance à chaque requête). Les membres sans compte (fiches) n'ont aucun accès : ils n'existent que comme données gérées par le club.
