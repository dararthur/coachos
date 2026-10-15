# Exploitation : sauvegardes, restauration, retour applicatif

> **Statut : procédures et scripts NON exécutés sur un serveur réel.** Aucune sauvegarde réelle n'a été créée, aucune restauration réelle
> n'a été faite, aucun accès serveur n'a eu lieu. Les scripts sont testés localement avec de FAUX binaires (`tests/unit/ops-scripts.test.ts`) ;
> `pg_dump`, `pg_restore`, `age`, `rclone` et `systemd` n'ont jamais tourné ici. Les privilèges du rôle de sauvegarde sont, eux, prouvés au
> niveau SQL sur un vrai PostgreSQL (`tests/db/backup-role.test.ts`). Tout le reste est à valider en préproduction (§6).

## 1. Sauvegarde chiffrée hors machine (`ops/backup/backup.sh`)

Chaîne : `pg_dump --format=custom` → `age` (clé **publique** seulement) → SHA-256 → `rclone copyto` vers un stockage hors de la machine
→ relecture de la copie distante et comparaison du SHA-256.

### 1.1 Identifiants : comportement réel

- **Aucune URL de connexion avec mot de passe n'est acceptée.** `BACKUP_DATABASE_URL` (et `RESTORE_ADMIN_URL` pour la restauration) sont
  refusées explicitement (code 2) : un mot de passe dans une URL se retrouve dans les arguments des processus, lisibles par les autres
  comptes de la machine.
- La connexion est décrite par des variables **sans secret** : `BACKUP_PGHOST`, `BACKUP_PGPORT` (défaut 5432), `BACKUP_PGDATABASE`,
  `BACKUP_PGUSER`, `BACKUP_PGSSLMODE` (défaut `verify-full`). Le mot de passe est dans un fichier **`BACKUP_PGPASSFILE`**, au format libpq
  `hôte:port:base:utilisateur:motdepasse`, créé par une personne (ex. `/etc/coachos/backup.pgpass`).
- Le script **refuse de démarrer** si ce fichier est absent, n'est pas un fichier ordinaire, ou n'a pas le mode `0600` (ou `0400`) : le même
  critère que libpq, qui ignorerait sinon le fichier. Le contrôle utilise `stat -c %a`.
- `pg_dump` reçoit uniquement `--format=custom --no-password --file=…` en arguments. L'environnement qui lui est transmis contient
  `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE` et **le NOM** du fichier (`PGPASSFILE`), jamais le mot de passe. `PGPASSWORD`,
  `PGSERVICE`, `PGSERVICEFILE`, `PGSSLKEY` et `PGOPTIONS` éventuellement présents chez l'appelant sont supprimés avant l'appel.
- Aucun message du script n'affiche le contenu d'un fichier de secrets ni une variable de connexion. Les messages de `pg_dump`/`rclone`
  eux-mêmes ne sont pas filtrés : ils peuvent citer l'hôte, jamais le mot de passe.
- Aucun fichier temporaire de secret n'est créé : le fichier de mots de passe est préexistant (donc rien à nettoyer). Le seul fichier
  sensible créé par le script est la copie en clair de la base, dans `BACKUP_WORKDIR` (`0700`), supprimée par un `trap EXIT` dans tous les cas
  (succès, échec, interruption par signal gérable). Une coupure brutale (`kill -9`, perte de courant) peut en laisser un exemplaire : prévoir
  un contrôle du dossier (supervision) et un disque chiffré.
- La clé **privée** age n'est jamais sur le serveur de production : elle est conservée par au moins deux personnes, hors ligne. Le script
  refuse un fichier de destinataires qui contient une clé privée. Une sauvegarde sans clé privée retrouvable est inutilisable.

### 1.2 Privilèges nécessaires du rôle de sauvegarde (`ops/backup/create-backup-role.sql`)

