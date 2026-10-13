#!/usr/bin/env bash
# Rétention des sauvegardes distantes. NE SUPPRIME RIEN sans --apply : par défaut, affiche seulement ce qui serait supprimé.
# La logique (jour/semaine/mois, dernière sauvegarde toujours conservée, noms inconnus ignorés) est dans scripts/backup-retention.mjs.
# Usage : prune.sh [--apply]    Variable : BACKUP_REMOTE
set -euo pipefail
APPLY=0
case "${1:-}" in
  "") ;;
  --apply) APPLY=1 ;;
  *) echo "Usage : prune.sh [--apply]" >&2; exit 2 ;;
esac
: "${BACKUP_REMOTE:?BACKUP_REMOTE est requis}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TO_DELETE="$(rclone lsf "$BACKUP_REMOTE" | node "$HERE/../../scripts/backup-retention.mjs")"
if [ -z "$TO_DELETE" ]; then echo "[prune] rien à supprimer"; exit 0; fi
while IFS= read -r name; do
  if [ "$APPLY" = 1 ]; then
    rclone deletefile "${BACKUP_REMOTE}/${name}"
    rclone deletefile "${BACKUP_REMOTE}/${name}.sha256" || true
    echo "[prune] supprimé : $name"
  else
    echo "[prune] (simulation) serait supprimé : $name"
  fi
done <<< "$TO_DELETE"
