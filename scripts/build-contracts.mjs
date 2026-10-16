// Génère les modèles de contrats Matnexa au format Word (.docx) dans docs/contrats/ :
//   - contrat-prestation-matnexa.docx        contrat d'abonnement entre l'éditeur et un club
//   - accord-traitement-donnees-matnexa.docx accord de sous-traitance des données (article 28 du RGPD), annexe du contrat
//   - contrat-site-web.docx                  création et maintenance d'un site web pour un client (l'éditeur agit alors comme prestataire)
//
// Utilisation : on ouvre le modèle dans Word, on remplit les zones JAUNES entre crochets (une fois par club), on enregistre sous un
// autre nom, on envoie. Les modèles eux-mêmes ne sont jamais modifiés par club.
// Les faits (hébergeurs, sauvegardes, durées) sont alignés sur docs/rgpd/ : à RÉGÉNÉRER quand ils changent :  npm run docs:contracts
//
// Les coordonnées de l'éditeur sont à renseigner une fois ici (EDITEUR) : tant qu'elles sont vides, elles apparaissent en jaune.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlignmentType, BorderStyle, Document, Footer, Header, LevelFormat, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell,
  TableRow, TextRun, WidthType,
} from "docx";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(root, "docs", "contrats");
const MAJ = "octobre 2026";

// --- À renseigner une fois pour toutes ------------------------------------------------------------------------------------------
const EDITEUR = {
  nom: "Arthur DARON",
  statut: "personne physique agissant à titre personnel", // remplacer par la raison sociale et la forme si une société est créée
  adresse: "", // ex. « 12 rue Exemple, 75000 Paris »
  siret: "", // ex. « 123 456 789 00012 » (laisser vide si aucun)
  email: "contact@matnexa.fr",
};

// --- Mise en forme -----------------------------------------------------------------------------------------------------------------
const FONT = "Calibri";
const INK = "16191D";
const ACCENT = "C2410C";
const LINE = "BFC3C8";
const WIDTH = 9638; // A4 moins 2 cm de marge de chaque côté, en twips

// Texte courant : {{zone à remplir}} en surbrillance jaune ; **gras**.
function runs(text, base = {}) {
  return text.split(/(\{\{.*?\}\}|\*\*.*?\*\*)/g).filter(Boolean).map((part) => {
    if (part.startsWith("{{")) return new TextRun({ text: "[" + part.slice(2, -2) + "]", highlight: "yellow", font: FONT, ...base });
    if (part.startsWith("**")) return new TextRun({ text: part.slice(2, -2), bold: true, font: FONT, ...base });
    return new TextRun({ text: part, font: FONT, ...base });
  });
}
const p = (text, o = {}) =>
  new Paragraph({ children: runs(text, o.run), spacing: { before: o.before ?? 0, after: o.after ?? 100, line: 264 }, alignment: o.align ?? AlignmentType.JUSTIFIED, keepNext: o.keepNext, indent: o.indent });
const bullet = (text) =>
  new Paragraph({ children: runs(text), numbering: { reference: "puces", level: 0 }, spacing: { after: 50, line: 264 }, alignment: AlignmentType.JUSTIFIED });
const art = (n, titre) =>
  new Paragraph({
    children: [new TextRun({ text: `Article ${n} — ${titre}`, bold: true, size: 24, color: ACCENT, font: FONT })],
    spacing: { before: 240, after: 100 },
    keepNext: true,
  });
const h2 = (titre) =>
  new Paragraph({ children: [new TextRun({ text: titre, bold: true, size: 22, color: INK, font: FONT })], spacing: { before: 160, after: 80 }, keepNext: true });

const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border };
const cell = (text, width, o = {}) =>
  new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: String(text).split("\n").map((t) => new Paragraph({ children: runs(t, o.bold ? { bold: true } : {}), spacing: { after: 20 }, alignment: AlignmentType.LEFT })),
  });
function grid(widths, head, rows) {
  const total = widths.reduce((a, b) => a + b, 0);
  const scale = (w) => Math.round((w / total) * WIDTH);
  const ws = widths.map(scale);
  const all = head ? [head, ...rows] : rows;
  return new Table({
    width: { size: WIDTH, type: WidthType.DXA },
    columnWidths: ws,
    rows: all.map((r, i) => new TableRow({ cantSplit: true, tableHeader: head && i === 0, children: r.map((c, j) => cell(c, ws[j], { bold: head && i === 0, shade: head && i === 0 ? "ECEEF0" : !head && j === 0 ? "F4F5F6" : undefined })) })),
  });
}
const space = () => new Paragraph({ children: [], spacing: { after: 120 } });

// Encadré « mode d'emploi », à supprimer avant envoi.
function guide(lines) {
  return new Table({
    width: { size: WIDTH, type: WidthType.DXA },
    columnWidths: [WIDTH],
    rows: [new TableRow({ children: [new TableCell({
      width: { size: WIDTH, type: WidthType.DXA },
      borders: { top: { style: BorderStyle.SINGLE, size: 8, color: ACCENT }, bottom: border, left: border, right: border },
      shading: { type: ShadingType.CLEAR, fill: "FFF4E8", color: "auto" },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      children: [
        new Paragraph({ children: [new TextRun({ text: "MODE D'EMPLOI — À SUPPRIMER AVANT ENVOI", bold: true, size: 18, color: ACCENT, font: FONT })], spacing: { after: 60 } }),
        ...lines.map((l) => new Paragraph({ children: runs(l, { size: 19 }), spacing: { after: 40 }, alignment: AlignmentType.LEFT })),
      ],
    })] })],
  });
}

function titre(t, sous) {
  return [
    new Paragraph({ children: [new TextRun({ text: "MATNEXA", bold: true, size: 20, color: ACCENT, font: FONT, characterSpacing: 60 })], spacing: { before: 200, after: 40 } }),
    new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 40, color: INK, font: FONT })], spacing: { after: 40 }, alignment: AlignmentType.LEFT }),
    new Paragraph({ children: [new TextRun({ text: sous, size: 22, color: "5A6068", font: FONT })], spacing: { after: 200 }, alignment: AlignmentType.LEFT }),
  ];
}

