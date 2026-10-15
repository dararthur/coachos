# Notifications push

Notifications Web Push (standard W3C), sans application native : un navigateur ou une PWA installée s'abonne, le serveur envoie un message **chiffré de bout en bout** via le service de notification du navigateur (Google FCM, Mozilla, Apple, Microsoft). Ce service ne voit passer qu'un message opaque.

## Ce qui existe

- **Abonnement par appareil** : « Mon compte » → carte « Notifications » → « Activer les notifications » (la permission du navigateur n'est demandée qu'à ce clic). Boutons « Envoyer une notification d'essai » et « Désactiver ». Chaque téléphone/ordinateur s'active séparément.
- **Premier usage** : publication d'une actualité (case « Prévenir les membres par notification », cochée par défaut, à la création seulement). Destinataires : appareils des membres du club, **hors l'auteur**. Contenu : nom du club (titre) et titre de la publication (corps) ; un toucher ouvre `/a/<club>/news`.
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
