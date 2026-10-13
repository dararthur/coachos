#!/usr/bin/env bash
# Sauvegarde chiffrée de la base Coach OS vers un stockage HORS de la machine. EXEMPLE NON EXÉCUTÉ sur un serveur réel.
#   pg_dump (format custom) -> chiffrement age (clé PUBLIQUE seulement) -> somme SHA-256 -> envoi rclone -> vérification distante.
# Le fichier en clair n'existe que dans un dossier privé (umask 077) et est supprimé dès le chiffrement (ou en cas d'échec).
#
# IDENTIFIANTS : jamais d'URL avec mot de passe. La connexion est décrite par des variables SANS secret (hôte, port, base, utilisateur)
# et le mot de passe est lu par libpq dans un fichier PGPASSFILE (format « hôte:port:base:utilisateur:motdepasse »), de mode 0600, créé
# par une personne (ex. /etc/coachos/backup.pgpass). Le mot de passe n'apparaît donc ni dans les arguments des processus, ni dans
# l'environnement, ni dans les journaux. Les variables PGPASSWORD / PGSERVICE / PGSERVICEFILE du processus appelant sont ignorées.
#
# Usage : backup.sh [--dry-run]    (--dry-run : affiche le plan, n'exécute AUCUNE commande de sauvegarde)
# Variables : BACKUP_PGHOST, BACKUP_PGDATABASE, BACKUP_PGUSER, BACKUP_PGPASSFILE (obligatoires) ; BACKUP_PGPORT (défaut 5432),
#             BACKUP_PGSSLMODE (défaut verify-full ; « prefer » seulement pour une socket locale),
#             BACKUP_AGE_RECIPIENTS_FILE (clés publiques age), BACKUP_REMOTE (ex. « offsite:coachos-backups »),
#             BACKUP_WORKDIR (défaut /var/backups/coachos).
# Le rôle de sauvegarde et ses privilèges : ops/backup/create-backup-role.sql, docs/operations.md.
# La clé PRIVÉE age n'est JAMAIS présente sur le serveur de production.
set -euo pipefail
umask 077

DRY_RUN=0
case "${1:-}" in
  "") ;;
  --dry-run) DRY_RUN=1 ;;
  *) echo "Usage : backup.sh [--dry-run]" >&2; exit 2 ;;
esac

if [ -n "${BACKUP_DATABASE_URL:-}" ]; then
  echo "[backup] ERREUR : BACKUP_DATABASE_URL n'est plus admise (un mot de passe dans une URL finit dans les arguments des processus). Utiliser BACKUP_PGHOST/PGDATABASE/PGUSER/PGPASSFILE." >&2
  exit 2
fi
: "${BACKUP_PGHOST:?BACKUP_PGHOST est requis}"
: "${BACKUP_PGDATABASE:?BACKUP_PGDATABASE est requis}"
: "${BACKUP_PGUSER:?BACKUP_PGUSER est requis}"
: "${BACKUP_PGPASSFILE:?BACKUP_PGPASSFILE est requis (fichier 0600, jamais le mot de passe lui-même)}"
: "${BACKUP_AGE_RECIPIENTS_FILE:?BACKUP_AGE_RECIPIENTS_FILE est requis (clés PUBLIQUES age)}"
: "${BACKUP_REMOTE:?BACKUP_REMOTE est requis (stockage hors machine)}"
WORKDIR="${BACKUP_WORKDIR:-/var/backups/coachos}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="${WORKDIR}/coachos-${STAMP}.dump"
ENC="${DUMP}.age"
SUM="${ENC}.sha256"

step() { echo "[backup] $*"; }

# Le fichier de mots de passe doit exister, être un fichier ordinaire et n'être accessible qu'à son propriétaire (libpq l'ignorerait sinon).
check_passfile() {
  [ -f "$BACKUP_PGPASSFILE" ] || { echo "[backup] ERREUR : BACKUP_PGPASSFILE est introuvable ou n'est pas un fichier ordinaire" >&2; exit 3; }
  local mode
  mode="$(stat -c '%a' "$BACKUP_PGPASSFILE")"
  case "$mode" in
    400|600) ;;
    *) echo "[backup] ERREUR : BACKUP_PGPASSFILE doit avoir le mode 0600 (ou 0400) ; mode actuel : ${mode}" >&2; exit 3 ;;
  esac
}

if [ "$DRY_RUN" = 1 ]; then
  step "plan (rien n'est exécuté) :"
  step "1. contrôle du fichier de mots de passe (mode 0600) ; connexion ${BACKUP_PGUSER}@(hôte fourni)/${BACKUP_PGDATABASE}, mot de passe lu par libpq dans le fichier"
  step "2. pg_dump --format=custom  ->  ${DUMP}   (aucun identifiant dans les arguments)"
  step "3. age -R ${BACKUP_AGE_RECIPIENTS_FILE}  ->  ${ENC}   puis suppression du fichier en clair"
  step "4. sha256sum  ->  ${SUM}"
  step "5. rclone copyto  ->  ${BACKUP_REMOTE}/$(basename "$ENC") (+ somme)"
  step "6. vérification : SHA-256 de la copie distante identique à la somme locale"
  exit 0
fi

for bin in pg_dump age rclone sha256sum stat; do
  command -v "$bin" >/dev/null 2>&1 || { echo "[backup] ERREUR : $bin introuvable" >&2; exit 3; }
done
check_passfile
[ -s "$BACKUP_AGE_RECIPIENTS_FILE" ] || { echo "[backup] ERREUR : fichier de destinataires age absent ou vide" >&2; exit 3; }
if grep -q "AGE-SECRET-KEY" "$BACKUP_AGE_RECIPIENTS_FILE"; then
  echo "[backup] ERREUR : une clé PRIVÉE age figure dans le fichier de destinataires ; seules les clés publiques sont admises" >&2
  exit 3
fi

mkdir -p "$WORKDIR"
chmod 700 "$WORKDIR"
cleanup() { rm -f "$DUMP"; }
trap cleanup EXIT

# Environnement de connexion : uniquement le NOM du fichier de mots de passe, jamais son contenu.
unset PGPASSWORD PGSERVICE PGSERVICEFILE PGSSLKEY PGOPTIONS
export PGHOST="$BACKUP_PGHOST" PGPORT="${BACKUP_PGPORT:-5432}" PGDATABASE="$BACKUP_PGDATABASE" PGUSER="$BACKUP_PGUSER"
export PGPASSFILE="$BACKUP_PGPASSFILE" PGSSLMODE="${BACKUP_PGSSLMODE:-verify-full}"

step "export de la base"
pg_dump --format=custom --no-password --file="$DUMP"
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
