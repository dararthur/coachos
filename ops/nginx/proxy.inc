# Directives communes de transmission vers Coach OS — incluses dans chaque `location` de coachos.conf.
# EXEMPLE NON VALIDÉ sur un serveur réel : `nginx -t` n'a pas été exécuté ici (voir docs/nginx.md ; validation de syntaxe prévue en CI, puis en préproduction).
#
# En-têtes de proxy : Nginx ÉCRASE tout ce que le client a envoyé. L'application fait confiance à X-Real-IP (limites de débit, sessions) :
# il ne doit JAMAIS provenir du client. X-Forwarded-For reçoit uniquement l'adresse du socket ($remote_addr), jamais la variable
# qui AJOUTE la valeur fournie par le client.
proxy_pass http://coachos_app;
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header Forwarded "";
proxy_hide_header X-Powered-By;
proxy_redirect off;

# Délais explicites (pas de connexions qui s'éternisent). Aucun cache de proxy n'est configuré : rien d'authentifié n'est jamais mis en cache.
proxy_connect_timeout 5s;
proxy_send_timeout 30s;
proxy_read_timeout 30s;
