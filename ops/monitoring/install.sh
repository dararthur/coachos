#!/usr/bin/env bash
# Branche l'alerte d'échec sur les unités Matnexa installées (drop-in OnFailure=). Idempotent. À lancer avec sudo, une fois.
set -eu
src=/srv/coachos/current/ops
install -m 0644 "$src/systemd/coachos-alert@.service" /etc/systemd/system/
for unit in coachos.service coachos-reminders.service coachos-close-rolls.service coachos-purge.service coachos-backup.service; do
  if [ -f "/etc/systemd/system/$unit" ]; then
    mkdir -p "/etc/systemd/system/$unit.d"
    printf '[Unit]\nOnFailure=coachos-alert@%%n.service\n' > "/etc/systemd/system/$unit.d/onfailure.conf"
    echo "alerte branchee : $unit"
  else
    echo "ignore (non installee) : $unit"
  fi
done
systemctl daemon-reload
