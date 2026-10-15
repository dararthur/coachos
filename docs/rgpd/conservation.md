# Matrice des durées de conservation

Principe : limitation de la conservation (art. 5.1.e). Les durées marquées **choix produit** ne découlent d'aucun texte : elles sont à valider par l'éditeur et, pour les données des clubs, par chaque club. Aucune durée légale spécifique n'a été vérifiée pour ce secteur.

| Donnée | Durée | Point de départ | Mécanisme (code) | Statut |
|---|---|---|---|---|
| Fiche membre active | Tant que le membre est actif | — | aucun (décision du club : archiver) | choix produit ; **pas de purge des fiches actives inactives depuis longtemps** — à décider |
| Date de naissance et responsable légal d'un mineur | Jusqu'à la majorité (18 ans) | date de naissance | `graduate_minors()` (cron de purge) ; anonymisation/suppression de la fiche | testé (`tests/db/minors.test.ts`) |
| Fiche membre archivée | `retention_months` du club (24 par défaut, 6–120) | archivage | `purge_expired_data()` → anonymisation | testé (`tests/db/privacy.test.ts`) |
| Présences | Indéfinie, **sans identité** après anonymisation | — | anonymisation de la fiche | choix produit : statistiques non identifiantes ; vérifier qu'elles ne sont pas réidentifiables dans un petit club |
| Réservations | Jusqu'à l'archivage/anonymisation de la fiche | — | trigger `people_drop_bookings` | testé |
| Photo | Jusqu'au retrait, anonymisation ou suppression du compte | — | triggers + `delete_my_account` | testé |
| Compte | Jusqu'à suppression par l'utilisateur | — | `delete_my_account` | **pas de suppression des comptes inactifs** — durée à décider |
| Session de connexion | 1 an glissant (renouvelée au plus une fois par jour) | dernière utilisation | `expiresIn`/`updateAge` (`src/server/auth/factory.ts`) + `purge_expired_auth()` | choix produit (usage mobile) |
| Jetons vérification / réinitialisation | 24 h / 1 h | émission | expiration + purge | testé |
| Invitations | 7 jours + 30 jours | expiration ou acceptation | `purge_expired_data()` | testé |
| Demandes de club | 90 j (en attente, refusée, approuvée non utilisée) ; 180 j max | création | `purge_academy_requests()` ; supprimées avec le compte du demandeur | testé |
| File d'avis de place | Jusqu'à l'envoi, 5 échecs, ou début du cours | création | `deliverBookingPromotions` | testé |
| Journal d'audit | 24 mois | événement | `purge_expired_data()` | choix produit, testé |
| Compteurs anti-abus | < 24 h | fenêtre | `purge_expired_data()` | testé |
| Jetons QR | ≤ 24 h après expiration | expiration | `purge_expired_data()` | testé |
| Sauvegardes chiffrées de la base | 7 jours (7 sauvegardes quotidiennes ; décision de l'éditeur du 15/10/2026) | sauvegarde | `prune.sh --apply` après chaque sauvegarde (`ExecStartPost`) | en place le 15/10/2026 |
| Sauvegarde OVH du VPS | 7 jours (indiqué par l'éditeur le 15/10/2026) | sauvegarde | côté OVHcloud | contient aussi les fichiers bruts de la base et `/etc/coachos` |
| Journaux Nginx / journald | [à fixer] | — | logrotate / journald | **à configurer** |
| E-mails chez le fournisseur | 30 jours d'après sa documentation | envoi | côté fournisseur | **à vérifier** contractuellement |

**Condition de fonctionnement** : toutes les purges dépendent de l'appel quotidien de `POST /api/cron/purge` avec `CRON_SECRET`. Sans tâche planifiée en production, **aucune durée n'est appliquée**.
