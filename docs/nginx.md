# Nginx — exemple autonome pour Coach OS

> **Statut : exemple NON appliqué et NON validé sur un serveur réel.** Aucun `nginx -t` n'a été exécuté en local (pas de binaire Nginx).
> La syntaxe est vérifiée par le job CI `nginx-syntax` (Nginx officiel, certificat jetable, domaine fictif) ; le comportement réel
> reste à valider en préproduction.

Fichiers : `ops/nginx/coachos.conf` (hôtes virtuels 80/443) et `ops/nginx/proxy.inc` (transmission commune).

## Installation (à faire par une personne, sur le serveur, jamais par l'agent)

1. Sauvegarder la configuration Nginx existante.
2. Copier `coachos.conf` dans `/etc/nginx/conf.d/` et `proxy.inc` dans `/etc/nginx/coachos/`.
3. Remplacer les **PLACEHOLDER** : nom de domaine, chemins des certificats, port local (à choisir après inventaire des ports du VPS).
4. `nginx -t` puis `nginx -s reload` (jamais de redémarrage complet).
5. Certificats : `certbot certonly --webroot -w /var/www/certbot` (ne modifie pas la configuration).

Toutes les directives de niveau `http` sont préfixées `coachos` ; l'exemple ne déclare jamais de `default_server`.

## Décisions

| Sujet | Décision |
|---|---|
| HSTS | **Un seul émetteur : l'application** (`src/proxy.ts`). Nginx n'ajoute aucun en-tête. Défaut 86400 s en production, 300 s en staging, ni `includeSubDomains` ni `preload`. Montée progressive via `HSTS_MAX_AGE_SECONDS` ; `0` pour reculer. |
| `Cache-Control` | `no-store` posé par l'application sur `/api/auth/*`. Aucun `proxy_cache` : rien d'authentifié n'est mis en cache. |
| IP client | Nginx **écrase** `X-Real-IP` et `X-Forwarded-For` par `$remote_addr` ; `Forwarded` est vidé. L'application ne fait confiance qu'à `X-Real-IP`. Si un autre proxy (CDN) précède Nginx, la configuration doit être revue (`set_real_ip_from`). |
| Journaux | Format sans chaîne de requête ; `access_log off` sur les chemins portant un jeton (`/api/auth/reset-password/`, `/invite/`, `/checkin/`). Le journal d'erreurs peut citer la requête : droits restreints, rotation courte. |
| Débit | Filet de rafales par adresse (429). Les compteurs applicatifs restent la référence. Derrière un Wi-Fi partagé ou du CGNAT, plusieurs personnes partagent une adresse : surveiller les faux positifs. |
| Purge de rétention | `/api/cron/purge` restreint à 127.0.0.1 / ::1 (minuterie locale). |
| Sondes | `/api/live` (processus vivant, sans base) et `/api/health` (disponibilité des dépendances) sans journal d'accès. |

## À valider en préproduction

- `nginx -t` avec le vrai `nginx.conf` du serveur (compatibilité, `http2 on` selon la version).
- Absence de collision de noms/zones, de ports et de `server_name` avec les autres applications.
- Réception effective de `X-Real-IP` correct par l'application ; un en-tête forgé par le client est écrasé.
- Un seul `Strict-Transport-Security` dans la réponse (`curl -sI`), valeur attendue.
- Réponse `429` sous rafale, jetons absents des journaux après un cycle de réinitialisation de mot de passe.