// --- Parties (communes aux deux documents) -----------------------------------------------------------------------------------------
const partieClub = () =>
  grid([30, 70], null, [
    ["Dénomination", "{{Nom de l'association ou de la société}}"],
    ["Forme juridique", "{{Association loi 1901 / SAS / SARL / autre}}"],
    ["Adresse du siège", "{{Adresse complète}}"],
    ["Identifiant", "{{N° RNA ou W… pour une association — SIREN pour une société}}"],
    ["Représenté(e) par", "{{Prénom NOM}}, agissant en qualité de {{Président(e) / Gérant(e) / autre}}"],
    ["Courriel de contact", "{{adresse e-mail}}"],
    ["Nom de l'espace dans Matnexa", "{{Nom du club tel qu'il apparaît dans l'application}}"],
  ]);
const partieEditeur = () =>
  grid([30, 70], null, [
    ["Nom", `**${EDITEUR.nom}**, ${EDITEUR.statut}`],
    ["Adresse", EDITEUR.adresse || "{{Adresse postale de l'éditeur}}"],
    ["Immatriculation", EDITEUR.siret || "{{SIRET, si applicable — sinon supprimer cette ligne}}"],
    ["Courriel de contact", EDITEUR.email],
    ["Service", "Matnexa — application app.matnexa.fr et site www.matnexa.fr"],
  ]);
const signatures = (gauche = "Pour le Club", droite = "Pour l'Éditeur") =>
  new Table({
    width: { size: WIDTH, type: WidthType.DXA },
    columnWidths: [WIDTH / 2, WIDTH / 2].map(Math.round),
    rows: [
      new TableRow({ children: [gauche, droite].map((t) => cell(t, Math.round(WIDTH / 2), { bold: true, shade: "ECEEF0" })) }),
      new TableRow({
        cantSplit: true,
        height: { value: 1700, rule: "atLeast" },
        children: [
          cell("{{Prénom NOM, qualité}}\nLu et approuvé, bon pour accord\nDate : {{jj/mm/aaaa}}\nSignature :", Math.round(WIDTH / 2)),
          cell(`${EDITEUR.nom}\nLu et approuvé, bon pour accord\nDate : {{jj/mm/aaaa}}\nSignature :`, Math.round(WIDTH / 2)),
        ],
      }),
    ],
  });

function doc(nom, children) {
  return new Document({
    creator: "Matnexa",
    title: nom,
    description: "Modèle Matnexa — à compléter pour chaque club",
    styles: { default: { document: { run: { font: FONT, size: 21, color: INK } } } },
    numbering: {
      config: [{ reference: "puces", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 260 } } } }] }],
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: "MATNEXA", bold: true, size: 16, color: ACCENT, font: FONT, characterSpacing: 60 }), new TextRun({ text: `   ·   ${nom}`, size: 16, color: "5A6068", font: FONT })], spacing: { after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 6 } } })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Page ", size: 16, color: "5A6068", font: FONT }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "5A6068", font: FONT }), new TextRun({ text: " sur ", size: 16, color: "5A6068", font: FONT }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "5A6068", font: FONT })] })] }) },
      children,
    }],
  });
}

