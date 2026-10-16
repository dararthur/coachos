-- Coach OS — pause déclarée et motif de départ (roadmap P1.5).
--
-- PAUSE : un adhérent (ou le staff, pour lui) déclare « pause jusqu'au… » avec une raison d'une liste fermée :
--   injury (blessure), sick (malade), schedule (horaires), travel (vacances ou déplacement), personal, other (autre),
--   undisclosed (ne souhaite pas s'exprimer : la pause existe, sans dire pourquoi).
-- Tant que la date n'est pas passée, l'adhérent n'est plus compté parmi les absents inquiétants (tableau de bord, futur brief).
--
-- DONNÉE DE SANTÉ (RGPD art. 9) : « blessure » et « malade » en sont. Garde-fous, tous appliqués par la base :
--   * jamais pour un mineur (pas de parcours d'accord du responsable légal) : « Autre » ou « Ne souhaite pas s'exprimer » restent possibles ;
--   * consentement explicite obligatoire pour ces deux raisons (case cochée, horodatée dans pause_consent_at), que l'adhérent
--     déclare lui-même ou que le staff note ce que l'adhérent lui a dit ;
--   * AUCUN détail libre : ni zone du corps, ni diagnostic, ni durée médicale — seulement la catégorie et une date de reprise ;
--   * visible du seul staff du club (propriétaire, administrateur, coach) et de l'adhérent lui-même : les colonnes sont dans
--     people, dont la RLS ne montre à un adhérent que sa propre fiche ; aucune fonction destinée aux adhérents ne les renvoie ;
--   * effacement automatique : à l'archivage, à l'anonymisation, et 30 jours après la date de reprise (purge quotidienne) ;
--   * jamais dans le journal d'audit (qui n'enregistre que « une pause a été posée », pas sa raison) ;
--   * incluse dans l'export des données de la personne (droit d'accès).
--
-- MOTIF DE DÉPART : liste fermée choisie à l'archivage, SANS catégorie de santé (déménagement, horaires, prix, niveau ou
-- ambiance, raison personnelle, autre, ne souhaite pas s'exprimer, non précisé). Effacé à la restauration de la fiche.

alter table public.people
  add column paused_until date,
  add column pause_reason text check (pause_reason is null or pause_reason in ('injury', 'sick', 'schedule', 'travel', 'personal', 'other', 'undisclosed')),
  add column pause_consent_at timestamptz,
  add column pause_set_by text check (pause_set_by is null or pause_set_by in ('member', 'staff')),
  add column departure_reason text check (departure_reason is null or departure_reason in ('moved', 'schedule', 'price', 'level_or_vibe', 'personal', 'other', 'undisclosed', 'unknown')),
  add constraint people_pause_consistent check (
    (paused_until is null and pause_reason is null and pause_set_by is null and pause_consent_at is null)
    or (paused_until is not null and pause_reason is not null and pause_set_by is not null)
  ),
  -- Une raison de santé n'existe jamais sans consentement horodaté.
  add constraint people_pause_health_consent check (pause_reason is null or pause_reason not in ('injury', 'sick') or pause_consent_at is not null);

-- Le staff administrateur enregistre le motif en archivant (les autres colonnes passent par les fonctions ci-dessous).
grant update (departure_reason) on public.people to authenticated;

