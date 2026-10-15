# Checklist avant toute donnée réelle

Coché = vérifié par une preuve (test exécuté, document signé, configuration constatée). Une case non cochée n'est pas une formalité.

## Bloquant (ne pas saisir de données réelles sans cela)

- [ ] Contrat de sous-traitance (art. 28) signé avec chaque club pilote.
- [x] Identité et coordonnées de l'éditeur renseignées dans `/privacy` (art. 13 §1.a) ; contact pour exercer les droits. Fait le 15/10/2026 : Arthur DARON, à titre personnel, contact@matnexa.fr (boîte à tester).
- [ ] Hébergeur : OVHcloud, Gravelines (France), déclaré ; conditions de traitement des données (DPA OVHcloud) acceptées et archivées, localisation constatée dans l'espace client.
- [ ] HTTPS public, Nginx de production validé (`docs/nginx.md`) ; en-tête `X-Real-IP` écrasé par le proxy. 15/10/2026 : `https://app.matnexa.fr/api/health` répond `ok` ; écrasement de `X-Real-IP` **non vérifié**.
- [ ] Secrets de production générés et stockés hors du dépôt ; `BETTER_AUTH_SECRET` absent des sauvegardes. 15/10/2026 : absent des sauvegardes chiffrées de la base, mais **présent dans la sauvegarde OVH complète du VPS** (avec les fichiers de la base) : risque accepté par l'éditeur, à compenser par la double authentification sur l'espace client OVHcloud.
- [x] `npm run pilot:preflight` exécuté **contre l'environnement réel**. 15/10/2026, version 61d9c13 : 26 OK, 3 avertissements attendus (PostgreSQL 18, connexions locales sans SSL), 1 échec attendu (garde « APP_ENV = production » sans `--production`).
- [x] Tâche quotidienne `POST /api/cron/purge` installée et constatée. 15/10/2026 : timer actif (03:10), exécution manuelle avec la version 61d9c13 réussie (réponse JSON complète).
- [x] Sauvegarde chiffrée exécutée et **restauration testée**. 15/10/2026 : `coachos-20261015T084152Z.dump.age` (315 Ko), timer actif (03:30) ; `restore-verify.sh` : intégrité, déchiffrement, rôles, RLS, tables, migrations OK en 1,3 s. Destination : dossier local `/var/backups/coachos-archive`, emporté hors machine par la **sauvegarde quotidienne OVH du VPS** (choix de l'éditeur, pas de stockage objet séparé). Clé privée age hors serveur, chez l'éditeur. Prochain exercice : janvier 2027.
- [ ] Resend (activé, région Irlande) : DPA accepté et archivé ; stockage aux États-Unis confirmé par sa documentation : certification DPF vérifiée sur la liste officielle et capture archivée ; suivi des ouvertures et clics désactivé ; durée de rétention vérifiée.

## À faire rapidement (avant élargissement au-delà du pilote)

- [ ] Revue juridique de la notice `/privacy` et du registre ; bases légales confirmées (notamment photo et recontact WhatsApp).
- [ ] Décision AIPD documentée ([risques-aipd.md](risques-aipd.md)).
- [ ] Information des membres par chaque club (modèle de mention à fournir par l'éditeur).
- [ ] Durées décidées pour les comptes inactifs et les fiches actives inactives ; rotation des journaux Nginx/journald.
- [ ] Journal des demandes d'exercice des droits et registre des violations ouverts.
- [ ] MFA pour propriétaires et administrateurs envisagée ; durée de session (1 an) réévaluée pour les comptes staff.
- [ ] Actions GitHub épinglées par SHA ; CodeQL activé ou alternative.
