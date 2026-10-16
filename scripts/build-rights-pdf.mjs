// Génère le PDF « Droits et rôles » à diffuser aux clubs : docs/droits-et-roles-matnexa.pdf
//
// Source des faits : docs/droits-et-roles.md (lui-même aligné sur src/domain/roles.ts). Ce PDF en est la version destinée aux clubs :
// même contenu, sans références techniques. À RÉGÉNÉRER quand les droits changent :  npm run docs:rights-pdf
// Contrôle visuel : RIGHTS_PNG_DIR=<dossier> exporte aussi chaque page en PNG.
// Navigateur : celui de Playwright (par défaut Microsoft Edge ; PW_CHANNEL=chrome pour Chrome, ou vide pour le Chromium de Playwright).
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "docs", "droits-et-roles-matnexa.pdf");
const DATE = "16 octobre 2026";
const font = readFileSync(path.join(root, "src", "app", "fonts", "archivo-latin-var.woff2")).toString("base64");

// --- Éléments graphiques -----------------------------------------------------------------------------------------------------------
const MARK = `<svg viewBox="0 0 32 32" width="__S__" height="__S__" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#16191d"/><g fill="#fff"><rect x="7.25" y="8" width="2.5" height="16" rx="0.5"/><rect x="12.25" y="8" width="2.5" height="16" rx="0.5"/><rect x="17.25" y="8" width="2.5" height="16" rx="0.5"/><rect x="22.25" y="8" width="2.5" height="16" rx="0.5"/></g><path d="M5 22.5 27 9.5" stroke="#16191d" stroke-width="6.5"/><path d="M5 22.5 27 9.5" stroke="#ea6a2a" stroke-width="3"/></svg>`;
const mark = (s) => MARK.replaceAll("__S__", String(s));
const YES = `<svg class="ok" viewBox="0 0 16 16" width="13" height="13" role="img" aria-label="Oui"><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="#1e7a46" stroke-width="2.4" stroke-linecap="square"/></svg>`;
const NO = `<span class="no" aria-label="Non">–</span>`;
const note = (t) => `<span class="note">${t}</span>`;
const Y = YES;
const N = NO;

// --- Contenu -----------------------------------------------------------------------------------------------------------------------
// Synthèse : P = propriétaire, A = administrateur, C = coach, M = membre.
const summary = [
  ["Gérer les administrateurs et les propriétaires", Y, N, N, N],
  ["Supprimer le club", Y, N, N, N],
  ["Inviter, changer le rôle ou retirer un coach ou un membre", Y, Y, N, N],
  ["Paramètres du club, journal d'activité", Y, Y, N, N],
  ["Créer et modifier le planning, les types de cours", Y, Y, N, N],
  ["Modifier, archiver, effacer la fiche d'un membre", Y, Y, N, N],
  ["Importer et exporter les membres (CSV)", Y, Y, N, N],
  ["Enregistrer les présences", Y, Y, note("ses séances"), N],
  ["Voir les fiches des membres", Y, Y, Y, note("la sienne")],
  ["Enregistrer un passage de ceinture, voir l'éligibilité", Y, Y, Y, N],
  ["Publier des actualités", Y, Y, Y, N],
  ["Consulter les rapports", Y, Y, Y, N],
  ["Exporter les rapports", Y, Y, N, N],
  ["Réserver, pointer par QR, gérer son profil", note("mode membre"), note("mode membre"), note("mode membre"), Y],
];