// =====================================================================================================================================
// 1. CONTRAT DE PRESTATION
// =====================================================================================================================================
function contratPrestation() {
  return doc("Contrat de prestation", [
    ...titre("Contrat de prestation", "Abonnement au service Matnexa"),
    guide([
      "1. Remplir toutes les zones **jaunes** entre crochets, puis retirer la surbrillance (Accueil › Couleur de surbrillance › Aucune couleur).",
      "2. Choisir, pour chaque option « / », celle qui s'applique et supprimer les autres.",
      "3. Supprimer ce cadre, enregistrer sous un nouveau nom (ex. « Contrat – Nom du club ») et ne jamais enregistrer par-dessus le modèle.",
      "4. Joindre en annexes : l'accord de traitement des données (fichier distinct, même date), le PDF « Droits et rôles » et la notice d'information des adhérents.",
      "5. Texte rédigé sans relecture juridique : à faire relire par un juriste ou un avocat avant la première signature, surtout les articles 10 (responsabilité) et 12 (résiliation).",
    ]),
    space(),
    h2("Entre les soussignés"),
    p("**Le Club**", { after: 60, keepNext: true }),
    partieClub(),
    p("ci-après « le **Club** »,", { before: 100, after: 120, align: AlignmentType.LEFT }),
    p("**L'Éditeur**", { after: 60, keepNext: true }),
    partieEditeur(),
    p("ci-après « l'**Éditeur** ».", { before: 100, after: 120, align: AlignmentType.LEFT }),
    p("Le Club et l'Éditeur sont ensemble « les Parties »."),

    art(1, "Objet"),
    p("Le présent contrat définit les conditions dans lesquelles l'Éditeur met à la disposition du Club le service en ligne **Matnexa** (« le Service »), outil de gestion de club d'arts martiaux : adhérents, cours, réservations, présences, grades et communication avec les adhérents."),

    art(2, "Description du Service"),
    p("Le Service est accessible par navigateur (application web installable) à l'adresse app.matnexa.fr. Il comprend, selon la formule choisie à l'article 3 :"),
    bullet("la gestion des fiches adhérents, des familles et des responsables légaux des mineurs ;"),
    bullet("le planning des cours, les réservations, la liste d'attente et le pointage des présences (dont par QR code) ;"),
    bullet("le suivi des grades (ceinture, barrettes), l'historique des passages et l'aide à l'identification des adhérents éligibles au grade suivant ;"),
    bullet("les modules optionnels, activés ou non par l'Éditeur selon la formule : classement et assiduité, actualités et notifications, rapports ;"),
    bullet("quatre niveaux d'accès pour l'équipe (propriétaire, administrateur, coach, membre), décrits dans le document « Droits et rôles » joint en annexe ;"),
    bullet("les exports de données au format CSV et la suppression ou l'anonymisation des fiches."),
    p("L'Éditeur peut faire évoluer le Service pour l'améliorer. Il ne supprime pas de fonctionnalité essentielle sans en avertir le Club au moins {{30}} jours à l'avance."),

    art(3, "Formule, prix et paiement"),
    grid([36, 64], null, [
      ["Formule", "{{Nom de la formule (ex. Pilote, Essentiel, Complet)}}"],
      ["Modules inclus", "{{Cours et présences / + classement / + actualités / + rapports}}"],
      ["Prix", "{{montant}} € hors taxes par {{mois / an}}"],
      ["TVA", "{{TVA au taux de 20 % en sus / TVA non applicable, art. 293 B du CGI}}"],
      ["Période d'essai ou pilote", "{{Aucune / gratuite jusqu'au jj/mm/aaaa, durée de X mois}}"],
      ["Facturation", "{{Mensuelle / trimestrielle / annuelle}}, à terme {{à échoir / échu}}"],
      ["Mode de paiement", "{{Virement / prélèvement / autre}}, à {{30}} jours à compter de la date de facture"],
    ]),
    space(),
    p("Le paiement s'effectue **en dehors de l'application** : celle-ci ne collecte aucun moyen de paiement. Les factures sont adressées par courriel à l'adresse de contact du Club. En cas de retard de paiement, des pénalités égales à trois fois le taux d'intérêt légal sont exigibles, ainsi qu'une indemnité forfaitaire de recouvrement de 40 € lorsque le Club agit en qualité de professionnel."),
    p("Le prix peut être révisé à chaque échéance annuelle, avec un préavis de {{60}} jours ; à défaut d'accord, le Club peut résilier sans frais avant l'entrée en vigueur du nouveau prix."),

    art(4, "Durée et renouvellement"),
    p("Le contrat prend effet le {{jj/mm/aaaa}} pour une durée initiale de {{12 mois}}. Il se renouvelle ensuite par tacite reconduction pour des périodes successives de {{12 mois}}, sauf résiliation notifiée par l'une des Parties par courriel avec accusé de réception au moins {{30}} jours avant l'échéance."),

    art(5, "Engagements de l'Éditeur"),
    p("L'Éditeur est tenu à une obligation de moyens. Il s'engage à :"),
    bullet("fournir le Service avec le soin d'un professionnel et le maintenir en état de fonctionnement ;"),
    bullet("héberger les données en France (OVHcloud, centre de données de Gravelines) et les protéger par les mesures décrites dans l'accord de traitement des données ;"),
    bullet("effectuer une sauvegarde chiffrée de la base de données chaque jour et conserver les sept dernières ;"),
    bullet("assurer un support par courriel à contact@matnexa.fr, les jours ouvrés, avec une réponse sous {{2}} jours ouvrés ;"),
    bullet("prévenir le Club, dans la mesure du possible, des interruptions programmées."),
    p("Le Service est fourni sans engagement de disponibilité chiffré. Il peut être interrompu pour maintenance, mise à jour ou en cas d'incident chez l'hébergeur ou les prestataires techniques ; ces interruptions n'ouvrent droit à aucune indemnité sauf faute lourde de l'Éditeur."),

    art(6, "Engagements du Club"),
    p("Le Club s'engage à :"),
    bullet("désigner un propriétaire du Club, responsable des accès de son équipe, et veiller à ce que seules les personnes habilitées reçoivent les rôles d'administrateur ou de coach ;"),
    bullet("garder confidentiels les identifiants de son équipe et signaler sans délai toute utilisation suspecte ;"),
    bullet("saisir des informations exactes et utiliser le Service conformément à la loi, notamment celle protégeant les mineurs ;"),
    bullet("recueillir l'accord du responsable légal pour toute fiche d'un mineur de moins de {{15 / 16 / 18}} ans ;"),
    bullet("ne pas saisir de données que le Service n'a pas vocation à recevoir : données de santé détaillées, données biométriques, opinions, condamnations, géolocalisation ;"),
    bullet("informer ses adhérents du traitement de leurs données, au moyen de la notice d'information modèle remise en annexe ou de son équivalent."),

    art(7, "Données personnelles"),
    p("Pour les données de ses adhérents, de leurs responsables légaux et de son équipe, le **Club est responsable de traitement** et l'**Éditeur est sous-traitant** au sens du règlement (UE) 2016/679 (RGPD). Les obligations de chacun sont fixées par l'**accord de traitement des données** signé le même jour et annexé au présent contrat. En cas de contradiction, cet accord prévaut pour tout ce qui concerne les données personnelles."),
    p("Pour ses propres besoins (gestion des comptes, sécurité, facturation, statistiques d'usage non nominatives), l'Éditeur agit en responsable de traitement ; les informations correspondantes figurent dans la notice de confidentialité du Service."),

    art(8, "Propriété intellectuelle"),
    p("Le Service, son code, son nom, son symbole et sa documentation restent la propriété exclusive de l'Éditeur. Le contrat confère au Club un droit d'usage personnel, non exclusif et non cessible, pendant sa durée. Le Club reste propriétaire des contenus qu'il saisit ou publie (actualités, fiches, noms de cours) et en garantit la licéité. Il consent à l'Éditeur le droit de les héberger et de les afficher aux seules fins du Service."),

    art(9, "Confidentialité"),
    p("Chaque Partie garde confidentielles les informations non publiques de l'autre dont elle a connaissance du fait du contrat (données, tarifs, éléments techniques) et ne les utilise que pour l'exécuter. Cet engagement dure tant que le contrat et pendant {{2}} ans après son terme."),

    art(10, "Responsabilité"),
    p("Chaque Partie répond des dommages directs causés par sa faute. La responsabilité totale de l'Éditeur au titre du contrat, tous préjudices confondus, est limitée au montant des sommes effectivement versées par le Club au cours des douze mois précédant le fait générateur. L'Éditeur ne répond pas des dommages indirects (perte d'exploitation, perte d'adhérents, atteinte à l'image) ni des conséquences d'un usage du Service contraire au contrat."),
    p("Ces limites ne s'appliquent pas en cas de faute lourde ou dolosive, ni pour les dommages corporels, ni lorsque la loi l'interdit. Les responsabilités propres à chaque Partie en matière de données personnelles sont celles de l'article 82 du RGPD."),
    p("Aucune Partie n'est responsable d'un manquement dû à un cas de force majeure au sens de l'article 1218 du Code civil."),

    art(11, "Suspension"),
    p("En cas de défaut de paiement non régularisé {{15}} jours après mise en demeure, ou d'usage manifestement illicite ou dangereux du Service, l'Éditeur peut suspendre l'accès du Club. Pendant la suspension, les données sont conservées intactes et le Club peut en demander l'export par courriel à contact@matnexa.fr ; l'accès est rétabli à la régularisation. L'Éditeur peut aussi suspendre immédiatement le Service pour préserver la sécurité des données."),

    art(12, "Résiliation et fin du contrat"),
    p("Chaque Partie peut résilier le contrat par courriel avec accusé de réception, de plein droit et sans indemnité, en cas de manquement grave de l'autre non réparé {{30}} jours après mise en demeure. Le Club peut également ne pas le renouveler dans les conditions de l'article 4."),
    p("À la fin du contrat, quelle qu'en soit la cause : le Club exporte ses données (formats CSV et JSON proposés par le Service) ; l'Éditeur supprime ensuite le Club et ses données, conformément à l'article 10 de l'accord de traitement des données, et le confirme par écrit sur demande. Les sommes dues pour la période écoulée restent exigibles."),

    art(13, "Modification du contrat"),
    p("Toute modification du contrat fait l'objet d'un avenant écrit signé des deux Parties, sauf évolution des mentions légales, de la notice de confidentialité ou des fonctionnalités dans les conditions de l'article 2."),

    art(14, "Cession"),
    p("Le Club ne peut céder le contrat sans l'accord écrit de l'Éditeur. L'Éditeur peut le céder à une société qu'il créerait pour exploiter le Service ou à son successeur, sous réserve d'en informer le Club et de reprendre l'accord de traitement des données dans les mêmes termes."),

    art(15, "Droit applicable et litiges"),
    p("Le contrat est soumis au droit français. Les Parties s'efforcent de résoudre à l'amiable tout différend. À défaut d'accord dans un délai de {{30}} jours, le litige est porté devant les juridictions compétentes de {{ville du ressort}}, sous réserve des règles impératives de compétence. L'invalidité d'une clause n'affecte pas les autres."),

    art(16, "Annexes"),
    bullet("Annexe 1 — Accord de traitement des données personnelles (article 28 du RGPD) ;"),
    bullet("Annexe 2 — Document « Droits et rôles » (PDF) ;"),
    bullet("Annexe 3 — Notice d'information à remettre aux adhérents."),
    p("Fait à {{lieu}}, le {{jj/mm/aaaa}}, en deux exemplaires originaux (ou par signature électronique).", { before: 200 }),
    space(),
    signatures(),
  ]);
}

