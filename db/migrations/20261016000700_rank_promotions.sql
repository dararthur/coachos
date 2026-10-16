-- Coach OS — historique des passages de ceinture (roadmap P1, idée 7).
--
-- Chaque changement de ceinture ou de barrettes d'une fiche est enregistré (date, grade, qui). L'équipe peut :
--   * enregistrer un passage à une date choisie (record_promotion) ;
--   * confirmer ou corriger la date à laquelle la personne a reçu sa ceinture actuelle (set_belt_since).
-- L'application en tire une date d'éligibilité INDICATIVE d'après les minimums de l'IBJJF (src/domain/graduation.ts).
--
-- CONFIDENTIALITÉ : l'historique n'est lisible que par le staff du club (propriétaire, administrateur, coach). La date d'éligibilité n'est
-- stockée nulle part : elle est calculée par l'application, pour le staff, à partir de cet historique. L'adhérent n'a aucun accès à la table ;
-- il retrouve ses propres passages dans l'export de ses données (droit d'accès).
--
-- Une date posée automatiquement (changement fait par l'adhérent dans « Mon profil », fiche créée avec une ceinture) vaut « aujourd'hui » et
-- n'est PAS confirmée : elle ne sert pas au calcul tant que l'équipe ne l'a pas confirmée.
-- Effacement : suppression de la fiche = suppression en cascade ; anonymisation = suppression de l'historique.

create table public.rank_promotions (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete cascade,
  person_id uuid not null,
  belt text not null check (belt in (
    'white', 'blue', 'purple', 'brown', 'black',
    'grey_white', 'grey', 'grey_black', 'yellow_white', 'yellow', 'yellow_black',
    'orange_white', 'orange', 'orange_black', 'green_white', 'green', 'green_black')),
  stripes smallint not null default 0 check (stripes between 0 and 4),
  promoted_on date not null check (promoted_on >= date '1990-01-01'),
  date_confirmed boolean not null default false,
  source text not null check (source in ('staff', 'member')),
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, academy_id),
  foreign key (person_id, academy_id) references public.people (id, academy_id) on delete cascade
);
create index rank_promotions_person_idx on public.rank_promotions (person_id, promoted_on, created_at);

alter table public.rank_promotions enable row level security;
alter table public.rank_promotions force row level security;
create policy rank_promotions_select on public.rank_promotions for select to authenticated
  using (app_private.is_staff(academy_id));
-- Aucune politique d'écriture : tout passe par les fonctions ci-dessous.
revoke all on public.rank_promotions from anon, authenticated;
grant select on public.rank_promotions to authenticated;

-- ---------------------------------------------------------------------------
-- Journalisation automatique de tout changement de grade
-- ---------------------------------------------------------------------------
create function app_private.people_log_promotion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_forced text := nullif(current_setting('coachos.promotion', true), '');
  v_today date;
  v_actor uuid := (select auth.uid());
begin
  if new.belt is null then
    return new;
  end if;
  select (now() at time zone a.timezone)::date into v_today from public.academies a where a.id = new.academy_id;
  insert into public.rank_promotions (academy_id, person_id, belt, stripes, promoted_on, date_confirmed, source, recorded_by)
  values (
    new.academy_id, new.id, new.belt, new.belt_stripes,
    coalesce(v_forced::date, v_today),
    v_forced is not null,
    case when v_actor is not null and v_actor = new.user_id and v_forced is null then 'member' else 'staff' end,
    v_actor
  );
  return new;
end
$$;
revoke all on function app_private.people_log_promotion() from public;

create trigger people_log_promotion_insert after insert on public.people
  for each row when (new.belt is not null) execute function app_private.people_log_promotion();
create trigger people_log_promotion_update after update of belt, belt_stripes on public.people
  for each row when (new.belt is not null and (old.belt is distinct from new.belt or old.belt_stripes is distinct from new.belt_stripes))
  execute function app_private.people_log_promotion();

-- Anonymisation : l'historique est effacé avec le reste du profil.
create function app_private.people_drop_promotions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.rank_promotions where person_id = new.id;
  return new;
end
$$;
revoke all on function app_private.people_drop_promotions() from public;
create trigger people_drop_promotions after update of anonymized_at on public.people
  for each row when (new.anonymized_at is not null and old.anonymized_at is null) execute function app_private.people_drop_promotions();

