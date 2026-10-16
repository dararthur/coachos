# Réservations, liste d'attente et e-mail de place confirmée

Règles des réservations (migration `20261014001300_session_bookings.sql`) et notification de l'adhérent promu depuis la liste
d'attente (migration `20261014002200_booking_promotion_notifications.sql`).

## Règles

- L'adhérent connecté réserve une séance à venir ; la réservation est **obligatoire pour pointer** (QR tournant ou fixe).
- La capacité ne bloque jamais : au-delà, la réservation passe en **liste d'attente**, dans l'ordre d'arrivée.
- Une place qui se libère est attribuée **automatiquement** au premier de la liste : annulation d'un inscrit, capacité augmentée
  ou retirée, inscrit archivé ou anonymisé. Le coach peut aussi **accorder une place** à un membre de la liste, même au-delà de
  la capacité.
- Annulation possible tant que la feuille d'appel n'est pas validée et qu'aucune présence n'est enregistrée ; à la validation,
  une réservation confirmée sans présence devient une absence.
- Aucune écriture directe : tout passe par des fonctions `SECURITY DEFINER` qui verrouillent la séance et arbitrent la capacité.

## E-mail « Votre place est confirmée »

L'adhérent promu depuis la liste d'attente (place libérée ou accordée par le coach) reçoit un e-mail. Le message affiché après
une mise en liste d'attente le dit : « vous serez prévenu(e) par e-mail » si une place se libère avant le cours.

### Comment l'application apprend la promotion

1. **Mise en file dans la transaction de la promotion.** Un déclencheur sur `session_bookings` (passage de `waitlisted` à
   `booked`) insère une ligne dans `booking_notifications`. Une promotion validée a donc toujours sa ligne, une transaction
   annulée n'en laisse aucune, et un nouveau chemin de promotion ajouté plus tard est couvert sans rien changer.
2. **Envoi après la réponse.** Les actions qui peuvent promouvoir quelqu'un (annulation, place accordée, modification de la
   séance, archivage ou effacement d'un membre) vident la file avec `after()` de Next.js : la réponse n'est pas retardée.
3. **Filet de sécurité quotidien.** `POST /api/cron/purge` (protégé par `CRON_SECRET`) vide aussi la file et renvoie
   `booking_emails_sent` / `booking_emails_failed`.

L'envoi utilise le rôle `app_server` et deux fonctions qui lui sont réservées : `app_private.claim_booking_notifications`
réserve un lot (`FOR UPDATE SKIP LOCKED` et bail de 10 minutes : deux envois simultanés ne prennent jamais la même ligne),
`app_private.complete_booking_notification` supprime la ligne une fois l'e-mail remis au fournisseur.

### Fiabilité

- **Au moins une fois** : un échec du fournisseur laisse la ligne en file ; nouvelle tentative au prochain envoi, au plus tôt
  10 minutes plus tard, **5 tentatives au maximum**, puis abandon.
- Un doublon n'est possible que si le serveur s'arrête entre la remise au fournisseur et l'effacement de la ligne.
- Limite : les nouvelles tentatives n'ont lieu que lors d'un envoi (action d'un club qui peut promouvoir, ou purge quotidienne).
  Une panne du fournisseur peu avant un cours peut donc faire manquer l'e-mail ; la réservation, elle, est bien confirmée et
  visible dans « Mon espace ».

### Aucun e-mail

La ligne est supprimée sans envoi, au moment de l'envoi, si :

- la fiche n'a pas de compte (rien n'est même mis en file), ou le compte n'a pas d'adresse confirmée ;
- l'adhérent a été retiré du club, ou sa fiche est archivée ou anonymisée ;
- la réservation a été annulée entre-temps (la ligne disparaît avec elle) ;
- la séance est annulée ou **déjà commencée**.

### Contenu et données

- Destinataire : l'adresse **du compte** de l'adhérent (pas l'e-mail saisi par le staff sur la fiche).
- Contenu : nom du club, nom du cours, date et heure **dans le fuseau du club**, lien vers `/a/<club>/me`. Ni nom de
  l'adhérent, ni autres inscrits, ni rang, ni capacité. La date est lue au moment de l'envoi : un changement d'horaire est
  reflété.
- La file ne contient que des identifiants ; la ligne est supprimée après l'envoi. RLS activée et forcée, aucune politique,
  aucun privilège : ni les membres, ni le staff, ni `app_server` ne la lisent directement.
- En développement et en test (`MAIL_PROVIDER=outbox`), l'e-mail est écrit dans `MAIL_OUTBOX_FILE` (catégorie
  `booking_promoted`).

### Preuves

- `tests/db/booking-notifications.test.ts` : chaque chemin de promotion, transaction annulée, fiche sans compte, places plus
  d'actualité, échec et abandon, envois simultanés, deux clubs, file fermée aux rôles applicatifs.
- `tests/unit/mail.test.ts` : contenu, fuseau du club, échappement HTML, objet sur une ligne.
- `tests/e2e/bookings.spec.ts` : la place accordée par le coach écrit l'e-mail dans la boîte d'envoi de test.

## Séance annulée et place confirmée : e-mail et notification push (P1.4)

La file `booking_notifications` (migration `20261016000400`) porte un **type** : `promoted` (place attribuée depuis la liste d'attente) ou `cancelled` (la séance réservée est annulée). Annuler une séance met en file, dans la même transaction, une ligne par réservation **confirmée** d'un adhérent avec compte (ni la liste d'attente, ni le coach affecté, ni une fiche archivée ou anonymisée). Rien ne part si la séance est déjà commencée, réactivée avant l'envoi, ou si la réservation a été annulée.

- **E-mail** (comme avant pour la promotion) puis **push** au mieux sur les appareils de l'adhérent (lus à l'envoi). Un échec push ne rejoue jamais l'e-mail ; un appareil disparu (404/410) est supprimé.
- **Texte neutre sur l'écran verrouillé** : « *Club* : séance annulée » / « *Club* : place confirmée », corps générique, sans nom de cours, horaire, nom d'adhérent ni autre inscrit ; un toucher ouvre le planning ou « Mon espace ». Le détail (cours, jour, heure) est dans l'e-mail et l'application.
- Envoi après la réponse de l'annulation (`after()`), filet de sécurité par la purge quotidienne (bail de 10 minutes, 5 tentatives).
- Mesure du pilote : réservations non honorées (absences après réservation) avant et après l'activation, à lire dans `attendance` (`absent` avec réservation).