// =====================================================================================================================================
// 2. ACCORD DE TRAITEMENT DES DONNÉES (art. 28 RGPD)
// =====================================================================================================================================
function accordTraitement() {
  return doc("Accord de traitement des données", [
    ...titre("Accord de traitement des données personnelles", "Sous-traitance au sens de l'article 28 du RGPD — annexe 1 du contrat de prestation"),
    guide([
      "1. Remplir les zones **jaunes** entre crochets (identité du club, date du contrat de prestation, lieu et date de signature), puis retirer la surbrillance.",
      "2. Ne rien modifier d'autre pour un club ordinaire. Toute clause modifiée à la demande d'un club doit être relue par un juriste.",
      "3. Supprimer ce cadre, enregistrer sous un nouveau nom et le faire signer **avant** que le club saisisse des données réelles.",
      "4. Texte rédigé sans relecture juridique, calqué sur les mentions obligatoires de l'article 28 §3. La CNIL publie un guide du sous-traitant et la Commission européenne des clauses types (décision d'exécution (UE) 2021/915) : les consulter est la voie la plus sûre.",
      "5. À tenir à jour avec docs/rgpd/ (sous-traitants, conservation, procédures) : régénérer ce modèle avec « npm run docs:contracts » quand ces faits changent.",
    ]),
    space(),
    h2("Entre"),
    p("**Le Club**, responsable de traitement", { after: 60, keepNext: true }),
    partieClub(),
    p("ci-après « le **Responsable** »,", { before: 100, after: 120, align: AlignmentType.LEFT }),
    p("**L'Éditeur**, sous-traitant", { after: 60, keepNext: true }),
    partieEditeur(),
    p("ci-après « le **Sous-traitant** ».", { before: 100, after: 120, align: AlignmentType.LEFT }),
    p("Le présent accord complète le contrat de prestation conclu le {{jj/mm/aaaa}} entre les Parties. Il s'applique dès la première saisie de données personnelles dans le Service."),

    art(1, "Objet et durée"),
    p("Le Sous-traitant traite des données personnelles pour le compte du Responsable, dans le cadre du service Matnexa (gestion des membres, des cours, des réservations et des présences). L'accord court pendant toute la durée d'utilisation du Service et prend fin à la suppression du Club dans Matnexa ou à la résiliation, selon l'article 10."),

    art(2, "Description du traitement"),
    grid([26, 74], ["Élément", "Contenu"], [
      ["Nature et finalités", "Gestion des adhérents ; organisation des cours, réservations et liste d'attente ; suivi des présences (y compris par QR code) ; suivi des grades ; classement des venues sur consentement des membres ; envoi d'e-mails et de notifications de service ; exports à la demande du Responsable"],
      ["Catégories de personnes", "Membres du Club, majeurs ou mineurs ; responsables légaux des mineurs ; encadrants (propriétaire, administrateurs, coachs)"],
      ["Catégories de données", "Identité (prénom, nom) ; contact (e-mail, téléphone) ; date d'inscription ; identifiant interne facultatif ; ceinture, barrettes et historique des passages de grade ; silhouette d'avatar ; photo facultative ; attestation de majorité ; pour les mineurs : date de naissance et responsable légal (nom, e-mail, téléphone) avec son accord ; réservations ; présences ; consentement au classement"],
      ["Données exclues", "Le Responsable s'engage à ne pas saisir de données de santé, biométriques, de géolocalisation, d'opinions ou de condamnations. Seule exception : la raison d'une pause déclarée par l'adhérent (« blessure » ou « maladie », catégorie seule, sans détail), avec son consentement explicite, jamais pour un mineur, effacée 30 jours après la reprise"],
      ["Durées de conservation", "Fiche archivée : anonymisée à l'issue du délai choisi par le Responsable (24 mois par défaut, réglable de 6 à 120 mois). Date de naissance et responsable légal d'un mineur : effacés à sa majorité. Présences conservées sans identité après anonymisation"],
    ]),

    art(3, "Instructions documentées (art. 28 §3 a)"),
    p("Le Sous-traitant ne traite les données que sur instruction documentée du Responsable ; l'utilisation du Service par le Responsable et son équipe (création, modification, export, archivage, effacement) vaut instruction. Il informe immédiatement le Responsable s'il estime qu'une instruction enfreint le RGPD. Il ne transfère les données hors de l'Union européenne que dans les conditions de l'article 6."),

    art(4, "Confidentialité (art. 28 §3 b)"),
    p("L'accès technique aux données chez le Sous-traitant est réservé à l'Éditeur lui-même. Si une autre personne devait y avoir accès, elle serait tenue par écrit à la confidentialité et le Responsable en serait informé. Le Sous-traitant n'accède pas aux données d'un club hors des besoins de maintenance, de sécurité, d'assistance ou d'une demande du Responsable. La console d'administration de l'Éditeur ne présente que des compteurs agrégés par club, sans le contenu des fiches."),

    art(5, "Sécurité (art. 28 §3 c et art. 32)"),
    p("Le Sous-traitant met en œuvre les mesures décrites en annexe A, proportionnées aux risques, et les améliore au fil du temps. Il les maintient au moins au niveau décrit pendant toute la durée de l'accord."),

    art(6, "Sous-traitants ultérieurs et transferts (art. 28 §2, §3 d et §4)"),
    p("Le Responsable donne une autorisation générale pour le recours aux sous-traitants ultérieurs suivants :"),
    grid([22, 40, 38], ["Prestataire", "Prestation", "Localisation des données"], [
      ["OVHcloud", "Hébergement du serveur et de la base de données", "France (Gravelines)"],
      ["OVHcloud", "Sauvegarde automatique quotidienne du serveur, conservée 7 jours", "{{À vérifier dans l'espace client OVHcloud — ex. France}}"],
      ["Resend", "Envoi des e-mails de service (connexion, rappels, notifications)", "Envoi depuis l'Irlande. Métadonnées et journaux stockés aux États-Unis, encadrés par les clauses contractuelles types de son accord de traitement et sa certification Data Privacy Framework"],
    ]),
    space(),
    p("Les notifications push, que chaque utilisateur active volontairement, transitent par le service de notification de son navigateur (Google, Apple, Mozilla ou Microsoft) : le message est chiffré de bout en bout et seule l'adresse technique de l'appareil est visible. Ces services sont des intermédiaires imposés par le standard Web Push et n'ont pas été choisis par le Sous-traitant."),
    p("Le Sous-traitant informe le Responsable de tout ajout ou remplacement de sous-traitant ultérieur **30 jours** à l'avance, par courriel. Le Responsable peut s'y opposer par écrit dans ce délai ; à défaut d'accord, il peut résilier sans frais. Le Sous-traitant impose à ses sous-traitants ultérieurs des obligations équivalentes à celles du présent accord et reste responsable à l'égard du Responsable de leur exécution."),

    art(7, "Droits des personnes (art. 28 §3 e)"),
    p("Le Service fournit au Responsable les outils d'export, de rectification, d'archivage, d'anonymisation et d'effacement des données d'une personne. Chaque utilisateur peut aussi télécharger ses données et supprimer son compte depuis son espace. Le Sous-traitant transmet au Responsable, sans délai, toute demande reçue directement d'une personne concernée par une fiche du Club, et l'aide à y répondre dans le délai d'un mois."),

    art(8, "Assistance et violations de données (art. 28 §3 f)"),
    p("Le Sous-traitant aide le Responsable à respecter ses obligations de sécurité, de notification des violations, d'analyse d'impact et de consultation préalable, compte tenu des informations dont il dispose. Il notifie au Responsable toute violation de données personnelles **dans un délai maximal de 48 heures** après en avoir pris connaissance, avec les informations de l'article 33 §3 du RGPD alors disponibles (nature, personnes et données concernées, conséquences probables, mesures prises). Il complète ces informations au fur et à mesure."),

    art(9, "Audit (art. 28 §3 h)"),
    p("Le Sous-traitant met à disposition du Responsable les informations nécessaires pour démontrer le respect du présent accord (descriptif des mesures de sécurité, registre des traitements, procédures, résultats des tests) et permet des audits raisonnables, sur préavis de **30 jours**, au plus une fois par an sauf violation avérée, aux frais du Responsable sauf manquement constaté."),

    art(10, "Fin de l'accord et restitution (art. 28 §3 g)"),
    p("Au choix du Responsable, à la fin du contrat : export de ses données (formats CSV et JSON fournis par le Service) puis suppression du Club et de toutes ses données, ou suppression directe. La suppression dans la base est immédiate ; les copies présentes dans les sauvegardes disparaissent à l'expiration de celles-ci, **au plus tard 7 jours** après l'effacement. Le Sous-traitant le confirme par écrit sur demande."),

    art(11, "Obligations du Responsable"),
    p("Le Responsable détermine les finalités et les moyens du traitement. Il lui appartient notamment de : disposer d'une base légale pour chaque traitement ; informer les personnes concernées (une notice modèle est fournie) ; recueillir l'accord du responsable légal pour les mineurs ; tenir son propre registre des traitements ; décider des durées de conservation dans les limites proposées par le Service ; réserver les rôles d'administrateur et de coach à des personnes de confiance."),

    art(12, "Responsabilités"),
    p("Chaque Partie répond de ses manquements dans les conditions de l'article 82 du RGPD. Les limitations de responsabilité du contrat de prestation s'appliquent dans la mesure permise par la loi."),

    art(13, "Droit applicable"),
    p("Le présent accord est soumis au droit français. Les litiges sont réglés selon l'article 15 du contrat de prestation."),
    p("Fait à {{lieu}}, le {{jj/mm/aaaa}}, en deux exemplaires originaux (ou par signature électronique).", { before: 200 }),
    space(),
    signatures(),

    new Paragraph({ children: [], pageBreakBefore: true }),
    ...titre("Annexe A", "Mesures de sécurité du Sous-traitant"),
    grid([26, 74], ["Domaine", "Mesures"], [
      ["Échanges", "Chiffrement de toutes les communications (HTTPS). Cookies de session protégés ; en-têtes de sécurité (CSP, HSTS)."],
      ["Cloisonnement des clubs", "Isolation des données de chaque club au niveau de la base de données elle-même (règles de sécurité par ligne, imposées même à l'application) : un club ne peut pas lire les données d'un autre, même en cas d'erreur de code."],
      ["Comptes et accès", "Mots de passe stockés sous forme hachée. Limitation des tentatives de connexion. Rôles distincts (propriétaire, administrateur, coach, membre). Journal des actions administratives conservé 24 mois."],
      ["Administration de l'Éditeur", "Console réservée à un compte unique, protégée par un code à usage unique envoyé par e-mail. Elle n'affiche que des compteurs, pas le contenu des fiches."],
      ["Sauvegardes", "Sauvegarde chiffrée de la base chaque jour, hors du serveur, sept conservées ; alerte automatique si une sauvegarde manque. Sauvegarde du serveur par l'hébergeur, conservée 7 jours. Restauration testée."],
      ["Hébergement", "Serveur dédié chez OVHcloud, centre de données de Gravelines (France). Mises à jour de sécurité appliquées régulièrement."],
      ["Surveillance", "Suivi des tâches planifiées, des envois d'e-mails et de notifications, alerte à l'Éditeur en cas d'anomalie."],
      ["Minimisation", "Pas de données de santé détaillées, de biométrie ni de géolocalisation. Photos facultatives. Anonymisation automatique des fiches archivées. Effacement des comptes et des fiches à la demande."],
      ["Développement", "Contrôles automatisés avant chaque mise en production, dont des tests des règles d'isolation des clubs et un contrôle de l'absence de secrets dans le code."],
    ]),
  ]);
}