const roles = [
  {
    name: "Propriétaire",
    line: "Le responsable du club : tout, y compris l'équipe d'encadrement.",
    can: ["Tout ce que fait un administrateur", "Nommer, rétrograder ou retirer un administrateur ou un autre propriétaire", "Supprimer le club"],
    cannot: ["Rester seul sans successeur : un club garde toujours au moins un propriétaire"],
  },
  {
    name: "Administrateur",
    line: "Gère le club au quotidien, sans toucher à l'équipe d'encadrement.",
    can: [
      "Créer, modifier, archiver, importer, exporter et effacer les fiches des membres",
      "Planning, disciplines et types de cours",
      "Inviter, retirer coachs et membres ; paramètres, QR de pointage, code d'adhésion, logo",
      "Rapports avec export, journal d'activité du club",
    ],
    cannot: ["Nommer ou retirer un administrateur ou un propriétaire", "Supprimer le club"],
  },
  {
    name: "Coach",
    line: "L'encadrant : il suit ses élèves et fait vivre ses cours.",
    can: [
      "Voir les fiches des membres, créer un nouvel arrivant",
      "Faire l'appel et valider la feuille des séances qui lui sont affectées (ou sans coach)",
      "Enregistrer un passage de ceinture, voir l'éligibilité, exporter la liste des éligibles",
      "Poser une pause, publier des actualités (et modifier les siennes), consulter les rapports",
    ],
    cannot: ["Modifier ou archiver une fiche, importer ou exporter les membres", "Créer des séances, accéder aux paramètres, à l'équipe ou au journal"],
  },
  {
    name: "Membre",
    line: "Le pratiquant, depuis son téléphone.",
    can: [
      "Réserver, passer sur liste d'attente, annuler",
      "Pointer sa présence en scannant le QR du cours, voir son historique",
      "Compléter son profil (téléphone, ceinture, photo), déclarer une pause",
      "Lire les actualités, télécharger ses données, supprimer son compte",
    ],
    cannot: ["Voir les fiches, coordonnées ou présences des autres", "Voir l'historique de grades ou l'éligibilité, y compris la sienne"],
  },
];

// Matrice complète : [domaine, [[action, P, A, C, M], …]]
const matrix = [
  ["Planning", [["Voir le planning", Y, Y, Y, Y], ["Créer, modifier, annuler des séances", Y, Y, N, N], ["Disciplines et types de cours", Y, Y, N, N]]],
  ["Réservations et présences", [
    ["Réserver, annuler, liste d'attente", note("mode membre"), note("mode membre"), note("mode membre"), Y],
    ["Enregistrer et corriger les présences", Y, Y, note("ses séances"), N],
    ["Ouvrir le pointage QR, valider la feuille d'appel", Y, Y, note("ses séances"), N],
    ["Pointer sa propre présence par QR", note("mode membre"), note("mode membre"), note("mode membre"), Y],
    ["Voir les présences", note("toutes"), note("toutes"), note("toutes"), note("les siennes")],
  ]],
  ["Membres", [
    ["Voir les fiches", Y, Y, Y, note("la sienne")],
    ["Créer une fiche", Y, Y, note("nouvel arrivant"), N],
    ["Modifier, archiver, restaurer", Y, Y, N, N],
    ["Importer, exporter (CSV)", Y, Y, N, N],
    ["Effacer ou anonymiser", Y, Y, N, N],
    ["Poser ou lever une pause", Y, Y, Y, note("la sienne")],
  ]],
  ["Grades", [
    ["Enregistrer un passage, confirmer une date", Y, Y, Y, N],
    ["Historique et éligibilité au grade suivant", Y, Y, Y, N],
    ["Exporter les éligibles au grade suivant", Y, Y, Y, N],
  ]],
  ["Actualités et rapports", [
    ["Lire les actualités", Y, Y, Y, Y],
    ["Publier", Y, Y, Y, N],
    ["Modifier ou supprimer", note("toutes"), note("toutes"), note("les siennes"), N],
    ["Consulter les rapports", Y, Y, Y, N],
    ["Exporter les rapports", Y, Y, N, N],
  ]],
  ["Équipe et club", [
    ["Inviter ou retirer un coach ou un membre", Y, Y, N, N],
    ["Nommer ou retirer un administrateur ou propriétaire", Y, N, N, N],
    ["Paramètres, QR, code d'adhésion, logo", Y, Y, N, N],
    ["Journal d'activité", Y, Y, N, N],
    ["Supprimer le club", Y, N, N, N],
  ]],
  ["Données personnelles", [["Télécharger ses propres données, supprimer son compte", Y, Y, Y, Y]]],
];

const sensitive = [
  ["Pause « blessure » ou « maladie »", "L'équipe du club et la personne", "Consentement explicite horodaté. Aucune zone du corps ni diagnostic. Effacée 30 jours après la reprise. Jamais pour un mineur, jamais dans un classement, une notification ou un écran partagé."],
  ["Autres raisons de pause", "L'équipe et la personne", "Liste fermée (vacances, horaires…). « Ne souhaite pas s'exprimer » est possible."],
  ["Historique des grades", "L'équipe et la personne (dans son export)", "Les autres membres n'y ont pas accès."],
  ["Date d'éligibilité au grade suivant", "Propriétaire, administrateur et coach seulement", "Calculée d'après les minimums de durée et d'âge de la fédération (IBJJF), jamais enregistrée. Indicative : le professeur décide."],
  ["Coordonnées d'un adhérent", "L'équipe du club", "Un adhérent ne voit que les siennes."],
  ["Classement", "Chacun voit son rang ; la liste est vue de tous", "Un adhérent n'y figure que s'il l'a demandé (désactivé par défaut). L'équipe voit le classement complet."],
];

