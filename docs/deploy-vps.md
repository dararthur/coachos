# Déploiement de Matnexa sur le VPS (app.matnexa.fr, production)

> **Statut : guide écrit d'après l'inventaire réel du serveur (14 octobre 2026), jamais exécuté.** Chaque commande est à lancer par une personne, sur le serveur, dans l'ordre. Rien ici n'a été validé sur ce VPS : à la première exécution, noter tout écart dans ce fichier.
> Complète `docs/setup.md`, `docs/operations.md`, `docs/nginx.md` et `docs/pilot.md` (les contrôles de ce dernier restent à valider **avant toute donnée réelle** de membres).

## 0. Ce que l'inventaire a montré

| Sujet | Constat | Conséquence |
|---|---|---|
| Machine | 2 cœurs, 3,7 Go de RAM, 2 Go de swap (ajouté), ~30 Go de disque libres | Suffisant pour l'application ; **pas pour les vidéos** (stockage externe, voir la feuille de route) |
| Autres projets | PM2 (utilisateurs `ubuntu` et `deploy`), `/var/www/*` | Matnexa est **isolé** : utilisateur `coachos`, `systemd`, `/srv/coachos`, plafond mémoire |
| Ports occupés | 3000, 3001, 3100, 3333, 3500, 4000 (+ 5432 local) | **Matnexa écoute sur 3400** (le 3100 par défaut du dépôt est pris) |
| PostgreSQL | 18.6, un seul cluster, bases `postgres` et `artisan_os`, écoute locale | Base `coachos` **dédiée** dans ce cluster ; la migration 0000 crée 4 rôles globaux (`anon`, `authenticated`, `app_server`, `auth_runtime`), sans conflit avec `artisan_os` |
| Nginx | 1.28.3, un fichier par domaine dans `sites-enabled`, `conf.d` vide | Configuration de Matnexa dans `conf.d` (directives `coachos_*`, pas de collision) |
| Pare-feu | `ufw` : 22, 80, 443 | Rien à ouvrir |
| Node | 24.21 | OK (≥ 22) |

## 1. Avant de toucher au serveur

1. **DNS** (chez le registrar de `matnexa.fr`) : enregistrement `A` `app` (soit `app.matnexa.fr`) → `137.74.168.132`. Facultatif : `AAAA` `app` → `2001:41d0:305:2100::1:41f4`. Attendre la propagation : `dig +short app.matnexa.fr`.
2. **Resend** : ajouter le domaine `matnexa.fr`, publier les enregistrements demandés (SPF, DKIM) et attendre « Verified ». Désactiver le suivi des ouvertures et des clics. Créer une clé d'API à **envoi seul**, limitée à ce domaine. Expéditeur : `Matnexa <no-reply@matnexa.fr>`. Facultatif mais conseillé : `_dmarc` en `v=DMARC1; p=none; rua=mailto:<votre adresse>`.
3. Garder la clé d'API sous la main (gestionnaire de mots de passe) : elle sera collée dans un fichier root, jamais dans Git ni dans le chat.

## 2. Utilisateur, dossiers

```bash
sudo useradd --system --home-dir /srv/coachos --shell /usr/sbin/nologin coachos
sudo install -d -o coachos -g coachos -m 755 /srv/coachos /srv/coachos/releases
sudo install -d -o root -g coachos -m 750 /etc/coachos
```

## 3. Base de données

Rôle administrateur **temporaire** (la migration 0000 crée des rôles) et base dédiée. Aucun mot de passe n'est tapé en clair : il est produit puis transmis par l'entrée standard.

```bash
ADMINPW=$(openssl rand -hex 24)
printf "create role coachos_admin login superuser password '%s';\ncreate database coachos owner coachos_admin;\n" "$ADMINPW" | sudo -u postgres psql
```

