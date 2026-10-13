#!/usr/bin/env bash
# Retour applicatif manuel à la version « previous » (écrite par activate.sh APRÈS un succès vérifié). NON DESTRUCTIF : aucune version
# supprimée, base intacte. Mêmes preuves et mêmes retours arrière qu'activate.sh. Voir docs/operations.md.
# Un retour automatique d'activate.sh (échec d'une nouvelle version) ne modifie pas « previous » : après un tel échec, la version active
# est de nouveau l'ancienne, et « previous » est celle d'avant elle. Un rollback manuel ira donc encore plus en arrière : vérifier
# l'état avec `ls -l` avant, et utiliser activate.sh <id> pour viser une version précise.
# Usage : rollback.sh [--dry-run] [--no-restart]
set -euo pipefail
ROOT="${RELEASES_ROOT:-/srv/coachos}"
MODE="${COACHOS_POINTER_MODE:-symlink}"
get() {
  if [ "$MODE" = file ]; then [ -f "$ROOT/$1" ] && tr -d '\r\n' < "$ROOT/$1" || true
  else [ -L "$ROOT/$1" ] && basename "$(readlink "$ROOT/$1")" || true; fi
}
PREV="$(get previous)"
CUR="$(get current)"
[ -n "$PREV" ] || { echo "[rollback] ERREUR : aucune version précédente enregistrée (${ROOT}/previous)" >&2; exit 3; }
[ "$PREV" != "$CUR" ] || { echo "[rollback] ERREUR : « previous » est identique à la version active (${CUR}) ; rien à annuler" >&2; exit 3; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[rollback] version active : ${CUR:-aucune} ; retour à : ${PREV}"
exec "$HERE/activate.sh" "$@" "$PREV"