const faq = [
  ["Un coach voit-il les coordonnées de tous les élèves ?", "Oui, c'est nécessaire pour les joindre. Il ne peut ni les modifier ni les exporter."],
  ["Un adhérent voit-il qui d'autre est inscrit ?", "Non. Il voit son planning et ses réservations."],
  ["Comment donner un accès limité à un bénévole ?", "Le rôle coach n'a ni paramètres, ni équipe, ni exports. Pour quelqu'un qui ne doit voir que les cours, le rôle membre suffit."],
  ["Un coach quitte le club : que se passe-t-il ?", "Un administrateur le retire et son accès est coupé immédiatement."],
  ["Qui peut effacer un adhérent ?", "Le propriétaire et les administrateurs, à la demande de la personne ou à l'expiration de la durée de conservation choisie par le club. L'effacement est tracé."],
];

// --- Gabarit -----------------------------------------------------------------------------------------------------------------------
const roleHead = `<tr><th class="lead" scope="col"></th><th scope="col">Propriétaire</th><th scope="col">Admin.</th><th scope="col">Coach</th><th scope="col">Membre</th></tr>`;
const row = (cells) => `<tr><th scope="row">${cells[0]}</th>${cells.slice(1).map((c) => `<td>${c}</td>`).join("")}</tr>`;

const css = `
@font-face { font-family: "Archivo"; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 900; font-stretch: 62% 125%; }
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
:root { --ink:#16191d; --soft:#585d64; --faint:#6a6f76; --line:#ddd8cf; --strong:#8a8378; --canvas:#f4f2ee; --sunken:#eeebe5; --accent:#c2410c; --bright:#ea6a2a; --ok:#1e7a46; --okbg:#e5f2ea; --warn:#b45309; }
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
h2 { font-size: 20pt; font-weight: 750; font-stretch: 78%; letter-spacing: -0.012em; line-height: 1.05; margin: 9mm 0 2.5mm; }
h3 { font-size: 10.6pt; font-weight: 700; line-height: 1.2; }
.lede { font-size: 11.4pt; line-height: 1.5; color: var(--soft); max-width: 150mm; }
.kicker { font-size: 8pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); margin-bottom: 1.5mm; }
.rule { height: 1.4mm; width: 22mm; background: var(--bright); margin-top: 6mm; }
table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); }
th, td { padding: 1.55mm 2.2mm; border-bottom: 1px solid var(--line); vertical-align: middle; }
thead th { background: var(--sunken); font-size: 8pt; font-weight: 700; color: var(--soft); text-align: center; white-space: nowrap; }
thead th.lead { text-align: left; }
tbody th { text-align: left; font-weight: 500; }
td { text-align: center; width: 21mm; }
table.roomy th, table.roomy td { padding: 2.55mm 2.4mm; }
table.compact th, table.compact td { padding: 0.78mm 2.2mm; }
table.compact tr.group th { padding: 0.9mm 2.2mm; }
tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
tr.group th { background: var(--sunken); font-size: 8pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--soft); padding: 1.1mm 2.2mm; }
.ok { display: inline-block; vertical-align: middle; }
.no { color: #b5b0a6; }
.note { font-size: 7.4pt; color: var(--soft); line-height: 1.15; display: inline-block; white-space: nowrap; }
.legend { font-size: 8pt; color: var(--soft); margin-top: 2.2mm; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
.panel { background: #fff; border: 1px solid var(--line); border-radius: 4px; padding: 4mm 4.4mm; }
.panel h3 { display: flex; align-items: center; gap: 2mm; }
.panel .line { color: var(--soft); font-size: 8.8pt; margin: 1mm 0 2.4mm; }
.bar { width: 8mm; height: 1.2mm; background: var(--ink); display: inline-block; }
ul { list-style: none; }
li { position: relative; padding-left: 4.6mm; margin-bottom: 1mm; font-size: 8.7pt; }
ul.can li::before { content: ""; position: absolute; left: 0.4mm; top: 1.3mm; width: 2.2mm; height: 1.1mm; border-left: 2px solid var(--ok); border-bottom: 2px solid var(--ok); transform: rotate(-45deg); }
ul.cannot li { color: var(--soft); }
ul.cannot li::before { content: "–"; position: absolute; left: 0.6mm; color: var(--strong); }
.sub { font-size: 7.6pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--soft); margin: 2.2mm 0 1.2mm; }
.callout { border-left: 1.2mm solid var(--bright); background: #fff; border-top: 1px solid var(--line); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 3mm 4mm; font-size: 8.9pt; }
.callout b { font-weight: 700; }
.data td, .data th { text-align: left; vertical-align: top; }
.data tbody th { width: 41mm; font-weight: 700; }
.data td:nth-child(2) { width: 42mm; }
.data td { width: auto; font-size: 8.6pt; }
.q { margin-bottom: 2.6mm; }
.q b { display: block; font-size: 9pt; }
.q span { color: var(--soft); font-size: 8.8pt; }
.pillars { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 3mm 0 0; }
.pillar { background: #fff; border: 1px solid var(--line); border-top: 1.1mm solid var(--ink); padding: 3mm 3.2mm; font-size: 8.5pt; }
.pillar b { display: block; font-size: 9.4pt; margin-bottom: 1mm; }
.pillar span { color: var(--soft); }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
.foot { position: absolute; left: 15mm; right: 15mm; bottom: 9mm; display: flex; justify-content: space-between; font-size: 7.6pt; color: var(--faint); border-top: 1px solid var(--line); padding-top: 2mm; }
.closing { background: var(--ink); color: #fff; margin: 5mm -15mm 0; padding: 6.5mm 15mm; display: flex; justify-content: space-between; align-items: center; }
.closing b { font-size: 12pt; font-weight: 700; font-stretch: 85%; }
.closing span { color: #a3a9b1; font-size: 8.6pt; }
`;

