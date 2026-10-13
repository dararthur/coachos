#!/usr/bin/env bash
# Active une version déjà déposée dans RELEASES_ROOT/releases/<id> : bascule atomique du lien « current », redémarrage, contrôle de santé,
# retour automatique à la version précédente si le service n'est pas prêt. EXEMPLE NON EXÉCUTÉ sur un serveur réel.
#
# NON DESTRUCTIF : ne supprime AUCUNE version, ne touche JAMAIS à la base de données (pas de migration, pas de restauration).
# Les migrations sont « en avant seulement » : un retour applicatif n'est sûr que si le schéma reste compatible avec l'ancienne version
# (règle expand/contract, docs/operations.md). Revenir sur la base = restauration explicite, décidée par une personne.
#
# Usage : activate.sh [--dry-run] [--no-restart] <identifiant-de-version>
# Variables : RELEASES_ROOT (défaut /srv/coachos), COACHOS_SERVICE (défaut coachos), HEALTH_URL (défaut http://127.0.0.1:3100/api/health),
#             HEALTH_RETRIES (défaut 30), HEALTH_RETRY_DELAY (secondes, défaut 1).
set -euo pipefail

DRY_RUN=0
RESTART=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --no-restart) RESTART=0 ;;
    -*) echo "Option inconnue : $1" >&2; exit 2 ;;
    *) break ;;
  esac
  shift
done
ID="${1:-}"
[[ "$ID" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Usage : activate.sh [--dry-run] [--no-restart] <identifiant-de-version>" >&2; exit 2; }

ROOT="${RELEASES_ROOT:-/srv/coachos}"
SERVICE="${COACHOS_SERVICE:-coachos}"
URL="${HEALTH_URL:-http://127.0.0.1:3100/api/health}"
RETRIES="${HEALTH_RETRIES:-30}"
DELAY="${HEALTH_RETRY_DELAY:-1}"
TARGET="${ROOT}/releases/${ID}"

step() { echo "[release] $*"; }
[ -d "$TARGET" ] || { echo "[release] ERREUR : version introuvable : ${TARGET}" >&2; exit 3; }
[ -f "$TARGET/package.json" ] && [ -d "$TARGET/.next" ] || { echo "[release] ERREUR : version incomplète (package.json et .next requis)" >&2; exit 3; }

CURRENT_ID=""
if [ -L "${ROOT}/current" ]; then CURRENT_ID="$(basename "$(readlink "${ROOT}/current")")"; fi

if [ "$DRY_RUN" = 1 ]; then
  step "plan (rien n'est exécuté) :"
  step "version actuelle : ${CURRENT_ID:-aucune} ; version demandée : ${ID}"
  step "1. current -> releases/${ID} (bascule atomique) ; previous -> ${CURRENT_ID:-aucune}"
  [ "$RESTART" = 1 ] && step "2. systemctl restart ${SERVICE}"
  step "3. contrôle ${URL} (${RETRIES} essais) ; échec => retour automatique à ${CURRENT_ID:-la version précédente}"
  step "La base de données n'est pas modifiée."
  exit 0
fi

switch_to() { # $1 = identifiant ; bascule atomique du lien
  ln -sfn "releases/$1" "${ROOT}/current.tmp"
  mv -T "${ROOT}/current.tmp" "${ROOT}/current"
}
restart() { [ "$RESTART" = 1 ] && systemctl restart "$SERVICE" || true; }
healthy() {
  local i
  for ((i = 1; i <= RETRIES; i++)); do
    if curl -fsS --max-time 5 "$URL" >/dev/null 2>&1; then return 0; fi
    sleep "$DELAY"
  done
  return 1
}

if [ -n "$CURRENT_ID" ] && [ "$CURRENT_ID" != "$ID" ]; then ln -sfn "releases/${CURRENT_ID}" "${ROOT}/previous"; fi
switch_to "$ID"
step "version active : ${ID}"
restart
if [ "$RESTART" = 1 ] && ! healthy; then
  echo "[release] ERREUR : le service n'est pas prêt après activation de ${ID}" >&2
  if [ -n "$CURRENT_ID" ] && [ "$CURRENT_ID" != "$ID" ]; then
    switch_to "$CURRENT_ID"
    restart
    echo "[release] retour automatique à ${CURRENT_ID}" >&2
  fi
  exit 5
fi
step "terminé"
