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

## 5. Console d'administration (`/admin`)

Réservée au compte dont l'e-mail confirmé est `PLATFORM_ADMIN_EMAIL` : tout autre compte, connecté ou non, reçoit un 404, et les fonctions de base (`admin_overview`, `admin_list_clubs`) refusent aussi tout autre compte (42501). On y accède depuis « Mon compte » → « Ouvrir l'administration ».

- **Vue d'ensemble** : nombre de clubs, clubs avec de l'usage sur 30 jours, membres actifs, comptes, demandes en attente, usage 7 et 30 jours par type d'événement, taille et version de la base.
- **Liste des clubs** : membres, équipe, séances des 30 derniers jours, usage 7 jours, dernier usage, e-mail du propriétaire, date de création. État : *Actif* (usage sur 7 jours), *Calme* (sur 30 jours), *Inactif*.
- Aucune donnée de membre n'est affichée (ni nom, ni e-mail, ni présence individuelle) : uniquement des compteurs et le contact du propriétaire.

### Tâches planifiées et santé des envois

Sur la vue d'ensemble, deux panneaux (migration 20261016001200, tables `job_runs` et `platform_counters`, `src/domain/monitoring.ts`) :

- **Tâches planifiées** : rappels de séance (toutes les 5 min), clôture des feuilles (toutes les heures), purge (chaque nuit). Chaque appel d'une route `/api/cron/*` enregistre son succès ou son échec (code d'erreur court). État : *Bon*, *En retard* (pas de passage depuis 15 min, 2 h 30 ou 30 h selon la tâche : le minuteur est probablement arrêté), *En échec* (le dernier passage a échoué), *Jamais exécutée*.
- **Envois** : compteurs des 7 et 30 derniers jours, sans aucune donnée personnelle : e-mails envoyés et en échec (tous les envois passent par `getMailer`), notifications envoyées, en échec et appareils expirés supprimés. Un chiffre rouge sur « en échec » mérite un coup d'œil aux journaux.
- **Limite** : la sauvegarde est lancée par systemd hors application et ne figure pas ici. Son contrôle reste l'alerte `OnFailure=` puis un « dead man's switch » (voir §3).
- Les écritures de supervision sont « au mieux » : une panne de ces tables ne fait jamais échouer une tâche ni un envoi. Rétention des compteurs : 13 mois (purge nocturne).

### Clubs à surveiller et usage sur 13 mois

Migration 20261016001300 (lecture seule, aucune donnée de plus). Sur la vue d'ensemble, le panneau **Clubs à surveiller** liste, du plus grave au moins grave :

- **Inactif** : aucun usage depuis 14 jours ou plus, ou jamais d'usage depuis la création ;
- **En baisse** : l'usage des 30 derniers jours est inférieur à la moitié de celui des 30 jours précédents, à condition que ceux-ci aient compté au moins 10 événements (sinon la comparaison n'a pas de sens).

Un club de moins de 14 jours est « en démarrage » et n'est jamais signalé. Règles dans `src/domain/club-alerts.ts` (testées). La courbe **Usage par mois** (13 mois, tous clubs, puis club par club sur sa page) additionne les pointages QR, les réservations et les feuilles d'appel ; elle s'arrête à 13 mois, comme la rétention de `usage_events`.

### Formule et facturation

Sur la page d'un club (`/admin/clubs/<id>`), carte **Formule et facturation** (migration 20261016001400, table `club_subscriptions`) : nom de la formule (libre), état (*Essai*, *Actif*, *En retard de paiement*, *Résilié*), début, échéance, prix mensuel indicatif et note interne.

- **Le paiement reste hors application** (virement, facture) : on note ici où en est chaque club. Aucune facture n'est émise par l'application.
- **Interne à la plateforme** : le club ne voit rien de ceci, aucun compte ne lit la table, et l'enregistrement n'est pas tracé dans le journal du club (contrairement aux modules).
- Alertes (`src/domain/billing.ts`, testées) : paiement en retard ; échéance dépassée ; échéance dans 14 jours ou moins ; absence de formule après les 14 premiers jours. Un club résilié n'alerte plus. Elles s'ajoutent à celles d'usage dans **Clubs à surveiller**.
- La vue d'ensemble affiche le **revenu mensuel indicatif** : somme des prix des clubs *Actifs* uniquement (hors essais, retards et résiliations) et la liste des formules à suivre.
- Le prix saisi en euros (« 49 » ou « 29,90 ») est conservé en centimes.

### Suspendre un club

Sur la page d'un club, carte **Suspension** (migration 20261016001500, table `club_suspensions`) : un motif interne (jamais montré au club) et « Suspendre l'accès ».