// =====================================================================================================================================
// 3. CONTRAT DE CRÉATION ET DE MAINTENANCE D'UN SITE WEB (l'éditeur agit comme prestataire pour un client)
// =====================================================================================================================================
const partieClient = () =>
  grid([30, 70], null, [
    ["Dénomination", "{{Nom de l'association ou de la société}}"],
    ["Forme juridique", "{{Association loi 1901 / SAS / SARL / entreprise individuelle / autre}}"],
    ["Adresse du siège", "{{Adresse complète}}"],
    ["Identifiant", "{{N° RNA ou W… pour une association — SIREN pour une société}}"],
    ["Représenté(e) par", "{{Prénom NOM}}, agissant en qualité de {{Président(e) / Gérant(e) / autre}}"],
    ["Courriel de contact", "{{adresse e-mail}}"],
    ["Interlocuteur pour le projet", "{{Prénom NOM, téléphone, e-mail}}"],
  ]);
const partiePrestataire = () =>
  grid([30, 70], null, [
    ["Nom", `**${EDITEUR.nom}**, ${EDITEUR.statut}`],
    ["Adresse", EDITEUR.adresse || "{{Adresse postale du prestataire}}"],
    ["Immatriculation", EDITEUR.siret || "{{SIRET, si applicable — sinon supprimer cette ligne}}"],
    ["Courriel de contact", EDITEUR.email],
  ]);