-- ---------------------------------------------------------------------------
-- Cœur commun : valide et pose une pause
-- ---------------------------------------------------------------------------
create function app_private.apply_pause(p_person uuid, p_until date, p_reason text, p_consent boolean, p_by text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_person public.people%rowtype;
  v_today date;
  v_health boolean := p_reason in ('injury', 'sick');
begin
  select * into v_person from public.people where id = p_person;
  if v_person.id is null then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if v_person.archived_at is not null or v_person.anonymized_at is not null then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if p_reason is null or p_reason not in ('injury', 'sick', 'schedule', 'travel', 'personal', 'other', 'undisclosed') then
    raise exception 'coachos:invalid_pause' using errcode = 'P0001';
  end if;
  select (now() at time zone a.timezone)::date into v_today from public.academies a where a.id = v_person.academy_id;
  if p_until is null or p_until < v_today or p_until > v_today + 366 then
    raise exception 'coachos:invalid_pause' using errcode = 'P0001';
  end if;
  -- Mineur : l'accord du responsable légal n'a pas de parcours ici, donc aucune raison de santé (« Autre » ou « Ne souhaite pas s'exprimer »).
  if v_health and v_person.birth_date is not null then
    raise exception 'coachos:pause_health_minor' using errcode = 'P0001';
  end if;
  if v_health and coalesce(p_consent, false) is not true then
    raise exception 'coachos:pause_consent_required' using errcode = 'P0001';
  end if;
  update public.people
  set paused_until = p_until, pause_reason = p_reason, pause_set_by = p_by,
      pause_consent_at = case when v_health then now() end
  where id = p_person;
  -- Le journal ne retient jamais la raison (donnée potentiellement de santé).
  perform app_private.write_audit(v_person.academy_id, (select auth.uid()), 'member.paused', 'person', p_person,
    jsonb_build_object('by', p_by));
end
$$;
revoke all on function app_private.apply_pause(uuid, date, text, boolean, text) from public;

create function app_private.clear_pause(p_person uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_academy uuid;
begin
  update public.people
  set paused_until = null, pause_reason = null, pause_set_by = null, pause_consent_at = null
  where id = p_person and paused_until is not null
  returning academy_id into v_academy;
  if v_academy is not null then
    perform app_private.write_audit(v_academy, (select auth.uid()), 'member.pause_ended', 'person', p_person, '{}'::jsonb);
  end if;
end
$$;
revoke all on function app_private.clear_pause(uuid) from public;

-- ---------------------------------------------------------------------------
-- Staff (propriétaire, administrateur, coach) : pose ou lève la pause d'un adhérent de son club
-- ---------------------------------------------------------------------------
create function public.set_member_pause(p_person uuid, p_until date, p_reason text, p_consent boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_academy uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select academy_id into v_academy from public.people where id = p_person;
  if v_academy is null or not app_private.is_staff(v_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  perform app_private.apply_pause(p_person, p_until, p_reason, p_consent, 'staff');
end
$$;

create function public.clear_member_pause(p_person uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_academy uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select academy_id into v_academy from public.people where id = p_person;
  if v_academy is null or not app_private.is_staff(v_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  perform app_private.clear_pause(p_person);
end
$$;

-- ---------------------------------------------------------------------------
-- Adhérent : pose ou lève SA pause (sa propre fiche, dans un club dont il est membre)
-- ---------------------------------------------------------------------------
create function app_private.my_person_in(p_academy uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_member(p_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  select id into v_id from public.people where academy_id = p_academy and user_id = v_uid;
  if v_id is null then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  return v_id;
end
$$;
revoke all on function app_private.my_person_in(uuid) from public;

create function public.set_my_pause(p_academy uuid, p_until date, p_reason text, p_consent boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.apply_pause(app_private.my_person_in(p_academy), p_until, p_reason, p_consent, 'member');
end
$$;

create function public.clear_my_pause(p_academy uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.clear_pause(app_private.my_person_in(p_academy));
end
$$;

revoke all on function public.set_member_pause(uuid, date, text, boolean), public.clear_member_pause(uuid),
  public.set_my_pause(uuid, date, text, boolean), public.clear_my_pause(uuid) from public, anon;
grant execute on function public.set_member_pause(uuid, date, text, boolean), public.clear_member_pause(uuid),
  public.set_my_pause(uuid, date, text, boolean), public.clear_my_pause(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Effacement : archivage et anonymisation lèvent la pause ; la restauration efface le motif de départ
-- ---------------------------------------------------------------------------
create function app_private.people_lifecycle_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.archived_at is not null and old.archived_at is null) or (new.anonymized_at is not null and old.anonymized_at is null) then
    new.paused_until := null;
    new.pause_reason := null;
    new.pause_set_by := null;
    new.pause_consent_at := null;
  end if;
  if new.archived_at is null and old.archived_at is not null then
    new.departure_reason := null;
  end if;
  return new;
end
$$;
revoke all on function app_private.people_lifecycle_cleanup() from public;
create trigger people_lifecycle_cleanup before update on public.people
  for each row execute function app_private.people_lifecycle_cleanup();

-- Purge quotidienne : une pause terminée depuis plus de 30 jours est effacée (minimisation).
create function app_private.purge_pauses() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  update public.people
  set paused_until = null, pause_reason = null, pause_set_by = null, pause_consent_at = null
  where paused_until is not null and paused_until < current_date - 30;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function app_private.purge_pauses() from public, anon, authenticated;
grant execute on function app_private.purge_pauses() to app_server;

-- ---------------------------------------------------------------------------
-- Droit d'accès : les exports existants sont conservés tels quels (déplacés) et enrichis de la pause
-- ---------------------------------------------------------------------------
alter function public.export_person_data(uuid) set schema app_private;
alter function app_private.export_person_data(uuid) rename to export_person_data_base;
revoke all on function app_private.export_person_data_base(uuid) from public, anon, authenticated;

create function public.export_person_data(p_person uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_base jsonb := app_private.export_person_data_base(p_person);
begin
  return v_base || jsonb_build_object('pause_and_departure', (
    select jsonb_build_object('paused_until', p.paused_until, 'pause_reason', p.pause_reason, 'pause_declared_by', p.pause_set_by,
                              'pause_consent_at', p.pause_consent_at, 'departure_reason', p.departure_reason)
    from public.people p where p.id = p_person
  ));
end
$$;

alter function public.export_my_data() set schema app_private;
alter function app_private.export_my_data() rename to export_my_data_base;
revoke all on function app_private.export_my_data_base() from public, anon, authenticated;

create function public.export_my_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_base jsonb := app_private.export_my_data_base();
begin
  return v_base || jsonb_build_object('pauses', coalesce((
    select jsonb_agg(jsonb_build_object('academy', a.name, 'paused_until', p.paused_until, 'pause_reason', p.pause_reason,
                                        'pause_declared_by', p.pause_set_by, 'pause_consent_at', p.pause_consent_at))
    from public.people p join public.academies a on a.id = p.academy_id
    where p.user_id = (select auth.uid()) and p.paused_until is not null
  ), '[]'::jsonb));
end
$$;

revoke all on function public.export_person_data(uuid), public.export_my_data() from public, anon;
grant execute on function public.export_person_data(uuid), public.export_my_data() to authenticated;
