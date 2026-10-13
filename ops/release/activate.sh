#!/usr/bin/env bash
# Active une version déjà déposée dans RELEASES_ROOT/releases/<id> : bascule atomique du lien « current », redémarrage du service,
# PREUVE que la nouvelle version tourne, retour automatique à la version précédente en cas d'échec. EXEMPLE NON EXÉCUTÉ sur un serveur réel.
#
# NON DESTRUCTIF : ne supprime AUCUNE version, ne touche JAMAIS à la base de données (pas de migration, pas de restauration).
# Les migrations sont « en avant seulement » : un retour applicatif n'est sûr que si le schéma reste compatible avec l'ancienne version
# (règle expand/contract, docs/operations.md). Revenir sur la base = restauration explicite, décidée par une personne.
#
# Succès = TOUTES ces conditions, sinon échec et retour arrière :
#   1. `systemctl restart` réussit (un échec n'est JAMAIS ignoré : code 6) ;
#   2. le service a un processus principal NOUVEAU (PID différent de celui d'avant) et est actif ;
#   3. ce processus tourne depuis le dossier de LA version demandée (répertoire courant du processus = releases/<id>) : un ancien
#      processus encore en vie ne peut donc pas valider l'activation ;
#   4. /api/health répond 200 (configuration, bases) ;
#   5. le PID n'a pas changé pendant le contrôle (pas de redémarrages en boucle).
# Contrat avec systemd : l'unité doit avoir WorkingDirectory=<RELEASES_ROOT>/current (voir ops/systemd/coachos.service).
#
# Le lien « previous » n'est écrit qu'APRÈS un succès vérifié : un échec ne modifie ni « current » (restauré) ni « previous ».
# Première activation (aucune version précédente) : en cas d'échec, le lien « current » est écarté (renommé current.failed) ; aucune
# version n'est supprimée et l'état du service est laissé tel quel pour examen.
#
# Usage : activate.sh [--dry-run] [--no-restart] <identifiant-de-version>
#   --no-restart : bascule seulement ; AUCUNE vérification n'est possible, l'opération doit être suivie d'un redémarrage manuel.
# Codes : 0 succès ; 2 usage ; 3 version absente/incomplète ; 4 activation déjà en cours ; 5 non prêt (retour arrière fait) ;
#         6 redémarrage en échec (retour arrière fait) ; 7 retour arrière lui-même non vérifié (intervention manuelle).
# Variables : RELEASES_ROOT (défaut /srv/coachos), COACHOS_SERVICE (défaut coachos), HEALTH_URL (défaut http://127.0.0.1:3100/api/health),
#             HEALTH_RETRIES (défaut 30), HEALTH_RETRY_DELAY (secondes, défaut 1), PROC_ROOT (défaut /proc).
# COACHOS_POINTER_MODE=file : MODE DE TEST uniquement (les « liens » sont de simples fichiers : environnements sans liens symboliques).
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
PROC_ROOT="${PROC_ROOT:-/proc}"
MODE="${COACHOS_POINTER_MODE:-symlink}"

step() { echo "[release] $*"; }
warn() { echo "[release] $*" >&2; }

# --- « liens » current / previous (symlinks en production ; fichiers en mode de test) -------------------------------------------------
link_get() { # $1 = nom ; affiche l'identifiant visé, ou rien
  if [ "$MODE" = file ]; then [ -f "$ROOT/$1" ] && tr -d '\r\n' < "$ROOT/$1" || true
  else [ -L "$ROOT/$1" ] && basename "$(readlink "$ROOT/$1")" || true; fi
}
link_set() { # $1 = nom, $2 = identifiant ; remplacement atomique
  if [ "$MODE" = file ]; then printf '%s\n' "$2" > "$ROOT/$1.tmp"; mv "$ROOT/$1.tmp" "$ROOT/$1"
  else ln -sfn "releases/$2" "$ROOT/$1.tmp"; mv -T "$ROOT/$1.tmp" "$ROOT/$1"; fi
}
proc_cwd() { # répertoire courant (résolu) du processus $1
  if [ "$MODE" = file ]; then tr -d '\r\n' < "$PROC_ROOT/$1/cwd" 2>/dev/null || true
  else readlink -f "$PROC_ROOT/$1/cwd" 2>/dev/null || true; fi
}
main_pid() { systemctl show -p MainPID --value "$SERVICE" 2>/dev/null || echo 0; }
real_dir() { (cd "$ROOT/releases/$1" && pwd -P); }

TARGET="${ROOT}/releases/${ID}"
[ -d "$TARGET" ] || { echo "[release] ERREUR : version introuvable : ${TARGET}" >&2; exit 3; }
{ [ -f "$TARGET/package.json" ] && [ -d "$TARGET/.next" ]; } || { echo "[release] ERREUR : version incomplète (package.json et .next requis)" >&2; exit 3; }

