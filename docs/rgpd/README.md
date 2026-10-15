# Dossier RGPD de Matnexa

> **Ce dossier n'est pas une attestation de conformité.** Il décrit le fonctionnement réel du code au 15/10/2026 et liste ce qui reste à décider ou à valider par l'éditeur, les clubs et un juriste. Les éléments entre crochets `[ … ]` sont à compléter. Rien ici ne doit être présenté comme « conforme au RGPD ».

Référence : règlement (UE) 2016/679 (RGPD), texte consolidé sur EUR-Lex ; recommandations de la CNIL ; lignes directrices du CEPD/EDPB ; guide d'hygiène informatique de l'ANSSI pour les mesures de sécurité.

Légende utilisée dans tout le dossier :

- **Obligation** : exigence d'un texte (article cité).
- **Recommandation** : CNIL, CEPD ou ANSSI ; non contraignante en soi, mais attendue.
- **Choix d'architecture** : décision de conception du produit, ni imposée ni garantie par un texte.
- **À vérifier** : information juridique ou contractuelle non confirmée.

| Document | Contenu |
|---|---|
| [cartographie.md](cartographie.md) | Données, personnes concernées, tables, flux et destinataires |
| [registre.md](registre.md) | Registre des traitements (art. 30), à compléter et valider |
| [conservation.md](conservation.md) | Matrice des durées de conservation et mécanisme qui les applique |
| [risques-aipd.md](risques-aipd.md) | Analyse des risques, mesures, et décision sur l'AIPD (art. 35) |
| [sous-traitants.md](sous-traitants.md) | Sous-traitants, transferts et vérifications contractuelles |
| [procedures.md](procedures.md) | Exercice des droits, suppression, violation de données |
| [checklist-mise-en-production.md](checklist-mise-en-production.md) | Conditions avant toute donnée réelle |
| [guide-mise-en-service.md](guide-mise-en-service.md) | Pas à pas sur le VPS : purge, sauvegardes, restauration, Resend, contrats |
| [modele-contrat-sous-traitance.md](modele-contrat-sous-traitance.md) | Modèle d'accord art. 28 à signer avec chaque club |
| [modele-information-membres.md](modele-information-membres.md) | Modèle d'information que chaque club diffuse à ses membres |
| [audit-2026-10-15.md](audit-2026-10-15.md) | Audit du code : constats, corrections, tests, statut |

Règle de maintenance : toute fonctionnalité qui ajoute une donnée personnelle, un destinataire ou un prestataire met à jour **dans le même commit** la cartographie, le registre, la matrice de conservation, la notice `/privacy` (`src/app/privacy/page.tsx`) et les fonctions d'export/effacement (`export_person_data`, `export_my_data`, `erase_person`, `delete_my_account`), avec un test dans `tests/db/privacy.test.ts`.
