# Sous-traitants, transferts et vérifications contractuelles

Rappels : art. 28 (contrat de sous-traitance obligatoire, avec les mentions de l'art. 28 §3) ; art. 44 à 49 (transferts hors EEE : décision d'adéquation, ou garanties appropriées comme les clauses contractuelles types). Le cadre de protection des données UE–États-Unis fait l'objet d'une décision d'adéquation (juillet 2023) **pour les entreprises certifiées** : la certification du prestataire est à vérifier sur la liste officielle.

## Chaîne contractuelle

1. **Club → éditeur** : contrat de sous-traitance (art. 28 §3) entre chaque club et l'éditeur, **à rédiger et signer avant que le club saisisse des données réelles**. [Modèle : à rédiger ; la CNIL publie un guide du sous-traitant et des clauses types.]
2. **Éditeur → sous-traitants ultérieurs** : l'éditeur ne peut recourir à un sous-traitant ultérieur qu'avec l'autorisation écrite du club (art. 28 §2) et doit lui imposer les mêmes obligations (art. 28 §4).

## Liste

| Prestataire | Rôle | Données | Localisation | Statut | Vérifications à faire |
|---|---|---|---|---|---|
| OVHcloud (VPS) | Serveur, base PostgreSQL, journaux | toutes | France, datacenter de Gravelines (déclaré par l'éditeur le 15/10/2026, à constater dans l'espace client) | contrat à archiver | DPA signé/archivé ; localisation ; chiffrement disque ; accès de l'hébergeur |
| Resend | E-mails transactionnels | adresse, lien, nom de club/cours/date ; demandes de club : nom et e-mail du demandeur | envoi depuis la région Irlande (configuré, déclaré par l'éditeur le 15/10/2026) ; d'après sa documentation (consultée le 15/10/2026), les données du compte (**métadonnées, journaux, enregistrements d'API**) sont stockées **aux États-Unis** quelle que soit la région ; son DPA inclut des clauses contractuelles types et Resend se déclare certifié Data Privacy Framework | **activé** | DPA intégré aux conditions d'utilisation (clauses types 2021/914) ; DPF actif, re-certification en cours (vérifié le 15/10/2026) ; reste à archiver le DPA signé et à confirmer le suivi désactivé |
| OVHcloud (sauvegarde automatique du VPS) | Copie quotidienne complète du serveur, hors de la machine | tout le disque : base (fichiers bruts **non chiffrés par l'application**), sauvegardes chiffrées, secrets de `/etc/coachos` | [localisation à vérifier dans l'espace client] | **activée** (déclaré par l'éditeur le 15/10/2026) | même contrat qu'OVHcloud ; durée de conservation ; double authentification sur l'espace client |
| Meta / WhatsApp | Aucun (lien ouvert par le coach sur son appareil) | numéro et prénom transmis par le coach lui-même | — | hors contrat de l'éditeur | à mentionner dans l'information du club |
| Fournisseur d'IA | Aucun | — | — | aucune intégration | toute intégration future exige une mise à jour de ce dossier avant le code |

`docs/privacy-gdpr.md` mentionnait aussi un hébergeur de type Vercel : l'architecture actuelle est auto-hébergée (`docs/deploy-vps.md`), cette ligne ne s'applique pas tant qu'aucun hébergement managé n'est utilisé.
