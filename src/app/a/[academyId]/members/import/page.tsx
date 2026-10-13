import type { Metadata } from "next";
import Link from "next/link";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/domain/csv-import";
import { Card, PageHeader } from "@/components/ui/ui";
import { requireAcademy } from "@/server/auth/guards";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Importer des membres" };

export default async function ImportPage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  await requireAcademy(academyId, "members.import");
  return (
    <>
      <PageHeader title="Importer des membres" description="Importez l'export CSV de votre ancien logiciel. Rien n'est enregistré avant votre confirmation." actions={<Link href={`/a/${academyId}/members`}>← Membres</Link>} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <ImportForm academyId={academyId} />
        <Card title="Format attendu">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
            <li>Fichier CSV UTF-8, {Math.round(MAX_IMPORT_BYTES / 1000)} Ko et {MAX_IMPORT_ROWS} lignes maximum.</li>
            <li>Séparateur virgule, point-virgule ou tabulation détecté automatiquement ; première ligne = en-têtes.</li>
            <li>
              Colonnes reconnues : <code>prénom</code>, <code>nom</code> (obligatoires), <code>email</code>, <code>date_inscription</code> (AAAA-MM-JJ ou JJ/MM/AAAA, jour en premier), <code>id</code> (identifiant d&apos;origine).
            </li>
            <li>Les autres colonnes (téléphone, adresse, date de naissance…) sont <strong>ignorées</strong> : Coach OS ne les conserve pas.</li>
            <li>Les doublons (même e-mail ou même identifiant) sont ignorés, jamais écrasés.</li>
            <li>Chaque ligne invalide est signalée avec sa raison ; rien n&apos;est corrigé en silence.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
