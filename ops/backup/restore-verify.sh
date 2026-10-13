#!/usr/bin/env bash
# Restauration VÉRIFIABLE dans une base JETABLE (jamais sur la base de production). EXEMPLE NON EXÉCUTÉ sur un serveur réel.
#   contrôle SHA-256 -> déchiffrement age (clé privée fournie par la personne qui restaure) -> base temporaire -> pg_restore
#   -> contrôles (RLS partout, tables attendues, suivi des migrations) -> suppression de la base temporaire.
# Prérequis : les rôles globaux (app_server, auth_runtime, authenticated, anon) existent sur le serveur de restauration
#   (créés par le lanceur de migrations sur une base vierge : scripts/migrate.mjs).
# Usage : restore-verify.sh [--dry-run] FICHIER.dump.age
# Variables : RESTORE_ADMIN_URL (URL d'un serveur de TEST/de restauration, pas la production), RESTORE_AGE_IDENTITY_FILE (clé privée age).
set -euo pipefail
umask 077

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=1; shift; fi
ENC="${1:-}"
[ -n "$ENC" ] || { echo "Usage : restore-verify.sh [--dry-run] FICHIER.dump.age" >&2; exit 2; }
: "${RESTORE_ADMIN_URL:?RESTORE_ADMIN_URL est requis (serveur de restauration)}"
: "${RESTORE_AGE_IDENTITY_FILE:?RESTORE_AGE_IDENTITY_FILE est requis}"

SCRATCH="restore_check_$(date -u +%Y%m%dt%H%M%S)"
step() { echo "[restore] $*"; }

if [ "$DRY_RUN" = 1 ]; then
  step "plan (rien n'est exécuté) :"
  step "1. contrôle de ${ENC}.sha256 contre ${ENC}"
  step "2. age -d (clé privée fournie)  ->  fichier temporaire privé"
  step "3. createdb ${SCRATCH}   (nom imposé « restore_check_* »)"
  step "4. pg_restore --exit-on-error --single-transaction vers ${SCRATCH}"
  step "5. contrôles : RLS sur toutes les tables publiques, tables attendues, suivi des migrations non vide"
  step "6. dropdb ${SCRATCH}   (uniquement la base temporaire créée ci-dessus)"
  exit 0
fi

for bin in psql pg_restore createdb dropdb age sha256sum; do
  command -v "$bin" >/dev/null 2>&1 || { echo "[restore] ERREUR : $bin introuvable" >&2; exit 3; }
done
case "$SCRATCH" in restore_check_*) ;; *) echo "[restore] ERREUR : nom de base temporaire inattendu" >&2; exit 3 ;; esac

TMP="$(mktemp -d)"
DUMP="${TMP}/restore.dump"
CREATED=0
cleanup() {
  # Seule la base temporaire créée par CE script peut être supprimée.
  if [ "$CREATED" = 1 ]; then dropdb --if-exists --maintenance-db="$RESTORE_ADMIN_URL" "$SCRATCH" >/dev/null 2>&1 || true; fi
  rm -f "$DUMP"
  rmdir "$TMP" 2>/dev/null || true
}
trap cleanup EXIT

step "contrôle d'intégrité"
(cd "$(dirname "$ENC")" && sha256sum --check "$(basename "$ENC").sha256")
step "déchiffrement"
age -d -i "$RESTORE_AGE_IDENTITY_FILE" -o "$DUMP" "$ENC"
step "restauration dans ${SCRATCH}"
createdb --maintenance-db="$RESTORE_ADMIN_URL" "$SCRATCH"
CREATED=1
SCRATCH_URL="$(printf '%s' "$RESTORE_ADMIN_URL" | sed -E "s#/[^/?]*(\?.*)?\$#/${SCRATCH}\1#")"
pg_restore --exit-on-error --single-transaction --dbname="$SCRATCH_URL" "$DUMP"

q() { psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -tAqc "$1"; }
FAIL=0
check() { if [ "$2" = "$3" ]; then step "OK   $1"; else step "ÉCHEC $1 (attendu $3, obtenu $2)"; FAIL=1; fi; }
check "tables publiques sans RLS" "$(q "select count(*) from pg_tables where schemaname='public' and not rowsecurity")" "0"
check "table academies présente" "$(q "select to_regclass('public.academies') is not null")" "t"
check "tables d'authentification présentes" "$(q "select count(*) from pg_tables where schemaname='auth'")" "4"
check "suivi des migrations non vide" "$(q "select count(*) > 0 from coachos_migrations.applied")" "t"
[ "$FAIL" = 0 ] || { echo "[restore] ÉCHEC de la vérification" >&2; exit 4; }
step "restauration vérifiée (base temporaire supprimée à la sortie)"
