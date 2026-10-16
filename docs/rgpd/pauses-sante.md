# Pauses déclarées et donnée de santé (art. 9)

Mise en place le 16/10/2026 (migration `20261016000600_member_lifecycle.sql`). **Décision de principe prise par l'éditeur ; validation juridique à faire** (comme le reste du dossier).

## Ce qui change

Jusqu'ici Matnexa n'enregistrait **aucune donnée de santé par conception**. Depuis les pauses, un adhérent (ou l'équipe du club, avec son accord) peut déclarer « pause jusqu'au… » avec une raison d'une liste fermée :

| Raison | Donnée de santé ? |
|---|---|
| 🩹 Blessure, 🤒 Malade | **Oui** (art. 9 RGPD, catégorie particulière) |
| 🕐 Horaires, ✈️ Vacances ou déplacement, 🏠 Raison personnelle, ⏸️ Autre, 🔒 Ne souhaite pas s'exprimer | Non |

Le motif de départ (à l'archivage) a sa propre liste fermée, **sans** catégorie de santé.

## Garde-fous (appliqués par la base, testés)

1. **Consentement explicite** (art. 9.2.a) pour « Blessure » et « Malade » : case cochée à la déclaration, horodatée (`pause_consent_at`). Que l'adhérent déclare lui-même ou que le staff note ce que la personne lui a dit : sans la case, la base refuse (y compris par accès direct, contrainte `people_pause_health_consent`).
2. **Aucun détail libre** : ni zone du corps, ni diagnostic, ni durée médicale. Seulement la catégorie et une date de reprise (au plus 366 jours).
3. **Visibilité** : l'équipe du club (propriétaire, administrateurs, coachs) et la personne elle-même. Jamais les autres adhérents (la RLS de `people` ne montre à un adhérent que sa propre fiche), ni le classement, ni une notification, ni un écran partagé. Les vignettes ne doivent jamais apparaître sur une tablette d'accueil (kiosque envisagé en P2).
4. **Mineurs** : aucune raison de santé (l'accord du responsable légal n'a pas de parcours dans cette version). « Autre » et « Ne souhaite pas s'exprimer » restent possibles.
5. **Minimisation et effacement** : effacée à l'archivage, à l'anonymisation, à la levée de la pause, et **30 jours après la date de reprise** (purge quotidienne `purge_pauses`).
6. **Audit** : le journal retient qu'une pause a été posée (`member.paused`, par l'adhérent ou le staff), jamais sa raison.
7. **Droit d'accès** : la pause (raison, date, consentement) figure dans l'export de la personne et dans l'export du compte. Exclue de l'export CSV des membres.
8. **Pas de décision automatique** : la pause sert seulement à ne pas signaler la personne comme décrocheuse.

## Ce que le club doit savoir et faire

- Le club est responsable du traitement ; il doit **informer** ses adhérents (modèle mis à jour : [modele-information-membres.md](modele-information-membres.md)) et n'enregistrer une blessure ou une maladie qu'**avec l'accord de la personne**.
- Le contrat de sous-traitance ([modele-contrat-sous-traitance.md](modele-contrat-sous-traitance.md)) ne dit plus « aucune donnée de santé » : il décrit cette catégorie limitée.
- « Ne souhaite pas s'exprimer » existe pour que personne ne soit obligé de justifier sa pause.

## À faire avant d'activer en production réelle

- [ ] Relire cette note et décider (éditeur) : **AIPD** requise ou non, maintenant qu'une donnée de santé existe (critère « données sensibles » du CEPD, cumulé avec les mineurs admis au club). Voir [risques-aipd.md](risques-aipd.md).
- [ ] Mettre à jour la notice `/privacy` publiée et la diffuser aux clubs (fait dans le code ; relecture juridique à faire).
- [ ] Informer les clubs pilotes avant la première pause « blessure » ou « malade ».
