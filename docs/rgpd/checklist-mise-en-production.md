# Checklist avant toute donnée réelle

Coché = vérifié par une preuve (test exécuté, document signé, configuration constatée). Une case non cochée n'est pas une formalité.

## Bloquant (ne pas saisir de données réelles sans cela)

- [ ] Contrat de sous-traitance (art. 28) signé avec chaque club pilote.
- [ ] Identité et coordonnées de l'éditeur renseignées dans `/privacy` (art. 13 §1.a) ; contact pour exercer les droits.
- [ ] Hébergeur : OVHcloud, Gravelines (France), déclaré ; conditions de traitement des données (DPA OVHcloud) acceptées et archivées, localisation constatée dans l'espace client.
- [ ] HTTPS public, Nginx de production validé (`docs/nginx.md`) ; en-tête `X-Real-IP` écrasé par le proxy.
- [ ] Secrets de production générés et stockés hors du dépôt ; `BETTER_AUTH_SECRET` absent des sauvegardes.
- [ ] `npm run pilot:preflight` exécuté **contre l'environnement réel** et vert.
- [ ] Tâche quotidienne `POST /api/cron/purge` installée et constatée (sans elle, aucune durée de conservation n'est appliquée).
- [ ] Sauvegarde chiffrée exécutée et **restauration testée**.
- [ ] Resend (activé, région Irlande) : DPA accepté et archivé ; lieu de stockage des journaux et contenus vérifié pour ce compte, et garanties de transfert documentées s'ils sont aux États-Unis ; suivi des ouvertures et clics désactivé ; durée de rétention vérifiée.

## À faire rapidement (avant élargissement au-delà du pilote)

- [ ] Revue juridique de la notice `/privacy` et du registre ; bases légales confirmées (notamment photo et recontact WhatsApp).
- [ ] Décision AIPD documentée ([risques-aipd.md](risques-aipd.md)).
- [ ] Information des membres par chaque club (modèle de mention à fournir par l'éditeur).
- [ ] Durées décidées pour les comptes inactifs et les fiches actives inactives ; rotation des journaux Nginx/journald.
- [ ] Journal des demandes d'exercice des droits et registre des violations ouverts.
- [ ] MFA pour propriétaires et administrateurs envisagée ; durée de session (1 an) réévaluée pour les comptes staff.
- [ ] Actions GitHub épinglées par SHA ; CodeQL activé ou alternative.
