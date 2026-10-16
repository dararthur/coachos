# Matnexa (Coach OS) — Revue stratégique et roadmap révisée

Date : 16 octobre 2026. Document d'analyse : aucun code modifié. Base : dépôt `main` 264db28, documents du dépôt, sites publics des concurrents.

Conventions : **[F]** fait vérifié (dépôt ou source citée) · **[H]** hypothèse à vérifier · **[R]** recommandation.
Efforts : XS < ½ jour · S ½–2 jours · M 3–5 jours · L 1–2 semaines · XL > 2 semaines (un développeur, rythme actuel).

---

## 1. Synthèse exécutive

**Diagnostic, sans complaisance.**

1. **Le moteur technique est excellent ; la stratégie produit a dérivé.** En 4 jours (13–16 octobre, 187 commits, 37 migrations, ~14 000 lignes de TypeScript, ~5 000 de SQL) tu as construit un socle plus solide que beaucoup de SaaS en production : RLS comme seule autorité, invariants de schéma testés, CSP à nonce, sauvegardes chiffrées avec restauration testée, procédure de déploiement réversible. Ce n'est pas le problème. **[F]**
2. **Tu as abandonné ta propre méthode de validation sans l'avoir exécutée.** Le README fixe des critères GO/NO-GO (15 entretiens, ≥ 10 qui décrivent le problème, 1 paiement avant J+45) et une liste explicite de ce qu'on ne construit **pas** : « paiements, CRM, planning, site web ». `discovery/interviews.csv` et `verbatims.csv` sont **vides** (en-tête seul), `notes-produit.md` est vide, le V0 n'a tourné que sur des données synthétiques (`v0/out/alma-bjj-*`). Depuis, le planning, les réservations, les actualités, le push ont été construits, et vidéothèque, boutique et sites web sont en file. **[F]**
3. **La seule chose qui te différencie est la seule qui n'est pas dans l'application.** Le brief hebdomadaire (« à qui parler ») reste un script CLI. Ce que l'app propose aujourd'hui pour la rétention (« actifs sans présence depuis 30 jours ») existe déjà chez Gymdesk, qui va plus loin (seuil réglable, relances automatiques). **[F]**
4. **Sur l'étendue fonctionnelle, tu as déjà perdu, et c'est normal.** OSS Academy est français, spécialisé sports de combat, revendique 90+ fonctionnalités : paiements, apps natives, kiosque, licences fédérales, compétitions, page club, essais en ligne, sondages. Il est à 30 €/mois (offre de lancement) et **gratuit sous 25 membres**. MAAT est à 49–59 $/mois (+1 % par transaction), centré sur le paiement et la migration gratuite. Courir après eux, c'est 6 à 12 mois de travail solo pour arriver à parité, plus cher ou au même prix, sans paiements. **[F]** sur les offres, **[R]** sur la conclusion.
5. **Le marché français n'a pas la douleur que ta thèse suppose, du moins pas sous la même forme.** La majorité des clubs sont des associations avec une cotisation annuelle payée en septembre, souvent via HelloAsso (gratuit). Un adhérent qui décroche en novembre ne coûte rien cette saison : il coûte **au renouvellement**. Ton README le disait déjà : « La France est le laboratoire, pas le marché ». La douleur « je perds de l'argent chaque mois » existe chez les **académies commerciales à prélèvement mensuel**. **[H]** à valider en entretiens.

**Ce que je recommande en une phrase :** arrête d'élargir, **branche le brief dans l'application et fais du pilote une expérience mesurée**. Matnexa doit être *l'outil d'appel le plus rapide du tatami, qui transforme les présences en une liste hebdomadaire de personnes à qui parler et prouve combien sont revenues*. Pas une plateforme de gestion complète, pas encore.

---

## 2. État réel de Matnexa et maturité

Méthode : lecture du code (`src/`, `db/migrations/`), des tests, de la CI et des documents ; recoupement avec les audits du 15 et du 16 octobre (qui ont, eux, rejoué les parcours dans un navigateur). Je n'ai pas refait de parcours en navigateur : l'audit UX de la veille couvre 22 pages × 2 rôles et je n'aurais rien appris de plus sur la stratégie.

### 2.1 Ce qui fonctionne réellement (testé automatiquement et, pour une partie, déployé)

| Domaine | Contenu | Preuve |
|---|---|---|
| Comptes et accès | Better Auth auto-hébergé, e-mail confirmé, sessions d'un an, appareils connectés, création de club sur approbation, inscription seulement avec code, invitation ou accord parental | tests db + e2e, prod app.matnexa.fr |
| Multi-clubs | Rôles propriétaire > admin > coach > membre, un compte dans plusieurs clubs, isolation testée table par table (`tenant-isolation-catalog`) | tests db |
| Membres | Liste paginée, fiche, import CSV en 2 étapes, export, archivage, effacement RGPD, téléphone et WhatsApp, photo normalisée | tests |
| Planning et réservations | Séances uniques et récurrentes, capacité non bloquante, liste d'attente auto-promue avec e-mail, annulation jusqu'à validation | tests |
| Appel et pointage | Feuille d'appel (présent / en retard / absent), validation qui marque absents les non-venus, QR tournant ou fixe, scanner intégré, appareil photo natif | tests, Android à confirmer |
| Mineurs | Fiche sans compte avant 15 ans, responsable légal avec accord par e-mail, réservation par le parent, ceintures enfants | tests |
| Engagement | Classement sur consentement, ceinture et barrettes, actualités, Web Push (annonces, rappel 1 h avant le cours) | tests, push vérifié sur un Android |
| Exploitation | VPS OVH, systemd, release + rollback, purge quotidienne, sauvegarde chiffrée + restauration testée, préflight | `docs/deploy-vps.md`, checklist RGPD |

### 2.2 Ce qui existe mais reste incomplet

