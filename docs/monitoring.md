# Supervision et mesure d'usage (pilote)

Objectif : savoir **avant le club** que le service est tombé ou qu'une tâche planifiée a échoué, et voir ce qui est réellement utilisé. Aucun outil ne reçoit de donnée personnelle.

## 1. Le site répond (sonde externe)

Une sonde gratuite appelle `https://app.matnexa.fr/api/health` toutes les 5 minutes (200 = configuration valide et deux bases disponibles ; 503 = indisponible, sans cause dans le corps). Au choix : UptimeRobot, Better Stack ou Healthchecks. Le seul paramètre est l'URL publique, et l'alerte part par e-mail ou notification. Test : arrêter le service quelques minutes (`sudo systemctl stop coachos`, puis `start`) et vérifier que l'alerte arrive.

## 2. Une tâche planifiée a échoué (alerte systemd)

`coachos-alert@.service` est lancée par `OnFailure=` quand l'application, les rappels, la clôture des feuilles, la purge ou la sauvegarde échouent. Elle envoie **un message** (nom de l'unité et de la machine) par e-mail (`ALERT_EMAIL_TO`, via Resend, avec la clé déjà présente dans `app.env`) et/ou vers `ALERT_URL` (un sujet [ntfy](https://ntfy.sh) à nom aléatoire). ntfy.sh peut refuser les envois depuis un VPS partagé (HTTP 429, constaté sur OVH) : l'e-mail est le canal recommandé. Sans canal, seul le journal est écrit (`sudo journalctl -t coachos-alert`).

Installation (une fois, sur le VPS) :

```bash
sudo bash /srv/coachos/current/ops/monitoring/install.sh
```

```bash
echo 'ALERT_EMAIL_TO=vous@exemple.fr' | sudo tee /etc/coachos/alert.env && sudo chown root:coachos /etc/coachos/alert.env && sudo chmod 0640 /etc/coachos/alert.env
```

Test de panne simulée :

```bash
sudo systemctl start coachos-alert@coachos-test.service && sudo journalctl -t coachos-alert -n 5 --no-pager
```

## 3. Une tâche n'a pas tourné du tout (filet de sécurité)

`OnFailure=` ne voit pas un minuteur silencieusement arrêté. Pour la sauvegarde et la purge, créer un contrôle « dead man's switch » (Healthchecks, période 1 jour et marge) et ajouter après la sauvegarde un `ExecStartPost=/usr/bin/curl -fsS --max-time 10 <URL-de-ping>`. Le ping ne contient rien.

## 4. Mesure d'usage

Table `usage_events` (migration 20261016000300) : une ligne = *club, événement, instant*. Aucun identifiant de personne ni de séance. Événements : `checkin_qr`, `booking_created`, `roll_validated`, `roll_auto_closed`, alimentés par des déclencheurs sur les tables existantes. Lecture réservée aux administrateurs du club (Réglages → Activité, 7 et 30 jours) ; conservation 13 mois, purge par `/api/cron/purge`.

Pour le suivi du pilote (hors interface) :

```sql
select event, count(*) from public.usage_events
where academy_id = '<id du club>' and created_at > now() - interval '30 days' group by 1 order by 1;
```

Part de pointage autonome = `checkin_qr` / (présences enregistrées) ; part de feuilles clôturées automatiquement = `roll_auto_closed` / (`roll_auto_closed` + `roll_validated`), seuil 30 % (voir `docs/qr-checkin.md`).
