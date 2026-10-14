import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as ranking from "@/server/repositories/ranking";
import { addMember, adminSql, asUser, buildWorld, closeAll, createAcademy, createPerson, createSession, createUser, failing, type World } from "./support";

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
afterAll(closeAll);

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();
const range = () => ({ from: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10), to: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) });

async function visit(academy: string, person: string, offsetDays: number, status: "present" | "late" | "absent" = "present") {
  const s = await createSession(academy, { startsAt: day(offsetDays) });
  await adminSql()`insert into public.attendance (academy_id, session_id, person_id, status) values (${academy}, ${s}, ${person}, ${status})`;
}

describe("classement d'assiduité", () => {
  it("le staff voit tout le monde ; un membre voit son rang réel mais seulement les membres consentants", async () => {
    const academy = await createAcademy(await createUser("rk-owner"), "Club classement");
    const coach = await createUser("rk-coach");
    const me = await createUser("rk-me");
    await addMember(academy, coach, "coach");
    await addMember(academy, me, "member");
    const meP = await createPerson(academy, "Moi", "Meme");
    await adminSql()`update public.people set user_id = ${me.id} where id = ${meP}`;
    const star = await createPerson(academy, "Star", "Visible");
    const shy = await createPerson(academy, "Timide", "Cache");
    await adminSql()`update public.people set ranking_opt_in = true where id = ${star}`;
    // Star : 3 venues, Timide : 2 (dont un retard), Moi : 1 ; une absence et une venue hors période ne comptent pas
    for (const d of [-1, -2, -3]) await visit(academy, star, d);
    await visit(academy, shy, -1);
    await visit(academy, shy, -2, "late");
    await visit(academy, shy, -3, "absent");
    await visit(academy, meP, -1);
    await visit(academy, star, -40);
    const { from, to } = range();

    const asCoach = await asUser(coach, (tx) => ranking.attendanceRanking(tx, academy, from, to));
    expect(asCoach.map((r) => [r.firstName, r.visits, r.rank])).toEqual([["Star", 3, 1], ["Timide", 2, 2], ["Moi", 1, 3]]);

    const asMe = await asUser(me, (tx) => ranking.attendanceRanking(tx, academy, from, to));
    // Timide n'a pas consenti : absente de la liste, mais le rang de « Moi » (3e sur 3) reste exact
    expect(asMe.map((r) => r.firstName)).toEqual(["Star", "Moi"]);
    expect(asMe.find((r) => r.isMe)).toMatchObject({ rank: 3, rankedTotal: 3, visits: 1 });
    expect(JSON.stringify(asMe)).not.toMatch(/Timide|Cache/);
  });

  it("chaque ligne porte grade, silhouette et photo ; seules les lignes déjà visibles sont concernées", async () => {
    const academy = await createAcademy(await createUser("rk3-owner"), "Club profils");
    const me = await createUser("rk3-me");
    await addMember(academy, me, "member");
    const meP = await createPerson(academy, "Moi", "Profil");
    await adminSql()`update public.people set user_id = ${me.id}, belt = 'purple', belt_stripes = 3, avatar_style = 'woman' where id = ${meP}`;
    const star = await createPerson(academy, "Star", "Profil");
    await adminSql()`update public.people set ranking_opt_in = true, belt = 'black', belt_stripes = 1 where id = ${star}`;
    const shy = await createPerson(academy, "Timide", "Profil");
    await adminSql()`update public.people set belt = 'brown' where id = ${shy}`;
    await adminSql()`insert into public.person_photos (person_id, academy_id, content_type, data) values (${star}, ${academy}, 'image/webp', ${Buffer.from([1, 2, 3])})`;
    for (const p of [meP, star, shy]) await visit(academy, p, -1);
    const { from, to } = range();
    const rows = await asUser(me, (tx) => ranking.attendanceRanking(tx, academy, from, to));
    expect(rows.map((r) => [r.firstName, r.belt, r.beltStripes, r.avatarStyle, r.hasPhoto])).toEqual([
      ["Moi", "purple", 3, "woman", false],
      ["Star", "black", 1, "neutral", true],
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/Timide|brown/);
  });

  it("un membre sans venue voit sa ligne (rang nul) ; période invalide et autre club refusés", async () => {
    const owner = await createUser("rk2-owner");
    const academy = await createAcademy(owner, "Club vide");
    const me = await createUser("rk2-me");
    await addMember(academy, me, "member");
    const meP = await createPerson(academy, "Zero", "Venue");
    await adminSql()`update public.people set user_id = ${me.id} where id = ${meP}`;
    const { from, to } = range();
    const rows = await asUser(me, (tx) => ranking.attendanceRanking(tx, academy, from, to));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isMe: true, visits: 0, rank: null });

    expect((await failing(() => asUser(me, (tx) => ranking.attendanceRanking(tx, academy, to, from)))).message).toMatch(/invalid_period/);
    // un utilisateur d'un autre club n'obtient rien (même réponse qu'un club inexistant)
    expect((await failing(() => asUser(w.bob, (tx) => ranking.attendanceRanking(tx, academy, from, to)))).message).toMatch(/not_found/);
  });

  it("le consentement : modifiable par le membre pour sa seule fiche, jamais directement, effacé à l'anonymisation", async () => {
    const owner = await createUser("rk3-owner");
    const academy = await createAcademy(owner, "Club consentement");
    const me = await createUser("rk3-me");
    await addMember(academy, me, "member");
    const meP = await createPerson(academy, "Con", "Sentant");
    await adminSql()`update public.people set user_id = ${me.id} where id = ${meP}`;

    expect(await asUser(me, (tx) => ranking.myRankingVisibility(tx, academy))).toBe(false);
    await asUser(me, (tx) => ranking.setMyRankingVisibility(tx, academy, true));
    expect(await asUser(me, (tx) => ranking.myRankingVisibility(tx, academy))).toBe(true);
    // aucun privilège direct sur la colonne
    expect((await failing(() => asUser(me, (tx) => tx`update public.people set ranking_opt_in = false where id = ${meP}`))).code).toBe("42501");
    // le propriétaire, sans fiche liée, n'a pas de choix à faire
    expect((await failing(() => asUser(owner, (tx) => ranking.setMyRankingVisibility(tx, academy, true)))).message).toMatch(/not_found/);

    await asUser(owner, (tx) => tx`select public.erase_person(${meP}, 'anonymize')`);
    const [p] = await adminSql()<{ ranking_opt_in: boolean }[]>`select ranking_opt_in from public.people where id = ${meP}`;
    expect(p?.ranking_opt_in).toBe(false);
  });
});
