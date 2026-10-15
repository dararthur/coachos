# Vitrine www.matnexa.fr

Site statique (dossier `site/`), servi par Nginx, indépendant de l'application (`app.matnexa.fr`) : pas de Node, pas de base de données, pas de cookie, pas de JavaScript. Le domaine nu `matnexa.fr` redirige vers `https://www.matnexa.fr/`.

| Fichier | Rôle |
|---|---|
| `site/index.html` | Page d'accueil (titre, description, canonical, Open Graph, JSON-LD Organization, WebSite, WebPage, SoftwareApplication, FAQPage). |
| `site/mentions-legales/index.html` | Mentions légales. |
| `site/404.html` | Page d'erreur (non indexée). |
| `site/robots.txt`, `site/sitemap.xml` | Exploration et plan du site. Mettre à jour `lastmod` à chaque modification de contenu. |
| `site/assets/` | Feuille de style, police Archivo (OFL), icônes, image de partage `og-matnexa.png`. |
| `ops/nginx/matnexa-www.conf` | Hôte virtuel (redirections, CSP, cache, 404). |
| `scripts/serve-site.mjs` | Aperçu local avec la même CSP : `node scripts/serve-site.mjs` puis http://127.0.0.1:4321/. |
| `scripts/build-site-og.mjs` | Régénère l'image de partage et `favicon.ico` (aperçu local lancé). |

## Avant chaque mise en ligne

- Contenu : uniquement des fonctions réelles (PRODUCT.md). Aucun prix, client, chiffre ou témoignage tant qu'ils ne sont pas réels et autorisés ; les écrans montrés portent « Données fictives ».
- Après une modification de `site/assets/site.css` : changer le paramètre `?v=` dans les trois pages HTML (cache de 30 jours).
- Après une modification de la page : mettre à jour `lastmod` dans `site/sitemap.xml`.

## Premier déploiement (sur le VPS, en SSH)

1. **DNS** (registrar de `matnexa.fr`) : `A` pour `@` et `www` → `137.74.168.132` ; facultatif `AAAA` → `2001:41d0:305:2100::1:41f4`. Vérifier : `dig +short www.matnexa.fr` et `dig +short matnexa.fr`.
2. **Certificat** (défi HTTP, même méthode que l'application) :

   ```bash
   sudo tee /etc/nginx/conf.d/matnexa-www-acme.conf >/dev/null <<'EOF'
   server {
       listen 80;
       listen [::]:80;
       server_name matnexa.fr www.matnexa.fr;
       location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
       location / { return 404; }
   }
   EOF
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot certonly --webroot -w /var/www/certbot -d www.matnexa.fr -d matnexa.fr --deploy-hook "systemctl reload nginx"
   sudo rm /etc/nginx/conf.d/matnexa-www-acme.conf
   ```

3. **Fichiers** : copier `site/` dans une version datée, puis basculer le lien `current` :

   ```bash
   ID=$(date +%Y%m%d-%H%M%S)
   sudo mkdir -p /srv/matnexa-www/releases/$ID
   sudo cp -r /srv/coachos/releases/<version de l'application>/site/. /srv/matnexa-www/releases/$ID/
   sudo ln -sfn /srv/matnexa-www/releases/$ID /srv/matnexa-www/current
   ```

4. **Nginx** :

   ```bash
   sudo cp /srv/coachos/releases/<version>/ops/nginx/matnexa-www.conf /etc/nginx/conf.d/matnexa-www.conf
   sudo nginx -t && sudo systemctl reload nginx
   ```

5. **Contrôles** :

   ```bash
   curl -sI http://matnexa.fr | grep -i location
   curl -sI https://matnexa.fr | grep -i location
   curl -sI https://www.matnexa.fr | grep -i -E "^(HTTP|content-security|strict-transport|cache-control)"
   curl -s -o /dev/null -w "%{http_code}\n" https://www.matnexa.fr/nexiste-pas
   ```

   Attendus : deux redirections vers `https://www.matnexa.fr/`, une réponse 200 avec CSP et HSTS, un 404.

## Référencement, après la mise en ligne

1. **Google Search Console** : ajouter une propriété de type *Domaine* `matnexa.fr` (enregistrement TXT au DNS), puis soumettre `https://www.matnexa.fr/sitemap.xml` et demander l'indexation de la page d'accueil (*Inspection de l'URL*).
2. **Bing Webmaster Tools** : importer la propriété depuis Search Console.
3. Vérifier l'aperçu de partage (LinkedIn Post Inspector, débogueur de partage Facebook) et les données structurées (*Test des résultats enrichis* de Google, validateur schema.org).
4. **Application** : `app.matnexa.fr` reste en `noindex` (src/app/layout.tsx), c'est voulu ; seule la vitrine doit apparaître dans les résultats.
5. Liens entrants : renseigner `https://www.matnexa.fr/` dans les profils publics du projet (réseaux sociaux, annuaires de logiciels sportifs, fédérations). C'est le levier principal une fois la page technique en place.
