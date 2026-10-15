# Guide : lever les blocages avant les données réelles

Écrit le 15/10/2026 pour le VPS OVHcloud (Gravelines) décrit dans `docs/deploy-vps.md`. **Jamais exécuté** : chaque commande est à lancer par vous, sur le serveur, dans l'ordre. Notez tout écart dans ce fichier. Aucun secret ne doit être collé dans le chat, dans Git ou dans un ticket.

Ordre conseillé : 1 (10 min) → 2 (1 h) → 3 (15 min) → 4 et 5 (documents, avec le club pilote). Les étapes 1 à 3 et la signature du contrat (4) sont les conditions minimales avant la première fiche réelle.

---

## 1. Purge quotidienne (rétention)

Si vous avez suivi `docs/deploy-vps.md` §11, elle est peut-être déjà en place. Vérifier :

```bash
systemctl list-timers coachos-purge.timer --no-pager
sudo systemctl start coachos-purge.service
journalctl -u coachos-purge.service -n 5 --no-pager
```

Attendu : le timer a une prochaine exécution, et le journal montre une réponse JSON contenant `members_anonymized`, `auth_sessions_deleted`, `club_requests`, `booking_emails_sent`. Une réponse `404` signifie que `CRON_SECRET` est absent de `/etc/coachos/app.env` ou que `/etc/coachos/purge.header` ne lui correspond pas.

S'il n'existe pas encore, l'installer depuis la version déployée (fichiers versionnés, testés par `tests/unit/ops-scripts.test.ts`) :

```bash
sudo cp /srv/coachos/current/ops/systemd/coachos-purge.service /srv/coachos/current/ops/systemd/coachos-purge.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now coachos-purge.timer
sudo systemctl start coachos-purge.service
journalctl -u coachos-purge.service -n 5 --no-pager
```

Cocher ensuite la ligne « purge » de [checklist-mise-en-production.md](checklist-mise-en-production.md) avec la date.

---

## 2. Sauvegardes chiffrées hors du serveur, et test de restauration