const head = (n, title) => `<header class="running"><span class="logo">${mark(22)}<b>Matnexa</b></span><span class="tag">${title}</span></header>`;
const foot = (n) => `<footer class="foot"><span>Matnexa · Droits et rôles · version du ${DATE}</span><span>${n} / 5</span></footer>`;

const summaryRows = summary.map(row).join("");
const matrixRows = matrix
  .map(([group, rows]) => `<tr class="group"><th colspan="5" scope="colgroup">${group}</th></tr>${rows.map(row).join("")}`)
  .join("");

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Matnexa — Droits et rôles</title><style>${css}</style></head><body>

<section class="page">
  <div class="band"><span class="logo">${mark(34)}<b>Matnexa</b></span><span class="tag">Guide à l'attention des clubs</span></div>
  <h1>Droits et rôles</h1>
  <p class="lede">Qui peut faire quoi dans Matnexa, qui voit quelles données, et comment c'est garanti. Un compte appartient à un ou plusieurs clubs, avec <b>un rôle par club</b>.</p>
  <div class="rule"></div>
  <h2>En une page</h2>
  <table class="roomy"><thead>${roleHead}</thead><tbody>${summaryRows}</tbody></table>
  <p class="legend">Mode membre : l'équipe peut basculer dans l'interface d'un adhérent pour s'inscrire à un cours ou pointer. Un bandeau l'indique et ses vrais droits restent ceux de son rôle.</p>
  ${foot(1)}
</section>

<section class="page">
  ${head(2, "Les quatre rôles")}
  <h2>Les quatre rôles, en détail</h2>
  <p class="lede" style="margin-bottom:5mm">Du plus large au plus restreint. Un club compte au moins un propriétaire ; personne ne peut changer son propre rôle.</p>
  <div class="grid2">
    ${roles
      .map(
        (r) => `<div class="panel"><h3><span class="bar"></span>${r.name}</h3><p class="line">${r.line}</p>
      <div class="sub">Peut</div><ul class="can">${r.can.map((t) => `<li>${t}</li>`).join("")}</ul>
      <div class="sub">Ne peut pas</div><ul class="cannot">${r.cannot.map((t) => `<li>${t}</li>`).join("")}</ul></div>`,
      )
      .join("")}
  </div>
  <div class="callout" style="margin-top:5mm"><b>Le mode membre.</b> Un coach, un administrateur ou un propriétaire peut basculer dans l'interface d'un adhérent pour s'inscrire à un cours, pointer ou consulter le classement. Un bandeau l'indique en permanence et ses vrais droits restent ceux de son rôle.</div>
  <div class="callout" style="margin-top:3.5mm"><b>Les fiches sans compte</b> n'ont aucun accès : ce sont seulement des données gérées par le club. <b>Les parents</b> d'un enfant ne sont pas un rôle du club : ils disposent d'un accès lié à la fiche de leur enfant (voir page 4).</div>
  ${foot(2)}