- **Rétention** : un seul signal (30 jours sans présence, liste de 8 personnes sur le tableau de bord). Pas d'historique, pas de retour du coach, pas de mesure du retour.
- **Notifications** : la promotion depuis la liste d'attente est envoyée par e-mail seulement. Rien n'est envoyé quand une séance est annulée ou modifiée. Pas de préférences par type.
- **Grades** : seulement la ceinture actuelle, sans historique des passages ni éligibilité.
- **Fiabilité des présences** : une feuille non validée reste ouverte indéfiniment (d'où le chantier (i)). Les présences sont la matière première de tout le reste.
- **Mineurs et parents** : les types de cours n'ont pas de public (adultes ou enfants), donc un parent voit tous les cours (audit UX, priorité P1).
- **Vérification sur appareils réels** : la caméra Android est corrigée mais pas encore validée sur un téléphone ; l'iPhone et la PWA installée n'ont été testés que partiellement.

### 2.3 Documenté ou envisagé seulement

Brief intégré (`PRODUCT_ARCHITECTURE.md` §8, `docs/architecture.md`), vidéothèque, boutique, sites de clubs, statut « en retard » automatique, clôture à minuit, paiements, abonnements (`membership_plans` prévus dans le modèle de 2026-10-13, jamais créés).

### 2.4 Ce qui manque et qui compte

- **Aucune notion d'adhésion** : ni type, ni échéance, ni saison, ni « à jour ». C'est la première question d'un gérant (« qui n'a pas payé ? qui doit renouveler ? »). **[F]** aucune table ni colonne.
- **Aucune notion de prospect ou de cours d'essai**, alors que c'est l'entrée du tunnel de croissance.
- **Aucune supervision externe** : pas d'alerte de disponibilité, pas d'alerte en cas d'échec d'une minuterie (sauvegarde, purge, rappels). Les journaux restent dans journald. **[F]** (`docs/operations.md` le note comme « à faire »).
- **Aucune donnée d'usage produit.** Tu ne sauras pas si le coach ouvre le tableau de bord ou le brief, sauf à lire la base à la main.

### 2.5 À vérifier

- Le pilote est-il **réellement en cours avec des données réelles** ? `PRODUCT.md` dit « un pilote est en cours », mais la checklist RGPD indique le **contrat de sous-traitance (art. 28) non signé**, ce qui est bloquant. Si de vraies données sont déjà en base, c'est le premier sujet à régulariser.
- La caméra sur un Android et un iPhone réels ; la réception réelle du rappel push.
- Le premier résultat CI des projets Playwright `webkit` et `firefox` ; l'alerte Gitleaks sur l'historique.

### 2.6 Maturité

| Axe | Niveau | Commentaire |
|---|---|---|
| Sécurité, isolation | Élevé | Au-dessus de la moyenne des SaaS en phase d'amorçage |
| Fiabilité des données de présence | Moyen | Feuilles non clôturées, appareils réels non validés |
| Exploitation | Moyen | Sauvegardes OK, supervision absente, un seul VPS |
| Adéquation au marché | **Non mesurée** | Zéro entretien, zéro métrique d'usage, zéro paiement |
| Différenciation livrée | Faible | Le différenciateur n'est pas branché |

---

## 3. Problèmes, incohérences et risques de la roadmap actuelle

1. **La roadmap est une liste de souhaits, pas une stratégie.** Vidéothèque (3–6 j plus l'hébergement), boutique (1–2 j), sites de clubs (4–8 j), actualités, push : chaque élément est raisonnable pris seul. Ensemble, ils rapprochent Matnexa d'un clone d'OSS Academy, sans paiements, sans apps natives et sans 2 ans d'avance. Ils ne répondent pas à la question du README : « Est-ce qu'un coach change son comportement une fois par semaine parce qu'un logiciel le lui a demandé ? »
2. **Une contradiction d'ICP non tranchée.** L'ICP v1 était un « propriétaire-coach […] qui **paie déjà un logiciel qu'il ne changera pas** », donc un produit *complémentaire*. L'application actuelle est un produit de *remplacement*. Ce sont deux modèles commerciaux opposés : la vente, l'onboarding, les données et la concurrence diffèrent.
3. **La dépendance aux données est sous-estimée.** Le brief, le classement, les grades et les rapports valent ce que valent les présences. Or la saisie des présences n'est fiable que si l'appel est fait **à chaque cours**. La clôture automatique (i) et l'adoption du pointage sont donc des prérequis du différenciateur, pas des détails.
4. **Deux des six règles du V0 ne peuvent pas fonctionner aujourd'hui.** `NEW_UNSEEN` et `QUIET_RELIABLE` reposent sur « aucune note du coach ». L'application n'a pas de notes, et le scoring de découverte (S2) prévient que les coachs ne notent pas. Il faut un signal de substitution sans saisie (voir l'idée n° 4).
5. **« En retard » automatique (h) : une mauvaise idée telle quelle.** Le statut `late` existe déjà en saisie manuelle. L'automatiser depuis l'heure du scan pénalise ceux qui scannent en fin de cours, crée des litiges si cela compte au classement, et n'aide aucune décision du gérant. Valeur faible, friction réelle.
6. **La vitesse devient un risque d'exploitation.** Plusieurs déploiements par jour, plusieurs sessions en parallèle sur `main`, pas de revue, des tests instables connus. Pendant un pilote, une régression sur l'appel un soir de cours coûte plus cher que n'importe quelle fonctionnalité.
7. **La surface RGPD s'élargit plus vite que la conformité.** Mineurs, photos, classement, push, actualités sont livrés, mais la checklist « avant données réelles » n'est pas entièrement cochée : contrat art. 28, AIPD sur les mineurs, revue juridique de la notice.
8. **Il n'y a aucune boucle de mesure.** Ni analytics, ni rapport de valeur, ni journal produit. À la fin du pilote, tu n'auras que des impressions.

---

## 4. Concurrence et opportunités de différenciation

### 4.1 Faits relevés (sites des éditeurs, octobre 2026)

| Acteur | Positionnement | Offre relevée | Prix affiché |
|---|---|---|---|
| **OSS Academy** (FR) | « Moins d'administration, plus de tatami » ; tous sports de combat | 90+ fonctions : paiements Stripe, 14 moyens de paiement, packs, boutique, billetterie, essais réservables sans compte, page club publique, QR, **kiosque tablette**, liste d'attente, comptes enfants et « gérés », licences CFJJB/IBJJF/FFJDA, compétitions, critères de passage de grade, fil d'actualité, push, sondages, 9 langues, apps iOS, Android, Mac et Windows | 30 €/mois ou 300 €/an (offre de lancement), **gratuit sous 25 membres**, 1 mois d'essai, +1,5 % par paiement |
| **MAAT** (maatapp.com) | Gestion BJJ et MMA, réseau d'affiliations (Checkmat, Gracie Barra, SBG cités) | Encaissements automatisés (carte, SEPA, BACS), réservations, présences, **alerte « prêt pour la barrette ou la ceinture »**, classement, **migration gratuite faite par l'équipe** (Gymdesk, Mindbody, Kicksite…), support WhatsApp | 49 $/mois (annuel) ou 59 $/mois, +1 % par transaction, 7 jours d'essai |
| **Fighty** | « Super app » des clubs de combat | Paiements, groupes, messagerie, app membre, « automatisation IA » (non détaillée) | 335 $/an |
| **Gymdesk** (US) | Salles et arts martiaux | **Membres « à risque »** au-delà d'un seuil d'absence, **relances automatiques** (e-mail, SMS) ; pas de modèle prédictif | — |
| HelloAsso / AssoConnect / Comiti (FR) | Associations | Adhésions et paiements (HelloAsso gratuit), gestion associative | 0 € / dès 11 €/mois / dès 19 €/mois |

