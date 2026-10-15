# Notifications push

Notifications Web Push (standard W3C), sans application native : un navigateur ou une PWA installée s'abonne, le serveur envoie un message **chiffré de bout en bout** via le service de notification du navigateur (Google FCM, Mozilla, Apple, Microsoft). Ce service ne voit passer qu'un message opaque.

## Ce qui existe

- **Abonnement par appareil** : « Mon compte » → carte « Notifications » → « Activer les notifications » (la permission du navigateur n'est demandée qu'à ce clic). Boutons « Envoyer une notification d'essai » et « Désactiver ». Chaque téléphone/ordinateur s'active séparément.
- **Proposition au premier lancement** : dans l'application installée uniquement (jamais dans un onglet), un encart « Être prévenu des annonces du club ? » propose d'activer ; « Plus tard » est mémorisé sur l'appareil (« Mon compte » reste disponible). La permission n'est demandée qu'au toucher du bouton.
- **Premier usage** : publication d'une actualité (case « Prévenir les membres par notification », cochée par défaut, à la création seulement). Destinataires : appareils des membres du club, **hors l'auteur**. Contenu : « 📣 Du nouveau chez *Club* » (titre) et titre de la publication (corps) ; un toucher ouvre `/a/<club>/news`.
- **Service worker** `public/sw.js` : affiche la notification et ouvre la page. Aucun `fetch`, aucun cache (cf. `docs/pwa.md`). Ne reçoit qu'un chemin de l'application (jamais une adresse externe).
- **Base** (migration `20261015001100_push_subscriptions.sql`) : `push_subscriptions`, visible et supprimable par son seul titulaire (RLS) ; l'enregistrement passe par `app_private.save_push_subscription` (un appareil qui change de compte passe au compte courant, 10 appareils max par compte) ; l'envoi lit les appareils d'un club via `app_private.push_targets_for_club` (réservée à `app_server`) et supprime les appareils expirés (404/410).
- **Sécurité** : l'adresse d'abonnement fournie par le navigateur n'est acceptée que pour les services connus en https (anti-SSRF, `src/domain/push.ts`, testé) ; CSP `worker-src 'self'` ; limitation de débit des écritures ; aucune adresse d'appareil dans les journaux.
- **Envoi « au mieux »** : après la réponse (`after()`), sans file ni nouvelle tentative. Une notification perdue ne perd pas l'information (elle est dans « Actualités »). Pas de limite de fréquence par club pour l'instant.

## Mise en service (une fois)

Fonction **désactivée** tant que les clés ne sont pas configurées (la carte et la case n'apparaissent pas).

```bash
node scripts/generate-vapid.mjs mailto:contact@matnexa.fr
```

Recopier les trois lignes affichées (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) dans `/etc/coachos/app.env`, puis redémarrer le service. **Ne jamais régénérer les clés ensuite** : tous les appareils devraient se réabonner. Les clés ne vont jamais dans Git ; la clé publique est envoyée au navigateur, la privée ne quitte pas le serveur.

## À vérifier sur appareils réels (non faisable en test automatique)

L'abonnement dépend du service du navigateur (réseau) : les tests automatiques couvrent l'interface, la base, la validation et l'envoi simulé, pas la remise réelle.

1. Android/Chrome : activer, « Envoyer une notification d'essai », publier une actualité avec un second compte ; la notification arrive, un toucher ouvre les actualités.
2. iPhone : installer l'app sur l'écran d'accueil, l'ouvrir depuis l'icône, activer (dans Safari simple, un mode d'emploi s'affiche).
3. Refuser la permission : le message « bloquées » s'affiche ; désactiver puis réactiver.

## Évolutions possibles

Notification « place confirmée » (liste d'attente, en plus de l'e-mail), rappel de séance, préférences par type de message, plafond d'envois par club.

## Rappel de séance (« 🥋 séance dans 1 h, tout est prêt ? »)

- **Qui** : les adhérents dont la réservation est **confirmée** (pas la liste d'attente), avec un compte rattaché à leur fiche, membres du club, fiche ni archivée ni anonymisée, et au moins un appareil abonné. Séance annulée : aucun rappel.
- **Quand** : la tâche `coachos-reminders.timer` appelle `/api/cron/reminders` toutes les 5 minutes ; la base choisit les séances qui commencent dans 35 à 65 minutes et les marque (`session_reminders`) dans la même instruction : jamais deux rappels pour une séance, même si deux appels se croisent. Une séance déplacée est rappelée pour son nouvel horaire. Le libellé dit « dans 1 h » (60–65 min) ou « dans N min » pour une séance créée tard.
- **Message** : titre « 🥋 *Club* : séance dans 1 h », texte « *Cours* à 19:00. Tout est prêt ? » ; un toucher ouvre « Mon espace ». Aucune donnée de membre.
- **Au mieux** : un rappel manqué n'est pas rejoué (il serait périmé). Sans clés VAPID, rien n'est marqué ni envoyé.
- **Installation de la tâche** (une fois, après le déploiement de cette version) :

```bash
sudo cp /srv/coachos/current/ops/systemd/coachos-reminders.service /srv/coachos/current/ops/systemd/coachos-reminders.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now coachos-reminders.timer
sudo systemctl start coachos-reminders.service && systemctl status coachos-reminders.service --no-pager
```

Le service réutilise `/etc/coachos/purge.header` (jeton `CRON_SECRET`). Réponse attendue de l'appel : `{"sessions":0,"sent":0,"failed":0}` hors d'une séance imminente. Journal : `journalctl -u coachos | grep push.reminders`.
