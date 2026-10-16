# Modèle — Accord de traitement des données (article 28 du RGPD)

> **Projet, non relu par un juriste.** Structure calquée sur les mentions obligatoires de l'article 28 §3 du RGPD. La CNIL publie un guide du sous-traitant et la Commission européenne des clauses contractuelles types entre responsable et sous-traitant (décision d'exécution (UE) 2021/915) : les consulter, ou les reprendre telles quelles, est la voie la plus sûre. Les crochets sont à compléter.

**Entre**
- le **Club** : [nom de l'association ou de la société], [forme], [adresse], [SIREN / RNA], représenté par [nom, qualité], ci-après « le Responsable » ;
- l'**Éditeur** : Arthur DARON, personne physique agissant à titre personnel, [adresse postale, si le club la demande], contact : contact@matnexa.fr, éditeur du service Matnexa, ci-après « le Sous-traitant ». (Si une entreprise est créée, remplacer par sa raison sociale, sa forme, son adresse et son SIREN, et faire signer un nouvel accord.)

## 1. Objet et durée

Le Sous-traitant traite des données personnelles pour le compte du Responsable, dans le cadre du service Matnexa (gestion des membres, des cours, des réservations et des présences). L'accord court pendant toute la durée d'utilisation du service et prend fin à la suppression du club dans Matnexa ou à la résiliation, selon les modalités de l'article 10.

## 2. Description du traitement

| Élément | Contenu |
|---|---|
| Nature et finalités | Gestion des adhérents ; organisation des cours, réservations et liste d'attente ; suivi des présences (y compris par QR code) ; classement des venues sur consentement des membres ; envoi d'e-mails de service ; exports à la demande du Responsable |
| Catégories de personnes | Membres du club, majeurs ou mineurs ; responsables légaux des mineurs ; encadrants (propriétaire, administrateurs, coachs) |
| Catégories de données | Identité (prénom, nom), contact (e-mail, téléphone), date d'inscription, identifiant interne facultatif, ceinture et barrettes, silhouette d'avatar, photo facultative, attestation de majorité, date de naissance et responsable légal (nom, e-mail, téléphone) des mineurs, accord du responsable, réservations, présences, consentement au classement |
| Données exclues | Aucune donnée de santé hors la raison d'une pause déclarée (« blessure » ou « malade » : catégorie seule, consentement explicite, aucun détail, voir `docs/rgpd/pauses-sante.md`), aucune date de naissance (hors mineurs, jusqu'à leur majorité), aucune donnée biométrique ou de géolocalisation. Le Responsable s'engage à ne pas en saisir |
| Durées | Selon `docs/rgpd/conservation.md` : fiches archivées anonymisées après le délai choisi par le Responsable (24 mois par défaut, réglable de 6 à 120 mois) |

## 3. Instructions documentées (art. 28 §3.a)

Le Sous-traitant ne traite les données que sur instruction documentée du Responsable ; l'utilisation du service par le Responsable (création, modification, export, archivage, effacement) vaut instruction. Il informe immédiatement le Responsable s'il estime qu'une instruction enfreint le RGPD. Il ne transfère les données hors de l'Union européenne que dans les conditions de l'article 6 ci-dessous.

## 4. Confidentialité (art. 28 §3.b)

Les personnes autorisées à accéder aux données chez le Sous-traitant sont [nommer] ; elles sont tenues à la confidentialité. Le Sous-traitant n'accède pas aux données d'un club hors des besoins de maintenance, de sécurité ou d'une demande du Responsable.

## 5. Sécurité (art. 28 §3.c et art. 32)

Mesures en place, détaillées dans `docs/security.md` : chiffrement des échanges (HTTPS) ; cloisonnement des clubs au niveau de la base de données (règles de sécurité par ligne) ; mots de passe hachés ; journal des actions administratives ; limitation des tentatives ; sauvegardes quotidiennes chiffrées hors du serveur, avec test de restauration ; hébergement en France.

## 6. Sous-traitants ultérieurs (art. 28 §2, §3.d et §4)

Le Responsable autorise le recours aux sous-traitants suivants :

| Sous-traitant | Prestation | Localisation des données |
|---|---|---|
| OVHcloud | Hébergement du serveur et de la base de données | France (Gravelines) |
| OVHcloud | Stockage des sauvegardes chiffrées | France ([région à compléter]) |
| Resend | Envoi des e-mails de service | Envoi depuis l'Irlande ; métadonnées et journaux stockés aux États-Unis, encadrés par les clauses contractuelles types de son DPA et sa certification Data Privacy Framework |

Les notifications push, que chaque utilisateur active volontairement, transitent par le service de notification de son navigateur (Google, Apple, Mozilla ou Microsoft) : message chiffré de bout en bout, adresse technique de l'appareil. Ces services sont des intermédiaires techniques du standard Web Push, non choisis par le Sous-traitant.

Le Sous-traitant informe le Responsable de tout ajout ou remplacement [30] jours à l'avance ; le Responsable peut s'y opposer et, à défaut d'accord, résilier sans frais. Le Sous-traitant impose à ses sous-traitants des obligations équivalentes.

## 7. Droits des personnes (art. 28 §3.e)

Le service fournit au Responsable les outils d'export, de rectification, d'archivage, d'anonymisation et d'effacement (`docs/rgpd/procedures.md`). Le Sous-traitant transmet au Responsable, sans délai, toute demande reçue directement d'une personne concernée par une fiche du club, et l'aide à y répondre dans le délai d'un mois.

## 8. Assistance (art. 28 §3.f)

Le Sous-traitant aide le Responsable à respecter ses obligations de sécurité, de notification des violations, d'analyse d'impact et de consultation préalable, compte tenu des informations à sa disposition. Il notifie au Responsable toute violation de données personnelles **dans un délai maximal de [48] heures** après en avoir pris connaissance, avec les informations prévues à l'article 33 §3 disponibles.

## 9. Audit (art. 28 §3.h)

Le Sous-traitant met à disposition les informations nécessaires pour démontrer le respect du présent accord (ce dossier `docs/rgpd/`, `docs/security.md`, résultats des tests) et permet des audits raisonnables, sur préavis de [30] jours, aux frais du Responsable sauf manquement constaté.

## 10. Fin du contrat (art. 28 §3.g)

Au choix du Responsable : export de ses données (formats CSV et JSON fournis par le service) puis suppression du club et de toutes ses données, ou suppression directe. La suppression dans la base est immédiate ; les copies dans les sauvegardes disparaissent à l'expiration de celles-ci, au plus tard 7 jours après l'effacement. Le Sous-traitant le confirme par écrit sur demande.

## 11. Responsabilités

Chaque partie répond de ses manquements dans les conditions de l'article 82 du RGPD. [Plafond et exclusions éventuels : à rédiger avec un conseil.]

Fait à [lieu], le [date], en deux exemplaires.

| Pour le Club | Pour l'Éditeur |
|---|---|
| [nom, qualité, signature] | [nom, qualité, signature] |
