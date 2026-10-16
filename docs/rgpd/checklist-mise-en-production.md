# Checklist avant toute donnée réelle

Coché = vérifié par une preuve (test exécuté, document signé, configuration constatée). Une case non cochée n'est pas une formalité.

## Bloquant (ne pas saisir de données réelles sans cela)

- [ ] Contrat de sous-traitance (art. 28) signé avec chaque club pilote.
- [x] Identité et coordonnées de l'éditeur renseignées dans `/privacy` (art. 13 §1.a) ; contact pour exercer les droits. Fait le 15/10/2026 : Arthur DARON, à titre personnel, contact@matnexa.fr (réception testée par l'éditeur le 15/10/2026).
- [x] Hébergeur : OVHcloud, Gravelines (France). 15/10/2026 : double authentification activée sur l'espace client et durée de la sauvegarde du VPS relevée (7 jours), d'après l'éditeur. Archiver une copie des conditions de traitement des données d'OVHcloud.
- [ ] HTTPS public, Nginx de production validé (`docs/nginx.md`) ; en-tête `X-Real-IP` écrasé par le proxy. 15/10/2026 : `https://app.matnexa.fr/api/health` répond `ok` ; écrasement de `X-Real-IP` **non vérifié**.
- [ ] Secrets de production générés et stockés hors du dépôt ; `BETTER_AUTH_SECRET` absent des sauvegardes. 15/10/2026 : absent des sauvegardes chiffrées de la base, mais **présent dans la sauvegarde OVH complète du VPS** (avec les fichiers de la base) : risque accepté par l'éditeur, à compenser par la double authentification sur l'espace client OVHcloud.
- [x] `npm run pilot:preflight` exécuté **contre l'environnement réel**. 15/10/2026, version 61d9c13 : 26 OK, 3 avertissements attendus (PostgreSQL 18, connexions locales sans SSL), 1 échec attendu (garde « APP_ENV = production » sans `--production`).
- [x] Tâche quotidienne `POST /api/cron/purge` installée et constatée. 15/10/2026 : timer actif (03:10), exécution manuelle avec la version 61d9c13 réussie (réponse JSON complète).
- [x] Sauvegarde chiffrée exécutée et **restauration testée**. 15/10/2026 : `coachos-20261015T084152Z.dump.age` (315 Ko), timer actif (03:30) ; `restore-verify.sh` : intégrité, déchiffrement, rôles, RLS, tables, migrations OK en 1,3 s. Destination : dossier local `/var/backups/coachos-archive`, emporté hors machine par la **sauvegarde quotidienne OVH du VPS** (choix de l'éditeur, pas de stockage objet séparé). Clé privée age hors serveur, chez l'éditeur. Prochain exercice : janvier 2027.
- [x] Resend (activé, région Irlande). Vérifié le 15/10/2026 : le DPA est intégré aux conditions d'utilisation et en vigueur dès l'acceptation du compte (clauses contractuelles types 2021/914, modules 2 et 3 ; sous-traitants ultérieurs sur resend.com/legal/subprocessors, préavis de 14 jours) ; Resend figure sur la liste officielle du Data Privacy Framework (UE–États-Unis et extension britannique, données hors RH), statut « Active - Re-certification under Review ». 15/10/2026, d'après l'éditeur : DPA signé téléchargé et archivé ; suivi des ouvertures et des clics désactivé sur `matnexa.fr`.

## Avant d'utiliser les pauses « blessure » et « malade » (donnée de santé)

- [ ] Note [pauses-sante.md](pauses-sante.md) relue et décision d'**AIPD** documentée ([risques-aipd.md](risques-aipd.md)) : une donnée de santé existe désormais.
- [ ] Les clubs pilotes sont informés et ont diffusé le texte d'information mis à jour ([modele-information-membres.md](modele-information-membres.md)).
- [ ] Notice `/privacy` relue juridiquement (paragraphe « Pauses »).

## Avant de saisir des fiches d'enfants réelles

- [ ] AIPD courte menée et documentée (ou décision motivée de ne pas en faire), voir [risques-aipd.md](risques-aipd.md) : les enfants sont des personnes vulnérables au sens des lignes directrices du CEPD.
- [ ] Texte d'information aux familles remis par le club ([modele-information-membres.md](modele-information-membres.md)) ; le club sait qu'il doit vérifier la qualité de responsable légal.
- [ ] Parcours mineur essayé de bout en bout sur la production avec des données fictives (création de la fiche, e-mail d'accord, confirmation, retrait de l'accord).
- [ ] Après déploiement des migrations 0004 à 0013 : purge quotidienne relancée à la main, réponse JSON contenant `minors_graduated`.

## À faire rapidement (avant élargissement au-delà du pilote)

- [ ] Revue juridique de la notice `/privacy` et du registre ; bases légales confirmées (notamment photo et recontact WhatsApp).
- [ ] Décision AIPD documentée ([risques-aipd.md](risques-aipd.md)).
- [ ] Information des membres par chaque club (modèle de mention à fournir par l'éditeur).
- [ ] Durées décidées pour les comptes inactifs et les fiches actives inactives ; rotation des journaux Nginx/journald.
- [ ] Journal des demandes d'exercice des droits et registre des violations ouverts.
- [ ] MFA pour propriétaires et administrateurs envisagée ; durée de session (1 an) réévaluée pour les comptes staff.
- [ ] Actions GitHub épinglées par SHA ; CodeQL activé ou alternative.