-- ---------------------------------------------------------------------------
-- Staff : enregistrer un passage, confirmer la date de la ceinture actuelle
-- ---------------------------------------------------------------------------
create function public.record_promotion(p_person uuid, p_belt text, p_stripes integer, p_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_person public.people%rowtype;
  v_today date;
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select * into v_person from public.people where id = p_person;
  if v_person.id is null or not app_private.is_staff(v_person.academy_id) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if v_person.archived_at is not null or v_person.anonymized_at is not null then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  select (now() at time zone a.timezone)::date into v_today from public.academies a where a.id = v_person.academy_id;
  if p_belt is null or p_stripes is null or p_stripes not between 0 and 4 or p_on is null or p_on > v_today or p_on < date '1990-01-01' then
    raise exception 'coachos:invalid_promotion' using errcode = 'P0001';
  end if;
  if p_belt is not distinct from v_person.belt and p_stripes = v_person.belt_stripes then
    raise exception 'coachos:invalid_promotion' using errcode = 'P0001';
  end if;
  -- La date choisie est transmise au déclencheur de journalisation, dans cette transaction seulement.
  perform set_config('coachos.promotion', p_on::text, true);
  update public.people set belt = p_belt, belt_stripes = p_stripes where id = p_person;
  perform set_config('coachos.promotion', '', true);
  perform app_private.write_audit(v_person.academy_id, (select auth.uid()), 'member.promoted', 'person', p_person,
    jsonb_build_object('belt', p_belt, 'stripes', p_stripes));
end
$$;

create function public.set_belt_since(p_person uuid, p_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_person public.people%rowtype;
  v_today date;
  v_group text;
  v_start uuid;
  v_start_rn bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select * into v_person from public.people where id = p_person;
  if v_person.id is null or not app_private.is_staff(v_person.academy_id) or v_person.belt is null
     or v_person.archived_at is not null or v_person.anonymized_at is not null then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  select (now() at time zone a.timezone)::date into v_today from public.academies a where a.id = v_person.academy_id;
  if p_on is null or p_on > v_today or p_on < date '1990-01-01' then
    raise exception 'coachos:invalid_promotion' using errcode = 'P0001';
  end if;
  v_group := regexp_replace(v_person.belt, '_(white|black)$', '');

  -- Première ligne de la série actuelle (même couleur, jusqu'à la dernière ligne).
  with ordered as (
    select id, belt, promoted_on, row_number() over (order by promoted_on, created_at, id) as rn
    from public.rank_promotions where person_id = p_person
  ), last_break as (
    select coalesce(max(rn), 0) as b from ordered where regexp_replace(belt, '_(white|black)$', '') <> v_group
  ), total as (select coalesce(max(rn), 0) as n from ordered)
  select o.id, o.rn into v_start, v_start_rn from ordered o, last_break, total
  where o.rn = last_break.b + 1 and o.rn <= total.n;

  if v_start is null then
    insert into public.rank_promotions (academy_id, person_id, belt, stripes, promoted_on, date_confirmed, source, recorded_by)
    values (v_person.academy_id, p_person, v_person.belt, v_person.belt_stripes, p_on, true, 'staff', (select auth.uid()));
  else
    -- La date ne peut pas dépasser celle d'un changement de barrette enregistré après elle.
    if exists (
      select 1 from public.rank_promotions r
      where r.person_id = p_person and r.id <> v_start and r.promoted_on < p_on
        and r.created_at >= (select created_at from public.rank_promotions where id = v_start)
    ) then
      raise exception 'coachos:invalid_promotion' using errcode = 'P0001';
    end if;
    update public.rank_promotions set promoted_on = p_on, date_confirmed = true, source = 'staff', recorded_by = (select auth.uid())
    where id = v_start;
  end if;
  perform app_private.write_audit(v_person.academy_id, (select auth.uid()), 'member.grade_date_set', 'person', p_person, '{}'::jsonb);
end
$$;

revoke all on function public.record_promotion(uuid, text, integer, date), public.set_belt_since(uuid, date) from public, anon;
grant execute on function public.record_promotion(uuid, text, integer, date), public.set_belt_since(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Droit d'accès : l'historique des passages rejoint les exports (fiche et compte)
-- ---------------------------------------------------------------------------
create or replace function public.export_person_data(p_person uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_base jsonb := app_private.export_person_data_base(p_person);
begin
  return v_base
    || jsonb_build_object('pause_and_departure', (
      select jsonb_build_object('paused_until', p.paused_until, 'pause_reason', p.pause_reason, 'pause_declared_by', p.pause_set_by,
                                'pause_consent_at', p.pause_consent_at, 'departure_reason', p.departure_reason)
      from public.people p where p.id = p_person))
    || jsonb_build_object('grade_history', coalesce((
      select jsonb_agg(jsonb_build_object('belt', r.belt, 'stripes', r.stripes, 'date', r.promoted_on, 'date_confirmed', r.date_confirmed, 'recorded_by', r.source)
                       order by r.promoted_on, r.created_at)
      from public.rank_promotions r where r.person_id = p_person), '[]'::jsonb));
end
$$;

create or replace function public.export_my_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_base jsonb := app_private.export_my_data_base();
begin
  return v_base
    || jsonb_build_object('pauses', coalesce((
      select jsonb_agg(jsonb_build_object('academy', a.name, 'paused_until', p.paused_until, 'pause_reason', p.pause_reason,
                                          'pause_declared_by', p.pause_set_by, 'pause_consent_at', p.pause_consent_at))
      from public.people p join public.academies a on a.id = p.academy_id
      where p.user_id = (select auth.uid()) and p.paused_until is not null), '[]'::jsonb))
    || jsonb_build_object('grade_history', coalesce((
      select jsonb_agg(jsonb_build_object('academy', a.name, 'belt', r.belt, 'stripes', r.stripes, 'date', r.promoted_on,
                                          'date_confirmed', r.date_confirmed, 'recorded_by', r.source) order by r.promoted_on, r.created_at)
      from public.people p join public.academies a on a.id = p.academy_id
      join public.rank_promotions r on r.person_id = p.id
      where p.user_id = (select auth.uid())), '[]'::jsonb));
end
$$;
