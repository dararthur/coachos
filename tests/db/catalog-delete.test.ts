import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, asUser, buildWorld, closeAll, createAcademy, createSession, createUser, failing } from "./support";

beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const names = async (table: "class_types" | "disciplines", academy: string) =>
  (await adminSql()<{ name: string }[]>`select name from public.${adminSql()(table)} where academy_id = ${academy} order by name`).map((r) => r.name);

async function setup(label: string) {
  const owner = await createUser(`${label}-owner`);
  const academy = await createAcademy(owner, `Club ${label}`);
  const [discipline] = await adminSql()<{ id: string }[]>`insert into public.disciplines (academy_id, name) values (${academy}, 'Luta Livre') returning id`;
  const [unused] = await adminSql()<{ id: string }[]>`insert into public.class_types (academy_id, discipline_id, name, default_duration_minutes) values (${academy}, ${discipline!.id}, 'Cours inutilisé', 60) returning id`;
  return { owner, academy, discipline: discipline!.id, unused: unused!.id };
}

describe("suppression définitive d'un type de cours ou d'une discipline", () => {
  it("un type de cours jamais utilisé est supprimé ; l'action est journalisée", async () => {
    const s = await setup("cd1");
    await asUser(s.owner, (tx) => tx`select public.delete_class_type(${s.academy}, ${s.unused})`);
    expect(await names("class_types", s.academy)).not.toContain("Cours inutilisé");
    const audit = await adminSql()<{ action: string }[]>`select action from public.audit_events where academy_id = ${s.academy} and action = 'catalog.class_type_deleted'`;
    expect(audit).toHaveLength(1);
  });

  it("refusé dès qu'une séance l'utilise (même annulée) : il faut l'archiver ; une fois les séances supprimées, la suppression passe", async () => {
    const s = await setup("cd2");
    const [used] = await adminSql()<{ id: string }[]>`select id from public.class_types where academy_id = ${s.academy} and name like 'JJB%'`;
    const session = await createSession(s.academy, { status: "cancelled" });
    expect((await failing(() => asUser(s.owner, (tx) => tx`select public.delete_class_type(${s.academy}, ${used!.id})`))).message).toContain("coachos:catalog_in_use");
    expect(await names("class_types", s.academy)).toContain("JJB — Tous niveaux");
    await adminSql()`delete from public.sessions where id = ${session}`;
    await asUser(s.owner, (tx) => tx`select public.delete_class_type(${s.academy}, ${used!.id})`);
    expect(await names("class_types", s.academy)).not.toContain("JJB — Tous niveaux");
  });

  it("une discipline emporte ses types de cours inutilisés ; refusée si l'un d'eux a servi", async () => {
    const s = await setup("cd3");
    await adminSql()`insert into public.class_types (academy_id, discipline_id, name, default_duration_minutes) values (${s.academy}, ${s.discipline}, 'Deuxième cours', 45)`;
    await asUser(s.owner, (tx) => tx`select public.delete_discipline(${s.academy}, ${s.discipline})`);
    expect(await names("disciplines", s.academy)).not.toContain("Luta Livre");
    expect(await names("class_types", s.academy)).not.toContain("Deuxième cours");
    const audit = await adminSql()<{ metadata: { class_types: number } }[]>`select metadata from public.audit_events where academy_id = ${s.academy} and action = 'catalog.discipline_deleted'`;
    expect(audit[0]!.metadata.class_types).toBe(2);

    // La discipline de départ porte « JJB — Tous niveaux » : une séance l'utilise, donc tout est refusé et rien n'est supprimé.
    const [jjb] = await adminSql()<{ id: string }[]>`select discipline_id as id from public.class_types where academy_id = ${s.academy} and name like 'JJB%'`;
    await createSession(s.academy);
    expect((await failing(() => asUser(s.owner, (tx) => tx`select public.delete_discipline(${s.academy}, ${jjb!.id})`))).message).toContain("coachos:catalog_in_use");
    expect(await names("class_types", s.academy)).toContain("JJB — Tous niveaux");
  });

  it("réservé aux administrateurs du club ; un autre club ou un identifiant inconnu : introuvable", async () => {
    const s = await setup("cd4");
    const coach = await createUser("cd4-coach");
    await addMember(s.academy, coach, "coach");
    expect((await failing(() => asUser(coach, (tx) => tx`select public.delete_class_type(${s.academy}, ${s.unused})`))).code).toBe("42501");
    expect((await failing(() => asUser(coach, (tx) => tx`select public.delete_discipline(${s.academy}, ${s.discipline})`))).code).toBe("42501");

    const other = await createUser("cd4-other");
    const otherAcademy = await createAcademy(other, "Autre club");
    // Administrateur d'un AUTRE club avec les identifiants du premier : refus, rien n'est supprimé.
    expect((await failing(() => asUser(other, (tx) => tx`select public.delete_class_type(${s.academy}, ${s.unused})`))).code).toBe("42501");
    expect((await failing(() => asUser(other, (tx) => tx`select public.delete_class_type(${otherAcademy}, ${s.unused})`))).message).toContain("coachos:not_found");
    expect(await names("class_types", s.academy)).toContain("Cours inutilisé");

    // Pas d'écriture directe non plus.
    expect((await failing(() => asUser(s.owner, (tx) => tx`delete from public.class_types where id = ${s.unused}`))).message).toMatch(/permission denied/);
  });
});