> **Configuration réellement installée le 15/10/2026** (choix de l'éditeur, sans stockage objet) : `BACKUP_REMOTE=/var/backups/coachos-archive` (dossier local), copie hors machine assurée par la sauvegarde quotidienne OVH du VPS. Fichier `/etc/systemd/system/coachos-backup.service.d/override.conf` : `Environment=HOME=/var/lib/coachos-backup`, `ReadWritePaths=/var/lib/coachos-backup /var/backups/coachos-archive`, puis deux `ExecStartPost` : suppression des `coachos-*.age*` du dossier de travail et `prune.sh --apply`. Pas de `rclone.conf` (rclone écrit dans un chemin local ; ses avertissements « config file not found » sont sans effet). Restauration testée le même jour, clé copiée par `scp` dans `/dev/shm` puis effacée. Les sections 2.2 et 2.4 (stockage objet OVH) restent valables pour passer plus tard à une copie séparée.

Principe (`docs/operations.md`) : `pg_dump` → chiffrement `age` avec une clé **publique** → copie vers un stockage distant → vérification. La clé **privée** ne vit jamais sur le serveur.

### 2.1 Sur votre ordinateur : la paire de clés age

```bash
winget install FiloSottile.age
age-keygen -o matnexa-backup.key
```

La commande affiche `Public key: age1…`. Rangez **le fichier `matnexa-backup.key`** dans votre gestionnaire de mots de passe, plus une seconde copie hors ligne (clé USB au coffre, ou une seconde personne). Sans elle, les sauvegardes sont illisibles, définitivement. Gardez la ligne `age1…` pour 2.4.

### 2.2 Chez OVHcloud : le stockage distant

Dans l'espace client : Public Cloud → Object Storage → créer un conteneur S3 **privé**, par exemple `matnexa-backups`, dans une **autre région que Gravelines** (par exemple Strasbourg, `sbg`) : un incident sur le site de Gravelines ne doit pas emporter les deux copies. Créer un utilisateur S3 dédié à ce conteneur et noter sa clé d'accès et sa clé secrète (gestionnaire de mots de passe). Si possible, activer le verrouillage d'objets ou le versionnement.

Vérifiez dans la console le nom exact du point d'accès : le guide rclone d'OVHcloud utilise le modèle `https://s3.<région>.io.cloud.ovh.net`.

### 2.3 Sur le serveur : outils, utilisateur, rôle PostgreSQL

```bash
sudo apt-get install -y age rclone postgresql-client-18
sudo useradd --system --home-dir /var/lib/coachos-backup --create-home --shell /usr/sbin/nologin coachos-backup
sudo install -d -o coachos-backup -g coachos-backup -m 700 /var/backups/coachos
sudo -u postgres psql -d coachos -f /srv/coachos/current/ops/backup/create-backup-role.sql
sudo -u postgres psql -c '\password coachos_backup'
```

La dernière commande demande un mot de passe : générez-le dans votre gestionnaire (32 caractères), collez-le deux fois. Puis le fichier de mot de passe, lisible par le seul utilisateur de sauvegarde (le script refuse tout autre mode) :

```bash
sudo install -o coachos-backup -g coachos-backup -m 600 /dev/null /etc/coachos/backup.pgpass
sudoedit /etc/coachos/backup.pgpass
```

Contenu, une ligne : `127.0.0.1:5432:coachos:coachos_backup:<le mot de passe>`.

Le dossier `/etc/coachos` est en `750 root:coachos` : l'utilisateur `coachos-backup` doit pouvoir le traverser.

```bash
sudo setfacl -m u:coachos-backup:x /etc/coachos
```

(Si `setfacl` manque : `sudo apt-get install -y acl`.)

### 2.4 Configuration

```bash
echo 'age1…votre clé publique…' | sudo tee /etc/coachos/backup.recipients >/dev/null
sudo chown root:coachos-backup /etc/coachos/backup.recipients && sudo chmod 640 /etc/coachos/backup.recipients

sudo install -o coachos-backup -g coachos-backup -m 600 /dev/null /etc/coachos/rclone.conf
sudoedit /etc/coachos/rclone.conf
```

Contenu de `rclone.conf` (valeurs à reprendre de la console OVHcloud) :

```ini
[offsite]
type = s3
provider = Other
env_auth = false
access_key_id = <clé d'accès>
secret_access_key = <clé secrète>
endpoint = https://s3.sbg.io.cloud.ovh.net
region = sbg
location_constraint = sbg
acl = private
```

Variables du service (aucun secret ici) :

```bash
sudo tee /etc/coachos/backup.env >/dev/null <<'EOF'
BACKUP_PGHOST=127.0.0.1
BACKUP_PGPORT=5432
BACKUP_PGDATABASE=coachos
BACKUP_PGUSER=coachos_backup
BACKUP_PGPASSFILE=/etc/coachos/backup.pgpass
BACKUP_PGSSLMODE=require
BACKUP_AGE_RECIPIENTS_FILE=/etc/coachos/backup.recipients
BACKUP_REMOTE=offsite:matnexa-backups
BACKUP_WORKDIR=/var/backups/coachos
RCLONE_CONFIG=/etc/coachos/rclone.conf
EOF
sudo chown root:coachos-backup /etc/coachos/backup.env && sudo chmod 640 /etc/coachos/backup.env
```

`BACKUP_PGSSLMODE=require` suppose que PostgreSQL a SSL activé (cas par défaut sur Ubuntu). Si la première sauvegarde répond « server does not support SSL », remplacez par `disable` : la connexion reste sur la boucle locale `127.0.0.1` et ne sort pas de la machine.

### 2.5 Première sauvegarde, puis tous les soirs

```bash
sudo cp /srv/coachos/current/ops/systemd/coachos-backup.service /srv/coachos/current/ops/systemd/coachos-backup.timer /etc/systemd/system/
sudo mkdir -p /etc/systemd/system/coachos-backup.service.d
printf '[Service]\nEnvironment=HOME=/var/lib/coachos-backup\nReadWritePaths=/var/lib/coachos-backup\n' | sudo tee /etc/systemd/system/coachos-backup.service.d/override.conf >/dev/null
sudo systemctl daemon-reload
sudo systemctl start coachos-backup.service
journalctl -u coachos-backup.service -n 20 --no-pager
```

Attendu : `[backup] export de la base`, `chiffrement`, envoi, puis vérification de la copie distante sans erreur. Ensuite :

```bash
sudo -u coachos-backup env RCLONE_CONFIG=/etc/coachos/rclone.conf rclone ls offsite:matnexa-backups
sudo systemctl enable --now coachos-backup.timer
```

### 2.6 Test de restauration (obligatoire une fois avant le pilote)

Le script restaure dans une base **jetable** `restore_check_*`, la contrôle, puis la supprime ; il ne touche jamais la base `coachos`. Il demande un superutilisateur : on réactive le temps du test le rôle `coachos_admin` (comme pour une migration, `docs/deploy-vps.md` §7) et on apporte la clé privée en mémoire seulement (`/dev/shm`).

```bash
# 1. Récupérer la dernière sauvegarde dans un dossier privé
sudo install -d -m 700 /root/restore-test && cd /root/restore-test
LAST=$(sudo env RCLONE_CONFIG=/etc/coachos/rclone.conf rclone lsf offsite:matnexa-backups | grep '\.age$' | sort | tail -1)
sudo env RCLONE_CONFIG=/etc/coachos/rclone.conf rclone copy "offsite:matnexa-backups/$LAST" .
sudo env RCLONE_CONFIG=/etc/coachos/rclone.conf rclone copy "offsite:matnexa-backups/$LAST.sha256" .

# 2. Superutilisateur temporaire et fichiers de secrets en mémoire
RPW=$(openssl rand -hex 24)
printf "alter role coachos_admin login password '%s';\n" "$RPW" | sudo -u postgres psql
sudo install -m 600 /dev/null /dev/shm/restore.pgpass
printf '127.0.0.1:5432:*:coachos_admin:%s\n' "$RPW" | sudo tee /dev/shm/restore.pgpass >/dev/null
sudo install -m 600 /dev/null /dev/shm/backup.key
sudoedit /dev/shm/backup.key      # coller le contenu de matnexa-backup.key, enregistrer

# 3. Restauration vérifiée
sudo env RESTORE_PGHOST=127.0.0.1 RESTORE_PGUSER=coachos_admin RESTORE_PGPASSFILE=/dev/shm/restore.pgpass \
  RESTORE_PGSSLMODE=require RESTORE_AGE_IDENTITY_FILE=/dev/shm/backup.key \
  /srv/coachos/current/ops/backup/restore-verify.sh "/root/restore-test/$LAST"

# 4. Nettoyage, dans tous les cas
sudo shred -u /dev/shm/backup.key /dev/shm/restore.pgpass
echo "alter role coachos_admin nologin;" | sudo -u postgres psql
unset RPW
sudo rm -rf /root/restore-test
```

Notez dans [checklist-mise-en-production.md](checklist-mise-en-production.md) : date, nom du fichier restauré, durée, résultat. À refaire chaque trimestre (`docs/operations.md` §3).

### 2.7 Rétention des sauvegardes

`prune.sh` **simule** par défaut. Après quelques semaines, regardez ce qu'il supprimerait, puis décidez :

```bash
sudo -u coachos-backup env BACKUP_REMOTE=offsite:matnexa-backups RCLONE_CONFIG=/etc/coachos/rclone.conf /srv/coachos/current/ops/backup/prune.sh
```

Durée décidée le 15/10/2026 : **7 jours** (`DEFAULT_POLICY` de `scripts/lib/backup-retention.mjs`), indiquée dans la notice `/privacy`. Toute modification de cette durée doit être reportée dans la notice.

---

## 3. Resend (déjà activé, région d'envoi Irlande)

Ce que dit la documentation de Resend (consultée le 15/10/2026) :

- la région choisie ne détermine que **le lieu d'envoi** ; les données du compte (**métadonnées des e-mails, journaux, enregistrements d'API**) sont stockées **aux États-Unis**, quelle que soit la région ;
- son DPA comprend des **clauses contractuelles types** pour le transfert UE → États-Unis, et Resend se déclare **certifié Data Privacy Framework**.

