import { afterAll, describe, expect, it } from "vitest";
import { adminSql, closeAll } from "./support";

/**
 * Invariants de sécurité du schéma, vérifiés sur la base réellement migrée.
 * Si une future migration ajoute une table ou une fonction sans durcissement, ces tests échouent.
 */
afterAll(closeAll);

describe("invariants du schéma", () => {
  it("toute table de public et app_private a la RLS activée", async () => {
    const rows = await adminSql()<{ nspname: string; relname: string }[]>`
      select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and n.nspname in ('public', 'app_private') and not c.relrowsecurity`;
    expect(rows).toEqual([]);
  });

  it("anon n'a aucun privilège sur les tables, vues et séquences de public/app_private", async () => {
    const rows = await adminSql()<{ table_name: string; privilege_type: string }[]>`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee in ('anon', 'PUBLIC') and table_schema in ('public', 'app_private', 'auth')`;
    expect(rows).toEqual([]);
  });

  it("authenticated n'a aucun DELETE/TRUNCATE/REFERENCES/TRIGGER direct hors tables prévues", async () => {
    const rows = await adminSql()<{ table_name: string; privilege_type: string }[]>`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public'
        and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')`;
    expect(rows).toEqual([]);
    const deletes = await adminSql()<{ table_name: string }[]>`
      select table_name from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'DELETE' order by table_name`;
    expect(deletes.map((r) => r.table_name)).toEqual(["attendance", "club_posts", "invitations", "push_subscriptions", "sessions"]);
  });

  it("app_server, authenticated et anon n'ont aucun accès direct à app_private (tables)", async () => {
    const rows = await adminSql()<{ grantee: string; table_name: string }[]>`
      select grantee, table_name from information_schema.role_table_grants
      where table_schema = 'app_private' and grantee in ('app_server', 'authenticated', 'anon')`;
    expect(rows).toEqual([]);
  });

  it("app_server n'hérite d'aucun privilège (NOINHERIT) et ne peut pas lire les tables", async () => {
    const [role] = await adminSql()<{ rolinherit: boolean; rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolinherit, rolsuper, rolbypassrls from pg_roles where rolname = 'app_server'`;
    expect(role).toEqual({ rolinherit: false, rolsuper: false, rolbypassrls: false });
  });

  it("aucune fonction de public n'est exécutable par anon ou PUBLIC", async () => {
    const rows = await adminSql()<{ proname: string }[]>`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app_private')
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))`;
    // Aucune fonction ne doit rester ouverte, sauf celles d'extensions éventuelles (aucune attendue ici).
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it("toute fonction SECURITY DEFINER fixe un search_path vide", async () => {
    const rows = await adminSql()<{ proname: string; proconfig: string[] | null }[]>`
      select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app_private') and p.prosecdef`;
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) {
      expect(r.proconfig ?? [], r.proname).toContain('search_path=""');
    }
  });

  it("les fonctions exposées à authenticated sont exactement la liste attendue", async () => {
    const rows = await adminSql()<{ proname: string }[]>`
      select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`;
    expect(rows.map((r) => r.proname)).toEqual([
      "accept_invitation", "admin_club_features", "admin_club_subscription", "admin_club_suspension", "admin_counters", "admin_job_runs", "admin_list_clubs", "admin_overview", "admin_set_club_feature", "admin_set_club_subscription", "admin_set_club_suspension", "admin_usage_series", "attendance_ranking", "book_for_child", "book_session", "cancel_booking", "cancel_child_booking", "checkin_book_and_redeem", "checkin_close", "checkin_fixed_peek", "checkin_fixed_redeem", "checkin_issue_token", "checkin_open", "checkin_peek", "checkin_redeem", "child_sessions",
      "claim_academy_request", "clear_member_pause", "clear_my_pause", "create_invitation", "create_minor_member", "decide_academy_request", "delete_academy", "delete_class_type", "delete_discipline", "delete_my_account", "ensure_my_member_record", "erase_person",
      "export_my_data", "export_person_data", "invite_minor_account", "join_academy_with_code", "list_academy_requests", "my_approved_academy_request", "my_children", "my_suspended_academies", "preview_join_code", "promote_booking", "record_event", "record_promotion", "regenerate_checkin_key", "regenerate_join_code", "remove_academy_logo", "remove_member", "remove_person_photo", "renew_guardian_consent", "roll_set_validated", "session_bookings_overview", "set_academy_logo", "set_belt_since", "set_checkin_settings", "set_child_ranking_visibility", "set_member_pause", "set_member_role", "set_my_pause", "set_my_photo", "set_my_ranking_visibility", "update_guardian", "update_my_profile", "withdraw_guardian_consent",
    ]);
  });

  it("les tables tenant portent academy_id et une clé unique (id, academy_id) pour les FK composites", async () => {
    const tenantTables = ["people", "disciplines", "class_types", "sessions", "attendance", "invitations", "session_bookings", "booking_notifications", "session_reminders", "guardianships", "rank_promotions"];
    for (const t of tenantTables) {
      const cols = await adminSql()`select 1 from information_schema.columns where table_schema = 'public' and table_name = ${t} and column_name = 'academy_id' and is_nullable = 'NO'`;
      expect(cols, `${t}.academy_id`).toHaveLength(1);
    }
    const fks = await adminSql()<{ conname: string; table_name: string }[]>`
      select c.conname, c.conrelid::regclass::text as table_name from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and c.confrelid in ('public.people'::regclass, 'public.sessions'::regclass, 'public.class_types'::regclass, 'public.disciplines'::regclass)
        and array_length(c.conkey, 1) = 1`;
    // Toute FK vers une table tenant doit être composite (id, academy_id).
    expect(fks).toEqual([]);
  });

  it("les migrations n'embarquent aucun secret évident", async () => {
    const { migrationFiles } = await import("../support/embedded-db.mjs");
    for (const m of migrationFiles()) {
      expect(m.sql, m.name).not.toMatch(/password\s+'[^']+'/i);
      expect(m.sql, m.name).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    }
  });
});