CURRENT_ID="$(link_get current)"

if [ "$DRY_RUN" = 1 ]; then
  step "plan (rien n'est exécuté) :"
  step "version actuelle : ${CURRENT_ID:-aucune} ; version demandée : ${ID}"
  step "1. current -> releases/${ID} (bascule atomique)"
  if [ "$RESTART" = 1 ]; then
    step "2. systemctl restart ${SERVICE} (un échec fait échouer l'opération)"
    step "3. preuve : nouveau PID, service actif, répertoire courant du processus = releases/${ID}, ${URL} (${RETRIES} essais), PID stable"
    step "4. échec => retour à ${CURRENT_ID:-« aucune version précédente : current.failed »}"
  else
    step "2. --no-restart : AUCUNE vérification (redémarrage manuel requis)"
  fi
  step "5. succès => previous = ${CURRENT_ID:-aucune}"
  step "La base de données n'est pas modifiée."
  exit 0
fi

if command -v flock >/dev/null 2>&1; then
  exec 9>"$ROOT/.activate.lock"
  flock -n 9 || { warn "[release] ERREUR : une autre activation est en cours"; exit 4; }
fi

healthy() {
  local i
  for ((i = 1; i <= RETRIES; i++)); do
    if curl -fsS --max-time 5 "$URL" >/dev/null 2>&1; then return 0; fi
    sleep "$DELAY"
  done
  return 1
}

# Prouve que la version $1 tourne (voir l'en-tête). $2 = PID d'avant le redémarrage. Écrit la raison de l'échec sur stderr.
verify_running() {
  local id="$1" old_pid="$2" pid expected cwd pid_after
  pid="$(main_pid)"
  if ! [[ "$pid" =~ ^[0-9]+$ ]] || [ "$pid" -le 0 ]; then warn "[release] le service n'a aucun processus principal"; return 1; fi
  if [ "$old_pid" -gt 0 ] && [ "$pid" = "$old_pid" ]; then warn "[release] le processus n'a pas été remplacé (ancien PID encore actif)"; return 1; fi
  systemctl is-active --quiet "$SERVICE" || { warn "[release] le service n'est pas actif"; return 1; }
  expected="$(real_dir "$id")"
  cwd="$(proc_cwd "$pid")"
  if [ "$cwd" != "$expected" ]; then warn "[release] le processus ne tourne pas depuis la version ${id} (répertoire courant différent)"; return 1; fi
  healthy || { warn "[release] ${URL} ne répond pas 200 dans le délai"; return 1; }
  pid_after="$(main_pid)"
  if [ "$pid_after" != "$pid" ]; then warn "[release] le service a redémarré pendant le contrôle (instable)"; return 1; fi
  return 0
}

# Échec après bascule : $1 = code, $2 = message. Remet la version précédente (ou écarte current à la première activation).
fail_and_revert() {
  local code="$1"
  warn "[release] ERREUR : $2"
  if [ -n "$CURRENT_ID" ] && [ "$CURRENT_ID" != "$ID" ]; then
    link_set current "$CURRENT_ID"
    if [ "$RESTART" = 1 ]; then
      local old_pid_revert
      old_pid_revert="$(main_pid)"
      if systemctl restart "$SERVICE" && verify_running "$CURRENT_ID" "$old_pid_revert"; then
        warn "[release] retour automatique à ${CURRENT_ID} (vérifié) ; « previous » inchangé"
      else
        warn "[release] ATTENTION : le retour à ${CURRENT_ID} n'est PAS vérifié. Intervention manuelle requise (systemctl status ${SERVICE})."
        exit 7
      fi
    else
      warn "[release] retour à ${CURRENT_ID} (lien seulement)"
    fi
  else
    mv -T "$ROOT/current" "$ROOT/current.failed" 2>/dev/null || true
    warn "[release] première activation : aucune version précédente. Lien « current » écarté (current.failed) ; service laissé en l'état."
  fi
  exit "$code"
}

OLD_PID=0
if [ "$RESTART" = 1 ]; then
  OLD_PID="$(main_pid)"
  [[ "$OLD_PID" =~ ^[0-9]+$ ]] || OLD_PID=0
fi

link_set current "$ID"
step "lien « current » -> ${ID}"
if [ "$RESTART" = 1 ]; then
  systemctl restart "$SERVICE" || fail_and_revert 6 "systemctl restart ${SERVICE} a échoué"
  verify_running "$ID" "$OLD_PID" || fail_and_revert 5 "la version ${ID} n'est pas prête"
else
  warn "[release] --no-restart : version basculée mais NON vérifiée ; redémarrer le service puis contrôler ${URL}"
fi

if [ -n "$CURRENT_ID" ] && [ "$CURRENT_ID" != "$ID" ]; then link_set previous "$CURRENT_ID"; fi
step "version active et vérifiée : ${ID}"