Le transfert existe donc bel et bien (art. 44 et suivants). À faire dans le tableau de bord Resend et sur le web :

1. Accepter ou télécharger le **DPA** de Resend, et l'archiver avec la date (un PDF dans votre espace documentaire, pas dans ce dépôt public).
2. Vérifier la certification de Resend sur la liste officielle du Data Privacy Framework (dataprivacyframework.gov) et archiver une capture datée.
3. Domaine `matnexa.fr` : **suivi des ouvertures et des clics désactivé** (sinon les liens sont réécrits et chaque clic est tracé).
4. Clé d'API à **envoi seul**, limitée au domaine ; comptes du tableau de bord nominatifs avec double authentification.
5. Noter la durée de conservation des journaux indiquée par Resend pour votre offre.

Ce qui part chez Resend : adresse du destinataire, liens à usage limité ; pour l'avis de place, nom du club, du cours, date et heure ; pour une demande de club, nom et e-mail du demandeur. Aucun nom d'adhérent dans les autres e-mails. Si un club exige que rien ne quitte l'UE, il faudra un prestataire d'envoi européen : l'application passe par une interface (`src/server/mail/`), le changement est circonscrit.

---

## 4. Contrat de sous-traitance avec chaque club

Modèle : [modele-contrat-sous-traitance.md](modele-contrat-sous-traitance.md). Le compléter (identités, durée, prix éventuel), le faire relire si possible, le signer avec le club pilote **avant** que le club saisisse ses membres. Une signature électronique simple ou un échange de PDF signés suffit en pratique ; conservez-le.

---

## 5. Notice `/privacy` et information des membres

1. Fait le 15/10/2026 : `/privacy` indique l'éditeur (Arthur DARON, à titre personnel) et le contact `contact@matnexa.fr`. **Vérifier que cette boîte reçoit bien les e-mails** et la consulter régulièrement : les demandes d'exercice des droits y arrivent, avec un délai de réponse d'un mois. Si une entreprise est créée, mettre à jour la notice, le registre et le contrat.
2. Remettre au club le modèle [modele-information-membres.md](modele-information-membres.md), qu'il diffuse à ses membres (affichage, e-mail, bulletin d'adhésion) : c'est au club, responsable de traitement, d'informer ses adhérents.
