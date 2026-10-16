import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, adminSql, asUser, buildWorld, closeAll, createAcademy, createUser, failing } from "./support";

/** Journalisation de l'export « Éligibles au grade suivant » (migration 001100) : ouverte à l'équipe, compteurs seulement. */
beforeAll(async () => {
  await buildWorld();
});
afterAll(closeAll);

describe("record_event('promotions.exported')", () => {
  it("l'équipe (coach compris) journalise l'export ; un adhérent, non ; seuls des compteurs sont gardés", async () => {
    const owner = await createUser("pe-owner");
    const academy = await createAcademy(owner, "Club export éligibles");
    const coach = await createUser("pe-coach");
    await addMember(academy, coach, "coach");
    const member = await createUser("pe-member");
    await addMember(academy, member, "member");

    await asUser(coach, (tx) => tx`select public.record_event(${academy}, 'promotions.exported', ${tx.json({ rows: 7, nom: "Secret" })})`);
    const [audit] = await adminSql()<{ metadata: Record<string, unknown> }[]>`select metadata from public.audit_events where academy_id = ${academy} and action = 'promotions.exported'`;
    expect(audit!.metadata).toEqual({ rows: 7 });
    expect((await failing(() => asUser(member, (tx) => tx`select public.record_event(${academy}, 'promotions.exported', '{}'::jsonb)`))).code).toBe("42501");
  });

  it("les autres exports restent réservés aux administrateurs (un coach est refusé)", async () => {
    const owner = await createUser("pe2-owner");
    const academy = await createAcademy(owner, "Club exports admin");
    const coach = await createUser("pe2-coach");
    await addMember(academy, coach, "coach");
    for (const action of ["members.exported", "attendance.exported", "members.imported"]) {
      expect((await failing(() => asUser(coach, (tx) => tx`select public.record_event(${academy}, ${action}, '{}'::jsonb)`))).code).toBe("42501");
      await asUser(owner, (tx) => tx`select public.record_event(${academy}, ${action}, '{}'::jsonb)`);
    }
    expect((await failing(() => asUser(owner, (tx) => tx`select public.record_event(${academy}, 'members.hacked', '{}'::jsonb)`))).message).toContain("coachos:invalid_action");
  });
});
