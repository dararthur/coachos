import type { Metadata } from "next";
import Link from "next/link";
import { Alert, BackLink, PageHeader } from "@/components/ui/ui";
import { StandaloneFrame } from "@/components/layout/standalone";

export const metadata: Metadata = { title: "Confidentialité" };

/**
 * Notice d'information (art. 13 RGPD) — PROJET À FAIRE VALIDER JURIDIQUEMENT. Doit rester cohérente avec docs/rgpd/registre.md
 * (même liste de données, mêmes durées). Éditeur : personne physique agissant à titre personnel. Les éléments entre crochets sont à compléter.
 */
export default function PrivacyPage() {
  return (
    <StandaloneFrame width="xl">
      <PageHeader title="Confidentialité et données personnelles" back={<BackLink href="/">Retour</BackLink>} />
      <div className="max-w-[68ch] space-y-6 text-base leading-7 [&_h2]:mb-1.5 [&_h2]:text-lg [&_h2]:font-bold">
      <Alert tone="warning" title="Document de travail">
        Ce texte est un projet de notice d&apos;information, non validé juridiquement. Les éléments entre crochets restent à compléter par l&apos;éditeur.
      </Alert>

      <section>
        <h2>Qui est responsable de vos données ?</h2>
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
            <strong>Compte</strong> (adresse e-mail, nom affiché, mot de passe haché, sessions de connexion avec le type de navigateur et une empreinte irréversible de l&apos;adresse IP) : se connecter et sécuriser l&apos;accès. Base légale envisagée : exécution du contrat.
          </li>
          <li>
            <strong>Fiche membre</strong> (prénom, nom, e-mail et téléphone facultatifs, date d&apos;inscription, identifiant d&apos;origine facultatif, ceinture et barrettes, silhouette d&apos;avatar, attestation de majorité) : gérer les adhérents du club. Le téléphone permet à l&apos;équipe du club de vous recontacter, notamment via WhatsApp depuis son propre téléphone.
          </li>
          <li>
            <strong>Photo de profil</strong> (facultative, ajoutée par vous) : visible de vous et de l&apos;équipe du club, et des autres membres seulement si vous apparaissez dans le classement.
          </li>
          <li>
            <strong>Présences et réservations</strong> (cours, date, statut présent / en retard / absent, inscrit ou en liste d&apos;attente) : organiser les cours et suivre l&apos;assiduité. Le pointage par QR code n&apos;utilise ni géolocalisation ni image : la caméra lit le code dans votre navigateur, sans envoi.
          </li>
          <li>
            <strong>Classement des venues</strong> : vous y voyez toujours votre rang. Les autres membres ne voient votre nom, votre photo, votre ceinture et vos venues que si vous l&apos;acceptez ; vous pouvez retirer cet accord à tout moment depuis la page Classement. Base légale : votre consentement.
          </li>
          <li>
            <strong>E-mails</strong> : confirmation d&apos;adresse, réinitialisation de mot de passe, invitation, et avis de place confirmée quand vous quittez la liste d&apos;attente.
          </li>
          <li>
            <strong>Demande de création de club</strong> (nom du club, votre nom, votre e-mail, message facultatif) : étudier la demande.
          </li>
          <li>
            <strong>Journal d&apos;audit</strong> (qui a fait quelle action administrative, sans contenu personnel) : sécurité et traçabilité.
          </li>
          <li>
            <strong>Compteurs anti-abus</strong> (empreintes irréversibles d&apos;adresse IP/e-mail) : limiter les tentatives répétées.
          </li>
        </ul>
        <p className="mt-2">Matnexa ne collecte <strong>aucune donnée de santé, de blessure ni de date de naissance</strong>, et n&apos;est ouvert qu&apos;aux <strong>membres majeurs</strong>. Aucun traceur publicitaire ni outil de mesure d&apos;audience : seuls des cookies de connexion strictement nécessaires sont utilisés.</p>
      </section>

      <section>
        <h2>Combien de temps ?</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Fiche membre : tant que vous êtes membre actif ; une fois archivée, anonymisée automatiquement après le délai fixé par le club (24 mois par défaut). Les présences sont alors conservées sans identité, à des fins statistiques.</li>
          <li>Photo : jusqu&apos;à ce que vous la retiriez, ou à l&apos;anonymisation de la fiche ou à la suppression de votre compte.</li>
          <li>Compte : jusqu&apos;à sa suppression. Une session de connexion expire après un an sans utilisation.</li>
          <li>Invitations : 30 jours après expiration ou acceptation. Demandes de création de club : 90 jours (180 jours au plus).</li>
          <li>Journal d&apos;audit : 24 mois. Compteurs anti-abus : moins de 24 heures.</li>
          <li>Sauvegardes : [durée à compléter] ; les données effacées disparaissent des sauvegardes à leur expiration.</li>
        </ul>
      </section>

      <section>
        <h2>Vos droits</h2>
        <p>
          Vous pouvez demander l&apos;accès, la rectification, l&apos;effacement, la limitation, la portabilité, vous opposer à un traitement et retirer votre consentement à tout moment. Depuis <Link href="/account">Mon compte</Link>, vous pouvez
          télécharger vos données et supprimer votre compte : votre photo et votre présence dans le classement disparaissent alors aussi. Votre fiche membre relève de votre club : adressez-vous à ses responsables, qui disposent d&apos;outils d&apos;export et d&apos;effacement. Pour votre compte, écrivez à <a href="mailto:contact@matnexa.fr">contact@matnexa.fr</a> : réponse sous un mois. Vous pouvez introduire une réclamation auprès de la CNIL (cnil.fr).
        </p>
      </section>

      <section>
        <h2>Hébergement et sous-traitants</h2>
        <p>
          L&apos;application, sa base de données et l&apos;authentification sont auto-hébergées sur un serveur loué à OVHcloud, situé en France (centre de données de Gravelines). Les e-mails sont envoyés par Resend depuis sa région d&apos;envoi en Irlande ; les métadonnées et journaux de ces e-mails sont conservés par ce prestataire aux États-Unis, transfert encadré par les clauses contractuelles types de la Commission européenne et la certification Data Privacy Framework du prestataire. Aucune donnée personnelle n&apos;est transmise à un fournisseur d&apos;intelligence artificielle.
        </p>
      </section>
      </div>
    </StandaloneFrame>
  );
}