</section>

<section class="page">
  ${head(3, "Matrice complète")}
  <h2>Matrice complète des droits</h2>
  <table class="compact"><thead>${roleHead}</thead><tbody>${matrixRows}</tbody></table>
  <p class="legend">${YES} autorisé · ${NO} non autorisé · mention en petit : condition ou périmètre. « Ses séances » : les séances qui lui sont affectées, ou qui n'ont pas de coach.</p>
  ${foot(3)}
</section>

<section class="page">
  ${head(4, "Données et mineurs")}
  <h2>Qui voit les données sensibles</h2>
  <table class="data"><thead><tr><th class="lead" scope="col">Donnée</th><th class="lead" scope="col">Qui la voit</th><th class="lead" scope="col">Garde-fous</th></tr></thead><tbody>
    ${sensitive.map(([a, b, c]) => `<tr><th scope="row">${a}</th><td>${b}</td><td>${c}</td></tr>`).join("")}
  </tbody></table>
  <h2>Les enfants et leurs parents</h2>
  <div class="cols">
    <div class="panel"><h3><span class="bar"></span>Le cadre</h3>
      <ul class="can" style="margin-top:2.4mm">
        <li>Pas de compte propre avant 15 ans ; à partir de 15 ans, compte facultatif ouvert sur invitation du parent.</li>
        <li>Le parent confirme son accord par un lien reçu par e-mail (valable 14 jours).</li>
        <li>Pas de photo ni de classement tant que le parent n'a pas donné son accord.</li>
        <li>Jamais de raison de santé dans la pause d'un mineur.</li>
        <li>Les messages vont uniquement au parent. La date de naissance n'est gardée que pendant la minorité.</li>
      </ul></div>
    <div class="panel"><h3><span class="bar"></span>Ce que le parent peut faire</h3>
      <ul class="can" style="margin-top:2.4mm">
        <li>Confirmer ou retirer son accord (la fiche est alors archivée et la photo supprimée).</li>
        <li>Réserver et annuler les cours de son enfant.</li>
        <li>Décider si l'enfant apparaît au classement (désactivé par défaut).</li>
        <li>Exporter les données de son compte, enfants compris.</li>
      </ul></div>
  </div>
  <h2>Exporter et effacer des données</h2>
  <div class="cols">
    <div class="panel"><h3><span class="bar"></span>Pour chaque personne</h3>
      <ul class="can" style="margin-top:2.4mm">
        <li>Télécharger l'ensemble de ses données depuis « Mon compte » (droit d'accès et de portabilité).</li>
        <li>Supprimer son compte à tout moment.</li>
        <li>Pour un enfant, ces droits sont exercés par le parent.</li>
      </ul></div>
    <div class="panel"><h3><span class="bar"></span>Pour le club</h3>
      <ul class="can" style="margin-top:2.4mm">
        <li>Les propriétaires et administrateurs exportent les données d'une personne, ou l'effacent ou l'anonymisent à sa demande.</li>
        <li>Un adhérent archivé est anonymisé automatiquement à l'issue de la durée de conservation choisie par le club (de 6 mois à 10 ans, 24 mois par défaut).</li>
        <li>Un modèle d'information à remettre à vos adhérents est fourni.</li>
      </ul></div>
  </div>
  ${foot(4)}
</section>

