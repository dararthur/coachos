# Procédures : droits des personnes, suppression, violation de données

## 1. Exercice des droits (art. 12 à 22)

Délai de réponse : **un mois** à compter de la réception, prolongeable de deux mois si nécessaire, avec information de la personne (art. 12 §3).

**Qui répond ?** Pour une fiche membre, le **club** (responsable). L'éditeur, sous-traitant, l'aide (art. 28 §3.e) et lui transmet sans délai toute demande reçue directement. Pour un compte ou une demande de club, l'**éditeur**.

**Vérification d'identité** : demander uniquement ce qui est nécessaire (art. 12 §6). Une demande envoyée depuis l'adresse e-mail du compte, ou faite depuis le compte connecté, suffit en général. Ne jamais demander de pièce d'identité par défaut.

| Droit | Outil | Fonction | Test |
|---|---|---|---|
| Accès / portabilité (membre) | Fiche membre → « Exporter ses données » (admin) | `export_person_data` : fiche, photo, présences, réservations | `tests/db/privacy.test.ts` |
| Accès / portabilité (compte) | Mon compte → « Télécharger mes données » | `export_my_data` : profil, sessions, clubs, demandes de club, fiches, photos, présences, réservations | `tests/db/privacy.test.ts` |
| Rectification | Modifier la fiche (admin) ; profil (membre) | actions serveur + RLS | repositories, e2e |
| Effacement (membre) | « Anonymiser » ou « Supprimer entièrement » (admin) | `erase_person` | `tests/db/privacy.test.ts` |
| Effacement (compte) | Mon compte → « Supprimer » | `delete_my_account` (photo, consentement, demandes de club, identifiants d'audit) | `tests/db/privacy.test.ts` |
| Retrait du consentement (classement) | Page Classement | `set_my_ranking_visibility` | `tests/e2e/mobile-pwa.spec.ts` (non exécuté dans cette session) |
| Opposition / limitation | Archiver la fiche (retire des appels), puis anonymiser | `setMemberArchivedAction` | e2e |

Tenir un **journal des demandes** (date, demandeur, droit, réponse, date de réponse) hors de l'application : [outil à choisir].

## 2. Suppression

- **Membre** : anonymisation recommandée (présences conservées sans identité), suppression complète si demandée ; la liste d'attente avance dans les deux cas.
- **Compte** : refusée tant que la personne est seule propriétaire d'un club (transférer ou supprimer le club d'abord). La fiche membre reste au club, sans photo ni présence dans le classement : en informer la personne et l'orienter vers le club pour la fiche.
- **Club** : par le propriétaire, confirmation par le nom ; suppression en cascade (`delete_academy`).
- **Sauvegardes** : les données effacées persistent dans les sauvegardes jusqu'à leur expiration. En cas de restauration, **rejouer les effacements** intervenus depuis la date de la sauvegarde (journal d'audit : `member.deleted`, `member.anonymized`, `account.deleted`) avant de remettre le service en ligne.

## 3. Violation de données (art. 33 et 34)

1. **Détecter et ouvrir un incident** horodaté (qui, quoi, quand, comment détecté).
2. **Contenir** : couper l'accès concerné ; changer `BETTER_AUTH_SECRET` (invalide tous les cookies) et vider `auth.sessions` si la table a fuité ; faire tourner `APP_SECRET`, `CRON_SECRET`, la clé du fournisseur d'e-mails et les mots de passe des rôles `app_server` et `auth_runtime`.
3. **Évaluer** : catégories de données, nombre de personnes et de clubs, conséquences possibles, données chiffrées ou non.
4. **Notifier** :
   - l'éditeur, sous-traitant, notifie **chaque club concerné sans délai injustifié** après en avoir pris connaissance (art. 33 §2) ;
   - le club notifie la CNIL **dans les 72 heures** après en avoir pris connaissance, sauf si la violation n'est pas susceptible d'engendrer un risque (art. 33 §1) ; pour les traitements dont l'éditeur est responsable (comptes), c'est l'éditeur qui notifie ;
   - les personnes concernées sont informées si le risque est élevé (art. 34).
5. **Documenter** toute violation, même non notifiée (art. 33 §5) : registre des violations [emplacement à définir].
6. Corriger, ajouter un test de non-régression, rédiger un retour d'expérience.

Contacts à préparer : [contact de chaque club, contact de l'éditeur, téléservice de notification de la CNIL].