function contratSiteWeb() {
  return doc("Création et maintenance d'un site web", [
    ...titre("Contrat de création et de maintenance de site web", "Développement, mise en ligne et entretien"),
    guide([
      "1. Remplir toutes les zones **jaunes** entre crochets, puis retirer la surbrillance (Accueil › Couleur de surbrillance › Aucune couleur).",
      "2. Choisir, pour chaque option « / », celle qui s'applique et supprimer les autres. Supprimer le Titre 2 (maintenance) ou le Titre 1 (création) si le contrat ne couvre que l'un des deux.",
      "3. Remplir **l'annexe 1 (cahier des charges)** avec soin : c'est elle qui fixe ce qui est dû et évite les litiges. Remplir l'annexe 2 (planning et prix).",
      "4. Supprimer ce cadre, enregistrer sous un nouveau nom (ex. « Site – Nom du client ») et ne jamais enregistrer par-dessus le modèle.",
      "5. Si le prestataire héberge le site ou accède à des données de visiteurs ou d'adhérents du client, faire aussi signer l'**accord de traitement des données** (modèle distinct).",
      "6. Texte rédigé sans relecture juridique : à faire relire par un juriste avant la première signature, surtout les articles 9 (propriété intellectuelle), 14 (responsabilité) et 15 (résiliation).",
    ]),
    space(),
    h2("Entre les soussignés"),
    p("**Le Client**", { after: 60, keepNext: true }),
    partieClient(),
    p("ci-après « le **Client** »,", { before: 100, after: 120, align: AlignmentType.LEFT }),
    p("**Le Prestataire**", { after: 60, keepNext: true }),
    partiePrestataire(),
    p("ci-après « le **Prestataire** ».", { before: 100, after: 120, align: AlignmentType.LEFT }),
    p("Le Client et le Prestataire sont ensemble « les Parties »."),

    art(1, "Objet"),
    p("Le Client confie au Prestataire, qui l'accepte, {{la conception et le développement de son site web / la maintenance de son site web existant / la conception, le développement puis la maintenance de son site web}} à l'adresse {{www.exemple.fr}} (« le Site »), selon le cahier des charges de l'annexe 1."),

    art(2, "Documents contractuels"),
    p("Le contrat est formé du présent document et de ses annexes : annexe 1 (cahier des charges) et annexe 2 (planning et prix). En cas de contradiction, le présent document prévaut sur les annexes, sauf précision expresse de l'annexe 1 sur le périmètre fonctionnel."),

    h2("Titre 1 — Création du Site"),
    art(3, "Déroulement de la prestation"),
    p("Le Prestataire réalise le Site en {{trois}} étapes : (1) cadrage et maquettes ; (2) développement et intégration des contenus ; (3) recette et mise en ligne. Le planning figure à l'annexe 2. Le Prestataire s'organise librement pour exécuter la prestation et reste indépendant : il n'existe aucun lien de subordination entre les Parties."),
    p("Les délais sont indicatifs et courent à compter de la réception de l'acompte et des éléments nécessaires fournis par le Client. Ils sont prolongés, sans pénalité, de la durée de tout retard du Client à fournir les contenus, accès ou validations demandés."),

    art(4, "Collaboration du Client"),
    p("Le Client s'engage à : désigner un interlocuteur unique habilité à valider ; fournir à temps les textes, images, logos, documents et accès nécessaires, dont il garantit qu'il détient les droits ; répondre aux demandes de validation sous {{5}} jours ouvrés ; respecter les formats demandés. Le Client est seul responsable du contenu qu'il fournit ou publie (droit d'auteur, droit à l'image, mentions légales, loyauté des informations)."),

    art(5, "Recette"),
    p("À la fin du développement, le Prestataire met le Site à disposition du Client sur un environnement de test. Le Client dispose de {{10}} jours pour le tester et notifier par écrit les anomalies par rapport au cahier des charges. Le Prestataire les corrige dans un délai raisonnable. Le Site est réputé accepté à l'expiration de ce délai sans réserve, ou à sa mise en ligne par le Client. Les demandes qui excèdent le cahier des charges sont traitées comme des évolutions (article 7)."),

    art(6, "Garantie"),
    p("Pendant {{3}} mois après la mise en ligne, le Prestataire corrige gratuitement les anomalies qui rendent le Site non conforme au cahier des charges, à condition qu'elles lui soient signalées par écrit et que le Site n'ait pas été modifié par un tiers. La garantie ne couvre ni les évolutions, ni les pannes dues à l'hébergeur, à un fournisseur tiers, à une mise à jour imposée par un service externe ou à un usage non conforme."),

    art(7, "Modifications du périmètre"),
    p("Toute demande hors cahier des charges (fonction, page, refonte graphique, changement de contenu après validation) fait l'objet d'un devis écrit du Prestataire, accepté avant exécution. Le tarif des travaux supplémentaires est de {{montant}} € hors taxes par {{heure / journée}}, sauf devis contraire."),

    h2("Titre 2 — Maintenance du Site"),
    art(8, "Contenu de la maintenance"),
    p("À compter de la mise en ligne, et sauf renonciation du Client à la maintenance à l'annexe 2, le Prestataire assure :"),
    bullet("la **maintenance corrective** : correction des anomalies de fonctionnement du Site ;"),
    bullet("la **maintenance de sécurité** : application des mises à jour de sécurité des composants du Site, surveillance de sa disponibilité, sauvegardes {{quotidiennes / hebdomadaires}} conservées {{7 / 30}} jours ;"),
    bullet("l'**assistance** par courriel à {{contact@…}}, les jours ouvrés, avec une réponse sous {{2}} jours ouvrés ;"),
    bullet("jusqu'à {{2}} heures par mois de **petites évolutions** (modification de textes, ajout d'une page ou d'une image), non reportables d'un mois sur l'autre."),
    p("Les anomalies bloquantes (Site inaccessible) sont traitées en priorité, dans un délai visé de {{1}} jour ouvré après signalement. Ces délais sont des objectifs et non des garanties. Sont exclus : les évolutions importantes (devis, article 7), la refonte, la formation, la rédaction de contenu, la rémunération des services tiers (nom de domaine, hébergement, outils payants) et les interventions rendues nécessaires par une faute du Client ou d'un tiers."),
    p("Le Prestataire est tenu d'une obligation de moyens. Il ne garantit pas une disponibilité continue du Site, qui dépend en partie de services tiers."),

    art(9, "Propriété intellectuelle"),
    p("Sous réserve du paiement intégral du prix de création, le Prestataire cède au Client, à titre non exclusif {{ou exclusif}}, pour la durée de protection des droits et pour le monde entier, les droits d'exploitation sur les éléments spécifiquement créés pour le Site (maquettes, textes rédigés par lui, code propre au Site) : droit de les reproduire, représenter, modifier et adapter pour les besoins du Site. Jusqu'au paiement intégral, le Client ne dispose que d'un droit d'usage du Site."),
    p("Restent la propriété du Prestataire ou de leurs titulaires, et ne sont pas cédés : les outils, bibliothèques, frameworks et composants préexistants du Prestataire, ainsi que les composants libres ou sous licence tiers, utilisés selon leurs licences (le Prestataire en fournit la liste sur demande). Le Client reçoit sur ces éléments un droit d'usage pour le Site. Le Prestataire peut réutiliser son savoir-faire général et ses composants génériques pour d'autres projets, sans reprendre les contenus ni les éléments distinctifs du Client."),
    p("Sauf opposition écrite du Client, le Prestataire peut citer le Client et présenter le Site comme référence (nom, capture d'écran, lien)."),

    art(10, "Hébergement, nom de domaine et accès"),
    p("{{Option A : Le Site est hébergé par le Prestataire chez OVHcloud (France). Le coût d'hébergement est inclus dans le forfait de maintenance. / Option B : Le Client souscrit lui-même son hébergement et son nom de domaine, et en donne l'accès au Prestataire pour la durée de sa mission.}} Le nom de domaine est enregistré au nom du Client, qui en reste le titulaire et responsable du renouvellement. Les accès confiés au Prestataire sont utilisés pour les seuls besoins de la mission et restitués à son terme."),

    art(11, "Données personnelles"),
    p("Le Client est responsable des données personnelles collectées par le Site (formulaires, comptes, statistiques) : il lui appartient de rédiger les mentions légales et la politique de confidentialité, de gérer l'information des visiteurs et, le cas échéant, leur consentement aux cookies. Le Prestataire prévoit dans le Site les dispositifs techniques convenus à l'annexe 1 pour l'y aider. Lorsque le Prestataire héberge le Site ou accède aux données collectées, il agit en sous-traitant du Client et les Parties signent l'**accord de traitement des données** (article 28 du RGPD) joint en annexe {{3 / sans objet}}."),

    h2("Dispositions communes"),
    art(12, "Prix et paiement"),
    p("Les prix, échéances et modalités de paiement sont fixés à l'annexe 2. Les factures sont payables à {{30}} jours à compter de leur date, par {{virement / autre}}. En cas de retard, des pénalités égales à trois fois le taux d'intérêt légal sont exigibles, ainsi qu'une indemnité forfaitaire de recouvrement de 40 € lorsque le Client agit en qualité de professionnel. Les sommes versées ne sont pas remboursables, sauf manquement du Prestataire non corrigé après mise en demeure. {{TVA au taux de 20 % en sus / TVA non applicable, art. 293 B du CGI.}}"),
    p("Le Prestataire peut suspendre sa prestation, y compris la maintenance, {{15}} jours après une mise en demeure de payer restée sans effet."),

    art(13, "Confidentialité"),
    p("Chaque Partie garde confidentielles les informations non publiques de l'autre dont elle a connaissance du fait du contrat et ne les utilise que pour l'exécuter, pendant sa durée et {{2}} ans après son terme."),

    art(14, "Responsabilité"),
    p("Chaque Partie répond des dommages directs causés par sa faute. La responsabilité totale du Prestataire, tous préjudices confondus, est limitée au montant des sommes effectivement perçues au titre du contrat au cours des douze mois précédant le fait générateur. Il ne répond pas des dommages indirects (perte de chiffre d'affaires, de clientèle, de référencement, d'image), ni des contenus fournis par le Client, ni des défaillances de services tiers. Ces limites ne s'appliquent pas en cas de faute lourde ou dolosive, de dommage corporel, ou lorsque la loi l'interdit. Aucune Partie n'est responsable d'un manquement dû à un cas de force majeure (article 1218 du Code civil)."),

    art(15, "Durée et résiliation"),
    p("**Création** : le contrat prend effet à sa signature et prend fin à l'acceptation du Site et au paiement du solde. **Maintenance** : elle débute à la mise en ligne pour {{12 mois}}, puis se renouvelle par tacite reconduction pour des périodes de {{12 mois}}, sauf résiliation par l'une des Parties notifiée par courriel avec accusé de réception au moins {{30}} jours avant l'échéance."),
    p("Chaque Partie peut résilier le contrat de plein droit en cas de manquement grave de l'autre non réparé {{30}} jours après mise en demeure. En cas de résiliation avant la fin de la création, le Client paie les travaux effectués jusqu'à la date de résiliation, sur la base de l'avancement constaté, l'acompte restant acquis au Prestataire dans cette limite."),
    p("À la fin du contrat, le Prestataire remet au Client, sur demande et sous {{15}} jours, les fichiers sources du Site cédés à l'article 9, les contenus et une copie de la base de données, puis supprime les données du Client qu'il héberge, sauf obligation légale de les conserver. Les accès confiés sont restitués."),

    art(16, "Dispositions générales"),
    p("Toute modification du contrat fait l'objet d'un avenant écrit. Aucune Partie ne peut céder le contrat sans l'accord écrit de l'autre. L'invalidité d'une clause n'affecte pas les autres. Le contrat est soumis au droit français. Les Parties s'efforcent de résoudre à l'amiable tout différend ; à défaut d'accord sous {{30}} jours, le litige est porté devant les juridictions compétentes de {{ville du ressort}}, sous réserve des règles impératives de compétence."),
    p("Fait à {{lieu}}, le {{jj/mm/aaaa}}, en deux exemplaires originaux (ou par signature électronique).", { before: 200 }),
    space(),
    signatures("Pour le Client", "Pour le Prestataire"),

    new Paragraph({ children: [], pageBreakBefore: true }),
    ...titre("Annexe 1", "Cahier des charges"),
    grid([28, 72], null, [
      ["Objectif du site", "{{À quoi sert le site, pour qui}}"],
      ["Type de site", "{{Vitrine / blog / réservation / boutique / application web / autre}}"],
      ["Pages et rubriques", "{{Liste : accueil, présentation, tarifs, contact…}}"],
      ["Fonctionnalités", "{{Formulaire de contact, inscription, paiement, agenda, multilingue, espace membre…}}"],
      ["Charte graphique", "{{Fournie par le Client (logo, couleurs, polices) / à créer par le Prestataire}}"],
      ["Contenus", "{{Fournis par le Client / rédigés par le Prestataire — préciser}}"],
      ["Référencement (SEO)", "{{Balises, plan du site, vitesse, inclus / non inclus}}"],
      ["Mentions légales et RGPD", "{{Mentions légales, politique de confidentialité, bandeau de cookies — qui les fournit}}"],
      ["Compatibilité", "{{Navigateurs récents, mobile et ordinateur}}"],
      ["Accessibilité", "{{Niveau visé, ex. bonnes pratiques RGAA / non demandé}}"],
      ["Services tiers", "{{Messagerie, cartographie, paiement, statistiques…}}"],
      ["Hors périmètre", "{{Ce qui n'est pas inclus : rédaction, photos, traduction, campagnes publicitaires…}}"],
    ]),

    new Paragraph({ children: [], pageBreakBefore: true }),
    ...titre("Annexe 2", "Planning et prix"),
    h2("Création"),
    grid([40, 30, 30], ["Étape", "Échéance", "Prix HT"], [
      ["Acompte à la signature ({{30}} %)", "{{jj/mm/aaaa}}", "{{montant}} €"],
      ["Maquettes validées", "{{jj/mm/aaaa}}", "{{montant}} €"],
      ["Mise en ligne et recette", "{{jj/mm/aaaa}}", "{{montant}} €"],
      ["**Total création**", "", "{{montant}} €"],
    ]),
    h2("Maintenance"),
    grid([40, 30, 30], ["Prestation", "Périodicité", "Prix HT"], [
      ["Forfait de maintenance (article 8)", "{{Mensuelle / annuelle}}", "{{montant}} €"],
      ["Hébergement et nom de domaine", "{{Inclus / refacturé à l'identique / à la charge du Client}}", "{{montant}} €"],
      ["Heures supplémentaires au-delà du forfait", "À l'heure", "{{montant}} €"],
    ]),
    p("Le Client {{souhaite / ne souhaite pas}} souscrire la maintenance.", { before: 120 }),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [file, build] of [["contrat-prestation-matnexa.docx", contratPrestation], ["accord-traitement-donnees-matnexa.docx", accordTraitement], ["contrat-site-web.docx", contratSiteWeb]]) {
  writeFileSync(path.join(OUT_DIR, file), await Packer.toBuffer(build()));
  console.log("écrit :", path.join("docs", "contrats", file));
}
console.log(`Modèles Matnexa — ${MAJ}`);
