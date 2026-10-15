# Registre des traitements (art. 30) — projet

> **À compléter et valider** par l'éditeur et, pour la partie « club », par chaque club. Les bases légales ci-dessous sont des **propositions** : elles dépendent de la relation réelle entre le club et ses adhérents (association, société, contrat d'adhésion) et doivent être confirmées juridiquement.

## A. Traitements dont l'éditeur est responsable (art. 30 §1)

Responsable : Arthur DARON, personne physique agissant à titre personnel (pas d'entreprise à ce jour). Contact protection des données : contact@matnexa.fr. DPO : [désigné ou non — l'art. 37 ne l'impose qu'en cas de suivi régulier et systématique à grande échelle ou de données sensibles à grande échelle ; à apprécier].

| Traitement | Finalité | Base légale proposée | Personnes | Données | Destinataires | Durée | Transferts |
|---|---|---|---|---|---|---|---|
| Comptes et authentification | Accès sécurisé au service | Art. 6.1.b (contrat) | Utilisateurs | e-mail, nom affiché, mot de passe haché, sessions (IP pseudonymisée, user-agent) | éditeur ; fournisseur d'e-mails | compte : jusqu'à suppression ; session : 1 an glissant | fournisseur d'e-mails : voir sous-traitants |
| Sécurité, anti-abus, audit | Prévenir les abus, tracer les actions administratives | Art. 6.1.f (intérêt légitime : sécurité) | Utilisateurs | HMAC d'IP/e-mail ; journal d'audit sans contenu | éditeur ; propriétaires/admins (audit de leur club) | compteurs < 24 h ; audit 24 mois | non |
| Demandes de création de club | Étudier et ouvrir un club | Art. 6.1.b (mesures précontractuelles) | Demandeurs | nom, e-mail, nom du club, note | administrateur de la plateforme ; fournisseur d'e-mails | 90 j (180 j max) ; suppression avec le compte | fournisseur d'e-mails |
| Journaux techniques (Nginx, application) | Exploitation, sécurité | Art. 6.1.f | Visiteurs, utilisateurs | IP, URL, user-agent, horodatage | éditeur, OVHcloud (hébergeur) | [à fixer ; la CNIL recommande en général 6 mois à 1 an pour la journalisation de sécurité — à vérifier selon le cas] | non (OVHcloud, France) |

## B. Traitements effectués pour le compte des clubs (art. 30 §2, registre du sous-traitant)

Pour chaque club client : [nom du club, contact]. Le club tient **son propre** registre (art. 30 §1) ; l'éditeur lui fournit cette description.

| Catégorie de traitement | Finalité (club) | Base légale à déterminer par le club | Données | Mesures |
|---|---|---|---|---|
| Fiches membres | Gestion des adhérents | Art. 6.1.b (contrat d'adhésion) ou 6.1.f | identité, contact (e-mail, téléphone), grade, silhouette, date d'inscription, attestation de majorité | RLS par club, rôles, export/effacement |
| Présences et réservations | Organisation des cours, assiduité | Art. 6.1.b / 6.1.f | séance, statut, réservation | idem |
| Photo de profil | Reconnaissance des membres par l'équipe | **À trancher** : facultative et ajoutée par le membre ; base 6.1.a (consentement) ou 6.1.f possibles | image | facultative ; retrait libre ; supprimée avec le compte |
| Classement des venues | Animation du club | **Art. 6.1.a (consentement)** — opt-in, désactivé par défaut, retrait en un clic | nom, photo, ceinture, venues visibles des autres membres | `ranking_opt_in` faux par défaut ; réinitialisé à la suppression du compte |
| Recontact (WhatsApp) | Relancer un membre absent | Art. 6.1.f (à confirmer) | téléphone, prénom | action manuelle du staff depuis son appareil |
| Avis de place confirmée | Informer de la sortie de liste d'attente | Art. 6.1.b | e-mail, club, cours, date | file interne fermée aux rôles applicatifs |

Mesures de sécurité (art. 32) : voir `docs/security.md` et [risques-aipd.md](risques-aipd.md).
