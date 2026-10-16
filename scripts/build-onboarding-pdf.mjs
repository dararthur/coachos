// Génère le guide de démarrage à remettre aux clubs : docs/onboarding/guide-demarrage-matnexa.pdf
//
// Les captures d'écran viennent de docs/onboarding/img/ (club 100 % fictif « Académie Horizon »), produites par
//   ONBOARDING_SHOTS_DIR=docs/onboarding/img PW_CHANNEL=msedge E2E_PORT=3150 npx playwright test --project=chromium onboarding-shots
// À RÉGÉNÉRER (captures, puis PDF) quand l'interface ou le parcours de démarrage change :  npm run docs:onboarding-pdf
// Contrôle visuel : ONBOARDING_PNG_DIR=<dossier> exporte aussi chaque page en PNG.
// Navigateur : celui de Playwright (par défaut Microsoft Edge ; PW_CHANNEL=chrome pour Chrome, ou vide pour le Chromium de Playwright).
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "docs", "onboarding", "guide-demarrage-matnexa.pdf");
const DATE = "16 octobre 2026";
const TOTAL = 7;
const font = readFileSync(path.join(root, "src", "app", "fonts", "archivo-latin-var.woff2")).toString("base64");
const img = (name) => `data:image/jpeg;base64,${readFileSync(path.join(root, "docs", "onboarding", "img", `${name}.jpg`)).toString("base64")}`;

// --- Éléments graphiques -----------------------------------------------------------------------------------------------------------
const MARK = `<svg viewBox="0 0 32 32" width="__S__" height="__S__" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#16191d"/><g fill="#fff"><rect x="7.25" y="8" width="2.5" height="16" rx="0.5"/><rect x="12.25" y="8" width="2.5" height="16" rx="0.5"/><rect x="17.25" y="8" width="2.5" height="16" rx="0.5"/><rect x="22.25" y="8" width="2.5" height="16" rx="0.5"/></g><path d="M5 22.5 27 9.5" stroke="#16191d" stroke-width="6.5"/><path d="M5 22.5 27 9.5" stroke="#ea6a2a" stroke-width="3"/></svg>`;
const mark = (s) => MARK.replaceAll("__S__", String(s));

