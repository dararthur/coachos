# Analyse des risques et décision sur l'AIPD

## Faut-il une AIPD (art. 35) ?

**Décision : à prendre par l'éditeur (et chaque club pour son traitement), pas par cette analyse.** Éléments pour décider :

- L'art. 35 §1 impose une AIPD quand un traitement est « susceptible d'engendrer un risque élevé ». Les lignes directrices du CEPD (WP248 rév.01) donnent neuf critères ; un traitement qui en remplit **au moins deux** devrait en principe faire l'objet d'une AIPD.
- La CNIL publie une liste de traitements pour lesquels l'AIPD est requise (art. 35 §4) [référence exacte de la délibération en vigueur : à vérifier sur cnil.fr].

Lecture des neuf critères pour Matnexa dans son périmètre actuel (adultes et mineurs avec responsable légal, pas de données sensibles, clubs de taille modeste) :

| Critère CEPD | Constat | Rempli ? |
|---|---|---|
| Évaluation / notation | Classement des venues : comptage, pas de profilage ni de décision ; opt-in | Discutable — **à apprécier** |
| Décision automatisée avec effet juridique | Aucune (la liste d'attente suit l'ordre d'arrivée, sans effet juridique) | Non |
| Surveillance systématique | Suivi des présences aux cours, au sein du club | Discutable — **à apprécier** |
| Données sensibles / hautement personnelles | **La raison d'une pause (« blessure », « malade »)** depuis le 16/10/2026 : catégorie seule, consentement explicite, sans détail libre, effacée 30 jours après la reprise (`pauses-sante.md`). Interdite pour les mineurs | **Oui, de façon limitée — à réévaluer** |
| Grande échelle | Non au lancement ; à réévaluer avec le nombre de clubs | Non à ce jour |
| Croisement de jeux de données | Non | Non |
| Personnes vulnérables | **Mineurs admis** (avec responsable légal, sans compte propre, classement/photo désactivés, aucune donnée de santé) ; adultes sur attestation | **Discutable — à apprécier** (voir mineurs.md) |
| Usage innovant | Non | Non |
| Empêche d'exercer un droit / bénéficier d'un service | Non | Non |

Conclusion provisoire, **à valider** : les lignes de critères « discutables » sont maintenant au nombre de trois. Point d'attention propre aux mineurs : les lignes directrices du CEPD (WP248 rév.01, critère « personnes vulnérables ») citent expressément les enfants parmi les personnes vulnérables [formulation exacte à relire dans le texte] ; ce critère est donc **plus difficile à écarter** qu'il ne l'était pour des adultes seuls. Avec un second critère retenu (suivi des présences ou classement), une AIPD est attendue. **Recommandation : mener une AIPD courte avant d'enregistrer des fiches d'enfants réelles** (ou, à défaut, limiter la mise en service aux adultes tant qu'elle n'est pas faite) et documenter le raisonnement dans les deux cas (le CEPD le recommande). **Réévaluer obligatoirement** si : compte propre pour les mineurs, ajout de données de santé/blessures, intégration d'IA, vidéos de membres, croissance à grande échelle.

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
| R11 | Mineur inscrit via un compte d'adulte (auto-inscription par code club : attestation « 18 ans ou plus ») | moyenne / moyenne | attestation horodatée ; les mineurs sont inscrits par le club avec responsable légal | procédure club en cas de découverte : effacement |
| R12 | Mineur inscrit sans accord réel du responsable (e-mail erroné ou usurpé) | faible / moyenne | lien à jeton aléatoire stocké haché, expirant à 14 jours, confirmation par geste explicite (pas à l'ouverture), accord horodaté ; fiche active mais messages bloqués tant que non confirmé | le club vérifie l'identité du responsable (papier au club) ; retrait possible à tout moment |
| R14 | Notification push affichant un contenu sensible sur l'écran verrouillé (nom du club, titre d'une actualité) | faible / faible | message limité au nom du club et au titre ; `docs/news.md` : aucune donnée de membre dans une publication ; chiffrement de bout en bout vers l'appareil ; activation volontaire par appareil | rappeler aux clubs de ne rien mettre de personnel dans un titre |
| R15 | Coordonnées du responsable conservées après la suppression de son compte | faible / faible | le lien au compte est coupé, la fiche de l'enfant garde le contact nécessaire au club ; l'accord peut être retiré (fiche archivée) ; expliqué dans `/privacy` | à valider avec un juriste : alternative = proposer l'effacement des coordonnées au retrait de l'accord |
| R16 | Appareil partagé : notification destinée à un autre compte | faible / faible | un appareil qui change de compte passe au compte courant (`save_push_subscription`) ; désactivation par appareil | — |
| R13 | Date de naissance conservée après la majorité | faible / faible | `graduate_minors()` quotidien (cron de purge) efface date de naissance et responsable | — |