État des lieux vérifié dans le dépôt : toutes les tables du schéma `public` ont la RLS **activée** (sans `FORCE`) et appartiennent au
superutilisateur `postgres` ; les schémas `auth` et `app_private` et le suivi `coachos_migrations` sont fermés aux rôles applicatifs.

| Privilège | Pourquoi | Garde-fou |
|---|---|---|
| `pg_read_all_data` | `SELECT` sur toutes les tables et séquences, `USAGE` sur tous les schémas (dont `auth` et `coachos_migrations`) : nécessaire à une copie **complète** | lecture seule, aucun DDL |
| `BYPASSRLS` | **Indispensable.** `pg_dump` force `row_security=off` ; un rôle qui n'est pas propriétaire et n'a pas `BYPASSRLS` obtient une erreur (copie interrompue). Le contournement par `--enable-row-security` ne copierait que les lignes visibles, soit un sous-ensemble **silencieux** : à ne jamais utiliser | la RLS n'est ni désactivée ni modifiée ; le rôle ne peut rien écrire |
| `default_transaction_read_only = on` | filet supplémentaire contre toute écriture | — |
| `CONNECTION LIMIT 2` | une sauvegarde à la fois | — |
| `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION` | aucun autre privilège | — |

Conséquence assumée : ce rôle **voit les données de tous les clubs** (c'est la définition d'une sauvegarde complète). Son mot de passe est
donc au même niveau de sensibilité que la base : fichier `0600`, jamais dans un dépôt, rotation à chaque départ d'une personne ayant accès.
Le mot de passe se définit à la main (`\password coachos_backup`), jamais dans le script SQL.

**Cohérence** : `pg_dump` lit l'ensemble de la base dans une seule transaction (`REPEATABLE READ`, lecture seule) : la copie est un instantané
cohérent, sans arrêt du service.

