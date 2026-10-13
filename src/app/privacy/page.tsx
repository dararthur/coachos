import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/ui";

export const metadata: Metadata = { title: "Confidentialité" };

/**
 * Notice d'information (art. 13 RGPD) — PROJET À FAIRE VALIDER JURIDIQUEMENT avant tout usage avec de vraies données.
 * Les éléments entre crochets (identité du responsable, DPO, hébergeur) sont à compléter. Voir docs/privacy-gdpr.md.
 */
export default function PrivacyPage() {
  return (
    <main id="contenu" className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] text-sm leading-6">
      <Link href="/">← Retour</Link>
      <h1 className="text-2xl font-semibold tracking-tight">Confidentialité et données personnelles</h1>
      <Alert tone="warning" title="Document de travail">
        Ce texte est un projet de notice d&apos;information. Il doit être complété et validé juridiquement avant l&apos;utilisation de Coach OS avec des données réelles.
      </Alert>

      <section>
        <h2 className="text-lg font-semibold">Qui est responsable de vos données ?</h2>
        <p>
          Pour les fiches membres, le <strong>club</strong> qui vous a inscrit est responsable du traitement ; l&apos;éditeur de Coach OS agit comme son sous-traitant (art. 28 RGPD).
          Pour les comptes utilisateurs (connexion), l&apos;éditeur de Coach OS est responsable du traitement. [Identité et coordonnées de l&apos;éditeur, contact protection des données : à compléter.]
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Quelles données, pour quoi faire ?</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Compte</strong> (adresse e-mail, nom affiché, mot de passe haché par le service d&apos;authentification) : se connecter et sécuriser l&apos;accès. Base légale : exécution du contrat.
          </li>
          <li>
            <strong>Fiche membre</strong> (prénom, nom, e-mail facultatif, date d&apos;inscription, identifiant d&apos;origine facultatif) : gérer les adhérents d&apos;un club. Base légale : intérêt légitime du club / exécution du contrat d&apos;adhésion.
          </li>
          <li>
            <strong>Présences</strong> (séance, statut présent / en retard / absent) : suivre l&apos;assiduité et organiser les cours.
          </li>
          <li>
            <strong>Journal d&apos;audit</strong> (qui a fait quelle action administrative, sans contenu personnel) : sécurité et traçabilité. Conservé 24 mois.
          </li>
          <li>
            <strong>Compteurs anti-abus</strong> (empreintes irréversibles d&apos;adresse IP/e-mail) : limiter les tentatives répétées. Conservés moins de 24 h.
          </li>
        </ul>
        <p className="mt-2">Coach OS ne collecte <strong>aucune donnée de santé, de blessure ou d&apos;état civil sensible</strong>, et n&apos;est ouvert qu&apos;aux <strong>membres majeurs</strong>.</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Combien de temps ?</h2>
        <p>
          Les fiches des membres archivés sont automatiquement anonymisées au bout d&apos;un délai configuré par le club (24 mois par défaut). Les invitations sont supprimées 30 jours après leur
          expiration ou acceptation. À la suppression d&apos;un club ou d&apos;un compte, les données associées sont supprimées.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Vos droits</h2>
        <p>
          Vous pouvez demander l&apos;accès, la rectification, l&apos;effacement, la limitation, la portabilité et vous opposer à un traitement. Depuis <Link href="/account">Mon compte</Link>, vous pouvez
          télécharger vos données et supprimer votre compte. Pour votre fiche membre, adressez-vous aux responsables de votre club, qui disposent d&apos;outils d&apos;export et d&apos;effacement. Vous pouvez aussi saisir la CNIL.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Hébergement et sous-traitants</h2>
        <p>[Hébergeur de l&apos;application, fournisseur de base de données et d&apos;authentification (Supabase), région d&apos;hébergement UE, éventuels transferts hors UE et garanties : à compléter.] Aucune donnée personnelle n&apos;est transmise à un fournisseur d&apos;IA.</p>
      </section>
    </main>
  );
}
