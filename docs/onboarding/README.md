# Guide de démarrage des clubs

`guide-demarrage-matnexa.pdf` : guide de 7 pages (charte Matnexa) à remettre à chaque club pilote avec le contrat et le document « Droits et rôles ». Il suit le parcours réel, sur téléphone d'abord (équipe et adhérents), avec quelques vues d'ordinateur.

## Régénérer

Après un changement d'interface ou de parcours :

```bash
npm run build
ONBOARDING_SHOTS_DIR=docs/onboarding/img PW_CHANNEL=msedge E2E_PORT=3150 npx playwright test --project=chromium onboarding-shots
npm run docs:onboarding-pdf
```

- Les captures (`img/`) viennent d'un club entièrement fictif (« Académie Horizon »), créé par `tests/e2e/onboarding-shots.spec.ts`, qui ne tourne que si `ONBOARDING_SHOTS_DIR` est défini.
- Le texte et la mise en page sont dans `scripts/build-onboarding-pdf.mjs`. `ONBOARDING_PNG_DIR=<dossier>` exporte chaque page en image pour la relecture.
- Aucune donnée réelle : adresses fictives, lien de partage remplacé par `app.matnexa.fr` avant capture.
