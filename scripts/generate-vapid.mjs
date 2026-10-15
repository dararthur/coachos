// Génère une paire de clés VAPID pour les notifications push. À exécuter UNE fois par environnement ; recopier les trois lignes
// dans /etc/coachos/app.env (jamais dans Git). Changer les clés plus tard oblige chaque appareil à se réabonner.
//   node scripts/generate-vapid.mjs [contact]      contact : mailto:adresse ou https://site (défaut : à compléter)
import webpush from "web-push";

const subject = process.argv[2] ?? "mailto:CONTACT@A-COMPLETER";
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`VAPID_SUBJECT=${subject}`);
