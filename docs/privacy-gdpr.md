# Protection des données (RGPD) — éléments de conformité

> **Ceci n'est pas une déclaration de conformité.** Le produit ne doit pas être présenté comme « conforme RGPD » avant : revue juridique, registre complété, contrats de sous-traitance signés, analyse d'impact si nécessaire et procédures testées en exploitation. Les crochets `[ … ]` sont à compléter.

## Rôles

- **Club** (association ou société) : *responsable de traitement* des fiches membres, présences, plannings.
- **Éditeur de Matnexa** : *sous-traitant* (art. 28) pour ces données ; *responsable de traitement* pour les comptes utilisateurs et la sécurité. [Identité, contact, DPO le cas échéant]

## Registre simplifié des traitements

| Traitement | Finalité | Base légale | Données | Qui y accède | Durée |
|---|---|---|---|---|---|
| Fiches membres | Gérer les adhérents d'un club | Exécution du contrat d'adhésion / intérêt légitime | prénom, nom, e-mail (facultatif), date d'inscription (facultatif), identifiant d'origine (facultatif), attestation de majorité | propriétaire, admins, coachs (lecture/création) ; le membre connecté voit sa fiche | Actif ; archivé → **anonymisation automatique** après `retention_months` (défaut 24, réglable 6–120) |
| Présences | Suivre l'assiduité, organiser les cours | idem | séance, statut présent / retard / absent, auteur, origine (manuelle ou QR) | staff ; le membre voit les siennes | Suit la fiche ; conservées anonymisées après effacement |
| Jetons de pointage QR | Permettre l'auto-pointage d'une séance | Intérêt légitime / exécution du contrat | hachage SHA-256 d'un jeton aléatoire, séance, expiration (aucune donnée sur la personne) | aucun client (table interne) | 10–300 s de validité ; supprimés ≤ 24 h après expiration |
| Comptes | Authentification | Exécution du contrat | e-mail, nom affiché, mot de passe (haché par Better Auth), sessions (jeton, adresse IP pseudonymisée, navigateur), jetons à durée limitée (vérification, réinitialisation) | l'utilisateur ; staff du même club voit nom/e-mail | Jusqu'à suppression du compte |
| Journal d'audit | Sécurité, traçabilité des actions administratives | Intérêt légitime | action, acteur, horodatage, compteurs (aucun nom/e-mail) | propriétaire, admins | **24 mois** (purge automatique) |
| Invitations | Rattacher un compte à un club | Exécution du contrat | e-mail invité, rôle, hachage de jeton | admins | 7 jours + 30 jours après expiration/acceptation |
| Compteurs anti-abus | Limiter les tentatives répétées | Intérêt légitime (sécurité) | HMAC d'IP / e-mail (non réversible sans le secret) | aucun (table interne) | < 24 h |
| E-mails transactionnels | Confirmation d'adresse, réinitialisation de mot de passe | Exécution du contrat | adresse e-mail du destinataire, lien à usage limité, texte générique (aucun nom de club ni donnée métier) | fournisseur d'e-mails (sous-traitant) | côté fournisseur : voir ci-dessous |

## Minimisation et exclusions (appliquées par le code)

- **Adultes uniquement** : attestation de majorité obligatoire à la création/import, horodatée par la base ; aucune date de naissance collectée. La gestion des mineurs (tuteurs, sauvegarde) exige une conception dédiée **avant** toute ouverture.
- **Aucune donnée de santé ni de blessure**, aucun champ libre « notes » sur un membre. L'import **ignore** toute colonne non reconnue (téléphone, adresse, naissance…).
- **Pointage QR : aucune géolocalisation, reconnaissance faciale, biométrie ni image conservée** : la caméra ne sert qu'à lire un code dans le navigateur, sans envoi ni stockage.
- **Aucune donnée personnelle envoyée à un fournisseur d'IA** : aucune intégration IA n'est implémentée. Toute évolution (Coach Briefing assisté par IA) exige : finalité, base légale, information des personnes, contrat de sous-traitance, garanties de transfert, configuration sans rétention/entraînement — et la sélection des personnes signalées doit rester déterministe et explicable.

## Droits des personnes — procédure opérationnelle

