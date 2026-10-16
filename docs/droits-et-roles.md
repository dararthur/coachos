# Droits et rôles dans Matnexa

> Document de référence pour la présentation aux clubs. Il décrit **qui peut faire quoi**, **qui voit quelles données** et **comment c'est garanti**. Source technique : `src/domain/roles.ts` (matrice des permissions) ; la base de données applique les mêmes règles de son côté, et des tests automatiques vérifient que les deux restent alignées (`tests/db/permissions-matrix.test.ts`, `tests/db/roles-workflows.test.ts`).
>
> **Version PDF à diffuser aux clubs** : [droits-et-roles-matnexa.pdf](droits-et-roles-matnexa.pdf) (5 pages, charte Matnexa). Elle est générée par `scripts/build-rights-pdf.mjs` : après tout changement de droits, mettre à jour ce document **et** le script, puis lancer `npm run docs:rights-pdf`.
>
> Mis à jour le 16 octobre 2026. Le dossier RGPD (`docs/rgpd/`) reste à faire relire juridiquement avant l'ouverture à des données réelles ; ce document ne vaut pas avis juridique.

## 1. L'essentiel en une page

Un compte appartient à un ou plusieurs clubs, avec **un rôle par club**. Quatre rôles, du plus large au plus restreint :

| | **Propriétaire** | **Administrateur** | **Coach** | **Membre** |
|---|---|---|---|---|
| En une phrase | Le responsable du club : tout, y compris l'équipe d'encadrement et la suppression du club | Gère le club au quotidien | Anime les cours, suit ses élèves | Pratiquant : réserve, pointe, suit sa progression |
| Combien par club | Au moins 1 | Autant que nécessaire | Autant que nécessaire | Tous les adhérents avec compte |
| Gère les autres administrateurs et propriétaires | ✅ | — | — | — |
| Gère l'équipe (coachs, membres) | ✅ | ✅ | — | — |
| Paramètres du club, journal d'activité | ✅ | ✅ | — | — |
| Planning et types de cours | ✅ | ✅ | — (lecture) | — (lecture) |
| Fiches des membres | ✅ modifier, archiver, effacer | ✅ modifier, archiver, effacer | voir, créer un nouvel arrivant | la sienne |
| Présences | toutes | toutes | celles de **ses** séances (ou sans coach) | les siennes |
| Grades (passages de ceinture) | ✅ | ✅ | ✅ | son propre grade seulement |
| Rapports | ✅ avec export | ✅ avec export | lecture seule | — |
| Import / export CSV des membres | ✅ | ✅ | — | — |
| Publier des actualités | ✅ toutes | ✅ toutes | ✅ les siennes | lecture seule |
| Supprimer le club | ✅ | — | — | — |

Deux autres profils existent hors de cette hiérarchie : le **responsable légal** d'un enfant (§4) et l'**éditeur de la plateforme** (§8). Les **fiches sans compte** (adhérents qui n'ont pas d'accès) n'ont aucun droit : ce sont seulement des données gérées par le club.

## 2. Le détail par rôle

### Propriétaire

C'est le rôle de la personne qui a créé le club (après approbation de sa demande). Il fait tout ce que fait un administrateur, plus :

- **nommer, rétrograder ou retirer un administrateur ou un autre propriétaire** (l'administrateur ne peut pas) ;
- **supprimer le club**, avec saisie de son nom pour confirmer.

Garde-fous : un club conserve **toujours au moins un propriétaire** ; personne ne peut changer son propre rôle ; un propriétaire seul ne peut pas supprimer son compte sans avoir transféré la propriété ou supprimé le club.

### Administrateur

Le bras droit du propriétaire, pour tout ce qui fait tourner le club :

- **Membres** : créer, modifier, archiver (avec motif de départ), restaurer, importer un fichier CSV, exporter, effacer ou anonymiser une fiche, exporter les données d'une personne (droit d'accès).
- **Planning** : créer, modifier, annuler des séances, y compris en série ; gérer les disciplines et les types de cours (public adulte ou enfants, âge minimum).
- **Équipe** : inviter des coachs et des membres, changer leur rôle, les retirer. Il ne peut **pas** inviter, nommer ou retirer un administrateur ou un propriétaire.
- **Paramètres** : nom, fuseau, devise, durée de conservation des données, QR de pointage, code d'adhésion, logo, âge minimum des cours adultes.
- **Suivi** : rapports avec export CSV (présences, classement), journal d'activité du club (qui a fait quoi, sans donnée personnelle).
- Tout ce que fait un coach.

