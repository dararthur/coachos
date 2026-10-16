import type { Metadata } from "next";
import Link from "next/link";
import { BackLink, PageHeader } from "@/components/ui/ui";
import { StandaloneFrame } from "@/components/layout/standalone";

export const metadata: Metadata = { title: "Confidentialité" };

/**
 * Notice d'information (art. 13 RGPD). Rédigée sans relecture juridique (docs/rgpd/README.md) : ne jamais la présenter comme validée.
 * Doit rester cohérente avec docs/rgpd/registre.md (même liste de données, mêmes durées) ; mettre à jour la date en bas à chaque changement.
 */
export default function PrivacyPage() {
  return (
    <StandaloneFrame width="xl">
      <PageHeader title="Confidentialité et données personnelles" back={<BackLink href="/">Retour</BackLink>} />
      <div className="max-w-[68ch] space-y-6 text-base leading-7 [&_h2]:mb-1.5 [&_h2]:text-lg [&_h2]:font-bold">
      <section>
        <h2>Responsable du traitement</h2>
        <p>
          Pour les fiches membres, les présences, les réservations et les photos, le <strong>club</strong> auquel vous appartenez est responsable du traitement ; l&apos;éditeur de Matnexa agit comme son sous-traitant (art. 28 RGPD).
          Pour les comptes utilisateurs (connexion) et les demandes de création de club, l&apos;éditeur de Matnexa est responsable du traitement.
        </p>
        <p className="mt-2">
          Éditeur : <strong>Arthur DARON</strong>, à titre personnel. Contact, y compris pour toute question sur vos données : <a href="mailto:contact@matnexa.fr">contact@matnexa.fr</a>.
        </p>
      </section>

      <section>
        <h2>Quelles données, pour quoi faire ?</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Compte</strong> (adresse e-mail, nom affiché, mot de passe haché, sessions de connexion avec le type de navigateur et une empreinte irréversible de l&apos;adresse IP) : se connecter et sécuriser l&apos;accès. Base légale : exécution du contrat (conditions d&apos;utilisation du service).
          </li>
          <li>
            <strong>Fiche membre</strong> (prénom, nom, e-mail et téléphone facultatifs, date d&apos;inscription, identifiant d&apos;origine facultatif, ceinture et barrettes, silhouette d&apos;avatar, attestation de majorité) : gérer les adhérents du club, sur la base légale retenue par celui-ci (en général l&apos;exécution du contrat d&apos;adhésion). Le téléphone permet à l&apos;équipe du club de vous recontacter, notamment via WhatsApp depuis son propre téléphone.
          </li>
          <li>
            <strong>Historique des grades</strong> : chaque changement de ceinture ou de barrette (grade, date, qui l&apos;a saisi) est daté. Visible de l&apos;équipe du club seulement ; vous le recevez dans l&apos;export de vos données. À titre indicatif, le club peut en tirer une date à partir de laquelle vous atteignez les durées et âges minimums de la Fédération internationale de jiu-jitsu brésilien (IBJJF) pour la ceinture suivante : ce calcul n&apos;est jamais montré aux autres membres, n&apos;a aucun effet automatique, et la décision d&apos;un passage reste celle de votre professeur. Base légale : intérêt légitime du club.
          </li>
          <li>
            <strong>Photo de profil</strong> (facultative, ajoutée par vous) : visible de vous et de l&apos;équipe du club, et des autres membres seulement si vous apparaissez dans le classement.
          </li>
          <li>
            <strong>Présences et réservations</strong> (cours, date, statut présent / en retard / absent, inscrit ou en liste d&apos;attente) : organiser les cours et suivre l&apos;assiduité. Le pointage par QR code n&apos;utilise ni géolocalisation ni image : la caméra lit le code dans votre navigateur, sans envoi.
          </li>
          <li>
            <strong>Pauses</strong> (facultatif) : vous pouvez déclarer une pause avec une raison choisie dans une liste (blessure, maladie, horaires, vacances ou déplacement, raison personnelle, autre, ou « ne souhaite pas s&apos;exprimer ») et une date de reprise, sans aucun détail médical. Blessure et maladie sont des <strong>données de santé</strong> : elles ne sont notées qu&apos;avec votre consentement explicite (que vous déclariez vous-même ou que l&apos;équipe du club les note avec votre accord), ne sont visibles que de l&apos;équipe du club et de vous, jamais des autres membres, et sont effacées 30 jours après votre reprise, à l&apos;archivage de votre fiche ou à son anonymisation. Vous pouvez lever votre pause à tout moment depuis « Mon profil ». Pour un mineur, ces deux raisons ne sont jamais enregistrées.
          </li>
          <li>
            <strong>Motif de départ</strong> (facultatif) : quand le club archive une fiche, il peut noter pourquoi la personne est partie, parmi une liste fermée (déménagement, horaires, prix, niveau ou ambiance, raison personnelle, autre, ne souhaite pas s&apos;exprimer, non précisé), sans catégorie de santé ni texte libre. Visible de l&apos;équipe du club seulement, pour comprendre les départs ; conservé avec la fiche archivée, puis sans identité après son anonymisation.
          </li>
          <li>
            <strong>Classement des venues</strong> : vous y voyez toujours votre rang. Les autres membres ne voient votre nom, votre photo, votre ceinture et vos venues que si vous l&apos;acceptez ; vous pouvez retirer cet accord à tout moment depuis « Mon profil ». Base légale : votre consentement.
          </li>
          <li>
            <strong>E-mails</strong> : confirmation d&apos;adresse, réinitialisation de mot de passe, invitation, avis de place confirmée quand vous quittez la liste d&apos;attente, et avis d&apos;annulation d&apos;une séance où vous étiez inscrit.
          </li>
          <li>
            <strong>Notifications</strong> (facultatives, activées appareil par appareil depuis « Mon compte ») : pour vous prévenir d&apos;une actualité du club, d&apos;une séance qui commence dans une heure, d&apos;une séance annulée ou d&apos;une place confirmée en liste d&apos;attente, nous enregistrons une adresse technique de votre appareil fournie par votre navigateur et des clés de chiffrement. Le message (nom du club, titre de l&apos;actualité ou du cours, jamais de motif ni de donnée de santé) transite chiffré par le service de notification de votre navigateur (Google, Apple, Mozilla ou Microsoft) qui n&apos;en connaît pas le contenu. Base légale : votre consentement, retirable en désactivant les notifications.
          </li>
          <li>
            <strong>Actualités du club</strong> (titre, texte, auteur) : informer les membres. Rédigées par l&apos;équipe du club, lisibles par ses seuls membres connectés.
          </li>
          <li>
            <strong>Demande de création de club</strong> (nom du club, votre nom, votre e-mail, message facultatif) : étudier la demande.
          </li>
          <li>
            <strong>Statistiques d&apos;activité du club</strong> (par exemple : un pointage par QR, une réservation, une feuille d&apos;appel validée ou clôturée automatiquement) : un simple compteur daté par club, <strong>sans aucun lien avec une personne</strong>. Il montre aux administrateurs du club si l&apos;outil est utilisé, et permet à l&apos;éditeur de le maintenir. Base légale : intérêt légitime.
          </li>
          <li>
            <strong>Journal d&apos;audit</strong> (qui a fait quelle action administrative, sans contenu personnel) : sécurité et traçabilité.
          </li>
          <li>
            <strong>Compteurs anti-abus</strong> (empreintes irréversibles d&apos;adresse IP/e-mail) : limiter les tentatives répétées.
          </li>
        </ul>
        <p className="mt-2">Hors la raison d&apos;une pause décrite ci-dessus, Matnexa ne collecte <strong>aucune donnée de santé</strong> : ni certificat médical, ni détail de blessure, ni zone du corps. Aucun traceur publicitaire ni outil de mesure d&apos;audience.</p>
        <p className="mt-2">
          <strong>Mineurs.</strong> Le club peut inscrire un membre mineur. Un mineur n&apos;a pas de compte propre avant 15 ans (dès 15 ans, un compte facultatif est possible sur invitation de son responsable) : le club enregistre sa <strong>date de naissance</strong> (effacée à sa majorité) et son <strong>responsable légal</strong> (nom, e-mail, téléphone facultatif). Le responsable reçoit un lien pour confirmer son accord ; la date de cet accord est conservée. Les messages du club lui sont adressés, jamais à l&apos;enfant. Le classement et la photo sont désactivés ; seul le responsable peut activer le classement. Il peut retirer son accord à tout moment depuis « Mon compte » (s&apos;il a rattaché un compte) ou auprès du club : la fiche est alors archivée et la photo supprimée. Cette date sert aussi à vérifier l&apos;accès aux cours réservés aux adultes, à partir d&apos;un âge minimum fixé par le club. Les membres majeurs ne fournissent pas de date de naissance.
        </p>
      </section>

      <section>
        <h2>Données obligatoires ou facultatives</h2>
        <p>
          Pour créer un compte, l&apos;adresse e-mail, un nom affiché et un mot de passe sont nécessaires : sans eux, le compte ne peut pas être créé. Pour une fiche membre, le prénom et le nom sont nécessaires ; l&apos;e-mail, le téléphone, la photo et l&apos;identifiant d&apos;origine sont facultatifs, et l&apos;apparition dans le classement relève de votre seul choix. Sans e-mail ni compte, vous restez membre du club mais ne pouvez pas réserver ni consulter votre espace en ligne. Pour un mineur, le nom et l&apos;e-mail du responsable légal sont nécessaires : sans eux, la fiche ne peut pas être créée.
        </p>
        <p className="mt-2">
          Vos données viennent de vous, de votre club (qui crée ou importe votre fiche) et, pour les présences, de l&apos;équipe qui fait l&apos;appel ou de votre propre pointage.
        </p>
      </section>

      <section>
        <h2>Décisions automatisées et profilage</h2>
        <p>
          Matnexa ne prend aucune décision automatisée produisant des effets juridiques ou vous affectant de manière significative, et ne fait aucun profilage. Le classement est un simple comptage de venues, et la liste d&apos;attente suit l&apos;ordre d&apos;arrivée des réservations : quand une place se libère, la première personne en attente la reçoit automatiquement. Si une feuille d&apos;appel n&apos;a pas été validée, elle est clôturée automatiquement après minuit (au plus tard trois jours après la séance) et les inscrits non pointés sont notés absents ; l&apos;équipe peut corriger toute présence à tout moment. Une pause déclarée sert uniquement à ne pas vous signaler comme absent prolongé ; elle n&apos;a aucune autre conséquence.
        </p>
      </section>

      <section>
        <h2>Cookies et stockage sur votre appareil</h2>
        <p>
          Matnexa ne dépose rien chez un visiteur non connecté. Une fois connecté : un <strong>cookie de session</strong> pour rester connecté (renouvelé à l&apos;usage, expire après un an sans utilisation) ; pour l&apos;équipe d&apos;un club qui choisit l&apos;affichage « membre », un cookie qui mémorise ce choix (un an) ; si vous fermez le bandeau d&apos;installation de l&apos;application, ce choix est mémorisé dans votre navigateur. Ces éléments sont strictement nécessaires au service ou mémorisent un choix que vous avez fait : ils ne demandent pas de consentement et aucun bandeau cookies n&apos;est affiché.
        </p>
        <p>
          <strong>Notifications (facultatives).</strong> Si vous les activez depuis « Mon compte », votre appareil est enregistré (une adresse technique fournie par votre navigateur et des clés de chiffrement, sans lien avec votre identité autre que votre compte). Les annonces de vos clubs, les séances annulées et les places confirmées vous sont alors envoyées chiffrées via le service de notification de votre navigateur (Google, Mozilla, Apple ou Microsoft selon l&apos;appareil), qui ne voit passer qu&apos;un message qu&apos;il ne peut pas lire. Vous pouvez les désactiver à tout moment ; elles sont supprimées avec votre compte.
        </p>
      </section>

      <section>
        <h2>Durées de conservation</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Fiche membre : tant que vous êtes membre actif ; une fois archivée, anonymisée automatiquement après le délai fixé par le club (24 mois par défaut). Les présences sont alors conservées sans identité, à des fins statistiques.</li>
          <li>Pause : jusqu&apos;à ce que vous la leviez, et au plus tard 30 jours après la date de reprise ; effacée aussi à l&apos;archivage ou à l&apos;anonymisation de la fiche. Motif de départ : avec la fiche archivée, puis sans identité après anonymisation.</li>
          <li>Historique des grades : avec votre fiche ; effacé à son anonymisation.</li>
          <li>Photo : jusqu&apos;à ce que vous la retiriez, ou à l&apos;anonymisation de la fiche ou à la suppression de votre compte.</li>
          <li>Compte : jusqu&apos;à sa suppression. Une session de connexion expire après un an sans utilisation.</li>
          <li>Invitations : 30 jours après expiration ou acceptation. Demandes de création de club : 90 jours (180 jours au plus).</li>
          <li>Appareils de notification : jusqu&apos;à ce que vous les désactiviez, qu&apos;ils expirent ou que vous supprimiez votre compte.</li>
          <li>Actualités : jusqu&apos;à leur suppression par le club. Si leur auteur supprime son compte, elles restent au club sans son nom.</li>
          <li>Journal d&apos;audit : 24 mois. Statistiques d&apos;activité du club : 13 mois. Compteurs anti-abus : moins de 24 heures.</li>
          <li>Sauvegardes : une sauvegarde chiffrée par jour, conservée 7 jours, et une sauvegarde quotidienne du serveur par l&apos;hébergeur, conservée 7 jours. Une donnée effacée disparaît donc des sauvegardes au plus tard une semaine après.</li>
        </ul>
      </section>

      <section>
        <h2>Vos droits</h2>
        <p>Vous disposez des droits suivants sur vos données personnelles :</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><strong>Droit d&apos;accès</strong> (art. 15 RGPD) : obtenir une copie de vos données.</li>
          <li><strong>Droit de rectification</strong> (art. 16) : faire corriger des données inexactes.</li>
          <li><strong>Droit à l&apos;effacement</strong> (art. 17) : demander la suppression de vos données.</li>
          <li><strong>Droit à la limitation</strong> (art. 18) : demander le gel de l&apos;utilisation de vos données.</li>
          <li><strong>Droit à la portabilité</strong> (art. 20) : recevoir vos données dans un format structuré (téléchargement en JSON depuis « Mon compte »).</li>
          <li><strong>Droit d&apos;opposition</strong> (art. 21) : vous opposer à un traitement fondé sur l&apos;intérêt légitime.</li>
          <li><strong>Retrait du consentement</strong> (art. 7 §3) : à tout moment, par exemple pour le classement, sans effet sur ce qui a eu lieu avant.</li>
        </ul>
        <p className="mt-2">
          Depuis <Link href="/account">Mon compte</Link>, vous pouvez télécharger vos données et supprimer votre compte : votre photo et votre présence dans le classement disparaissent alors aussi. Votre fiche membre relève de votre club : adressez-vous à ses responsables, qui disposent d&apos;outils d&apos;export, de rectification et d&apos;effacement. Pour votre compte, écrivez à <a href="mailto:contact@matnexa.fr">contact@matnexa.fr</a> : réponse sous un mois (prolongeable de deux mois si la demande est complexe, avec information de votre part). Pour un mineur, ces droits sont exercés par son responsable légal, depuis « Mes enfants » ou auprès du club. Si un responsable supprime son compte, ses coordonnées de responsable restent sur la fiche de l&apos;enfant tant que l&apos;enfant est membre (le club en a besoin pour le joindre) : pour les faire effacer, retirez votre accord, ce qui archive la fiche. Vous pouvez aussi introduire une réclamation auprès de la CNIL (<a href="https://www.cnil.fr/fr/plaintes">cnil.fr/fr/plaintes</a>).
        </p>
      </section>

      <section>
        <h2>Contact et délégué à la protection des données</h2>
        <p>
          Aucun délégué à la protection des données (DPO) n&apos;est désigné : ce n&apos;est pas obligatoire pour ce traitement (art. 37 RGPD). Pour toute question ou demande concernant vos données : <a href="mailto:contact@matnexa.fr">contact@matnexa.fr</a>.
        </p>
      </section>

      <section>
        <h2>Hébergement et sous-traitants</h2>
        <p>
          L&apos;application, sa base de données et l&apos;authentification sont auto-hébergées sur un serveur loué à OVHcloud, situé en France (centre de données de Gravelines). Les e-mails sont envoyés par Resend depuis sa région d&apos;envoi en Irlande ; les métadonnées et journaux de ces e-mails sont conservés par ce prestataire aux États-Unis, transfert encadré par les clauses contractuelles types de la Commission européenne et la certification Data Privacy Framework du prestataire. Les notifications passent par le service de notification de votre navigateur (Google, Apple, Mozilla ou Microsoft), qui reçoit un message chiffré et l&apos;adresse technique de votre appareil, aucune autre donnée de votre fiche. Aucune donnée personnelle n&apos;est transmise à un fournisseur d&apos;intelligence artificielle.
        </p>
      </section>

      <p className="text-sm text-ink-soft">Dernière mise à jour : 16 octobre 2026.</p>
      </div>
    </StandaloneFrame>
  );
}
