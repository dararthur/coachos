import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/ui";
import { resumeKind, withResume } from "@/domain/resume";
import { safeNext } from "@/server/actions/helpers";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Créer un compte" };

const CONTEXT = {
  join: "Vous allez rejoindre un club. Créez votre compte, confirmez votre e-mail, puis connectez-vous : votre inscription au club se termine alors en un clic.",
  invite: "Vous avez été invité par un club. Créez votre compte avec l'adresse e-mail qui a reçu l'invitation : après la confirmation de cette adresse, vous revenez directement à l'invitation.",
  consent: "Vous êtes le responsable légal d'un enfant inscrit dans un club. Créez votre compte avec l'adresse e-mail qui a reçu le lien d'accord : vous pourrez ensuite suivre ses cours et les réserver.",
} as const;

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const next = safeNext((await searchParams).next, "");
  const kind = resumeKind(next);
  const resume = kind && kind !== "checkin" ? next : null;
  return (
    <>
      <h1 className="mb-1 text-title font-bold font-stretch-[80%]">Créer un compte</h1>
      {kind && kind !== "checkin" ? (
        <Alert tone="info">{CONTEXT[kind]}</Alert>
      ) : (
        <p className="mb-5 text-sm text-ink-soft">Le code de votre club vous est donné par votre coach. Vous avez été invité par e-mail ? Utilisez la même adresse ici.</p>
      )}
      <SignupForm next={resume} askCode={!resume} />
      <p className="mt-5 text-sm">
        Déjà un compte ? <Link href={withResume("/login", next)}>Se connecter</Link>
      </p>
      {!resume && (
        <p className="mt-2 text-xs text-ink-soft">
          Vous dirigez un club ? <Link href="/request-club">Demander la création de votre club</Link>.
        </p>
      )}
    </>
  );
}
