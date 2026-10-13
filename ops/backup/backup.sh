#!/usr/bin/env bash
# Sauvegarde chiffrée de la base Coach OS vers un stockage HORS de la machine. EXEMPLE NON EXÉCUTÉ sur un serveur réel.
#   pg_dump (format custom) -> chiffrement age (clé PUBLIQUE seulement) -> somme SHA-256 -> envoi rclone -> vérification distante.
# Le fichier en clair n'existe que dans un dossier privé (umask 077) et est supprimé dès le chiffrement (ou en cas d'échec).
# Usage : backup.sh [--dry-run]    (--dry-run : affiche le plan, n'exécute AUCUNE commande de sauvegarde)
# Variables : BACKUP_DATABASE_URL (rôle en lecture seule recommandé), BACKUP_AGE_RECIPIENTS_FILE (clés publiques age),
#             BACKUP_REMOTE (ex. « offsite:coachos-backups »), BACKUP_WORKDIR (défaut /var/backups/coachos).
# La clé PRIVÉE age n'est JAMAIS présente sur le serveur de production (voir docs/operations.md).
set -euo pipefail
umask 077

DRY_RUN=0
case "${1:-}" in
  "") ;;
  --dry-run) DRY_RUN=1 ;;
  *) echo "Usage : backup.sh [--dry-run]" >&2; exit 2 ;;
esac

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL est requis}"
: "${BACKUP_AGE_RECIPIENTS_FILE:?BACKUP_AGE_RECIPIENTS_FILE est requis (clés PUBLIQUES age)}"
: "${BACKUP_REMOTE:?BACKUP_REMOTE est requis (stockage hors machine)}"
WORKDIR="${BACKUP_WORKDIR:-/var/backups/coachos}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="${WORKDIR}/coachos-${STAMP}.dump"
ENC="${DUMP}.age"
SUM="${ENC}.sha256"

step() { echo "[backup] $*"; }

if [ "$DRY_RUN" = 1 ]; then
  step "plan (rien n'est exécuté) :"
  step "1. pg_dump --format=custom  ->  ${DUMP}   (URL de base : non affichée)"
  step "2. age -R ${BACKUP_AGE_RECIPIENTS_FILE}  ->  ${ENC}   puis suppression du fichier en clair"
  step "3. sha256sum  ->  ${SUM}"
  step "4. rclone copyto  ->  ${BACKUP_REMOTE}/$(basename "$ENC") (+ somme)"
  step "5. vérification : SHA-256 de la copie distante identique à la somme locale"
  exit 0
fi

for bin in pg_dump age rclone sha256sum; do
  command -v "$bin" >/dev/null 2>&1 || { echo "[backup] ERREUR : $bin introuvable" >&2; exit 3; }
done
[ -s "$BACKUP_AGE_RECIPIENTS_FILE" ] || { echo "[backup] ERREUR : fichier de destinataires age absent ou vide" >&2; exit 3; }
if grep -q "AGE-SECRET-KEY" "$BACKUP_AGE_RECIPIENTS_FILE"; then
  echo "[backup] ERREUR : une clé PRIVÉE age figure dans le fichier de destinataires ; seules les clés publiques sont admises" >&2
  exit 3
fi

mkdir -p "$WORKDIR"
chmod 700 "$WORKDIR"
cleanup() { rm -f "$DUMP"; }
trap cleanup EXIT

step "export de la base"
pg_dump --format=custom --no-password --dbname="$BACKUP_DATABASE_URL" --file="$DUMP"
step "chiffrement"
age -R "$BACKUP_AGE_RECIPIENTS_FILE" -o "$ENC" "$DUMP"
rm -f "$DUMP"
(cd "$WORKDIR" && sha256sum "$(basename "$ENC")" > "$(basename "$SUM")")
step "envoi hors machine"
rclone copyto "$ENC" "${BACKUP_REMOTE}/$(basename "$ENC")"
rclone copyto "$SUM" "${BACKUP_REMOTE}/$(basename "$SUM")"
step "vérification distante"
LOCAL_SUM="$(cut -d' ' -f1 "$SUM")"
REMOTE_SUM="$(rclone cat "${BACKUP_REMOTE}/$(basename "$ENC")" | sha256sum | cut -d' ' -f1)"
if [ "$LOCAL_SUM" != "$REMOTE_SUM" ]; then
  echo "[backup] ERREUR : la copie distante diffère de la sauvegarde locale" >&2
  exit 4
fi
step "terminé : $(basename "$ENC")"