- **Effet immédiat, dans la base** : `member_role` et `is_member` — les deux briques de toute la RLS — répondent « non » pour un club suspendu. Plus personne n'y voit ni n'y écrit rien, y compris par les fonctions métier, les liens de pointage QR et les exports. Aucune donnée n'est supprimée : la réactivation (« Réactiver le club ») rend tout tel quel.
- **Message clair** : ses membres sont redirigés vers `/suspended` (« Votre club est suspendu », contact `contact@matnexa.fr`), et « Mes clubs » affiche un bandeau. Une action tentée renvoie « Ce club est suspendu ».
- **Rappels** : les rappels de séance par notification ne partent plus pour ce club. La clôture automatique des feuilles d'appel continue (hygiène des données).
- La liste des clubs affiche « Suspendu » et ne génère plus d'alerte d'usage pour ce club.
- **Limites à connaître** : un club suspendu bloque aussi l'export de ses données par ses propres administrateurs (le droit d'accès s'exerce alors auprès de `contact@matnexa.fr`, qui peut le satisfaire depuis la base) ; le code d'adhésion d'un club suspendu reste valable, mais les personnes qui l'utilisent n'ont aucun accès tant que le club est suspendu.

### Double authentification par e-mail

L'administration exige, après le mot de passe, un **code à 6 chiffres envoyé à l'adresse du compte** (`PLATFORM_ADMIN_EMAIL`). Sans lui, toute page `/admin/*` renvoie vers `/admin/security`, et toute action d'administration est refusée (le contrôle est dans `isPlatformAdminUser`, utilisé par les pages et les actions).

- Le code est **lié à la session** qui l'a demandé, valable **10 minutes**, limité à **5 essais**, à **usage unique**, et un nouvel envoi invalide le précédent. La base ne garde qu'une empreinte HMAC (clé `APP_SECRET`).
- L'envoi est une **action explicite** (bouton), jamais déclenchée par l'affichage de la page : 3 envois par quart d'heure ; 10 essais de saisie par quart d'heure et 30 par heure et par IP.
- Une fois le code saisi, un cookie signé (HttpOnly, SameSite=Strict, préfixe `__Host-` en HTTPS) lié au compte **et à la session** vaut preuve pendant **8 heures**. Se déconnecter, changer ou réinitialiser le mot de passe, ou « déconnecter les autres appareils » l'invalide. « Verrouiller sur cet appareil » l'efface aussitôt.
- **Limite à connaître** : le code arrive par e-mail ; si la même boîte permet aussi de réinitialiser le mot de passe, quelqu'un qui contrôle la boîte obtient les deux. Protégez cette boîte avec sa propre double authentification (application ou clé de sécurité), et gardez le mot de passe de l'application différent de celui de la boîte.
- En cas d'e-mail qui n'arrive pas : le fournisseur (Resend) doit fonctionner, vérifiez `sudo journalctl -u coachos -n 50 --no-pager | grep admin_code`. Il n'y a volontairement aucun contournement dans l'application.

### Fonctionnalités par club (formule)

Depuis la liste, un clic sur le nom d'un club ouvre `/admin/clubs/<id>` : trois interrupteurs, **Classement et assiduité**, **Actualités et notifications**, **Grades et rapports** (migration 20261016000900, table `club_features`, `src/domain/features.ts`).

- Tout est **activé par défaut** : l'absence de ligne vaut « activé », donc aucun club existant ne change.
- Un module coupé disparaît de la navigation, ses pages renvoient « Non incluse dans votre formule », ses actions et exports sont refusés par le serveur, et la **base** refuse aussi (actualités : politique restrictive ; classement, passages de grade : contrôle dans la fonction). Aucune donnée n'est supprimée : tout revient à la réactivation.
- Le réglage est tracé dans le journal d'activité du club (« Module activé ou coupé par Matnexa »).
- Seul l'administrateur de la plateforme règle (`admin_set_club_feature`) ; les membres du club peuvent lire leurs interrupteurs, pas les modifier.
- Ne sont pas coupés : la ceinture et les barrettes de la fiche d'un membre (champ de la fiche, pas le module des grades), les pointages, le planning et les réservations. Le réglage « apparaître au classement » d'un enfant (compte du responsable) reste visible.
- Ajouter un module : ajouter son identifiant dans `FEATURES`, dans la contrainte `club_features.feature` et dans `admin_club_features`/`admin_set_club_feature` (nouvelle migration), puis passer `feature` à `requireAcademy`/`authorizeAcademy` aux endroits concernés.
