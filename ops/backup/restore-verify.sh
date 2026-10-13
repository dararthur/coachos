#!/usr/bin/env bash
# Restauration VÉRIFIABLE dans une base JETABLE (jamais sur la base de production). EXEMPLE NON EXÉCUTÉ sur un serveur réel.
#   contrôle SHA-256 -> déchiffrement age (clé privée fournie par la personne qui restaure) -> contrôle des rôles -> base temporaire
#   -> pg_restore -> contrôles (RLS partout, tables attendues, suivi des migrations) -> suppression de la base temporaire.
#
# IDENTIFIANTS : aucune URL avec mot de passe. Hôte, port, utilisateur : variables sans secret ; mot de passe : fichier PGPASSFILE
# (« hôte:port:*:utilisateur:motdepasse », mode 0600) lu par libpq. Rien de secret dans les arguments, l'environnement ou les journaux.
# L'utilisateur doit être un SUPERUTILISATEUR du serveur de RESTAURATION (propriétaires et droits d'origine restaurés).
#
# Prérequis (sinon refus AVANT toute restauration) : les rôles globaux anon, authenticated, app_server, auth_runtime existent sur le
# serveur de restauration avec le marqueur « coachos:managed ». Ils ne font pas partie d'un pg_dump d'une base : sur un serveur
# vierge, les créer d'abord avec le lanceur de migrations sur une base jetable (scripts/migrate.mjs), puis supprimer cette base.
#
# Usage : restore-verify.sh [--dry-run] FICHIER.dump.age
# Variables : RESTORE_PGHOST, RESTORE_PGUSER, RESTORE_PGPASSFILE, RESTORE_AGE_IDENTITY_FILE (obligatoires) ;
#             RESTORE_PGPORT (défaut 5432), RESTORE_PGSSLMODE (défaut verify-full).
set -euo pipefail
umask 077

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=1; shift; fi
ENC="${1:-}"
[ -n "$ENC" ] || { echo "Usage : restore-verify.sh [--dry-run] FICHIER.dump.age" >&2; exit 2; }
if [ -n "${RESTORE_ADMIN_URL:-}" ]; then
  echo "[restore] ERREUR : RESTORE_ADMIN_URL n'est plus admise (mot de passe dans les arguments des processus). Utiliser RESTORE_PGHOST/PGUSER/PGPASSFILE." >&2
  exit 2
fi
: "${RESTORE_PGHOST:?RESTORE_PGHOST est requis (serveur de restauration)}"
: "${RESTORE_PGUSER:?RESTORE_PGUSER est requis}"
: "${RESTORE_PGPASSFILE:?RESTORE_PGPASSFILE est requis (fichier 0600)}"
: "${RESTORE_AGE_IDENTITY_FILE:?RESTORE_AGE_IDENTITY_FILE est requis}"

SCRATCH="restore_check_$(date -u +%Y%m%dt%H%M%S)"
step() { echo "[restore] $*"; }

if [ "$DRY_RUN" = 1 ]; then
  step "plan (rien n'est exécuté) :"
  step "1. contrôle des fichiers de secrets (mode 0600) et de ${ENC}.sha256 contre ${ENC}"
  step "2. age -d (clé privée fournie)  ->  fichier temporaire privé"
  step "3. contrôle : les 4 rôles Coach OS existent avec le marqueur coachos:managed (sinon refus)"
  step "4. createdb ${SCRATCH}   (nom imposé « restore_check_* »)"
  step "5. pg_restore --exit-on-error --single-transaction vers ${SCRATCH}"
  step "6. contrôles : RLS sur toutes les tables publiques, tables attendues, suivi des migrations non vide"
  step "7. dropdb ${SCRATCH}   (uniquement la base temporaire créée ci-dessus)"
  exit 0
fi

for bin in psql pg_restore createdb dropdb age sha256sum stat; do
  command -v "$bin" >/dev/null 2>&1 || { echo "[restore] ERREUR : $bin introuvable" >&2; exit 3; }