### Coach

L'encadrant : il voit ses élèves et fait vivre les cours, sans toucher à l'organisation du club.

- **Tableau de bord** : séances du jour, adhérents qui décrochent, passages de grade à évaluer.
- **Fiches des membres** : consultation, création d'un nouvel arrivant.
- **Présences** : il enregistre et valide la feuille d'appel des séances **qui lui sont affectées** (ou qui n'ont pas de coach). Il peut ouvrir et fermer le pointage QR de ces séances.
- **Grades** : enregistrer un passage de ceinture, confirmer une date de départ, voir l'éligibilité indicative (§5), exporter la liste « Éligibles au grade suivant ».
- **Pauses** : poser ou lever la pause d'un adhérent (avec son accord s'il s'agit d'une blessure ou d'une maladie).
- **Actualités** : publier, et modifier **ses propres** publications.
- **Rapports** : en lecture, sans export.
- Il ne peut **pas** : modifier ou archiver une fiche, importer ou exporter des fichiers, créer ou modifier des séances, gérer le catalogue, les paramètres, l'équipe, ni lire le journal d'activité.

### Membre

Le pratiquant, depuis son téléphone (l'application s'installe sur l'écran d'accueil).

- **Planning et réservations** : réserver une place, passer sur liste d'attente (promotion automatique si une place se libère), annuler.
- **Pointage** : scanner le QR du cours pour enregistrer sa présence ; voir l'historique de ses présences et de son assiduité.
- **Son profil** : prénom, nom, téléphone, ceinture et barrettes, silhouette ou photo.
- **Pauses** : déclarer une pause avec une raison dans une liste fermée (sans obligation de justifier : « ne souhaite pas s'exprimer »).
- **Actualités du club** : lecture, avec notification.
- **Classement** : s'il est activé pour son club, il voit son propre rang, mais n'apparaît dans la liste vue par les autres que s'il l'a lui-même demandé (**désactivé par défaut**).
- **Ses données** : télécharger l'export de ses données, supprimer son compte.
- Il ne voit **jamais** : les fiches des autres membres, leurs coordonnées, leurs présences, leur éligibilité ou leur historique de grades.

### Équipe en « mode membre »

Un coach, un administrateur ou un propriétaire peut basculer en **mode membre** pour s'inscrire à d'autres cours, pointer ou consulter le classement comme un adhérent. Un bandeau l'indique en permanence, et ses vrais droits restent ceux de son rôle. Un coach affecté à un cours figure automatiquement parmi les inscrits.

## 3. Matrice complète

✅ autorisé · — non autorisé · (S) seulement pour les séances qui lui sont affectées ou sans coach

| Domaine | Action | Propriétaire | Admin | Coach | Membre |
|---|---|:-:|:-:|:-:|:-:|
| **Tableau de bord** | Voir le tableau de bord | ✅ | ✅ | ✅ | — |
| **Planning** | Voir le planning | ✅ | ✅ | ✅ | ✅ |
| | Créer, modifier, annuler des séances | ✅ | ✅ | — | — |
| | Disciplines et types de cours | ✅ | ✅ | — | — |
| **Réservations** | Réserver, annuler, liste d'attente | ✅ (mode membre) | ✅ (mode membre) | ✅ (mode membre) | ✅ |
| **Présences** | Enregistrer et corriger | ✅ | ✅ | (S) | — |
| | Ouvrir/fermer le pointage QR, valider la feuille | ✅ | ✅ | (S) | — |
| | Pointer sa propre présence par QR | (mode membre) | (mode membre) | (mode membre) | ✅ |
| | Voir les présences | toutes | toutes | toutes | les siennes |
| **Membres** | Voir les fiches | ✅ | ✅ | ✅ | la sienne |
| | Créer une fiche | ✅ | ✅ | ✅ (nouvel arrivant) | — |
| | Modifier, archiver, restaurer | ✅ | ✅ | — | — (il complète son profil, voir §2) |
| | Importer un CSV | ✅ | ✅ | — | — |
| | Exporter (CSV) | ✅ | ✅ | — | — |
| | Effacer ou anonymiser | ✅ | ✅ | — | — |
| | Poser ou lever une pause | ✅ | ✅ | ✅ | la sienne |
| **Grades** | Enregistrer un passage, confirmer une date | ✅ | ✅ | ✅ | — |
| | Voir l'historique et l'éligibilité | ✅ | ✅ | ✅ | — |
| | Exporter les éligibles au grade suivant | ✅ | ✅ | ✅ | — |
| **Actualités** | Lire | ✅ | ✅ | ✅ | ✅ |
| | Publier | ✅ | ✅ | ✅ | — |
| | Modifier ou supprimer | toutes | toutes | les siennes | — |
| **Rapports** | Consulter | ✅ | ✅ | ✅ | — |
| | Exporter | ✅ | ✅ | — | — |
| **Équipe** | Inviter ou retirer un coach ou un membre | ✅ | ✅ | — | — |
| | Inviter, nommer ou retirer un administrateur ou propriétaire | ✅ | — | — | — |
| **Club** | Paramètres, QR, code d'adhésion, logo | ✅ | ✅ | — | — |
| | Journal d'activité | ✅ | ✅ | — | — |
| | Supprimer le club | ✅ | — | — | — |
| **Données personnelles** | Exporter ses propres données, supprimer son compte | ✅ | ✅ | ✅ | ✅ |

## 4. Les parents et les mineurs

Un enfant n'a pas de compte propre avant **15 ans** ; à partir de 15 ans, le compte est facultatif et ouvert sur invitation du responsable légal. Le **responsable légal** n'est pas un rôle du club : c'est un lien avec la fiche de l'enfant, qui lui donne, depuis « Mon compte » :

- de **confirmer son accord** (lien envoyé par e-mail, valable 14 jours) ;
- de **réserver et d'annuler** les cours de son enfant ;
- de décider si l'enfant **apparaît au classement** (désactivé par défaut) ;
- de **retirer son accord** : la fiche est archivée, la photo supprimée, le compte de l'enfant détaché ;
- d'exporter les données du compte, enfants compris.

Pour un mineur : pas de photo, pas de classement tant que le responsable n'a pas donné son accord, jamais de raison de santé dans une pause, et la communication (e-mail, WhatsApp) va **uniquement au responsable**. La date de naissance n'est conservée que pendant la minorité.

## 5. Qui voit les données sensibles

| Donnée | Qui la voit | Garde-fous |
|---|---|---|
| **Pause « blessure » ou « maladie »** (donnée de santé) | L'équipe du club et la personne elle-même | Consentement explicite horodaté ; aucune zone du corps ni diagnostic ; effacée 30 jours après la reprise ; jamais pour un mineur ; jamais dans un classement, une notification ou un écran partagé |
| **Autres raisons de pause** (vacances, horaires…) | L'équipe et la personne | Liste fermée ; « ne souhaite pas s'exprimer » possible |
| **Historique des grades** | L'équipe du club et la personne (dans son export) | Les autres membres n'y ont pas accès |
| **Date d'éligibilité au grade suivant** | **Propriétaire, administrateur, coach uniquement** | Calculée à l'affichage d'après les minimums de durée et d'âge de la fédération (IBJJF), **jamais stockée**, indicative : le professeur décide |
| **Coordonnées d'un adhérent** (e-mail, téléphone) | L'équipe du club | Un adhérent ne voit que les siennes |
| **Présences** | L'équipe ; chaque membre voit les siennes | Dans le classement, un adhérent n'est visible des autres que s'il l'a demandé (désactivé par défaut) ; l'équipe voit le classement complet |
| **Journal d'activité** | Propriétaire et administrateur | Sans donnée personnelle : seulement qui a fait quelle action |

## 6. Comment c'est garanti

- **Isolation entre clubs** : chaque requête s'exécute dans la base avec l'identité de l'utilisateur ; la base elle-même (sécurité au niveau des lignes) refuse toute lecture ou écriture hors de ses clubs. Un club ne peut voir ni les membres, ni les séances, ni les chiffres d'un autre club, même en cas d'erreur de l'application.
- **Retrait immédiat** : retirer un accès est effectif à la requête suivante ; il n'y a pas de session à laisser expirer.
- **Défense en profondeur** : les règles sont vérifiées trois fois — dans l'interface (ce qui n'est pas permis n'est pas proposé), dans le serveur (chaque action contrôle le rôle) et dans la base (qui refuse même si les deux premiers étaient contournés).
- **Traçabilité** : les actions sensibles (invitations et changements de rôle, retrait d'un accès, exports, passages de grade, suppressions, publications, pointage QR et validation des feuilles, réglage d'un module par l'éditeur) sont inscrites au journal d'activité du club, visible de ses propriétaires et administrateurs.
- **Tests automatiques** : plusieurs centaines de tests vérifient les droits de chaque rôle, l'isolation entre clubs et la cohérence entre l'application et la base.

## 7. Fonctionnalités selon la formule du club

La plateforme peut activer ou couper, **club par club**, trois modules :

| Module | Ce qu'il contient |
|---|---|
| **Classement et assiduité** | Page Classement et son export, rang du mois, réglage « apparaître au classement » |
| **Actualités et notifications** | Fil d'actualités du club, notification envoyée aux membres à chaque publication |
| **Grades et rapports** | Page Rapports et son export, historique des passages de ceinture, éligibilité indicative, liste et export « Éligibles au grade suivant » |

Un module coupé disparaît du menu, ses pages affichent « Non incluse dans votre formule » et il est refusé par le serveur **et** par la base. **Aucune donnée n'est supprimée** : tout revient à la réactivation. Les droits décrits ci-dessus s'appliquent ensuite normalement : activer un module ne donne un droit à personne.

Un club peut aussi être **suspendu** (impayé, par exemple) : il devient inaccessible à tous ses membres, avec un message clair, et se rouvre à l'identique à la réactivation.

## 8. Côté éditeur : ce que Matnexa voit, et ce qu'il ne voit pas

Un seul compte, celui de l'éditeur, a accès à la **console d'administration de la plateforme**. Elle est protégée par le mot de passe **et** par un code à usage unique envoyé par e-mail (valable 10 minutes, 5 essais, lié à la session).

| Matnexa voit | Matnexa ne voit pas |
|---|---|
| La liste des clubs, leur ancienneté et leur activité (compteurs) | Les noms, e-mails, téléphones ou présences des **membres** |
| L'e-mail du **propriétaire** de chaque club (pour le support) | Les pauses, grades, éligibilités, actualités ou réservations d'un club |
| Le nombre de membres et d'encadrants par club | Le contenu des fiches |
| L'état des tâches automatiques, les envois en échec | |
| Les modules activés, la formule et l'échéance de chaque club (information interne, que le club ne voit pas) | |

L'éditeur peut activer ou couper un module, suspendre un club ou le rouvrir, et approuver la création d'un nouveau club. Chaque changement de module est visible dans le journal d'activité du club concerné.

## 9. Questions fréquentes en rendez-vous

**Un coach peut-il voir les coordonnées de tous les élèves ?** Oui : il voit les fiches des membres de son club (nécessaire pour les contacter). Il ne peut pas les modifier ni les exporter.

**Un adhérent peut-il voir qui d'autre est inscrit ?** Non. Il voit son planning et ses réservations. Le classement ne montre que les personnes qui ont choisi d'y apparaître (désactivé par défaut).

**Peut-on donner un accès limité à un bénévole ?** Oui : le rôle **coach** n'a ni accès aux paramètres, ni à l'équipe, ni aux exports. Pour une personne qui ne doit voir que les cours, le rôle **membre** suffit.

**Que se passe-t-il si un coach quitte le club ?** Le propriétaire ou un administrateur le retire : l'accès est coupé immédiatement. Ses données personnelles de compte ne sont plus liées au club.

**Qui peut effacer un adhérent ?** Le propriétaire et les administrateurs, à sa demande ou à l'expiration de la durée de conservation choisie par le club. L'effacement est tracé.

**L'éditeur de la plateforme peut-il lire nos données ?** Non par la console : elle n'affiche que des compteurs et l'e-mail du propriétaire. L'éditeur est tenu par un contrat de sous-traitance (modèle dans `docs/rgpd/modele-contrat-sous-traitance.md`).

**Où sont hébergées les données ?** Chez OVHcloud, à Gravelines (France). Les e-mails passent par un fournisseur d'envoi en Irlande. Détail dans la notice de confidentialité (`/privacy`) et le dossier RGPD.
