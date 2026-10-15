---
version: 1
slug: "site-index-html"
primary_target: "site/index.html"
related_targets: []
---

# Surface brief — www.matnexa.fr (landing publique)

Scope: page d'accueil publique de Matnexa sur www.matnexa.fr, site statique indépendant (`site/`), servi par Nginx ; l'application reste sur app.matnexa.fr. Mode: Persuade.

Audience and job: responsable de club de JJB, grappling ou MMA (100–300 membres, plusieurs coachs), souvent arrivé par Google (« logiciel gestion club JJB », « appel présences club », « QR code pointage club »). Il doit comprendre en quelques secondes ce que fait Matnexa et demander l'accès. Coachs et adhérents arrivent aussi : « Se connecter » et « Je suis adhérent » doivent être évidents.

Action: bouton orange unique « Demander l'accès pour mon club » → https://app.matnexa.fr/request-club. Secondaires : « Se connecter » (app.matnexa.fr/login), « J'ai un code de club » (app.matnexa.fr/signup).

Proof/content: uniquement les fonctions réelles de PRODUCT.md. Aucun prix, aucun client, aucun chiffre, aucune citation, pas de mention du pilote. Données de démonstration (noms) étiquetées fictives.

Constraints: HTML/CSS statique, zéro JS requis pour lire et agir ; police Archivo auto-hébergée ; CSP stricte possible (aucun style ni script en ligne) ; SEO complet (title, description, canonical, Open Graph, JSON-LD SoftwareApplication + Organization + FAQPage, sitemap, robots, 404) ; WCAG 2.1 AA ; Core Web Vitals au vert.

## Direction contract

THESIS: Matnexa remplace le cahier d'appel ; la page le prouve corvée par corvée. Elle refuse la landing SaaS par défaut (dégradé, rangée de cartes icône-titre-texte, logos clients, chiffres héros) : chaque section prend une page du cahier et la montre résolue dans l'écran réel.

OWN-WORLD: monde Ceinture inchangé. Fond coton #F4F2EE, panneaux blancs à filet 1 px, coins 4 px, aucune ombre hors superposition. Barre noire #16191D pour l'en-tête et la clôture ; rubans blancs comptés en barrettes. Orange #C2410C une fois par écran, sur l'action. Archivo condensé gras pour titres et heures, chasse normale pour le texte. Contrepoint : la page de cahier quadrillée, crayon graphite, ratures.

STORY: le responsable reconnaît son cahier et son tableur, voit l'appel fait au doigt, la liste des membres qui décrochent avec « Écrire », le QR de pointage, puis comprend que tout tient dans un outil et que les données restent en France ; il demande l'accès.

FIRST VIEWPORT: en-tête noir (logotype, ancres, Se connecter, « Demander l'accès » au trait blanc). À gauche H1 condensé 48–72 px « Rayez le cahier d'appel. » (titre validé par Arthur, repris par l'image de partage) suivi d'une sous-ligne porteuse des mots-clés, une phrase de promesse, le bouton orange et le lien « J'ai un code de club ». À droite, une page de cahier quadrillée (noms, bâtons au crayon) barrée en diagonale par le trait orange du symbole, la feuille d'appel Matnexa interactive posée par-dessus, compteurs Présent/Retard/Absent.

FORM: « Le cahier d'appel, rayé », position 6 de ma liste ordonnée de sept structures ; seed key 19e50651. Signature : le trait orange qui raye le cahier se trace au chargement (stroke-dashoffset, 700 ms, sortie exponentielle, désactivé sous prefers-reduced-motion), puis chaque section « corvée » montre sa ligne de cahier rayée au-dessus de l'écran qui la remplace.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