done
case "$SCRATCH" in restore_check_*) ;; *) echo "[restore] ERREUR : nom de base temporaire inattendu" >&2; exit 3 ;; esac

private_file() { # $1 = variable (nom), $2 = chemin
  [ -f "$2" ] || { echo "[restore] ERREUR : $1 est introuvable ou n'est pas un fichier ordinaire" >&2; exit 3; }
  case "$(stat -c '%a' "$2")" in
    400|600) ;;
    *) echo "[restore] ERREUR : $1 doit avoir le mode 0600 (ou 0400)" >&2; exit 3 ;;
  esac
}
private_file RESTORE_PGPASSFILE "$RESTORE_PGPASSFILE"
private_file RESTORE_AGE_IDENTITY_FILE "$RESTORE_AGE_IDENTITY_FILE"

unset PGPASSWORD PGSERVICE PGSERVICEFILE PGSSLKEY PGOPTIONS
export PGHOST="$RESTORE_PGHOST" PGPORT="${RESTORE_PGPORT:-5432}" PGUSER="$RESTORE_PGUSER"
export PGPASSFILE="$RESTORE_PGPASSFILE" PGSSLMODE="${RESTORE_PGSSLMODE:-verify-full}" PGDATABASE=postgres

TMP="$(mktemp -d)"
DUMP="${TMP}/restore.dump"
CREATED=0
cleanup() {
  # Seule la base temporaire créée par CE script peut être supprimée.
  if [ "$CREATED" = 1 ]; then PGDATABASE=postgres dropdb --if-exists --no-password "$SCRATCH" >/dev/null 2>&1 || true; fi
  rm -f "$DUMP"
  rmdir "$TMP" 2>/dev/null || true
}
trap cleanup EXIT

step "contrôle d'intégrité"
(cd "$(dirname "$ENC")" && sha256sum --check "$(basename "$ENC").sha256")
step "déchiffrement"
age -d -i "$RESTORE_AGE_IDENTITY_FILE" -o "$DUMP" "$ENC"

step "contrôle des rôles globaux"
ROLES_OK="$(psql --no-password -v ON_ERROR_STOP=1 -tAqc "select count(*) from pg_roles r where r.rolname in ('anon','authenticated','app_server','auth_runtime') and coalesce(shobj_description(r.oid, 'pg_authid'), '') = 'coachos:managed'")"
if [ "$ROLES_OK" != "4" ]; then
  echo "[restore] ERREUR : les 4 rôles Coach OS (avec le marqueur coachos:managed) sont requis sur le serveur de restauration (trouvés : ${ROLES_OK}). Les créer avec scripts/migrate.mjs sur une base jetable, puis relancer. Rien n'a été restauré." >&2
  exit 3
fi

step "restauration dans ${SCRATCH}"
createdb --no-password "$SCRATCH"
CREATED=1
export PGDATABASE="$SCRATCH"
pg_restore --exit-on-error --single-transaction --no-password --dbname="$SCRATCH" "$DUMP"

q() { psql --no-password -v ON_ERROR_STOP=1 -tAqc "$1"; }
FAIL=0
check() { if [ "$2" = "$3" ]; then step "OK   $1"; else step "ÉCHEC $1 (attendu $3, obtenu $2)"; FAIL=1; fi; }
check "tables publiques sans RLS" "$(q "select count(*) from pg_tables where schemaname='public' and not rowsecurity")" "0"
check "table academies présente" "$(q "select to_regclass('public.academies') is not null")" "t"
check "tables d'authentification présentes" "$(q "select count(*) from pg_tables where schemaname='auth'")" "4"
check "suivi des migrations non vide" "$(q "select count(*) > 0 from coachos_migrations.applied")" "t"
[ "$FAIL" = 0 ] || { echo "[restore] ÉCHEC de la vérification" >&2; exit 4; }
step "restauration vérifiée (base temporaire supprimée à la sortie)"