/** Téléphone : `h` = hauteur visible de l'écran en mm (l'image est rognée par le bas), `w` = largeur de l'écran en mm. */
const phone = (name, caption, { w = 44, h } = {}) =>
  `<figure class="pw" style="width:${w + 3.6}mm"><div class="phone"><div class="screen" style="${h ? `height:${h}mm` : ""}"><img src="${img(name)}" alt=""></div></div>${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
/** Fenêtre d'ordinateur ou bloc d'écran : image large, rognée à `h` mm si besoin. */
const win = (name, caption, { w, h, desk = true } = {}) =>
  `<figure class="win" style="${w ? `width:${w}mm` : ""}">${desk ? `<div class="dots"><i></i><i></i><i></i></div>` : ""}<div class="screen" style="${h ? `height:${h}mm` : ""}"><img src="${img(name)}" alt=""></div>${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;

const steps = (items) => `<ol class="steps">${items.map((t) => `<li>${t}</li>`).join("")}</ol>`;
const ticks = (items) => `<ul class="can">${items.map((t) => `<li>${t}</li>`).join("")}</ul>`;
const head = (title) => `<header class="running"><span class="logo">${mark(22)}<b>Matnexa</b></span><span class="tag">${title}</span></header>`;
const foot = (n) => `<footer class="foot"><span>Matnexa · Guide de démarrage · version du ${DATE}</span><span>${n} / ${TOTAL}</span></footer>`;
const kicker = (t) => `<div class="kicker">${t}</div>`;

// --- Feuille de style (charte « Ceinture », identique au PDF « Droits et rôles ») ------------------------------------------------------
const css = `
@font-face { font-family: "Archivo"; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 900; font-stretch: 62% 125%; }
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
:root { --ink:#16191d; --soft:#585d64; --faint:#6a6f76; --line:#ddd8cf; --strong:#8a8378; --canvas:#f4f2ee; --sunken:#eeebe5; --accent:#c2410c; --bright:#ea6a2a; --ok:#1e7a46; }
html { font-family: Archivo, system-ui, sans-serif; color: var(--ink); font-size: 9.4pt; line-height: 1.42; font-feature-settings: "tnum"; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; height: 296.5mm; position: relative; overflow: hidden; page-break-after: always; padding: 0 15mm; }
.page:last-child { page-break-after: auto; }
.band { background: var(--ink); color: #fff; margin: 0 -15mm; padding: 9mm 15mm 8mm; display: flex; align-items: center; justify-content: space-between; }
.logo { display: inline-flex; align-items: center; gap: 3.2mm; }
.logo b { font-size: 19pt; font-weight: 700; font-stretch: 87.5%; letter-spacing: -0.015em; line-height: 1; }
.band .tag { color: #a3a9b1; font-size: 8.4pt; letter-spacing: 0.02em; }
.running { background: var(--ink); color: #fff; margin: 0 -15mm; padding: 5.5mm 15mm; display: flex; align-items: center; justify-content: space-between; }
.running .logo b { font-size: 12.5pt; }
.running .tag { color: #a3a9b1; font-size: 7.8pt; }
h1 { font-size: 40pt; font-weight: 750; font-stretch: 72%; letter-spacing: -0.02em; line-height: 0.95; margin: 12mm 0 3.5mm; }
h2 { font-size: 21pt; font-weight: 750; font-stretch: 78%; letter-spacing: -0.012em; line-height: 1.05; margin: 1.5mm 0 2.5mm; }
h3 { font-size: 10.6pt; font-weight: 700; line-height: 1.2; }
.lede { font-size: 11.2pt; line-height: 1.5; color: var(--soft); max-width: 150mm; }
.kicker { font-size: 8pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); margin-top: 9mm; }
.rule { height: 1.4mm; width: 22mm; background: var(--bright); margin-top: 6mm; }
p { font-size: 9.2pt; }
.soft { color: var(--soft); }
.row { display: flex; gap: 7mm; align-items: flex-start; }
.col { flex: 1; min-width: 0; }
.row > .panel { align-self: stretch; }
.tight ol.steps li { font-size: 9pt; margin-bottom: 1.8mm; }
.tight .panel { padding: 3.2mm 4mm; }
.panel { background: #fff; border: 1px solid var(--line); border-radius: 4px; padding: 4mm 4.4mm; }
.panel h3 { display: flex; align-items: center; gap: 2mm; margin-bottom: 1.6mm; }
.bar { width: 8mm; height: 1.2mm; background: var(--ink); display: inline-block; }
ul { list-style: none; }
li { position: relative; padding-left: 4.6mm; margin-bottom: 1.2mm; font-size: 9pt; }
ul.can li::before { content: ""; position: absolute; left: 0.4mm; top: 1.3mm; width: 2.2mm; height: 1.1mm; border-left: 2px solid var(--ok); border-bottom: 2px solid var(--ok); transform: rotate(-45deg); }
ul.box li::before { content: ""; position: absolute; left: 0; top: 0.5mm; width: 3mm; height: 3mm; border: 1.3px solid var(--strong); border-radius: 0.6mm; background: #fff; }
ol.steps { list-style: none; counter-reset: s; margin-top: 2mm; }
ol.steps li { counter-increment: s; padding-left: 8mm; margin-bottom: 3mm; font-size: 9.6pt; }
ol.steps li::before { content: counter(s); position: absolute; left: 0; top: -0.2mm; width: 5.4mm; height: 5.4mm; border-radius: 1mm; background: var(--ink); color: #fff; font-size: 8pt; font-weight: 700; display: flex; align-items: center; justify-content: center; }
ol.steps li b { font-weight: 700; }
.callout { border-left: 1.2mm solid var(--bright); background: #fff; border-top: 1px solid var(--line); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 3mm 4mm; font-size: 8.9pt; margin-top: 4mm; }
.callout b { font-weight: 700; }
.sub { font-size: 7.6pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--soft); margin: 3mm 0 1.4mm; }
.time { display: inline-block; font-size: 7.6pt; font-weight: 700; letter-spacing: 0.04em; color: var(--accent); background: #fbeee4; padding: 0.5mm 2mm; border-radius: 1mm; margin-left: 2mm; vertical-align: 2px; }
/* Téléphone */
figure { margin: 0; }
.pw { flex: none; display: flex; flex-direction: column; align-items: center; }
.phone { background: var(--ink); border-radius: 5mm; padding: 1.8mm; width: 100%; box-shadow: 0 1.2mm 3mm rgba(22,25,29,0.18); }
.phone .screen { border-radius: 3.4mm; overflow: hidden; background: var(--canvas); }
.phone img { display: block; width: 100%; }
figcaption { font-size: 7.4pt; color: var(--soft); text-align: center; margin-top: 1.6mm; line-height: 1.25; }
.cap { text-align: center; font-size: 7.4pt; color: var(--soft); margin-top: 1.6mm; line-height: 1.25; }
.pcol { display: flex; flex-direction: column; align-items: center; flex: none; }
/* Fenêtre */
.win { background: #fff; border: 1px solid var(--strong); border-radius: 2mm; overflow: hidden; box-shadow: 0 1.2mm 3mm rgba(22,25,29,0.12); }
.win .dots { background: var(--sunken); height: 4.6mm; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 1.2mm; padding-left: 2.2mm; }
.win .dots i { width: 1.8mm; height: 1.8mm; border-radius: 50%; background: #cfc9be; display: block; }
.win .screen { overflow: hidden; }
.win img { display: block; width: 100%; }
.win figcaption { padding: 1.4mm 2mm; background: var(--canvas); border-top: 1px solid var(--line); margin: 0; }
.msg { background: var(--sunken); border-left: 1.2mm solid var(--ink); padding: 3.2mm 4mm; font-size: 8.9pt; line-height: 1.5; }
.msg p { font-size: 8.9pt; margin-bottom: 1.6mm; }
.msg p:last-child { margin-bottom: 0; }
.flow { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2.6mm; margin-top: 4mm; }
.flow .st { background: #fff; border: 1px solid var(--line); border-top: 1.1mm solid var(--ink); padding: 3mm 3mm 3.2mm; }
.flow .n { font-size: 19pt; font-weight: 750; font-stretch: 72%; color: var(--bright); line-height: 1; }
.flow b { display: block; font-size: 9.2pt; margin: 1.4mm 0 0.6mm; line-height: 1.2; }
.flow span { font-size: 7.8pt; color: var(--soft); }
.foot { position: absolute; left: 15mm; right: 15mm; bottom: 9mm; display: flex; justify-content: space-between; font-size: 7.6pt; color: var(--faint); border-top: 1px solid var(--line); padding-top: 2mm; }
.closing { background: var(--ink); color: #fff; padding: 6.5mm 15mm; display: flex; justify-content: space-between; align-items: center; position: absolute; left: 0; right: 0; bottom: 19mm; }
.closing b { font-size: 12pt; font-weight: 700; font-stretch: 85%; }
.closing span { color: #a3a9b1; font-size: 8.6pt; }
`;

// --- Pages -------------------------------------------------------------------------------------------------------------------------
const pages = [];

// 1. Couverture
pages.push(`
<section class="page">
  <div class="band"><span class="logo">${mark(34)}<b>Matnexa</b></span><span class="tag">Guide de démarrage</span></div>
  <h1>Vos 30 premières minutes avec Matnexa</h1>
  <p class="lede">De la création de votre club au premier cours pointé. Tout se fait depuis un téléphone ; l'ordinateur reste pratique pour importer une liste ou suivre l'activité.</p>
  <div class="rule"></div>
  ${kicker("Le parcours en cinq étapes")}
  <div class="flow">
    <div class="st"><div class="n">1</div><b>Créer et régler le club</b><span>5 min</span></div>
    <div class="st"><div class="n">2</div><b>Préparer le planning</b><span>5 min</span></div>
    <div class="st"><div class="n">3</div><b>Faire entrer les adhérents</b><span>10 min</span></div>
    <div class="st"><div class="n">4</div><b>Inviter l'équipe</b><span>5 min</span></div>
    <div class="st"><div class="n">5</div><b>Faire le premier cours</b><span>5 min</span></div>
  </div>
  <div class="row" style="margin-top:6mm">
    <div class="panel col"><h3><span class="bar"></span>Avant de commencer</h3>
      ${ticks([
        "L'adresse e-mail de votre demande d'accès : c'est elle qui déclenche la création du club.",
        "Votre planning de la saison (jours, heures, durée de chaque cours).",
        "Votre liste d'adhérents, si vous en avez une (fichier CSV, facultatif).",
        "Le contrat et l'accord de traitement des données, signés avant de saisir de vrais noms.",
      ])}
    </div>
    <div class="panel col"><h3><span class="bar"></span>Ce qu'il faut retenir</h3>
      ${ticks([
        "Vos adhérents créent eux-mêmes leur compte avec un lien : vous ne saisissez rien à la main.",
        "Chaque rôle (propriétaire, administrateur, coach, membre) voit ce qui le concerne.",
        "Rien n'est définitif : tous les réglages se modifient plus tard.",
        "Une question ? contact@matnexa.fr",
      ])}
    </div>
  </div>
  <div style="display:flex;justify-content:center;gap:7mm;margin-top:6mm">
    ${phone("m-me", "Ce que voit un adhérent", { w: 46, h: 62 })}
    ${phone("p-dashboard", "Ce que voit l'équipe", { w: 46, h: 62 })}
    ${phone("p-attendance", "L'appel d'un cours", { w: 46, h: 62 })}
  </div>
  ${foot(1)}
</section>`);

// 2. Étape 1
pages.push(`
<section class="page">
  ${head("Étape 1 sur 5")}
  ${kicker("Étape 1 · 5 minutes")}
  <h2>Créez et réglez votre club</h2>
  <p class="soft" style="max-width:120mm">Dès que Matnexa approuve votre demande, vous recevez un e-mail. Quelques réglages suffisent pour démarrer.</p>
  <div class="row" style="margin-top:5mm">
    <div class="col">
      ${steps([
        "<b>Créez votre compte</b> avec l'adresse e-mail de votre demande, puis confirmez-la grâce au lien reçu par e-mail.",
        "<b>Vérifiez le nom, le fuseau horaire et la devise</b> du club, puis touchez « Créer le club ». Trois disciplines de départ (JJB, Grappling, MMA) sont ajoutées pour vous.",
        "<b>Ouvrez Paramètres › Club</b> (« Plus » dans la barre du bas) : ajoutez le <b>logo</b>, choisissez combien de temps garder les fiches des membres archivés (24 mois par défaut) et l'âge minimum des cours « Adultes ».",
        "<b>Adaptez vos disciplines et vos types de cours</b> dans Paramètres › Disciplines et Types de cours : nom, durée, public (enfants, adultes, tous).",
      ])}
      <div class="callout"><b>Bon à savoir.</b> Un club a au moins un propriétaire. Vous pourrez inviter d'autres administrateurs et des coachs à l'étape 4.</div>
    </div>
    <div class="pcol">
      <div style="display:flex;gap:5mm">
        ${phone("p-onboarding", "Création du club", { w: 44 })}
        ${phone("p-settings", "Paramètres du club", { w: 44 })}
      </div>
    </div>
  </div>
  <div class="sub" style="margin-top:6mm">Les réglages à connaître</div>
  <div class="row" style="gap:3.5mm">
    <div class="panel col"><h3><span class="bar"></span>Fuseau horaire</h3><p class="soft">Détermine les heures des séances et les statistiques « aujourd'hui » et « cette semaine ».</p></div>
    <div class="panel col"><h3><span class="bar"></span>Conservation</h3><p class="soft">La fiche d'un membre archivé est anonymisée automatiquement après la durée choisie, de 6 mois à 10 ans.</p></div>
    <div class="panel col"><h3><span class="bar"></span>Cours « Adultes »</h3><p class="soft">Un mineur ne peut réserver un cours « Adultes » qu'à partir de l'âge que vous fixez (18 ans par défaut).</p></div>
  </div>
  ${foot(2)}
</section>`);

// 3. Étape 2
pages.push(`
<section class="page">
  ${head("Étape 2 sur 5")}
  ${kicker("Étape 2 · 5 minutes")}
  <h2>Préparez votre planning</h2>
  <p class="soft" style="max-width:120mm">Créez vos cours une fois : une récurrence hebdomadaire génère toutes les séances de la saison.</p>
  <div class="row" style="margin-top:5mm">
    <div class="col">
      ${steps([
        "Touchez <b>Planning › Nouvelle séance</b>.",
        "Choisissez le <b>type de cours</b>, la <b>date</b> de la première séance, l'<b>heure</b> et, si besoin, un <b>coach</b>. La durée reprend celle du type de cours.",
        "Indiquez le <b>nombre de places</b> : au-delà, les réservations passent en liste d'attente.",
        "Dans <b>Répétition</b>, choisissez « Toutes les semaines », cochez les jours et la date de fin. Un seul formulaire crée toutes les séances.",
        "Touchez <b>Créer la séance</b>. Les créneaux déjà existants sont ignorés : aucune séance en double.",
      ])}
      <div class="sub">Ensuite</div>
      ${ticks([
        "<b>Modifier</b> une séance (heure, coach, places) depuis le planning.",
        "<b>Annuler</b> une séance : elle reste visible, marquée « annulée », et les inscrits sont prévenus.",
        "Vos adhérents réservent depuis leur téléphone ; vous voyez les inscrits avant le cours.",
      ])}
    </div>
    <div class="pcol">
      <div style="display:flex;gap:5mm">
        ${phone("p-schedule-new", "Nouvelle séance", { w: 44 })}
        ${phone("p-schedule", "Le planning de la semaine", { w: 44 })}
      </div>
    </div>
  </div>
  <div class="sub" style="margin-top:6mm">Questions fréquentes</div>
  <div class="row" style="gap:3.5mm">
    <div class="panel col"><h3><span class="bar"></span>Cours exceptionnel ?</h3><p class="soft">Créez une séance unique : laissez simplement la répétition désactivée.</p></div>
    <div class="panel col"><h3><span class="bar"></span>Cours complet ?</h3><p class="soft">Les réservations suivantes passent en liste d'attente ; si une place se libère, l'adhérent suivant est prévenu.</p></div>
    <div class="panel col"><h3><span class="bar"></span>Plusieurs coachs ?</h3><p class="soft">Affectez un coach à chaque séance : il ne fait l'appel que de ses séances.</p></div>
  </div>
  ${foot(3)}
</section>`);

// 4. Étape 3
pages.push(`
<section class="page">
  ${head("Étape 3 sur 5")}
  ${kicker("Étape 3 · 10 minutes")}
  <h2>Faites entrer vos adhérents</h2>
  <p class="soft" style="max-width:130mm">Deux façons de procéder, selon votre situation. Vous partez de zéro : le lien d'inscription. Vous avez déjà une liste : l'import.</p>
  <div class="panel" style="margin-top:4mm">
    <h3><span class="bar"></span>A · Le lien d'inscription <span class="time">recommandé</span></h3>
    <div class="row">
      <div class="col">
        ${steps([
          "Ouvrez <b>Paramètres › Inscription des membres</b>.",
          "Touchez <b>Partager</b> (ou « Copier le lien ») et envoyez-le à vos adhérents par message, ou affichez le code à la salle.",
          "Chacun crée son compte, confirme son e-mail et rejoint le club : <b>sa fiche est créée automatiquement</b>, sans action de votre part.",
          "Les mineurs sont rattachés à un parent ou à un responsable légal, dont l'accord est demandé.",
        ])}
        <p class="soft" style="font-size:8.3pt;margin-top:1mm">Le lien reste valable tant que vous ne générez pas un nouveau code : l'ancien cesse alors de fonctionner, les membres déjà inscrits ne sont pas touchés.</p>
      </div>
      <div style="display:flex;gap:4.5mm;flex:none">
        ${phone("p-join-code", "Le code et le lien du club", { w: 38, h: 76 })}
        ${phone("m-join", "Ce que voit l'adhérent", { w: 38, h: 76 })}
      </div>
    </div>
  </div>
  <div class="panel" style="margin-top:4mm">
    <h3><span class="bar"></span>B · L'import de votre liste (CSV)</h3>
    <div class="row">
      <div class="col">
        ${steps([
          "Exportez votre liste depuis votre ancien outil ou un tableur, au format <b>CSV</b>. Deux colonnes obligatoires : <b>prénom</b> et <b>nom</b> ; facultatives : e-mail, téléphone, date d'inscription, identifiant.",
          "Ouvrez <b>Membres › Importer un CSV</b>, choisissez le fichier, touchez « Analyser le fichier ».",
          "Vérifiez l'aperçu : <b>rien n'est enregistré avant votre confirmation</b>. Les lignes invalides et les doublons sont signalés avec leur raison.",
          "Confirmez : les fiches sont créées. Quand un adhérent importé s'inscrit avec le lien du club, son compte est rattaché à sa fiche s'il utilise l'adresse e-mail du fichier.",
        ])}
        <p class="soft" style="font-size:8.3pt"><b>Sans e-mail dans le fichier</b>, l'inscription crée une seconde fiche : ouvrez la fiche d'origine et touchez <b>Rattacher un compte</b>. Vous pouvez aussi ajouter un membre à la main (Membres › Nouveau membre). Un fichier compte au plus 2 000 lignes.</p>
      </div>
      <div style="width:84mm;flex:none">${win("d-import", "L'aperçu avant import, sur ordinateur", { w: 84, h: 66 })}</div>
    </div>
  </div>
  ${foot(4)}
</section>`);

// 5. Étapes 4 et 5
pages.push(`
<section class="page tight">
  ${head("Étapes 4 et 5 sur 5")}
  ${kicker("Étape 4 · 5 minutes")}
  <h2>Invitez votre équipe</h2>
  <div class="row" style="margin-top:3mm">
    <div class="col">
      ${steps([
        "Ouvrez <b>Paramètres › Équipe</b>.",
        "Saisissez l'<b>adresse e-mail</b> de la personne et choisissez son <b>rôle</b> : coach ou administrateur.",
        "Touchez « Créer le lien d'invitation » et envoyez-le-lui (message, WhatsApp, e-mail) : Matnexa ne l'envoie pas. Le lien s'affiche une seule fois, vaut 7 jours et ne fonctionne qu'avec cette adresse.",
      ])}
      <p class="soft" style="font-size:8.3pt;margin-top:1mm">Un <b>coach</b> fait l'appel de ses séances ; un <b>administrateur</b> gère aussi les membres, le planning et les réglages. Le détail des droits est dans le document « Droits et rôles ».</p>
    </div>
    <div style="width:66mm;flex:none">${win("p-team", "", { w: 66, desk: false })}</div>
  </div>

  ${kicker("Étape 5 · 5 minutes")}
  <h2>Faites votre premier cours</h2>
  <p class="soft" style="max-width:140mm">Deux façons d'enregistrer les présences. Choisissez celle qui convient à votre salle.</p>
  <div class="row" style="margin-top:4mm">
    <div class="col">
      <div class="panel"><h3><span class="bar"></span>L'appel par le coach</h3>
        ${steps([
          "Ouvrez <b>Présences</b> et touchez « Faire l'appel » sur la séance.",
          "Pour chaque adhérent : <b>Présent</b>, <b>En retard</b> ou <b>Absent</b>. Un second appui annule l'erreur.",
          "Touchez <b>Valider la feuille d'appel</b>.",
        ])}
      </div>
      <div class="panel" style="margin-top:3.5mm"><h3><span class="bar"></span>Le pointage par QR code</h3>
        ${steps([
          "Dans <b>Paramètres › Pointage</b>, choisissez un <b>QR fixe</b> (affiche imprimée à l'entrée) ou un <b>QR tournant</b> (affiché par le coach).",
          "Touchez « Afficher l'affiche à imprimer » et collez-la à l'entrée.",
          "L'adhérent <b>réserve</b> son cours, puis ouvre « Pointer » et vise le QR : sa présence est enregistrée.",
        ])}
      </div>
    </div>
    <div style="display:flex;gap:4.5mm;flex:none">
      ${phone("p-attendance", "L'appel", { w: 40 })}
      ${phone("p-qr", "L'affiche à imprimer", { w: 40 })}
    </div>
  </div>
  ${foot(5)}
</section>`);

// 6. Côté adhérents
pages.push(`
<section class="page">
  ${head("Côté adhérents")}
  ${kicker("Ce que vivent vos adhérents")}
  <h2>Sur leur téléphone, en trois gestes</h2>
  <p class="soft" style="max-width:140mm">Matnexa s'installe sur l'écran d'accueil comme une application, sans passer par un magasin d'applications.</p>
  <div style="display:flex;justify-content:space-between;margin-top:5mm">
    ${phone("m-me", "1 · Ils retrouvent leur prochain cours", { w: 38 })}
    ${phone("m-schedule", "2 · Ils réservent", { w: 38 })}
    ${phone("m-scan", "3 · Ils pointent à l'arrivée", { w: 38 })}
    ${phone("m-account", "Mon compte : installer, notifier", { w: 38 })}
  </div>
  <div class="row" style="margin-top:6mm">
    <div class="col">
      <h3>Installer l'application</h3>
      ${ticks([
        "<b>Android (Chrome)</b> : bouton « Installer l'application » dans Mon compte, ou menu ⋮ › Installer.",
        "<b>iPhone (Safari)</b> : bouton Partager › « Sur l'écran d'accueil ».",
      ])}
      <h3 style="margin-top:3mm">Activer les notifications</h3>
      ${ticks([
        "Depuis <b>Mon compte</b> : rappels de cours, place libérée en liste d'attente, annulation.",
        "Sur iPhone, depuis l'application installée sur l'écran d'accueil (iOS 16.4 ou plus).",
      ])}
    </div>
    <div class="col">
      <h3>Pour les familles</h3>
      ${ticks([
        "Un parent crée son propre compte, puis gère ses enfants depuis <b>« Mes enfants »</b>.",
        "L'accord du responsable légal est demandé pour chaque mineur.",
        "Le classement est facultatif et se choisit membre par membre.",
      ])}
      <h3 style="margin-top:3mm">Sur ordinateur</h3>
      ${ticks([
        "Même adresse, même compte : pratique pour importer une liste et suivre l'activité.",
      ])}
    </div>
  </div>
  <div style="margin-top:5mm">${win("d-dashboard", "Le tableau de bord du club, sur ordinateur : membres actifs, séances du jour, membres à recontacter.", { w: 180, h: 44 })}</div>
  ${foot(6)}
</section>`);

// 7. Lancement
pages.push(`
<section class="page">
  ${head("Lancement")}
  ${kicker("Avant d'ouvrir à tous")}
  <h2>La liste de contrôle du lancement</h2>
  <div class="row" style="margin-top:3mm">
    <div class="panel col">
      <ul class="box">
        <li>Le contrat et l'accord de traitement des données sont <b>signés</b>, avant toute vraie fiche.</li>
        <li>La <b>notice d'information</b> est remise à vos adhérents (modèle fourni).</li>
        <li>Le logo, le fuseau horaire et la durée de conservation sont <b>vérifiés</b>.</li>
        <li>Les <b>séances</b> de la saison sont créées.</li>
        <li>Un <b>second administrateur</b> est invité, pour ne pas dépendre d'une seule personne.</li>
        <li>Un <b>premier appel</b> (ou un pointage par QR) a été testé avec un coach.</li>
      </ul>
    </div>
    <div class="panel col">
      <h3><span class="bar"></span>Ce que nous vous remettons</h3>
      ${ticks([
        "Le <b>contrat de prestation</b> et l'<b>accord de traitement des données</b> à signer.",
        "Le document <b>« Droits et rôles »</b> : qui peut faire quoi.",
        "Le modèle de <b>notice d'information</b> pour vos adhérents.",
        "Une aide par e-mail, avec une réponse sous deux jours ouvrés.",
      ])}
    </div>
  </div>
  <h2 style="margin-top:7mm">Annoncer Matnexa à vos adhérents</h2>
  <p class="soft" style="margin-bottom:2.6mm">Un message prêt à envoyer par WhatsApp ou par e-mail. Remplacez les crochets.</p>
  <div class="msg">
    <p><b>Bonjour à toutes et à tous,</b></p>
    <p>À partir du [date], [nom du club] utilise Matnexa pour réserver les cours et enregistrer les présences. Cela prend deux minutes :</p>
    <p>1. Ouvrez ce lien : <b>[lien d'inscription du club]</b><br>
       2. Créez votre compte avec votre prénom et votre nom, puis confirmez votre adresse e-mail.<br>
       3. Réservez votre prochain cours, et à l'arrivée, touchez « Pointer » et visez le QR code à l'entrée.</p>
    <p>Astuce : ajoutez Matnexa à l'écran d'accueil de votre téléphone et activez les notifications pour recevoir les rappels et les places libérées.</p>
    <p>Vos données sont gérées par le club, qui reste seul responsable de leur usage. Vous pouvez les consulter, les corriger ou les effacer sur demande : [contact du club].</p>
  </div>
  <h2 style="margin-top:7mm">Pour la suite</h2>
  <div class="row" style="gap:3.5mm">
    <div class="panel col"><h3><span class="bar"></span>À recontacter</h3><p class="soft">Le tableau de bord liste les adhérents actifs sans présence depuis 30 jours : un message suffit souvent.</p></div>
    <div class="panel col"><h3><span class="bar"></span>Actualités</h3><p class="soft">Publiez une information et prévenez vos membres par notification (selon votre formule).</p></div>
    <div class="panel col"><h3><span class="bar"></span>Grades</h3><p class="soft">Ceinture, barrettes et historique des passages de chaque adhérent.</p></div>
    <div class="panel col"><h3><span class="bar"></span>Rapports</h3><p class="soft">Fréquentation et assiduité, pour piloter la saison (selon votre formule).</p></div>
  </div>
  <div class="closing"><b>Besoin d'un coup de main pour démarrer ?</b><span>contact@matnexa.fr · www.matnexa.fr</span></div>
  ${foot(7)}
</section>`);

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Matnexa — Guide de démarrage</title><style>${css}</style></head><body>${pages.join("\n")}</body></html>`;

// --- Rendu -------------------------------------------------------------------------------------------------------------------------
const channel = process.env.PW_CHANNEL === undefined ? "msedge" : process.env.PW_CHANNEL || undefined;
const browser = await chromium.launch(channel ? { channel } : {});
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(path.dirname(OUT), { recursive: true });
  await page.pdf({ path: OUT, preferCSSPageSize: true, printBackground: true });
  if (process.env.ONBOARDING_PNG_DIR) {
    mkdirSync(process.env.ONBOARDING_PNG_DIR, { recursive: true });
    await page.emulateMedia({ media: "print" });
    const sections = await page.locator("section.page").all();
    for (const [i, el] of sections.entries()) await el.screenshot({ path: path.join(process.env.ONBOARDING_PNG_DIR, `page-${i + 1}.png`) });
  }
  const count = await page.evaluate(() => document.querySelectorAll("section.page").length);
  // Dépassements : un contenu qui sort de sa page (ou la dépasse) est une erreur de mise en page.
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll("section.page")].flatMap((s, i) => {
      const box = s.getBoundingClientRect();
      const foot = s.querySelector(".foot")?.getBoundingClientRect();
      return [...s.querySelectorAll(".row, .panel, .callout, .msg, figure, ol, ul, h2, p")].some((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > (foot ? foot.top - 2 : box.bottom - 2) && !el.closest(".foot") && !el.closest(".closing");
      })
        ? [i + 1]
        : [];
    }),
  );
  console.log(`écrit : ${path.relative(root, OUT)} (${count} pages)`);
  if (overflow.length) console.warn(`ATTENTION : contenu au contact du pied de page, pages ${overflow.join(", ")}`);
} finally {
  await browser.close();
}
