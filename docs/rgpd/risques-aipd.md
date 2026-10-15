# Analyse des risques et décision sur l'AIPD

## Faut-il une AIPD (art. 35) ?

**Décision : à prendre par l'éditeur (et chaque club pour son traitement), pas par cette analyse.** Éléments pour décider :

- L'art. 35 §1 impose une AIPD quand un traitement est « susceptible d'engendrer un risque élevé ». Les lignes directrices du CEPD (WP248 rév.01) donnent neuf critères ; un traitement qui en remplit **au moins deux** devrait en principe faire l'objet d'une AIPD.
- La CNIL publie une liste de traitements pour lesquels l'AIPD est requise (art. 35 §4) [référence exacte de la délibération en vigueur : à vérifier sur cnil.fr].

Lecture des neuf critères pour Matnexa dans son périmètre actuel (adultes, pas de données sensibles, clubs de taille modeste) :

| Critère CEPD | Constat | Rempli ? |
|---|---|---|
| Évaluation / notation | Classement des venues : comptage, pas de profilage ni de décision ; opt-in | Discutable — **à apprécier** |
| Décision automatisée avec effet juridique | Aucune (la liste d'attente suit l'ordre d'arrivée, sans effet juridique) | Non |
| Surveillance systématique | Suivi des présences aux cours, au sein du club | Discutable — **à apprécier** |
| Données sensibles / hautement personnelles | Aucune par conception | Non |
| Grande échelle | Non au lancement ; à réévaluer avec le nombre de clubs | Non à ce jour |
| Croisement de jeux de données | Non | Non |
| Personnes vulnérables | Adultes uniquement (attestation) ; pas de relation de subordination employeur | Non |
| Usage innovant | Non | Non |
| Empêche d'exercer un droit / bénéficier d'un service | Non | Non |

Conclusion provisoire, **à valider** : zéro à deux critères selon l'interprétation des deux lignes « discutables ». Si l'éditeur retient les deux, une AIPD est attendue ; sinon, documenter le raisonnement (le CEPD le recommande). **Réévaluer obligatoirement** si : ouverture aux mineurs, ajout de données de santé/blessures, intégration d'IA, vidéos de membres, croissance à grande échelle.

## Risques et mesures

| Id | Risque | Vraisemblance / gravité (estimation) | Mesures en place | Reste à faire |
|---|---|---|---|---|
| R1 | Accès d'un club aux données d'un autre | faible / élevée | RLS sur toutes les tables, FK composites, tests inter-club (`tests/db/tenant-isolation.test.ts`, e2e) | — |
| R2 | Accès d'un membre aux données des autres membres | faible / moyenne | RLS ; classement et photo seulement sur consentement | — |
| R3 | Vol de la base ou d'une sauvegarde | faible / élevée | sauvegardes chiffrées `age` ; mots de passe hachés ; IP pseudonymisées ; **jetons de session en clair** mais inutilisables sans `BETTER_AUTH_SECRET` | séparer secret et sauvegardes ; tester la restauration ; chiffrement du disque chez l'hébergeur à confirmer |
| R4 | Compromission d'un compte staff | moyenne / élevée | mots de passe ≥ 12, limitation de débit, révocation des sessions | **pas de MFA** ; sessions longues (1 an) ; envisager MFA pour propriétaires/admins |
| R5 | Fuite par export CSV/JSON | moyenne / moyenne | exports réservés aux admins, journalisés, limités | sensibiliser les clubs (un export sort du périmètre) |
| R6 | Envoi vers un prestataire hors UE (e-mails) | certaine si Resend / moyenne | contenu minimal (pas de nom d'adhérent sauf demande de club) | DPA et analyse de transfert **avant** envoi réel |
| R7 | Données conservées trop longtemps | moyenne / moyenne | purges automatiques testées | **planifier la purge** ; décider des durées pour comptes et fiches actives inactifs |
| R8 | Consentement au classement non éclairé | corrigé / faible | texte précisant nom, photo, ceinture, venues (commit `a508400`) | — |
| R9 | Données sensibles dans la note libre de demande de club | faible / moyenne | 500 caractères, avertissement sur le formulaire, purge 90 j | — |
| R10 | Journaux serveur conservant IP et URL sans limite | moyenne / faible | journaux applicatifs redactés | fixer rotation Nginx/journald |
| R11 | Mineur inscrit malgré l'attestation | moyenne / moyenne | attestation horodatée obligatoire ; aucune date de naissance | procédure club en cas de découverte : effacement |
