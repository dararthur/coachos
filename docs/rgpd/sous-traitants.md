# Sous-traitants, transferts et vérifications contractuelles

Rappels : art. 28 (contrat de sous-traitance obligatoire, avec les mentions de l'art. 28 §3) ; art. 44 à 49 (transferts hors EEE : décision d'adéquation, ou garanties appropriées comme les clauses contractuelles types). Le cadre de protection des données UE–États-Unis fait l'objet d'une décision d'adéquation (juillet 2023) **pour les entreprises certifiées** : la certification du prestataire est à vérifier sur la liste officielle.

## Chaîne contractuelle

1. **Club → éditeur** : contrat de sous-traitance (art. 28 §3) entre chaque club et l'éditeur, **à rédiger et signer avant que le club saisisse des données réelles**. [Modèle : à rédiger ; la CNIL publie un guide du sous-traitant et des clauses types.]
2. **Éditeur → sous-traitants ultérieurs** : l'éditeur ne peut recourir à un sous-traitant ultérieur qu'avec l'autorisation écrite du club (art. 28 §2) et doit lui imposer les mêmes obligations (art. 28 §4).

## Liste

| Prestataire | Rôle | Données | Localisation | Statut | Vérifications à faire |
|---|---|---|---|---|---|
| OVHcloud (VPS) | Serveur, base PostgreSQL, journaux | toutes | France, datacenter de Gravelines (déclaré par l'éditeur le 15/10/2026, à constater dans l'espace client) | contrat à archiver | DPA signé/archivé ; localisation ; chiffrement disque ; accès de l'hébergeur |
| Resend | E-mails transactionnels | adresse, lien, nom de club/cours/date ; demandes de club : nom et e-mail du demandeur | envoi depuis la région Irlande (configuré, déclaré par l'éditeur le 15/10/2026) ; le stockage des métadonnées, journaux et contenus peut rester aux États-Unis d'après la documentation du fournisseur **[à vérifier pour ce compte]** | **activé** | DPA ; clauses types / certification DPF ; sous-traitants ultérieurs ; désactiver le suivi des ouvertures et clics ; durée de rétention ; alternative UE à envisager |
| [Stockage de sauvegardes] | Copies chiffrées hors serveur | base complète chiffrée (clé non détenue par le prestataire) | [UE] | **non choisi** | DPA ; région ; verrouillage d'objets |
| Meta / WhatsApp | Aucun (lien ouvert par le coach sur son appareil) | numéro et prénom transmis par le coach lui-même | — | hors contrat de l'éditeur | à mentionner dans l'information du club |
| Fournisseur d'IA | Aucun | — | — | aucune intégration | toute intégration future exige une mise à jour de ce dossier avant le code |

`docs/privacy-gdpr.md` mentionnait aussi un hébergeur de type Vercel : l'architecture actuelle est auto-hébergée (`docs/deploy-vps.md`), cette ligne ne s'applique pas tant qu'aucun hébergement managé n'est utilisé.