Sources : [oss-academy.com](https://www.oss-academy.com/en/), [maatapp.com](https://maatapp.com/), [BJJEE sur MAAT](https://www.bjjee.com/articles/maat-the-gym-management-software-connecting-checkmat-gyms-across-europe/), [fighty.com](https://www.fighty.com/), [Gymdesk, member insights](https://gymdesk.com/ja/features/member-insights), [comparatif tool-advisor](https://tool-advisor.fr/logiciel-association/comparatif/association-sportive/). Les affirmations de ces pages sont celles des éditeurs. Je n'ai pas trouvé d'avis indépendants exploitables sur OSS Academy ni sur MAAT : je ne leur attribue donc **aucune faiblesse**.

### 4.2 Lecture **[R]**

- **La gestion est devenue un produit de base.** Le paiement est le point d'accroche qui rend ces logiciels difficiles à quitter : une fois les prélèvements installés, on ne change plus. Sans paiement, Matnexa ne peut pas déloger un club déjà équipé. Il ne faut pas viser ces clubs-là.
- **Personne, dans ce que j'ai trouvé, ne vend un rituel hebdomadaire priorisé et expliqué, avec mesure des retours.** Gymdesk signale les absents et MAAT signale les passages de grade : ce sont des alertes, pas un rituel ni une preuve de valeur. L'espace libre est étroit mais réel : **la qualité de la décision** (5 noms, pourquoi, quoi faire) et **la preuve** (« 3 personnes sont revenues ce mois-ci après ton message »). **[H]** : rien ne garantit que le coach agira. C'est précisément ce que le pilote doit mesurer.
- **La cible accessible tout de suite** : les clubs de 60 à 250 membres **sans logiciel de gestion** (WhatsApp, Excel, papier, HelloAsso pour l'encaissement). Pour eux, Matnexa apporte l'appel en quelques secondes, le pointage et les réservations, puis le brief. Il ne leur demande pas de quitter HelloAsso.
- **La cible de long terme** : les académies commerciales à prélèvement mensuel, où chaque départ fait baisser le revenu mensuel. C'est là que le brief se vend le mieux, y compris **en complément** d'un logiciel existant, à partir de ses exports.

---

## 5. Nouvelles idées, classées par valeur

Seules les idées retenues sont détaillées. Les autres sont en section 6.

### Idée 1 — Le brief hebdomadaire intégré, avec une boucle sans saisie ★★★★★
- **Problème** : le coach ne voit pas qui décroche avant qu'il soit trop tard. **Pour qui** : le coach-gérant.
- **Valeur** : chaque lundi, 5 noms, la raison factuelle de chacun et un bouton pour écrire (WhatsApp prérempli, ou e-mail au responsable pour un mineur), puis la mesure du retour.
- **Différenciation** : forte, par la priorisation, l'explication et la preuve, et non par l'alerte en elle-même.
- **Difficulté** : M à L. Les règles existent ; il faut tests de caractérisation, module, 3 tables, une page, une tâche hebdomadaire.
- **Maintenance** : faible (calcul déterministe, une exécution par semaine et par club).
- **Dépendances** : présences fiables (clôture automatique), téléphone et e-mail des fiches (existants), push vers l'équipe (existant).
- **Risque d'adoption** : élevé. C'est *la* question du projet. On le réduit en supprimant la saisie : **le tap sur « Écrire sur WhatsApp » depuis le brief est enregistré comme « contacté »**, et le retour est constaté automatiquement dans les présences suivantes. Le coach n'a rien à déclarer.
- **Monétisation** : c'est la raison de payer. Le « rapport de valeur » (idée 5) justifie le prix.
- **Validation avant développement** : faire tourner le V0 sur les présences réelles du club pilote dès la 2ᵉ semaine (export CSV de l'application), puis l'envoyer à la main au coach, comme le prévoit `ops/weekly-loop.md`. Si le coach ignore 2 briefs sur 3, ne pas industrialiser.

### Idée 2 — Clôture automatique de l'appel à minuit (ta proposition (i)) ★★★★★
- **Problème** : des feuilles jamais validées, donc des absences non enregistrées, un classement faux et un brief aveugle. **Pour qui** : tout le club, indirectement.
- **Difficulté** : S. Une fonction SQL `app_private.close_due_rolls()` qui reproduit la validation manuelle, appelée par le minuteur existant ; le fuseau du club est déjà en base.
- **Validation** : aucune, c'est de l'hygiène de données. Mesurer la **part des feuilles clôturées automatiquement** : au-delà de 30 %, l'appel n'est pas fait et il faut comprendre pourquoi.

### Idée 3 — Parcours des nouveaux : de l'essai à la 6ᵉ semaine ★★★★
- **Problème** : les 6 premières semaines décident de tout (`RULES.md`) et la conversion essai → adhérent est de l'argent mesurable. **Pour qui** : le gérant, et le nouvel adhérent.
- **Valeur** : un formulaire public « Réserver un cours d'essai » (sans compte, nom, e-mail ou téléphone, consentement) crée une fiche « essai ». Le coach la voit sur la feuille d'appel. À J+1, il reçoit dans le brief « X a fait son essai hier : relance-le ». À J+7 et J+21, il reçoit les règles `NEW_*`.
- **Différenciation** : moyenne. OSS Academy propose l'essai en ligne ; l'intégration au brief est l'originalité.
- **Difficulté** : M (formulaire public avec limitation de débit et anti-abus, statut de fiche, règle de brief, purge des essais non convertis).
- **RGPD** : un prospect n'est pas un adhérent. Conservation courte (3 mois sans conversion, par exemple), information à la collecte.
- **Validation** : demander au club pilote combien d'essais il reçoit par mois et comment il les suit aujourd'hui. Moins de 4 par mois : P3.

### Idée 4 — Remplacer les « notes du coach » par des événements d'un geste ★★★★
- **Problème** : `NEW_UNSEEN` et `QUIET_RELIABLE` exigent de savoir si le coach a fait un retour à l'élève, et personne ne tape de notes au bord du tatami.
- **Valeur** : sur la fiche et dans le brief, un bouton « Je lui ai fait un retour » (horodaté, sans texte). Couplé à l'idée 1, c'est la même table `coach_actions`.
- **Difficulté** : XS une fois l'idée 1 faite. **RGPD** : aucune donnée de santé possible, puisqu'il n'y a pas de texte libre.

### Idée 5 — Rapport de valeur mensuel pour le gérant ★★★★
- **Valeur** : « Ce mois-ci : 9 personnes contactées depuis le brief, 4 revenues dans les 14 jours ; 3 essais, 2 inscrits ; assiduité moyenne +6 % ». C'est l'argument de renouvellement de **ton** abonnement, et il est mesuré, pas promis.
- **Difficulté** : S (requêtes sur `coach_actions` et `attendance`). Envoi par e-mail ou push à l'équipe.
- **Garde-fou** : ne jamais écrire « sauvé grâce à Matnexa ». Écrire « revenu après contact », ce qui est un fait.

### Idée 6 — Adhésion informative (échéance, sans paiement) ★★★
- **Problème** : « qui doit renouveler ? qui n'est pas à jour ? », la première question du gérant. **Valeur** : un type (saison, mensuel, carte de cours) et une date de fin par fiche ; une règle de brief « fin d'adhésion dans 30 jours et assiduité en baisse » ; une liste des renouvellements.
- **Différenciation** : faible seule, forte combinée au brief (« renouvellement à risque »).
- **Difficulté** : M. Import CSV de la colonne, puis éventuellement lecture des adhésions **HelloAsso** par leur API (**[H]** : existence et conditions d'accès de l'API à vérifier, ainsi que le consentement de l'association).
- **Pourquoi pas les paiements** : encaisser expose à la conformité (prestataire de paiement, statut d'agent), aux remboursements, aux litiges et au support, et c'est un terrain où OSS Academy et MAAT ont des années d'avance. Lire l'état d'adhésion donne 80 % de la valeur de pilotage sans ce coût.
- **Validation** : demander au club pilote comment il suit les renouvellements aujourd'hui, puis montrer une maquette.

### Idée 7 — Historique des grades et éligibilité ★★★
- **Valeur** : un historique des passages (date, ceinture, barrettes, par qui) ; « éligible à la barrette » selon le nombre de présences depuis le dernier passage, avec un seuil réglable par le club. Cela motive l'adhérent (« plus que 6 cours ») et prépare les passages du coach. MAAT le met en avant.
- **Difficulté** : S à M (table `rank_promotions`, seuils par club, affichage sur la fiche et sur Mon espace). Intégration au brief : règle positive « à féliciter ou à évaluer », qui rend le brief moins négatif.
- **Validation** : demander au coach pilote comment il décide d'une barrette aujourd'hui. Si la réponse est « au feeling, et je ne veux pas de règle », l'éligibilité doit rester indicative.

### Idée 8 — Mode kiosque (tablette à l'entrée) ★★★
- **Problème** : les adhérents sans téléphone, les enfants, l'iPhone qui redemande la caméra à chaque lancement de la PWA, les files au scan. **Valeur** : une tablette du club affiche les cours en cours, chacun touche sa photo ou son nom, et le coach valide.
- **Difficulté** : S à M. On réutilise la feuille d'appel dans une session « kiosque » limitée à un club et à l'appel, révocable.
- **Sécurité** : la session ne doit donner accès à aucune fiche ni aucun export. Afficher les prénoms et l'initiale du nom seulement.
- **Validation** : observer 2 cours au club pilote et compter les présents qui n'ont pas pointé eux-mêmes.

### Idée 9 — Pause déclarée et motif de départ ★★★
- **Pause** : l'adhérent (ou le coach) déclare « vacances » ou « pause jusqu'au… ». Le brief l'ignore jusqu'à la date de reprise puis le signale à son retour. Cela réduit les faux positifs, qui tuent la confiance dans le brief.
- **Motif de départ** : une liste courte à l'archivage (déménagement, horaires, prix, niveau ou ambiance, raison personnelle, inconnu). **Pas de catégorie « blessure » ni « santé »** : ce serait une donnée de santé (art. 9 RGPD). Cela donne la première analyse des départs.
- **Difficulté** : XS à S. **Validation** : aucune nécessaire pour le motif ; pour la pause, vérifier qu'elle est réellement utilisée.

### Idée 10 — Notifications qui réduisent les absences ★★★
- « Votre place est confirmée » (promotion depuis la liste d'attente) et « Séance annulée ou modifiée », en push et en e-mail. Tes rappels « Tout est prêt ? » sont déjà en place.
- **Difficulté** : S, à condition de factoriser l'envoi (section 8.2). **Mesure** : taux de réservations non honorées avant et après.

---

## 6. Idées écartées ou à valider avant tout développement

| Idée | Verdict | Pourquoi | Ce qui la ferait revenir |
|---|---|---|---|
| (h) « En retard » automatique selon l'heure du scan | **À valider, ne pas construire** | Le statut existe en manuel ; l'automatisme crée des litiges et ne sert aucune décision | Le coach pilote le réclame après 4 semaines, avec un usage précis |
| (a) Vidéothèque hébergée | **Rejeté sous cette forme** | Stockage et bande passante sur un seul VPS, droits d'auteur, modération, usage incertain. Une vidéo de technique se regarde sur Instagram ou YouTube | Version simple : des liens (YouTube non répertorié, Vimeo) rattachés à un type de cours ou à une ceinture, effort S, si un coach le demande |
| (b) Boutique de réservation (kimonos, rashguards) | **À valider** | Fréquence d'achat faible, WhatsApp suffit | 2 clubs payants la demandent |
| (e) Sites de clubs sur sous-domaine | **Reporté (P3)**, sauf une page publique minimale | 4 à 8 jours plus le SEO et la maintenance des pages ; ce n'est pas ton métier | La page publique « Planning + Réserver un essai » de l'idée 3 en est le noyau utile |
| Paiements et prélèvements | **Reporté**, à décider sur preuve | Conformité, support, litiges, concurrence frontale avec OSS Academy et MAAT | 3 clubs payants disent qu'ils partiraient sans cela ; même alors, d'abord HelloAsso ou Stripe hébergé, jamais un prestataire de paiement maison |
| Gestion de compétitions | **Rejeté** | Niche, complexe (tableaux, poids), outils fédéraux existants | — |
| Apps natives | **Rejeté** | La PWA suffit ; le seul manque réel (caméra sur iPhone) se contourne avec le kiosque et le QR fixe | Un blocage iOS qui empêche un parcours clé |
| IA conversationnelle sur les données des membres | **Rejeté** | Sous-traitant hors UE, profilage, coût, et aucune valeur démontrée. Des modèles de messages couvrent 90 % du besoin | Reformulation d'un message *déjà choisi*, sans donnée nominative, après une AIPD |
| Score de churn en pourcentage | **Rejeté** (déjà dans le README) | Inexplicable, faux sentiment de précision | — |
| Notes vocales du coach | **Rejeté** sauf preuve | Le scoring S2 de la découverte est la condition, et il n'a pas été mesuré | S2 ≥ 8 sur 15 entretiens |
| Sondages, messagerie interne | **Reporté** | Concurrence directe avec WhatsApp, déjà utilisé par tous | — |
| Licences fédérales (CFJJB, FFJDA) | **À valider** | Utile en France (assurance) mais spécifique ; ne jamais stocker de certificat médical (donnée de santé) | Le club pilote passe un temps réel sur les licences |

---

## 7. Cartographie des interactions

### 7.1 Le socle : une seule chaîne de vérité

```
 Essai (public) ─┐
 Code / lien ────┼─▶ FICHE (people) ──▶ cycle de vie : essai → nouveau (≤ 6 sem.) → actif → en pause → parti (motif)
 Import CSV ─────┘          │
                            ▼
 Planning ─▶ Séance ─▶ Réservation ─▶ Appel / QR / kiosque ─▶ CLÔTURE (manuelle ou à minuit)
                                                                    │
                                     PRÉSENCES FIABLES (attendance) ◀┘
                                                │
       ┌───────────────┬───────────────┬────────┴────────┬──────────────────┐
       ▼               ▼               ▼                 ▼                  ▼
  Classement     Éligibilité      BRIEF hebdo       Rapports, exports   Adhésion (échéance)
  (opt-in)       grade            (règles)                                   │
                                     │ ◀─────────── renouvellement à risque ─┘
                                     ▼
                     ACTIONS DE L'ÉQUIPE (coach_actions) : contacté (tap WhatsApp ou e-mail), retour fait, perdu
                                     │
                                     ▼
                     RETOUR CONSTATÉ (présences suivantes) ─▶ RAPPORT DE VALEUR mensuel
                                     │
                     MOTEUR D'ENVOI (tâches + push + e-mail) : brief du lundi, rappels, place confirmée, annulation
```

### 7.2 Les socles communs à renforcer, plutôt que des modules isolés

| Socle | Aujourd'hui | À faire | Le réutilisent |
|---|---|---|---|
| **Présences fiables** | Appel, QR, validation manuelle | Clôture automatique, heure de scan exposée | Classement, brief, grades, rapports, rapport de valeur |
| **Cycle de vie du membre** | `archived_at`, `joined_on` | `paused_until`, `departure_reason`, statut « essai ». Le statut « nouveau » est **calculé**, jamais stocké | Brief, rapports, purge RGPD |
| **Actions de l'équipe** | Rien (le clic WhatsApp n'est pas tracé) | Table `coach_actions` (qui, sur qui, quoi, d'où, quand) | Brief, retours faits, rapport de valeur, journal |
| **Moteur d'envoi** | 2 tables ad hoc (`booking_notifications`, `session_reminders`), 2 routes de cron, des appels `after()` dispersés | Une file de tâches générique et un seul répartiteur | Brief du lundi, rappels, place confirmée, annulation, rapport mensuel, clôture |

Ce qui reste un **module indépendant**, et pourquoi : la page publique d'essai, qui est hors session, exposée à Internet, et a ses propres règles anti-abus ; le kiosque, qui est un mode de session restreint.

### 7.3 Parcours de bout en bout — le brief (l'intégration la plus importante)

1. **Point d'entrée** : le lundi à 7 h (fuseau du club), un push à l'équipe : « 5 personnes à qui parler cette semaine ». Il ouvre `/a/<id>/brief`. Une carte en tête du tableau de bord affiche aussi « Brief : 2 sur 5 faits ».
2. **Parcours** : 5 cartes. Chacune porte le nom, la photo si autorisée, le motif factuel (« venait 3 fois par semaine, plus rien depuis 12 jours »), une action conseillée, et des boutons « Écrire » (WhatsApp prérempli et modifiable, ou e-mail au responsable si mineur), « Je lui ai parlé », « Pas le temps » et « Il a arrêté » (qui propose l'archivage avec motif). Une annexe affiche « toujours sans nouvelles ».
3. **Données réutilisées** : `attendance`, `sessions`, `people` (téléphone, e-mail, `joined_on`, archivage), `guardianships`, `academy_memberships` (destinataires), `push_subscriptions`.
4. **Données nouvelles** : `brief_runs` (club, semaine, version des règles), `brief_items` (exécution, fiche, règle, faits utiles en JSON borné, rang), `coach_actions`. Toutes avec `academy_id` et une clé composite, comme l'impose `schema-invariants`.
5. **Règles et permissions** : lecture pour le propriétaire, l'admin et le coach ; écriture d'action par l'équipe ; **jamais visible du membre**. Génération par une fonction `app_private` appelée par `app_server` uniquement. Une seule exécution par club et par semaine, garantie par une contrainte d'unicité. Les mineurs sont exclus en v1 (contrat du V0) ou contactés via le responsable légal : à décider.
6. **Interactions** : le clic « Écrire » crée `coach_actions(kind='contacted', source='brief')` ; l'archivage depuis « Il a arrêté » réutilise l'action d'archivage existante avec son motif ; la même fiche propose « Je lui ai fait un retour ».
7. **Automatisations** : la tâche du lundi génère, puis envoie le push ; la tâche du dimanche constate les retours (présence dans les 14 jours suivant le contact) ; la tâche mensuelle produit le rapport de valeur.
8. **Architecture** : un module pur `src/domain/briefing/` (faits et règles, sans entrées-sorties, testé par caractérisation contre `v0/brief.mjs`), un dépôt SQL qui charge 70 jours de présences, une route de tâche. **Aucun** appel à un modèle de langage.
9. **Sécurité et RGPD** : c'est un **profilage** au sens de l'art. 4(4) RGPD (évaluation automatisée du comportement), sans décision produisant des effets juridiques (pas d'art. 22), puisque l'humain décide. Il faut donc l'information dans `/privacy` et dans le modèle d'information des membres, une base légale d'intérêt légitime avec mise en balance documentée, le **droit d'opposition** (art. 21) via une case « ne pas me faire apparaître dans le brief » que le staff respecte, l'inclusion des `brief_items` dans l'**export JSON** de la personne (droit d'accès), et une conservation limitée (12 mois, par exemple, dans la purge existante). **[À faire valider]** par un juriste.
10. **Tests** : caractérisation (fixtures synthétiques, dates figées, changement d'heure, plusieurs séances le même jour, frontières de chaque règle, quotas, anti-fatigue) ; base de données (RLS : un membre ne lit rien, isolation entre clubs, unicité par semaine, export RGPD incluant le brief, opposition respectée) ; e2e (le coach voit le brief, tape « Écrire », l'action est enregistrée ; la semaine suivante, le retour est constaté).

### 7.4 Parcours — clôture à minuit

Entrée : aucune, c'est automatique. Une fois par heure, le minuteur de 5 minutes existant (ou le futur répartiteur) cherche les séances `scheduled` dont la date locale du club est passée et la feuille non validée. Il applique **la même fonction** que la validation manuelle (inscrits non venus = absents), avec `validated_by = null` et un événement d'audit dont l'acteur est « système », de façon idempotente. La feuille d'appel affiche alors « Clôturée automatiquement à minuit » ; un coach ou un admin peut encore corriger (même règle que pour une feuille validée à la main). Tests : fuseau (club à Paris, serveur en UTC), changement d'heure, séance annulée, séance sans inscrit, double exécution.

### 7.5 Parcours — essai vers adhérent

Page publique du club → « Réserver un essai » → fiche `status='trial'` et réservation → visible sur la feuille d'appel avec un badge « Essai » → présence → J+1 dans le brief : « Relance X » → conversion quand il crée son compte avec le code du club (rattachement à la fiche d'essai par e-mail vérifié), sinon purge au bout de 90 jours. Sécurité : limitation par IP **et** par club, pas d'énumération, pas de données de membres affichées sur la page publique.

---

## 8. Architecture et dette technique

### 8.1 Ce qui est sain et doit être gardé
Monolithe modulaire, RLS comme seule autorité, fonctions `SECURITY DEFINER` étroites, invariants testés, migrations additives, une migration par fonctionnalité, PostgreSQL embarqué pour les tests, VPS unique bon marché. **Aucune migration de technologie n'est justifiée.** Ne touche ni à Next.js, ni à Better Auth, ni à PostgreSQL.

### 8.2 Les dettes qui vont coûter cher si on ne les traite pas maintenant

| Dette | Pourquoi maintenant | Proposition | Effort |
|---|---|---|---|
| **Envoi asynchrone éclaté** : une table et une route par usage, `after()` best-effort | 4 à 6 nouveaux envois arrivent (brief, rapport, place confirmée, annulation, clôture, renouvellement) | Table `jobs` (type, club, identifiants seulement, `run_after`, tentatives, verrou à échéance, `done_at`) ; une seule route `/api/cron/tick` toutes les 5 minutes, avec `SKIP LOCKED` (le modèle existe déjà dans `booking_notifications`) ; préférences de notification par type et par utilisateur | M |
| **Aucune supervision** | Un pilote réel commence | Sonde externe gratuite sur `/api/health` ; `OnFailure=` sur les services systemd vers un e-mail ; ping « dead man's switch » pour la sauvegarde et la purge. Données envoyées : aucune donnée personnelle | S |
| **Aucune mesure d'usage** | Sans elle, le pilote ne prouve rien | Table `usage_events` minimale côté serveur (club, rôle, événement : `brief_opened`, `roll_validated`, `checkin_qr`…), **sans identifiant de personne**, conservation 13 mois, sans outil tiers | S |
| **Rythme de livraison** | Une régression un soir de cours coûte un club | Pendant le pilote : une livraison par semaine hors horaires de cours, un test rapide écrit (connexion, appel, scan, réservation), un retour arrière documenté (il existe), une branche de livraison | XS (discipline) |
| **Tests instables et propres à Windows** ; compteurs de migrations codés en dur dans 3 tests | Du bruit qui pousse à ignorer les échecs | Corriger `catalog-delete`, calculer le nombre de migrations depuis le dossier | S |
| `src/domain/validation.ts` contient un octet NUL | Les outils le voient comme binaire, donc pas de recherche ni d'édition fiable | Le nettoyer | XS |
| Sessions d'un an pour l'équipe | Les comptes de l'équipe voient des données de mineurs | Sessions plus courtes ou réauthentification pour exports et effacements ; MFA facultative pour propriétaire et admin (déjà dans la checklist) | S |
| Modèle : types de cours sans public | Parents et mineurs | `class_types.audience` (adultes, enfants, tous) et filtrage | S |

### 8.3 Fiabilité du QR et des présences
Le modèle est bon : réservation obligatoire, jeton haché, fenêtre réglable, idempotence. Les risques restants sont **physiques** (caméra iPhone en PWA, lumière, réseau) et **organisationnels** (feuilles non clôturées). D'où la clôture automatique, le kiosque, et la mesure de la part de pointage autonome.

### 8.4 Mobile et réseau moyen
Pas de cache de données authentifiées : c'est un bon choix de sécurité, mais il faut un réseau. Mesurer le temps d'ouverture de la feuille d'appel en 4G dégradée (limitation dans Chrome) avant d'optimiser quoi que ce soit.

### 8.5 Sauvegardes et restauration
C'est fait et testé. Il reste un risque assumé : le secret de session dans la sauvegarde OVH. Pour le pilote, documenter la durée d'interruption acceptable : une restauration sur un VPS neuf, combien de temps ?

---

## 9. Scénarios stratégiques

| | **A — Lancement pragmatique** | **B — Plateforme complète** | **C — Différenciation par la fidélisation** (recommandé) | **D — Brief seul, en complément** |
|---|---|---|---|---|
| Proposition | « L'appel et les réservations les plus simples du tatami » | « Tout votre club dans une app » | « L'appel en quelques secondes, et chaque lundi les 5 personnes à qui parler, avec la preuve de qui est revenu » | « Gardez votre logiciel, nous vous disons à qui parler » |
| Essentiel | L'existant + clôture + fiabilisation | + paiements, boutique, vidéos, sites, compétitions, apps | L'existant + clôture + brief + rapport de valeur, puis essai, adhésion, grades | Import CSV ou export → brief → rapport |
| Cible | Clubs sans logiciel | Tous les clubs | Clubs de 60 à 250 membres sans logiciel (FR), puis académies commerciales | Académies déjà équipées (OSS, MAAT, Gymdesk) |
| Avantage | Rapide | Aucun, à parité au mieux | La décision et la preuve | Aucune migration demandée au client |
| Délai | 1–2 semaines | 6–12 mois et plus | 3–4 semaines pour la v1 du pilote, puis par incréments | Quasi immédiat (le V0 existe) |
| Risques | Indifférencié face à une offre gratuite sous 25 membres ; guerre des prix | Épuisement, conformité des paiements, rattrapage perpétuel | Le coach n'agit pas (hypothèse centrale) ; douleur faible dans les associations | Exports manuels fragiles, dépendance aux formats des autres, faible rétention |
| Modèle | 15–20 €/mois | 30–60 €/mois + commission | ~29 €/mois forfait club, palier supérieur seulement si le rapport prouve des retours | 15–29 €/mois |
| Effet sur l'existant | Garde tout | Le socle convient, mais la feuille de route explose | Garde tout, ajoute 4 tables, gèle le reste | Réutilise le module brief extrait (C étape 1) |
| Confirmé si | 3 clubs paient à J+60 | — | Brief ouvert 3 semaines sur 4, ≥ 1,5 action par brief, ≥ 25 % de retours, 1 paiement à J+45 | 3 clubs envoient leur export 4 semaines de suite |
| Invalidé si | Les clubs comparent à OSS et partent | — | Brief ignoré 2 semaines sur 3 malgré zéro saisie | Exports irréguliers |

**Recommandation : C, avec D en parallèle pour presque rien.** Le module brief extrait pour C sert aussi à D. Pendant que le club pilote utilise l'application, propose le brief par WhatsApp à 2 ou 3 clubs déjà équipés, à partir de leur export, exactement comme le prévoit `ops/pilot-offer.md`. Tu testes ainsi la même hypothèse sur deux populations : clubs sans logiciel et clubs équipés. Les résultats décideront entre « remplaçant » et « complément ».

---

## 10. Roadmap recommandée

### P0 — Indispensable avant ou au démarrage du pilote (≈ 1 semaine)

| # | Initiative | Résultat attendu | Effort | Critère d'acceptation | Mesure |
|---|---|---|---|---|---|
| P0.1 | **Régulariser le pilote** : contrat art. 28 signé, information des membres, mineurs exclus du pilote **ou** AIPD courte faite | Droit de traiter des données réelles | XS (admin) | Checklist « Bloquant » entièrement cochée | — |
| P0.2 | **Clôture automatique à minuit** (i) | Plus aucune feuille ouverte la veille | S | Idempotente, fuseau du club, audit « système », correction possible | Part des feuilles clôturées automatiquement < 30 % en semaine 3 |
| P0.3 | **Validation sur appareils réels** : Android, iPhone, PWA installée, push | L'appel et le scan marchent sur les téléphones du club | XS–S | Procédures `docs/qr-checkin.md` et `docs/pwa.md` cochées | Taux de pointages réussis |
| P0.4 | **Supervision minimale** et **mesure d'usage** | Savoir si le service tombe, et ce qui est utilisé | S + S | Alerte reçue sur une panne simulée ; événements visibles par club | — |
| P0.5 | **Discipline de livraison pendant le pilote**, CI verte (exception Gitleaks), tests instables corrigés | Aucune régression un soir de cours | S | CI verte 5 jours de suite | Incidents pendant le pilote = 0 |

### P1 — Valeur directe pour le pilote et les premiers clients (semaines 1 à 5 du pilote)

| # | Initiative | Effort | Dépendances | Critère d'acceptation | Mesure de réussite |
|---|---|---|---|---|---|
| P1.0 | **Brief manuel** (V0 sur l'export réel, envoyé à la main) dès la semaine 2 | XS | P0.2 | 1 brief par semaine envoyé | Le coach répond ou agit 2 semaines sur 3 → feu vert pour P1.2 |
| P1.1 | **File de tâches unique et préférences de notification** | M | — | Les envois existants migrés sans régression ; tests de reprise et de verrou | — |
| P1.2 | **Brief intégré v1** + boucle sans saisie (idées 1 et 4) | L | P0.2, P1.1 | Section 7.3 entièrement satisfaite, y compris l'export RGPD et l'opposition | Ouvert ≥ 3 semaines sur 4 ; ≥ 1,5 contact par brief ; ≥ 25 % de retours dans les 14 jours |
| P1.3 | **Rapport de valeur mensuel** (idée 5) | S | P1.2 | Chiffres recalculables à la main depuis la base | Le gérant le cite spontanément |
| P1.4 | **Place confirmée** et **séance annulée** en push (idée 10) | S | P1.1 | Push et e-mail, texte neutre sur l'écran verrouillé | Absences non prévenues en baisse |
| P1.5 | **Motif de départ** à l'archivage, **pause déclarée** (idée 9) | S | — | Pas de catégorie santé ; pause respectée par le brief | Faux positifs du brief < 1 sur 5 |
| P1.6 | Petits correctifs : ceinture modifiable par l'admin, liste d'attente à l'effacement, public des types de cours si mineurs | S | — | Tests existants verts | — |
| P1.7 | **Facturation de ton client** : lien de paiement Stripe ou facture et virement, **hors application** | XS | — | — | 1 paiement à J+45 |

### P2 — Différenciation (après le GO du pilote)

Dans cet ordre : **parcours des nouveaux et page d'essai** (idée 3, M) → **adhésion informative** et renouvellements, avec étude de l'API HelloAsso (idée 6, M) → **historique des grades et éligibilité** (idée 7, S–M) → **kiosque** (idée 8, S–M) → dernière actualité sur Mon espace (XS) → anglais (i18n) si les tests du scénario D montrent une traction anglophone (L).

### P3 — Long terme
Page publique enrichie, puis site du club ; ressources pédagogiques par liens ; affiliations et multi-sites (le modèle de MAAT) ; paiement via un tiers, sur preuve ; reformulation des messages par IA, après AIPD ; ouverture à d'autres sports de combat.

### Ordre et dépendances

```
P0.1 ─┐
P0.2 ─┼─▶ P1.0 (brief manuel) ──GO──▶ P1.2 brief intégré ─▶ P1.3 rapport ─▶ décision tarifaire (sem. 4–6)
P0.3 ─┤          P1.1 file de tâches ─┘        │
P0.4 ─┘                                        └─▶ P2 : essai → adhésion → grades → kiosque
P1.4, P1.5, P1.6 en parallèle, au fil des petites fenêtres
```

### À tester auprès des utilisateurs **avant** d'écrire du code
1. Le brief manuel (P1.0) : agit-il ?
2. Les essais : volume mensuel et suivi actuel.
3. Les renouvellements : comment, quand, avec quel outil ; HelloAsso ou non.
4. Les passages de grade : règle explicite ou ressenti du coach.
5. Le prix : demander un paiement réel, pas une opinion (semaine 3 ou 4).
6. Mener **5 entretiens hors pilote** avec le script `discovery/03-interview-script.md`, même tardivement. Ils coûtent 5 heures et protègent des mois de travail.

---

## 11. Plan d'intégration dans le code existant

### 11.1 Modules existants et nouveaux

| Module (existant) | Fichiers principaux | Ce qui change |
|---|---|---|
| Présences | `repositories/attendance.ts`, `actions/checkin.ts`, migration `…0300` | Fonction de clôture partagée (manuelle et automatique) |
| Tableau de bord | `repositories/dashboard.ts`, `dashboard/page.tsx` | La carte « à recontacter » devient « Brief de la semaine » ; `listInactiveMembers` est conservé en repli tant qu'aucun brief n'existe |
| Membres | `repositories/members.ts`, `members/[personId]` | Motif de départ, pause, bouton « Je lui ai fait un retour », historique des actions |
| Envois | `server/push.ts`, `session-reminders.ts`, `booking-notifications.ts`, `api/cron/*` | Absorbés par `server/jobs/` et `/api/cron/tick` ; les tables existantes migrent par une migration de compatibilité |
| RGPD | `app_private.export_*`, `erase_person`, purge | Inclure `brief_items` et `coach_actions` ; effacement en cascade ; durée de conservation |
| **Nouveau** `src/domain/briefing/` | faits, règles, sélection, rendu de texte | Pur, testé ; `v0/brief.mjs` devient un client CLI de ce module, ou reste figé comme référence de caractérisation |
| **Nouveau** `repositories/brief.ts`, `actions/brief.ts`, `a/[academyId]/brief/page.tsx` | — | — |

### 11.2 Migrations prévues (additives, une par fonctionnalité)
1. `…roll_auto_close` : fonction de clôture, audit « système », droits `app_server`.
2. `…jobs` : `jobs`, `notification_preferences` ; reprise des files existantes.
3. `…usage_events`.
4. `…brief` : `brief_runs`, `brief_items`, `coach_actions`, `people.brief_opt_out` ; RLS équipe seulement ; fonctions `app_private.generate_brief(academy, week)`, `record_coach_action`.
5. `…member_lifecycle` : `people.paused_until`, `people.departure_reason` (liste fermée).
6. P2 : `…trials`, `…memberships_info`, `…rank_promotions`, `…class_type_audience`.

À chaque fois : mettre à jour `schema-invariants` (tables du club, droits de suppression) et les tests de comptage des migrations, à rendre dynamiques au passage.

### 11.3 Interface
- Équipe : une entrée « Brief » dans la navigation (onglet mobile à la place de « Rapports », qui est un usage de bureau) ; une carte sur le tableau de bord ; un badge « Essai » et « Clôturée automatiquement » sur la feuille d'appel.
- Membre : rien de nouveau en P1, hormis « Pause » sur Mon espace et la case d'opposition au brief dans le profil (ou dans la notice, selon l'avis juridique).

### 11.4 Non-régression
Suite e2e existante (appel, QR tournant et fixe, réservations, mineurs, push) ; ajout de `brief.spec.ts`, `roll-close.test.ts` (base de données, fuseaux), `jobs.test.ts` (verrou, reprise, idempotence) ; caractérisation `briefing.test.ts` comparée au V0 sur `v0/data/demo-academy.csv` et `weird-export.csv`.

### 11.5 Documentation
`PRODUCT.md` (positionnement mis à jour, brief branché), `docs/brief.md` (nouveau : règles, données, RGPD), `docs/rgpd/registre.md` et `cartographie.md` (profilage, conservation), `/privacy`, `docs/push.md` (file de tâches), README (fin de la contradiction entre « on ne construit pas » et l'état réel : réécrire la section « Contexte produit »).

### 11.6 Avant chaque mise en production pendant le pilote
CI verte ; préflight ; test rapide sur le téléphone (connexion, appel, scan, réservation) ; migration testée sur une copie de la base de production restaurée ; livraison hors horaires de cours ; retour arrière prêt.

---

## 12. Indicateurs de réussite

| Niveau | Indicateur | Seuil |
|---|---|---|
| Données | Feuilles validées le jour même (hors clôture automatique) | ≥ 70 % en semaine 3 |
| Données | Pointages autonomes (QR ou kiosque) / présents | ≥ 60 % en semaine 4 |
| Adoption | Membres actifs avec un compte | ≥ 50 % |
| **Brief** | Semaines où le brief est ouvert | **≥ 3 sur 4** |
| **Brief** | Contacts par brief | **≥ 1,5** |
| **Brief** | Retours constatés dans les 14 jours / contactés | **≥ 25 %** |
| Brief | Faux positifs signalés | < 1 par brief |
| Commercial | Paiement du club pilote | Avant J+45 |
| Commercial | Clubs payants | 3 à J+90, 0 départ à M+3 |
| Qualité | Incidents en soirée de cours | 0 |

**Règle d'arrêt, écrite maintenant :** si après 4 semaines de brief avec boucle sans saisie, le coach n'a contacté personne 2 semaines sur 3, le brief n'est pas le produit. Repositionne alors Matnexa sur le scénario A, avec un prix bas et la simplicité comme argument, ou arrête d'investir du temps.

---

## 13. Questions ouvertes et décisions qui t'appartiennent

1. **Le pilote utilise-t-il déjà des données réelles ?** Si oui, le contrat art. 28 devient urgent.
2. **Remplaçant ou complément ?** Je recommande de laisser le pilote et le scénario D trancher, mais il faut l'accepter explicitement.
3. **Marché** : associations françaises (douleur au renouvellement, prix sensible) ou académies commerciales, éventuellement anglophones (douleur mensuelle) ? Ton README penchait pour les secondes.
4. **Gel** : acceptes-tu de geler vidéothèque, boutique, sites et « en retard » automatique jusqu'au GO du pilote ?
5. **Mineurs dans le brief** : exclus en v1 (recommandé) ou contactés via le responsable légal ?
6. **Paiements** : est-ce un « jamais nous-mêmes » assumé ? Je recommande oui, avec la lecture des adhésions HelloAsso en premier.
7. **Prix** : 29 €/mois forfait club, gratuit ou non sous un seuil ? OSS est gratuit sous 25 membres : ne rivalise pas sur ce segment.
8. **Ton temps** : combien d'heures par semaine pendant le pilote ? Le rituel du fondateur (`ops/weekly-loop.md`) en demande 40 minutes, à garder.
9. **Entretiens** : en as-tu mené hors du dépôt ? Sinon, 5 entretiens cette semaine valent plus qu'une fonctionnalité.

---

## Réponse à la question finale

**Si je reprenais Matnexa aujourd'hui :**

- **Je garderais tout le code.** Il est bon, sûr et déployé. Je n'y toucherais pas pour le plaisir.
- **Je changerais d'objectif.** Plus de « plateforme de référence », mais « le club qui ne perd plus ses adhérents sans le voir ». Chaque ligne de code des 6 prochaines semaines doit servir une seule question : le coach agit-il sur le brief, et des gens reviennent-ils ?
- **J'ajouterais** : la clôture automatique (tu l'avais vue juste), le brief intégré avec une boucle **sans saisie** (le tap WhatsApp vaut action, le retour est constaté dans les présences), le rapport de valeur, la pause et le motif de départ, une file de tâches unique, la supervision et la mesure d'usage. Ensuite, sur preuve : le parcours essai → adhérent, l'échéance d'adhésion (via HelloAsso si possible), l'historique des grades et le kiosque.
- **J'abandonnerais ou je gèlerais** : la vidéothèque hébergée, la boutique, les sites de clubs, le « en retard » automatique, les paiements, les compétitions, les apps natives et toute IA décisionnelle.
- **J'organiserais** : 1 semaine de P0 (contrat, clôture, appareils réels, supervision) ; le brief manuel dès la 2ᵉ semaine de pilote pour vérifier qu'il sert ; l'industrialisation seulement si c'est le cas ; une demande de paiement réelle en semaine 4 ; en parallèle, le même brief envoyé à 2 ou 3 clubs déjà équipés pour tester le complément ; à J+45, une décision écrite selon les seuils de la section 12.

C'est moins excitant que la feuille de route actuelle. Mais c'est la seule version où, dans deux mois, tu sauras si tu as une entreprise, au lieu d'avoir un logiciel de plus.