<section class="page">
  ${head(5, "Garanties et formules")}
  <h2>Comment c'est garanti</h2>
  <div class="pillars">
    <div class="pillar"><b>Clubs étanches</b><span>La base de données refuse toute lecture ou écriture hors des clubs de l'utilisateur, même en cas d'erreur de l'application.</span></div>
    <div class="pillar"><b>Retrait immédiat</b><span>Retirer un accès est effectif à la requête suivante. Aucune session à laisser expirer.</span></div>
    <div class="pillar"><b>Triple contrôle</b><span>Dans l'interface, dans le serveur et dans la base : ce qui n'est pas permis n'est pas proposé, et reste refusé si on le force.</span></div>
    <div class="pillar"><b>Traçabilité</b><span>Invitations, changements de rôle, exports, passages de grade, suppressions : le journal du club les retient.</span></div>
  </div>
  <div class="cols" style="margin-top:6mm">
    <div>
      <h2 style="margin-top:3mm">Selon votre formule</h2>
      <p class="line" style="color:var(--soft);font-size:8.8pt;margin-bottom:2mm">Trois modules s'activent club par club. Un module coupé disparaît du menu et reste fermé ; vos données sont conservées et reviennent à la réactivation.</p>
      <ul class="can" style="margin-top:2mm">
        <li><b>Classement et assiduité</b> : page Classement, rang du mois.</li>
        <li><b>Actualités et notifications</b> : fil du club, notification aux membres.</li>
        <li><b>Grades et rapports</b> : rapports, historique des passages, éligibilité.</li>
      </ul>
    </div>
    <div>
      <h2 style="margin-top:3mm">Ce que Matnexa voit</h2>
      <p class="line" style="color:var(--soft);font-size:8.8pt;margin-bottom:2mm">L'éditeur suit le service par des compteurs, pas par vos données.</p>
      <div class="sub">Il voit</div>
      <ul class="can"><li>Le nombre de clubs, de membres et de séances, l'activité du club</li><li>L'e-mail du propriétaire, pour le support</li></ul>
      <div class="sub">Il ne voit pas</div>
      <ul class="cannot"><li>Les noms, e-mails, téléphones ou présences de vos membres</li><li>Les pauses, grades, réservations ou actualités</li></ul>
    </div>
  </div>
  <h2 style="margin-top:6mm">Questions fréquentes</h2>
  <div class="cols">
    <div>${faq.slice(0, 3).map(([q, a]) => `<div class="q"><b>${q}</b><span>${a}</span></div>`).join("")}</div>
    <div>${faq.slice(3).map(([q, a]) => `<div class="q"><b>${q}</b><span>${a}</span></div>`).join("")}</div>
  </div>
  <div class="closing" style="position:absolute;left:15mm;right:15mm;bottom:19mm;margin:0;border-radius:0"><b>Une question sur les droits de votre club ?</b><span>contact@matnexa.fr · www.matnexa.fr</span></div>
  ${foot(5)}
</section>

</body></html>`;

// --- Rendu -------------------------------------------------------------------------------------------------------------------------
const channel = process.env.PW_CHANNEL === undefined ? "msedge" : process.env.PW_CHANNEL || undefined;
const browser = await chromium.launch(channel ? { channel } : {});
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(path.dirname(OUT), { recursive: true });
  await page.pdf({ path: OUT, preferCSSPageSize: true, printBackground: true });
  // Contrôle visuel (facultatif) : RIGHTS_PNG_DIR=<dossier> exporte chaque page en image, avec la mise en page d'impression.
  if (process.env.RIGHTS_PNG_DIR) {
    mkdirSync(process.env.RIGHTS_PNG_DIR, { recursive: true });
    await page.emulateMedia({ media: "print" });
    const sections = await page.locator("section.page").all();
    for (const [i, el] of sections.entries()) await el.screenshot({ path: path.join(process.env.RIGHTS_PNG_DIR, `page-${i + 1}.png`) });
  }
  const pages = await page.evaluate(() => document.querySelectorAll("section.page").length);
  // Détection des débordements : chaque page doit tenir dans sa hauteur.
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll("section.page")].map((s, i) => {
      const last = [...s.children].filter((c) => !c.classList.contains("foot")).at(-1);
      const bottom = last ? last.getBoundingClientRect().bottom - s.getBoundingClientRect().top : 0;
      return { page: i + 1, usedPx: Math.round(bottom), maxPx: Math.round(s.getBoundingClientRect().height - 38) };
    }),
  );
  console.log(`PDF : ${OUT} (${pages} pages)`);
  for (const o of overflow) console.log(`  page ${o.page} : contenu jusqu'à ${o.usedPx} px sur ${o.maxPx} px utiles${o.usedPx > o.maxPx ? "  <-- DÉBORDE" : ""}`);
} finally {
  await browser.close();
}
