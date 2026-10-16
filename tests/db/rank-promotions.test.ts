import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createUser, failing } from "./support";

/** Historique des passages de ceinture (migration 000700) : journalisation, visibilité réservée au staff, dates confirmées, effacement. */
beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

type Row = { belt: string; stripes: number; promoted_on: string; date_confirmed: boolean; source: string };
const rowsOf = async (person: string) =>
  adminSql()<Row[]>`select belt, stripes, promoted_on::text, date_confirmed, source from public.rank_promotions where person_id = ${person} order by promoted_on, created_at`;

async function club(label: string) {
  const owner = await createUser(`${label}-owner`);
  const academy = await createAcademy(owner, `Club ${label}`);
  const coach = await createUser(`${label}-coach`);
  await addMember(academy, coach, "coach");
  const member = async (name: string) => {
    const user = await createUser(`${label}-${name}`);
    await addMember(academy, user, "member");
    const person = await createPerson(academy, name, "Test");
    await adminSql()`update public.people set user_id = ${user.id} where id = ${person}`;
    return { user, person };
  };
  return { owner, academy, coach, member };
}

describe("journalisation et enregistrement d'un passage", () => {
  it("un coach enregistre un passage à une date choisie : la date est confirmée, la fiche est mise à jour", async () => {
    const c = await club("rp1");
    const m = await c.member("ana");
    await asUser(c.coach, (tx) => tx`select public.record_promotion(${m.person}, 'blue', 0, ${inDays(-400)})`);
    expect(await rowsOf(m.person)).toEqual([{ belt: "blue", stripes: 0, promoted_on: inDays(-400), date_confirmed: true, source: "staff" }]);
    const [p] = await adminSql()<{ belt: string; belt_stripes: number }[]>`select belt, belt_stripes from public.people where id = ${m.person}`;
    expect(p).toEqual({ belt: "blue", belt_stripes: 0 });

    // Une barrette, plus tard : une ligne de plus, la couleur reste la même.
    await asUser(c.coach, (tx) => tx`select public.record_promotion(${m.person}, 'blue', 1, ${inDays(-100)})`);
    expect((await rowsOf(m.person)).map((r) => [r.belt, r.stripes])).toEqual([["blue", 0], ["blue", 1]]);
  });

  it("refuse une date future, un grade inconnu ou inchangé, et une ceinture hors liste", async () => {
    const c = await club("rp2");
    const m = await c.member("bob");
    await asUser(c.coach, (tx) => tx`select public.record_promotion(${m.person}, 'purple', 0, ${inDays(-10)})`);
    for (const [belt, stripes, on] of [["purple", 0, inDays(-1)], ["blue", 0, inDays(2)], ["red", 0, inDays(-1)], ["blue", 9, inDays(-1)], ["blue", 0, "1980-01-01"]] as const) {
      const err = await failing(() => asUser(c.coach, (tx) => tx`select public.record_promotion(${m.person}, ${belt}, ${stripes}, ${on})`));
      expect(err.message, `${belt} ${stripes} ${on}`).toBeTruthy();
    }
    expect(await rowsOf(m.person)).toHaveLength(1);
  });

  it("un changement fait par l'adhérent dans « Mon profil » est journalisé mais NON confirmé", async () => {
    const c = await club("rp3");
    const m = await c.member("cleo");
    await asUser(m.user, (tx) => tx`select public.update_my_profile(${c.academy}, 'Cleo', 'Test', null, 'blue', 2, 'neutral', true)`);
    const rows = await rowsOf(m.person);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ belt: "blue", stripes: 2, date_confirmed: false, source: "member", promoted_on: inDays(0) });
  });

  it("une fiche créée avec une ceinture reçoit une première ligne non confirmée", async () => {
    const c = await club("rp4");
    const [p] = await adminSql()<{ id: string }[]>`insert into public.people (academy_id, first_name, last_name, belt, belt_stripes) values (${c.academy}, 'Dan', 'Test', 'brown', 1) returning id`;
    expect(await rowsOf(p!.id)).toEqual([expect.objectContaining({ belt: "brown", stripes: 1, date_confirmed: false })]);
  });
});