Garder le terminal ouvert (la variable `ADMINPW` sert à l'étape 5).

## 4. Construire une version

La construction demande ~1,5 Go de mémoire : la lancer à un moment calme (les 2 Go de swap absorbent un pic, mais les autres sites ralentiraient).

```bash
ID=$(date -u +%Y%m%d-%H%M%S)
sudo -u coachos -H git clone --depth 1 https://github.com/dararthur/coachos.git /srv/coachos/releases/$ID
sudo -u coachos -H bash -c "cd /srv/coachos/releases/$ID && npm ci && NODE_OPTIONS=--max-old-space-size=1536 npm run build && npm prune --omit=dev"
```

Si `npm run build` réclame une variable d'environnement, passer à l'étape 6 pour créer le fichier, puis relancer la construction avec `set -a; . /etc/coachos/app.env; set +a` devant.

## 5. Migrations

```bash
cd /srv/coachos/releases/$ID
sudo -u coachos -H env MIGRATION_DATABASE_URL="postgresql://coachos_admin:$ADMINPW@127.0.0.1:5432/coachos" node scripts/migrate.mjs --dry-run
sudo -u coachos -H env MIGRATION_DATABASE_URL="postgresql://coachos_admin:$ADMINPW@127.0.0.1:5432/coachos" node scripts/migrate.mjs
```

Le premier appel liste ce qui serait appliqué (24 migrations sur une base vierge) sans rien écrire. PostgreSQL 18 est signalée « non testée » par le lanceur mais la CI rejoue les migrations dessus. Le mot de passe temporaire apparaît quelques secondes dans la liste des processus : acceptable sur ce serveur, car le rôle est verrouillé à l'étape 7.

## 6. Secrets et environnement

Les mots de passe des deux rôles applicatifs, les deux secrets et le jeton de purge sont générés et écrits directement dans le fichier, sans s'afficher.

```bash
APP_PW=$(openssl rand -hex 24); AUTH_PW=$(openssl rand -hex 24)
printf "alter role app_server login password '%s';\nalter role auth_runtime login password '%s';\n" "$APP_PW" "$AUTH_PW" | sudo -u postgres psql -d coachos
CRON=$(openssl rand -hex 32)
sudo tee /etc/coachos/app.env >/dev/null <<EOF
APP_ENV=production
SITE_URL=https://app.matnexa.fr
DATABASE_URL=postgresql://app_server:$APP_PW@127.0.0.1:5432/coachos
DATABASE_SSL=disable
AUTH_DATABASE_URL=postgresql://auth_runtime:$AUTH_PW@127.0.0.1:5432/coachos
APP_SECRET=$(openssl rand -hex 32)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
MAIL_PROVIDER=resend
RESEND_API_KEY=A_REMPLACER
MAIL_FROM="Matnexa <no-reply@matnexa.fr>"
PLATFORM_ADMIN_EMAIL=arthur.daron@gmail.com
CRON_SECRET=$CRON
EOF
printf 'Authorization: Bearer %s\n' "$CRON" | sudo tee /etc/coachos/purge.header >/dev/null
sudo chown root:coachos /etc/coachos/app.env /etc/coachos/purge.header
sudo chmod 640 /etc/coachos/app.env /etc/coachos/purge.header
sudoedit /etc/coachos/app.env      # remplacer A_REMPLACER par la clé Resend, enregistrer
unset APP_PW AUTH_PW CRON
```

`BETTER_AUTH_SECRET` ne doit **jamais** se retrouver dans les sauvegardes de la base (`docs/self-hosted-auth.md` §4) : `/etc/coachos` n'est pas dans le périmètre de `backup.sh`, ne l'y ajoutez pas. Conservez ce secret dans votre gestionnaire de mots de passe : le perdre déconnecte tout le monde.

**Préflight** (contrôle sans affichage de secret) :

```bash
cd /srv/coachos/releases/$ID
sudo -u coachos -H bash -c "set -a; . /etc/coachos/app.env; set +a; MIGRATION_DATABASE_URL='postgresql://coachos_admin:$ADMINPW@127.0.0.1:5432/coachos' node scripts/pilot-preflight.mjs"
```

`PLATFORM_ADMIN_EMAIL` est l'adresse qui reçoit les demandes de création de club et qui est la seule à pouvoir les approuver (voir la section 12). Elle ne vit que dans ce fichier : l'application ne l'affiche, ne la journalise et ne la stocke nulle part. Il doit se terminer sans échec. Toute ligne en échec se corrige avant de continuer.

## 7. Verrouiller le rôle administrateur

```bash
echo "alter role coachos_admin nologin;" | sudo -u postgres psql
unset ADMINPW
```

Pour une migration ultérieure : refaire l'étape 3 version « réactiver » (`alter role coachos_admin login password '…'`), migrer, puis verrouiller de nouveau.

## 8. Service systemd

```bash
sudo cp /srv/coachos/releases/$ID/ops/systemd/coachos.service /etc/systemd/system/coachos.service
sudo mkdir -p /etc/systemd/system/coachos.service.d
sudo tee /etc/systemd/system/coachos.service.d/override.conf >/dev/null <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/npm run start -- -p 3400
ReadWritePaths=/srv/coachos/releases
Environment=NODE_OPTIONS=--max-old-space-size=512
Environment=npm_config_cache=/tmp/.npm
MemoryMax=900M
EOF
sudo systemctl daemon-reload
sudo systemctl enable coachos
```

`MemoryMax` et `NODE_OPTIONS` protègent les autres projets : si Matnexa dérape, c'est elle qui est redémarrée. L'unité du dépôt n'a jamais tourné sur un vrai serveur : si le démarrage échoue (écriture refusée par `ProtectSystem`, par exemple), lire `journalctl -u coachos -n 50 --no-pager` et corriger dans `override.conf`.

## 9. Nginx et HTTPS

Le certificat doit exister avant que la configuration complète (qui référence les fichiers du certificat) ne soit chargée. Deux temps.

**9.1 Défi ACME seul (HTTP)**

```bash
command -v certbot || sudo apt install -y certbot
sudo mkdir -p /var/www/certbot /etc/nginx/coachos
sudo tee /etc/nginx/conf.d/matnexa-acme.conf >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name app.matnexa.fr;
    location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
EOF
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/certbot -d app.matnexa.fr --deploy-hook "systemctl reload nginx"
```

**9.2 Configuration complète**

```bash
sudo rm /etc/nginx/conf.d/matnexa-acme.conf
sudo cp /srv/coachos/releases/$ID/ops/nginx/proxy.inc /etc/nginx/coachos/proxy.inc
sudo sed -e 's/coachos\.example\.invalid/app.matnexa.fr/g' -e 's/127\.0\.0\.1:3100/127.0.0.1:3400/' /srv/coachos/releases/$ID/ops/nginx/coachos.conf | sudo tee /etc/nginx/conf.d/coachos.conf >/dev/null
sudo grep -rn "limit_req" /etc/nginx/sites-enabled /etc/nginx/nginx.conf
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` doit réussir **avant** le rechargement (jamais de redémarrage complet : les autres sites restent servis). Le fichier pose `limit_req_status 429;` au niveau global : si la commande `grep` montre que d'autres sites utilisent `limit_req`, leurs refus passeront de 503 à 429 (sans autre conséquence). HSTS est émis par l'application seule : ne rien ajouter dans Nginx.

## 10. Première activation

```bash
sudo HEALTH_URL=http://127.0.0.1:3400/api/health /srv/coachos/releases/$ID/ops/release/activate.sh $ID
```

Le script bascule `current`, démarre le service, prouve que **cette** version tourne et que `/api/health` répond 200. Un échec laisse l'état pour examen (voir `docs/operations.md` §4).

## 11. Purge quotidienne (rétention et sessions expirées)

```bash
sudo tee /etc/systemd/system/coachos-purge.service >/dev/null <<'EOF'
[Unit]
Description=Matnexa - purge de rétention
[Service]
Type=oneshot
User=coachos
ExecStart=/usr/bin/curl -fsS -X POST -H @/etc/coachos/purge.header http://127.0.0.1:3400/api/cron/purge
EOF
sudo tee /etc/systemd/system/coachos-purge.timer >/dev/null <<'EOF'
[Unit]
Description=Matnexa - purge quotidienne
[Timer]
OnCalendar=*-*-* 03:10:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now coachos-purge.timer
sudo systemctl start coachos-purge.service && systemctl status coachos-purge.service --no-pager
```

La même tâche envoie ensuite les e-mails « place confirmée » restés en file (fournisseur indisponible, redémarrage) : la réponse contient `booking_emails_sent` et `booking_emails_failed` (`docs/bookings.md`).

## 12. Vérifications finales

```bash
curl -s https://app.matnexa.fr/api/live; echo
curl -s https://app.matnexa.fr/api/health; echo
curl -sI https://app.matnexa.fr | grep -i -E "^(HTTP|strict-transport|content-security|x-frame)"
free -h; pm2 status
```

À contrôler, dans l'ordre :
- `/api/health` → `{"status":"ok"}`, HSTS présent **une seule fois** (86400 s au début), les autres sites inchangés (`pm2 status`).
- **Votre compte administrateur** : sur `https://app.matnexa.fr/signup`, créez le compte avec l'adresse de `PLATFORM_ADMIN_EMAIL` (le formulaire répond comme pour n'importe qui, c'est voulu), confirmez-la par e-mail, connectez-vous puis ouvrez `https://app.matnexa.fr/admin/club-requests`. Un autre compte voit une page « introuvable ».
- **Créer le premier club** : `https://app.matnexa.fr/request-club` avec l'adresse du futur propriétaire. Vous recevez un e-mail, vous approuvez, le demandeur reçoit le lien de création de compte, puis crée son club.
- Créer un compte : l'e-mail de confirmation doit arriver (sinon `journalctl -u coachos` cherche `auth.mail_failed`, et le tableau de bord Resend).
- Créer le club, ajouter le logo, tester l'envoi d'une photo de profil de 2 Mo (limite de 3 Mo à Nginx), ouvrir le site depuis un téléphone et installer l'application (`docs/pwa.md`).
- Contrôles N1 à N6 de `docs/self-hosted-auth.md` §9 et `docs/nginx.md` « À valider ».

## 13. Avant toute donnée réelle de membres

À ne pas sauter (`docs/pilot.md`, `docs/operations.md`) :
1. **Sauvegardes chiffrées hors du serveur** : `age`, `rclone`, un stockage externe séparé, rôle `coachos_backup` (`ops/backup/create-backup-role.sql`), `coachos-backup.timer`. **Une restauration doit avoir été testée** sur une base jetable.
2. Revue juridique (RGPD, mentions, politique de confidentialité) : `docs/privacy-gdpr.md`.
3. Montée progressive de HSTS (`HSTS_MAX_AGE_SECONDS`) après quelques jours sans problème.

## 14. Mises à jour ultérieures

```bash
ID=$(date -u +%Y%m%d-%H%M%S)
# construire (étape 4) → sauvegarde fraîche → migrations s'il y en a (étapes 3 « réactiver », 5, 7) → activer :
sudo HEALTH_URL=http://127.0.0.1:3400/api/health /srv/coachos/releases/$ID/ops/release/activate.sh $ID
```

Retour arrière applicatif : `sudo HEALTH_URL=http://127.0.0.1:3400/api/health /srv/coachos/current/ops/release/rollback.sh` (réactive la version `previous` ; lire d'abord `docs/operations.md` §4.3, ou viser une version précise avec `activate.sh <id>`). Les migrations vont toujours vers l'avant : revenir sur la base = restauration d'une sauvegarde. Garder les trois dernières versions dans `releases/`, supprimer les autres à la main.
