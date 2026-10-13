# Exploitation : sauvegardes, restauration, retour applicatif

> **Statut : procédures et scripts NON exécutés sur un serveur réel.** Aucune sauvegarde réelle n'a été créée, aucune restauration réelle
> n'a été faite, aucun accès serveur n'a eu lieu. Les scripts sont testés localement avec de FAUX binaires (`tests/unit/ops-scripts.test.ts`) ;
> `pg_dump`, `pg_restore`, `age`, `rclone` et `systemd` n'ont jamais tourné ici. Tout ce qui suit est à valider en préproduction.

## 1. Sauvegarde chiffrée hors machine (`ops/backup/backup.sh`)

Chaîne : `pg_dump --format=custom` → `age` (clé **publique** seulement) → SHA-256 → `rclone copyto` vers un stockage hors de la machine
→ relecture de la copie distante et comparaison du SHA-256.

- Le fichier en clair n'existe que dans `BACKUP_WORKDIR` (dossier `0700`, `umask 077`) et est supprimé dès le chiffrement, ou en cas d'échec.
- La clé **privée** age n'est jamais sur le serveur de production : elle est conservée par au moins deux personnes, hors ligne. Le script
  refuse un fichier de destinataires qui contient une clé privée. Une sauvegarde sans clé privée retrouvable est inutilisable.
- Rôle de sauvegarde PostgreSQL dédié, en lecture seule (à créer par une personne ; hors migrations). L'URL est dans un fichier
  `root:root 0600` lu par systemd (`EnvironmentFile`), jamais en argument de ligne de commande, jamais journalisée.
- Les rôles globaux (`app_server`, `auth_runtime`, `authenticated`, `anon`) ne font pas partie d'un `pg_dump` d'une seule base ; ils sont recréés
  par le lanceur de migrations. Ne pas utiliser `pg_dumpall --roles-only` (contient des empreintes de mots de passe).
- Stockage distant : compte séparé du serveur, droits d'écriture seule pour le serveur si le fournisseur le permet (une machine compromise
  ne doit pas pouvoir effacer ses sauvegardes), versionnement ou verrouillage d'objets recommandé.
- `systemd` : `ops/systemd/coachos-backup.service` et `.timer` (exemples non installés).
- `backup.sh --dry-run` affiche le plan sans rien exécuter.

## 2. Rétention (`ops/backup/prune.sh`, `scripts/lib/backup-retention.mjs`)

**Objectifs proposés, à valider avec le client et le coût de stockage** : 14 jours quotidiennes, 8 semaines, 6 mois (une sauvegarde par
période, la plus récente). La plus récente n'est jamais supprimée ; un fichier dont le nom n'est pas exactement celui d'une sauvegarde est ignoré.
`prune.sh` **simule** par défaut ; `--apply` est nécessaire pour supprimer. Les données personnelles restent dans les sauvegardes jusqu'à leur
expiration : la durée maximale doit figurer dans l'information des personnes concernées.

## 3. Restauration vérifiable (`ops/backup/restore-verify.sh`)

Dans une base **jetable** `restore_check_*` d'un serveur de restauration (jamais la production) : contrôle SHA-256, déchiffrement avec la clé
privée fournie par la personne qui restaure, `pg_restore --exit-on-error --single-transaction`, puis contrôles : RLS active sur toutes les
tables publiques, tables attendues présentes, suivi des migrations non vide. La base temporaire est supprimée à la sortie ; le script ne
supprime que celle qu'il a créée.

**Objectifs à mesurer, pas des garanties** : RPO ≤ 24 h (une sauvegarde par nuit), RTO à mesurer lors du premier exercice réel.
Exercice de restauration : une fois avant le pilote, puis tous les trimestres ; consigner date, version, durée, résultat.
Une restauration sur la production est une décision humaine distincte (arrêt du service, sauvegarde de l'état actuel, restauration, `npm run
preflight`, redémarrage) et n'est pas automatisée.

## 4. Mise en production et retour applicatif non destructif (`ops/release/`)

Disposition : `releases/<id>/` (une version complète construite), lien `current`, lien `previous`.

- `activate.sh <id>` : contrôle que la version est complète, enregistre `previous`, bascule `current` de façon atomique, redémarre le service,
  attend `/api/health`, et **revient automatiquement** à la version précédente si le service n'est pas prêt (code 5).
- `rollback.sh` : réactive `previous`. Aucune version n'est supprimée ; la base n'est jamais touchée.
- **Migrations en avant seulement.** Un retour applicatif n'est sûr que si le schéma reste compatible avec l'ancienne version : appliquer les
  changements de schéma en deux temps (ajouter d'abord, retirer une version plus tard — expand/contract). Annuler une migration = restauration
  de sauvegarde, décision explicite. Avant toute migration en production : sauvegarde fraîche et vérifiée.
- Ordre recommandé : sauvegarde → `node scripts/migrate.mjs --dry-run` → `node scripts/migrate.mjs` → `activate.sh`.
- Le nettoyage des anciennes versions (garder les 3 dernières) est manuel.

## 5. À valider en préproduction (non exécuté ici)

1. `backup.sh` réel : durée, taille, droits du dossier, relecture distante.
2. `restore-verify.sh` réel depuis le stockage distant avec la clé privée ; mesurer le RTO.
3. Perte de la clé publique/privée : procédure de rotation des destinataires.
4. `activate.sh` / `rollback.sh` avec le vrai service `systemd` ; comportement de `/api/health` pendant un redémarrage.
5. Alerte si la minuterie de sauvegarde échoue ou si la dernière sauvegarde a plus de 26 h (supervision externe).
6. Test des deux tests ignorés localement (`activate.sh` avec liens symboliques) : ils s'exécutent en CI Linux, pas sous Windows.
