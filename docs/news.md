# Actualités du club

Page `/a/<club>/news` : l'équipe (coach, administrateur, propriétaire) publie des annonces (horaires, stage, compétition…), tous les membres du club les lisent.

## Droits

| Action | Propriétaire | Admin | Coach | Membre |
|---|---|---|---|---|
| Lire les actualités | ✅ | ✅ | ✅ | ✅ |
| Publier | ✅ | ✅ | ✅ | — |
| Modifier / supprimer | toutes | toutes | les siennes | — |

Permission applicative : `news.manage` (`src/domain/roles.ts`). La base applique la même règle par RLS (`club_posts`, migration `20261015001000_club_news`) : un coach ne peut ni modifier ni supprimer la publication d'un autre ; l'auteur est fixé par la base. Aucun accès sans compte (aucune politique pour `anon`).

## Contenu

Texte seul : titre (120 caractères), texte (5 000 caractères), retours à la ligne conservés, rendu en texte brut (pas de HTML ni de Markdown : rien à assainir). Ni image ni pièce jointe pour l'instant (à ajouter avec `src/server/image.ts`).

**RGPD** : une publication ne doit contenir aucune information personnelle sur un membre (nom, santé, résultats). Le formulaire le rappelle. Les publications ne sont pas des données de membres : elles suivent la vie du club (supprimées avec lui) et ne sont jamais conservées après suppression. Publication et suppression sont tracées dans le journal d'audit (`news.published`, `news.deleted`), sans le texte.

## Préparation du site web du club

La colonne `visibility` vaut `members` (défaut) ou `public`. L'application ne propose **pas encore** le choix et n'écrit que `members` ; la lecture reste réservée aux membres connectés. Le jour où le site public existera : ajouter le sélecteur « Publique / Membres » dans `PostForm`, et exposer les publications `public` par une fonction dédiée qui ne renvoie que titre, texte et date (jamais le reste), jamais par une politique ouverte à `anon` sur la table.

## Pas encore fait

Notification (e-mail, push) à la publication ; image ; épinglage ; accueil du membre (« Mon espace ») affichant la dernière annonce.

## Notification à la publication

À la création (pas à la modification), une case « Prévenir les membres par notification » — cochée par défaut, affichée seulement si les notifications sont configurées — envoie une notification push aux appareils des membres du club qui l'ont activée (hors l'auteur). Voir `docs/push.md`.
