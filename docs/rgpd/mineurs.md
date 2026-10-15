# Adhérents mineurs

Matnexa admet les adhérents mineurs depuis la migration `0024_minors` (a priori sans âge minimum : sections enfants incluses). Ce document décrit le dispositif, ses limites et ce qui reste à décider avant l'ouverture à des données réelles. Il ne vaut pas avis juridique et **ne permet pas d'affirmer la conformité** : voir la liste « À valider » en bas.

## Principes retenus

| Sujet | Choix |
|---|---|
| Compte | La fiche est créée par le staff (formulaire ou import CSV). **Moins de 15 ans : pas de compte propre.** **15 ans et plus : compte propre facultatif**, sur invitation créée par le responsable légal (accord confirmé) depuis « Mon compte » ; lien à usage unique, 7 jours, lié à l'e-mail du mineur (stocké seulement dans l'invitation, purgée ensuite). L'auto-inscription par code club reste réservée aux adultes (attestation « 18 ans ou plus ») |
| Responsable légal | Obligatoire à la création (base : contrainte différée `people_require_guardian`) : nom, e-mail, téléphone facultatif. Table `guardianships` |
| Accord | Lien envoyé par e-mail au responsable (jeton de 256 bits, stocké **haché**, valable 14 jours). La page `/consent/<jeton>` ne confirme rien à l'ouverture (les messageries préchargent les liens) : l'accord est enregistré par un bouton. Date de demande, de confirmation et de retrait conservées |
| Compte du responsable | Facultatif. S'il confirme connecté, ou depuis un compte, son compte est rattaché à la fiche (jamais écrasé) et il voit « Mes enfants » dans Mon compte : accord, dernier cours, classement, retrait |
| Communication | WhatsApp et e-mail : **vers le responsable uniquement**, et seulement une fois l'accord confirmé. L'e-mail et le téléphone de l'enfant ne sont pas enregistrés (formulaire, import CSV) |
| Classement et photo | Désactivés. Seul le responsable (accord confirmé) peut activer le classement ; la base le force à faux sinon (`minor_ranking_guard`). Le mineur titulaire d'un compte ne peut ni activer le classement ni déposer de photo (la base refuse, `coachos:guardian_required`). La photo n'est visible des autres que si le classement est activé |
| Date de naissance | Conservée **uniquement pour les mineurs**, effacée à la majorité (`graduate_minors()`, appelée par la purge quotidienne) avec le responsable. Jamais conservée pour un majeur saisi par le staff |
| Retrait de l'accord | Par le responsable (Mon compte) ou un administrateur : fiche archivée, classement coupé, photo supprimée, compte du mineur délié et retiré du club. L'anonymisation suit selon la durée de rétention du club |
| Réservations | Le responsable lié (accord confirmé) réserve et annule les cours de son enfant depuis « Mes enfants » (fonctions `book_for_child`, `cancel_child_booking`, `child_sessions` : seul le responsable rattaché y accède, pour le club de l'enfant). Mêmes règles que pour un adhérent (capacité, liste d'attente). Limite : pas d'e-mail de promotion depuis la liste d'attente pour un enfant sans compte (le statut se voit dans l'application) |
| Santé | Toujours exclue. Les ceintures enfants IBJJF (grise, jaune, orange, verte et leurs degrés) ne sont pas une donnée de santé |

Âge de 15 ans : le consentement seul du mineur (art. 45 de la loi Informatique et Libertés) n'est **pas** utilisé. Pour tout mineur, c'est le responsable qui consent, ce qui couvre aussi les moins de 15 ans. Dès 15 ans, le compte propre est facultatif et **ne dispense pas** de l'accord du responsable (exigé avant l'invitation). Le mineur qui a un compte garde un responsable légal rattaché et reste destinataire d'aucun message du club : les messages vont toujours au responsable.

## Droits

- **Accès / portabilité** : l'export de la fiche (`export_person_data`) inclut date de naissance et responsable ; l'export du compte du responsable (`export_my_data`) inclut la section `children`.
- **Effacement** : `erase_person` (anonymiser/supprimer) supprime le responsable ; l'anonymisation efface aussi la date de naissance (déclencheurs `people_clear_phone_on_anonymize`, `drop_guardian_on_anonymize`).
- **Sécurité** : RLS sur `guardianships` (staff du club et responsable lié en lecture ; aucune écriture directe, tout passe par des fonctions `security definer`) ; clés étrangères composites `(id, academy_id)` ; tests dans `tests/db/minors.test.ts` et `tests/e2e/minors.spec.ts`.

## À valider avant mise en production

1. Revue juridique du texte d'information aux familles (`modele-information-membres.md`) et de la page `/privacy`.
2. Base légale pour le traitement des données du mineur et du responsable (6.1.b via le contrat d'adhésion conclu par le responsable, à confirmer par le club).
3. Réévaluation de l'AIPD (`risques-aipd.md`) : critère « personnes vulnérables », risques R11 à R13.
4. Le club vérifie l'identité du responsable (le lien prouve l'accès à l'e-mail, pas la qualité de responsable légal) ; prévoir un justificatif papier si besoin.
5. Mise à jour du modèle de contrat de sous-traitance avec chaque club (catégories de personnes et de données déjà adaptées).
6. Confirmer que l'accord du parent en plus du consentement du mineur de 15 ans et plus est le niveau souhaité (le texte légal permettrait le consentement seul du mineur).