describe("confirmer la date de la ceinture actuelle", () => {
  it("confirme la ligne existante sans en créer, et la crée si l'historique est vide", async () => {
    const c = await club("rp5");
    const m = await c.member("eli");
    await asUser(m.user, (tx) => tx`select public.update_my_profile(${c.academy}, 'Eli', 'Test', null, 'purple', 0, 'neutral', true)`);
    await asUser(c.coach, (tx) => tx`select public.set_belt_since(${m.person}, ${inDays(-500)})`);
    expect(await rowsOf(m.person)).toEqual([{ belt: "purple", stripes: 0, promoted_on: inDays(-500), date_confirmed: true, source: "staff" }]);

    // Historique vide mais une ceinture sur la fiche (ex. données d'avant la fonction) : la ligne est créée, confirmée.
    const [p] = await adminSql()<{ id: string }[]>`insert into public.people (academy_id, first_name, last_name) values (${c.academy}, 'Fay', 'Test') returning id`;
    await adminSql()`update public.people set belt = 'blue', belt_stripes = 1 where id = ${p!.id}`;
    await adminSql()`delete from public.rank_promotions where person_id = ${p!.id}`;
    await asUser(c.coach, (tx) => tx`select public.set_belt_since(${p!.id}, ${inDays(-30)})`);
    expect(await rowsOf(p!.id)).toEqual([expect.objectContaining({ belt: "blue", date_confirmed: true, promoted_on: inDays(-30) })]);
  });

  it("une barrette posée plus tard ne bouge pas, et la date de la couleur ne peut pas la dépasser", async () => {
    const c = await club("rp6");
    const m = await c.member("gus");
    await asUser(c.coach, (tx) => tx`select public.record_promotion(${m.person}, 'blue', 0, ${inDays(-300)})`);
    await asUser(c.coach, (tx) => tx`select public.record_promotion(${m.person}, 'blue', 1, ${inDays(-100)})`);
    await asUser(c.coach, (tx) => tx`select public.set_belt_since(${m.person}, ${inDays(-350)})`);
    expect((await rowsOf(m.person)).map((r) => r.promoted_on)).toEqual([inDays(-350), inDays(-100)]);
    const err = await failing(() => asUser(c.coach, (tx) => tx`select public.set_belt_since(${m.person}, ${inDays(-50)})`));
    expect(err.message).toBeTruthy();
  });

  it("passer à une autre couleur ouvre une nouvelle série : la date de la précédente n'est pas touchée", async () => {
    const c = await club("rp7");
    const m = await c.member("hal");
    await asUser(c.coach, (tx) => tx`select public.record_promotion(${m.person}, 'blue', 0, ${inDays(-900)})`);
    await asUser(c.coach, (tx) => tx`select public.record_promotion(${m.person}, 'purple', 0, ${inDays(-60)})`);
    await asUser(c.coach, (tx) => tx`select public.set_belt_since(${m.person}, ${inDays(-80)})`);
    expect((await rowsOf(m.person)).map((r) => [r.belt, r.promoted_on])).toEqual([["blue", inDays(-900)], ["purple", inDays(-80)]]);
  });
});

describe("qui voit l'historique", () => {
  it("le staff du club le lit ; l'adhérent, un adhérent d'un autre club et un coach d'un autre club n'en lisent rien", async () => {
    const c = await club("rp8");
    const other = await club("rp8b");
    const m = await c.member("ivy");
    await asUser(c.coach, (tx) => tx`select public.record_promotion(${m.person}, 'blue', 0, ${inDays(-10)})`);

    expect(await asUser(c.coach, (tx) => tx`select id from public.rank_promotions`)).toHaveLength(1);
    expect(await asUser(c.owner, (tx) => tx`select id from public.rank_promotions`)).toHaveLength(1);
    expect(await asUser(m.user, (tx) => tx`select id from public.rank_promotions`)).toHaveLength(0);
    expect(await asUser(other.coach, (tx) => tx`select id from public.rank_promotions where person_id = ${m.person}`)).toHaveLength(0);
  });

  it("personne n'écrit directement dans la table ; un adhérent ni un coach d'un autre club n'enregistre de passage", async () => {
    const c = await club("rp9");
    const other = await club("rp9b");
    const m = await c.member("jo");
    const direct = await failing(() => asUser(c.owner, (tx) => tx`insert into public.rank_promotions (academy_id, person_id, belt, promoted_on, source) values (${c.academy}, ${m.person}, 'black', '2020-01-01', 'staff')`));
    expect(direct.message).toBeTruthy();
    for (const who of [m.user, other.coach]) {
      const err = await failing(() => asUser(who, (tx) => tx`select public.record_promotion(${m.person}, 'black', 4, ${inDays(-1)})`));
      expect(err.message).toBeTruthy();
    }
    expect(await rowsOf(m.person)).toHaveLength(0);
  });
});

describe("effacement et droit d'accès", () => {
  it("l'anonymisation efface l'historique ; l'export de la fiche et celui du compte le contiennent avant", async () => {
    const c = await club("rp10");
    const m = await c.member("kai");
    await asUser(c.coach, (tx) => tx`select public.record_promotion(${m.person}, 'blue', 0, ${inDays(-200)})`);

    const [staff] = await asUser(c.owner, (tx) => tx<{ d: { grade_history: { belt: string; date: string; recorded_by: string }[] } }[]>`select public.export_person_data(${m.person}) as d`);
    expect(staff!.d.grade_history).toEqual([expect.objectContaining({ belt: "blue", date: inDays(-200), recorded_by: "staff" })]);
    const [mine] = await asUser(m.user, (tx) => tx<{ d: { grade_history: { belt: string }[]; pauses: unknown[] } }[]>`select public.export_my_data() as d`);
    expect(mine!.d.grade_history).toEqual([expect.objectContaining({ belt: "blue" })]);
    expect(mine!.d.pauses).toEqual([]); // l'export enrichi par les pauses est conservé

    await asUser(c.owner, (tx) => tx`select public.erase_person(${m.person}, 'anonymize')`);
    expect(await rowsOf(m.person)).toHaveLength(0);
  });

  it("l'effacement complet de la fiche supprime l'historique en cascade ; l'archivage le garde", async () => {
    const c = await club("rp11");
    const a = await c.member("lea");
    const b = await c.member("max");
    await asUser(c.coach, (tx) => tx`select public.record_promotion(${a.person}, 'blue', 0, ${inDays(-20)})`);
    await asUser(c.coach, (tx) => tx`select public.record_promotion(${b.person}, 'blue', 0, ${inDays(-20)})`);
    await adminSql()`update public.people set archived_at = now() where id = ${a.person}`;
    expect(await rowsOf(a.person)).toHaveLength(1);
    await asUser(c.owner, (tx) => tx`select public.erase_person(${b.person}, 'delete')`);
    expect(await rowsOf(b.person)).toHaveLength(0);
  });
});