| Droit | Comment l'exercer | Implémentation | Test |
|---|---|---|---|
| Accès / portabilité (membre) | Demande au club ; un admin ouvre la fiche → **« Exporter ses données »** (JSON) | `public.export_person_data`, journalisé | `tests/db/privacy.test.ts`, e2e |
| Accès / portabilité (compte) | **Mon compte → Télécharger mes données** | `public.export_my_data` | `tests/db/privacy.test.ts` |
| Rectification | Admin : modifier la fiche | `updateMemberAction` | repositories, e2e |
| Effacement (membre) | Admin : **Anonymiser** (recommandé : présences conservées sans identité) ou **Supprimer entièrement** | `public.erase_person` | `tests/db/privacy.test.ts`, e2e |
| Effacement (compte) | **Mon compte → Supprimer** (refusé si seul propriétaire d'un club) | `public.delete_my_account` : supprime l'accès, pseudonymise les journaux | `tests/db/privacy.test.ts` |
| Suppression d'un club | Propriétaire, confirmation par le nom | `public.delete_academy` (cascade) | `tests/db/roles-workflows.test.ts` |
| Opposition / limitation | Archiver le membre (retire des appels) puis anonymiser | `setMemberArchivedAction` | e2e |

Délai de réponse légal : **1 mois**. [Procédure interne de réception et de vérification d'identité : à définir.] L'effacement d'un compte ne supprime pas la fiche membre créée par un club (le club en est responsable) : le renvoyer vers le club.

## Rétention et purge

`app_private.purge_expired_data()` (appelée chaque jour par `POST /api/cron/purge`, authentifiée par `CRON_SECRET`) : anonymise les membres archivés depuis plus de `retention_months`, supprime les invitations périmées (+30 j), les événements d'audit de plus de 24 mois et les compteurs de débit de plus de 24 h. Testée dans `tests/db/privacy.test.ts`. **À planifier en production**, sinon la rétention n'est pas appliquée. [Vérifier la politique de rétention contractuelle de chaque club.]

## Sous-traitants et transferts — à documenter avant la production

| Sous-traitant | Rôle | Région | Garanties |
|---|---|---|---|
| [Hébergeur du serveur — à documenter] | Exécution de l'application et de la base PostgreSQL (auto-hébergées), journaux d'accès | [UE — à confirmer] | [DPA / conditions de l'hébergeur à archiver] |
| Resend (fournisseur d'e-mails transactionnels, **prévu, non activé**) | Envoi des e-mails de confirmation et de réinitialisation | Envoi possible depuis l'Irlande ; **les données stockées (métadonnées, journaux, contenu) sont aux États-Unis** d'après la documentation du fournisseur | DPA pré-signé avec clauses contractuelles types ; cadre UE–États-Unis en complément ; sous-traitants ultérieurs listés (dont un traitement d'**échantillons** d'e-mails à des fins de sécurité) — **à faire valider juridiquement avant tout envoi réel** |
| [Stockage de sauvegardes chiffrées — à choisir] | Sauvegardes hors du serveur | [UE] | [DPA ; chiffrement avec une clé que le fournisseur ne détient pas] |
| [Hébergeur de l'application, ex. Vercel] | Exécution de l'application, journaux d'accès | [UE — fonctions et journaux] | [DPA] |

Aucun outil d'analyse produit/traqueur n'est inclus. Aucun cookie non essentiel n'est posé (seuls les cookies de session d'authentification, strictement nécessaires) : pas de bandeau requis tant que cela reste vrai.

## Sauvegardes et accès

- Sauvegardes **chiffrées**, hors du serveur, à planifier [fréquence et durée de rétention à documenter] ; les données effacées disparaissent des sauvegardes à leur expiration — l'indiquer dans la notice. **Le secret de session (`BETTER_AUTH_SECRET`) ne doit jamais figurer dans une sauvegarde** : une sauvegarde contient des jetons de session en clair (`docs/self-hosted-auth.md` §4). **Tester la restauration** avant production.
- **E-mails (fournisseur)** : le contenu et les journaux des e-mails sont conservés par le fournisseur (30 jours d'après sa documentation) ; ils contiennent l'adresse du destinataire et un lien à usage limité (1 h pour la réinitialisation, 24 h pour la confirmation). Désactiver le suivi des ouvertures et des clics. Limiter l'accès au tableau de bord du fournisseur (comptes nominatifs, double authentification).
- Accès humain à la base de production : restreint aux personnes nommées, journalisé, jamais depuis un poste non protégé ; aucune donnée de production en développement.
- Le support de l'éditeur n'a **aucun accès implicite** aux données d'un club (aucun rôle « super-admin » n'existe dans l'application).

## Violation de données (art. 33-34)

1. Détecter / signaler (journaux, alerte, signalement) → ouvrir un incident horodaté.
2. Contenir (changer `BETTER_AUTH_SECRET` — invalide tous les cookies —, vider `auth.sessions` si la table a fuité, faire tourner `APP_SECRET`/`CRON_SECRET`/`RESEND_API_KEY`/mots de passe `app_server` et `auth_runtime`, couper l'accès).
3. Évaluer : données concernées, nombre de personnes, risque pour leurs droits.
4. **Notifier le club (responsable de traitement) sans délai injustifié** ; le club notifie la CNIL **sous 72 h** si risque, et les personnes si risque élevé. [Contacts et modèles de notification : à préparer.]
5. Documenter dans le registre des violations, corriger, rédiger un retour d'expérience.

## À faire avant tout usage avec de vraies données

- [ ] Revue juridique de la notice `/privacy`, des CGU et du contrat de sous-traitance.
- [ ] Registre des traitements finalisé ; décider si une AIPD est nécessaire.
- [ ] DPA signés avec les sous-traitants ; région UE confirmée ; transferts documentés.
- [ ] Purge planifiée, restauration de sauvegarde testée, procédure de violation répétée.
- [ ] Information des membres par les clubs (modèle de mention fourni par l'éditeur).
- [ ] Décision explicite sur l'ouverture aux mineurs : **non** dans ce MVP.