**Ce qui a été prouvé, et ce qui ne l'est pas.** `tests/db/backup-role.test.ts` prouve sur un vrai PostgreSQL que ce rôle lit toutes les lignes
de tous les clubs (clubs, personnes, appartenances, utilisateurs d'authentification, suivi des migrations), n'écrit rien, ne modifie pas la RLS
(même nombre de politiques, aucune table sans RLS) et que sans `BYPASSRLS` la lecture est incomplète. **Non prouvé : qu'un `pg_dump` réel
aille au bout avec ce rôle** (les binaires `pg_dump`/`pg_restore` ne sont pas disponibles dans l'environnement de test). À vérifier sur une vraie
instance avant de se fier aux sauvegardes (§6).

**Limites connues.**
- Un `pg_dump` d'une base ne contient **pas** les rôles globaux (ni leurs commentaires, donc ni le marqueur `coachos:managed`) : voir §3.
  Ne pas utiliser `pg_dumpall --roles-only` (contient des empreintes de mots de passe).
- Le dump conserve propriétaires et droits d'origine (`postgres`, rôles applicatifs) : la restauration exige un superutilisateur et des rôles préexistants.
- `pg_read_all_data` existe à partir de PostgreSQL 14 ; la politique de versions du projet (cible 17, minimum 15) est compatible.
- Stockage distant : compte séparé du serveur, droits d'écriture seule pour le serveur si le fournisseur le permet (une machine compromise
  ne doit pas pouvoir effacer ses sauvegardes), versionnement ou verrouillage d'objets recommandé.
- `systemd` : `ops/systemd/coachos-backup.service` et `.timer` (exemples non installés ; `rclone` doit trouver sa configuration, voir `RCLONE_CONFIG`).
- `backup.sh --dry-run` affiche le plan sans rien exécuter (et sans contrôler les secrets).

## 2. Rétention (`ops/backup/prune.sh`, `scripts/lib/backup-retention.mjs`)

**Politique en vigueur (décidée le 15/10/2026)** : 7 jours (`DEFAULT_POLICY`). Une politique plus longue reste possible avec `--daily/--weekly/--monthly` : 14 jours quotidiennes, 8 semaines, 6 mois (une sauvegarde par
période, la plus récente). La plus récente n'est jamais supprimée ; un fichier dont le nom n'est pas exactement celui d'une sauvegarde est ignoré.
`prune.sh` **simule** par défaut ; `--apply` est nécessaire pour supprimer. Les données personnelles restent dans les sauvegardes jusqu'à leur
expiration : la durée maximale doit figurer dans l'information des personnes concernées.

## 3. Restauration vérifiable (`ops/backup/restore-verify.sh`)

Dans une base **jetable** `restore_check_*` d'un serveur de restauration (jamais la production).

**Identifiants** : mêmes règles qu'au §1.1. Variables `RESTORE_PGHOST`, `RESTORE_PGPORT`, `RESTORE_PGUSER`, `RESTORE_PGSSLMODE`,
`RESTORE_PGPASSFILE` (`hôte:port:*:utilisateur:motdepasse`, mode `0600`) et `RESTORE_AGE_IDENTITY_FILE` (clé privée age, mode `0600`,
fournie par la personne qui restaure). Fichiers trop ouverts : refus avant toute commande. `RESTORE_ADMIN_URL` est refusée. L'utilisateur
doit être **superutilisateur du serveur de restauration**.

**Prérequis vérifié par le script, avant toute création de base** : les quatre rôles `anon`, `authenticated`, `app_server`, `auth_runtime`
existent avec le marqueur `coachos:managed`, sinon refus (code 3, « Rien n'a été restauré »). Sur un serveur vierge, les créer en lançant
`node scripts/migrate.mjs` sur une base jetable (qui les crée avec leur marqueur), puis supprimer cette base.

**Déroulement** : contrôle SHA-256 → déchiffrement (fichier temporaire privé) → contrôle des rôles → `createdb` → `pg_restore
--exit-on-error --single-transaction` → contrôles (RLS active sur toutes les tables publiques, `academies` présente, 4 tables
d'authentification, suivi des migrations non vide) → suppression de la base temporaire. Celle-ci est supprimée même si un contrôle échoue
(code 4) ; le script ne supprime que celle qu'il a créée.

**Objectifs à mesurer, pas des garanties** : RPO ≤ 24 h (une sauvegarde par nuit), RTO à mesurer lors du premier exercice réel.
Exercice de restauration : une fois avant le pilote, puis tous les trimestres ; consigner date, version, durée, résultat.
Une restauration sur la production est une décision humaine distincte (arrêt du service, sauvegarde de l'état actuel, restauration, `npm run
pilot:preflight`, redémarrage) et n'est pas automatisée.

## 4. Mise en production et retour applicatif non destructif (`ops/release/`)

Disposition : `releases/<id>/` (une version complète construite), lien `current`, lien `previous`, verrou `.activate.lock`.
Contrat avec `systemd` : l'unité a `WorkingDirectory=/srv/coachos/current` (`ops/systemd/coachos.service`), ce qui permet de **prouver** la version qui tourne.

### 4.1 `activate.sh <id>` : ce qui est exigé pour déclarer un succès
1. `systemctl restart` réussit. **Un échec n'est jamais ignoré** (code 6).
2. Le service a un processus principal **nouveau** (PID différent de celui d'avant le redémarrage) et est actif.
3. Le répertoire courant de ce processus (`/proc/<pid>/cwd`, résolu par le noyau) est **le dossier de la version demandée**. Un ancien
   processus encore en vie, ou un nouveau processus lancé depuis l'ancienne version, ne valide donc pas l'activation.
4. `/api/health` répond 200 (configuration valide, base applicative et base d'authentification disponibles) dans le délai.
5. Le PID est inchangé à la fin du contrôle (pas de redémarrages en boucle).

Le lien `previous` n'est écrit **qu'après** ce succès vérifié.

### 4.2 Échecs et retours arrière
| Situation | Résultat |
|---|---|
| Échec de redémarrage ou non-prêt, il existait une version active | `current` remis sur elle, service redémarré, retour **vérifié avec les mêmes preuves** ; `previous` inchangé ; code 6 ou 5 |
| Le retour automatique lui-même ne se vérifie pas | code **7**, message d'intervention manuelle (`systemctl status`), rien d'autre n'est tenté |
| **Première activation** (aucune version précédente) | `current` écarté (renommé `current.failed`, jamais supprimé) ; le service est laissé tel quel pour examen |
| `--no-restart` | bascule seulement ; **aucune vérification possible** (avertissement) ; redémarrage et contrôle manuels |
| Deux activations simultanées | la seconde est refusée (code 4), si `flock` est disponible |

Aucune version n'est jamais supprimée et la base n'est jamais touchée (ni migration, ni restauration).

### 4.3 `rollback.sh` (retour manuel)
Réactive `previous`, avec exactement les mêmes preuves et retours arrière. Refus si `previous` est absent ou identique à la version active.
Un rollback est lui-même réversible (il échange `current` et `previous`).
**Attention, cas d'un échec d'activation** : après un échec dont le retour automatique a réussi, la version active est l'ancienne et
`previous` est inchangé (c'est la version d'**avant** elle). Un `rollback.sh` lancé juste après irait donc *encore plus en arrière* : vérifier
`ls -l /srv/coachos` d'abord, et préférer `activate.sh <id>` pour viser une version précise.

### 4.4 Base de données
- **Migrations en avant seulement.** Un retour applicatif n'est sûr que si le schéma reste compatible avec l'ancienne version : appliquer les
  changements de schéma en deux temps (ajouter d'abord, retirer une version plus tard — expand/contract). Annuler une migration = restauration
  de sauvegarde (§3), décision explicite et humaine. Aucun retour SQL destructif n'est automatisé.
- Ordre recommandé : sauvegarde fraîche et vérifiée → `node scripts/migrate.mjs --dry-run` → `node scripts/migrate.mjs` → `activate.sh`.
- Le nettoyage des anciennes versions (garder les 3 dernières) est manuel.

## 5. Tests locaux et limites de la plateforme de développement
- Les tests de `ops-scripts` utilisent de faux binaires (`pg_dump`, `age`, `rclone`, `systemctl`, `curl`, `stat`, `psql`…). Ils prouvent la
  **logique des scripts** (ce qui est passé en argument, les codes de sortie, le nettoyage, l'ordre des opérations), pas le comportement des outils réels.
- Sous Windows (système de fichiers sans modes Unix ni liens symboliques, pas de `flock`), `stat` est simulé et les liens `current`/`previous`
  sont remplacés par de simples fichiers (`COACHOS_POINTER_MODE=file`, **réservé aux tests**). Les tests avec de vrais liens symboliques,
  le contrôle de mode réel et le verrou `flock` s'exécutent en CI Linux (job `quality`) ; ils sont ignorés (et listés comme tels) en local.

## 6. À valider en préproduction (non exécuté ici)
1. `create-backup-role.sql` sur une vraie instance, puis `backup.sh` réel : le `pg_dump` va-t-il au bout avec ce rôle ? durée, taille, droits du dossier, relecture distante.
2. `restore-verify.sh` réel depuis le stockage distant avec la clé privée, sur un serveur de restauration ; mesurer le RTO ; vérifier le comportement des propriétaires et des rôles.
3. Perte de la clé publique/privée : procédure de rotation des destinataires.
4. `activate.sh` / `rollback.sh` avec le vrai service `systemd` : `MainPID` pour une unité lançant `npm` (le répertoire courant de `npm` et de `node` doit être celui de la version), `/proc/<pid>/cwd` lisible par l'utilisateur du script, comportement de `/api/health` pendant un redémarrage.
5. Alerte si la minuterie de sauvegarde échoue ou si la dernière sauvegarde a plus de 26 h (supervision externe) ; contrôle de fichiers `.dump` résiduels.
6. Configuration réelle de `rclone` pour l'unité `systemd` (HOME, `RCLONE_CONFIG`) sous `ProtectSystem=strict`.
