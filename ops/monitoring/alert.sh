#!/usr/bin/env bash
# Alerte d'échec d'une unité systemd (appelée par coachos-alert@.service via OnFailure=).
# Deux canaux facultatifs, configurés dans /etc/coachos/alert.env :
#   ALERT_EMAIL_TO=vous@exemple.fr   e-mail via Resend (réutilise RESEND_API_KEY et MAIL_FROM de /etc/coachos/app.env)
#   ALERT_URL=https://ntfy.sh/matnexa-<chaine-aleatoire>   notification push via ntfy (ou équivalent)
# Contenu envoyé : nom de l'unité et nom de la machine. AUCUNE donnée personnelle, aucun journal.
# Le script ne échoue jamais : une alerte ne doit pas en provoquer une autre. Les échecs d'envoi sont écrits dans le journal.
set -u
unit="${1:-inconnue}"
host="$(hostname -s 2>/dev/null || echo vps)"
msg="L'unite ${unit} a echoue sur ${host}. Voir : journalctl -u ${unit} -n 50"
logger -t coachos-alert "unite en echec : ${unit}"

if [ -n "${ALERT_EMAIL_TO:-}" ] && [ -n "${RESEND_API_KEY:-}" ] && [ -n "${MAIL_FROM:-}" ]; then
  payload="$(printf '{"from":"%s","to":["%s"],"subject":"Matnexa : echec %s","text":"%s"}' "${MAIL_FROM}" "${ALERT_EMAIL_TO}" "${unit}" "${msg}")"
  if ! err="$(curl -fsS --max-time 20 -H "Authorization: Bearer ${RESEND_API_KEY}" -H "Content-Type: application/json" \
    -d "${payload}" https://api.resend.com/emails 2>&1 >/dev/null)"; then
    logger -t coachos-alert "envoi e-mail impossible : ${err}"
  fi
fi

if [ -n "${ALERT_URL:-}" ]; then
  if ! err="$(curl -fsS --max-time 20 -H "Title: Matnexa : echec ${unit}" -H "Priority: high" -d "${msg}" "${ALERT_URL}" 2>&1 >/dev/null)"; then
    logger -t coachos-alert "envoi ntfy impossible : ${err}"
  fi
fi
exit 0
