#!/usr/bin/env bash
# Alerte d'échec d'une unité systemd (appelée par coachos-alert@.service via OnFailure=).
# Envoie UNE requête HTTP vers l'adresse de /etc/coachos/alert.env (ALERT_URL), par exemple un sujet ntfy.sh :
#   ALERT_URL=https://ntfy.sh/matnexa-<chaine-secrete-aleatoire>
# Contenu envoyé : nom de l'unité et nom de la machine. AUCUNE donnée personnelle, aucun journal.
# Sans ALERT_URL, l'échec est seulement écrit dans le journal (le script ne échoue jamais : une alerte ne doit pas en provoquer une autre).
set -u
unit="${1:-inconnue}"
host="$(hostname -s 2>/dev/null || echo vps)"
logger -t coachos-alert "unite en echec : ${unit}"
if [ -n "${ALERT_URL:-}" ]; then
  if ! err="$(curl -fsS --max-time 20 -H "Title: Matnexa : echec ${unit}" -H "Priority: high"     -d "L'unite ${unit} a echoue sur ${host}. Voir : journalctl -u ${unit} -n 50" "${ALERT_URL}" 2>&1 >/dev/null)"; then
    logger -t coachos-alert "envoi de l'alerte impossible : ${err}"
  fi
fi
exit 0
