#!/usr/bin/env bash
# Retour applicatif à la version précédente (lien « previous » écrit par activate.sh). NON DESTRUCTIF : aucune version supprimée,
# base de données intacte. Voir docs/operations.md pour les conditions de compatibilité du schéma.
# Usage : rollback.sh [--dry-run] [--no-restart]
set -euo pipefail
ROOT="${RELEASES_ROOT:-/srv/coachos}"
[ -L "${ROOT}/previous" ] || { echo "[rollback] ERREUR : aucune version précédente enregistrée (${ROOT}/previous)" >&2; exit 3; }
PREV="$(basename "$(readlink "${ROOT}/previous")")"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[rollback] retour à la version ${PREV}"
exec "$HERE/activate.sh" "$@" "$PREV"
