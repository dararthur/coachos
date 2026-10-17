-- Historique des grades : anciens grades, correction et suppression d'une ligne (demande du 2026-10-17).
--
-- Défauts corrigés : « Enregistrer un passage » changeait TOUJOURS le grade actuel, même pour un grade obtenu il y a des années (renseigner
-- l'historique d'un adhérent le faisait redescendre de ceinture) ; une ligne de l'historique ne pouvait être ni corrigée ni supprimée.
--
-- Modèle : le grade actuel de la fiche (people.belt, belt_stripes) est la ligne la plus RÉCENTE de l'historique (date, puis ordre de saisie).
--   * add_past_grade : ajoute un ancien grade, daté AVANT le grade actuel ; la fiche ne change pas. Si la fiche a un grade sans aucune ligne
--     (fiches antérieures à l'historique), ce grade est d'abord inscrit, daté d'aujourd'hui et « date à confirmer », comme le fait le déclencheur.
--   * update_grade : corrige ceinture, barrettes ou date d'une ligne (la date devient confirmée). Une ligne ancienne reste ancienne et la ligne
--     du grade actuel reste la plus récente (sinon refus : coachos:grade_order) ; corriger la ligne actuelle met la fiche à jour.
--   * delete_grade : supprime une ligne ; si c'était le grade actuel, la fiche reprend le grade précédent (s'il en reste un).
--   * record_promotion (nouveau grade actuel) refuse désormais une date antérieure au dernier grade enregistré (coachos:promotion_before_history).
-- Réservé au staff (propriétaire, administrateur, coach), module « Grades et rapports » actif ; fiche active seulement. Journalisé sans détail.

-- La synchronisation de la fiche depuis l'historique ne doit pas créer une nouvelle ligne.
create or replace function app_private.people_log_promotion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_forced text := nullif(current_setting('coachos.promotion', true), '');
  v_today date;
  v_actor uuid := (select auth.uid());
begin
  if new.belt is null or current_setting('coachos.grade_sync', true) = 'on' then
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

-- Ligne la plus récente (le grade actuel) d'une fiche.
create function app_private.latest_grade(p_person uuid) returns public.rank_promotions
language sql stable security definer set search_path = '' as $$
  select r.* from public.rank_promotions r where r.person_id = p_person
  order by r.promoted_on desc, r.created_at desc, r.id desc limit 1
$$;
revoke all on function app_private.latest_grade(uuid) from public;

-- Fiche alignée sur la ligne la plus récente, sans nouvelle ligne d'historique.
create function app_private.grade_sync(p_person uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_last public.rank_promotions := app_private.latest_grade(p_person);
begin
  if v_last.id is null then
    return;
  end if;
  perform set_config('coachos.grade_sync', 'on', true);
  update public.people set belt = v_last.belt, belt_stripes = v_last.stripes
  where id = p_person and (belt is distinct from v_last.belt or belt_stripes is distinct from v_last.stripes);
  perform set_config('coachos.grade_sync', '', true);
end
$$;
revoke all on function app_private.grade_sync(uuid) from public;

-- Contrôles communs : staff du club, module actif, fiche active, grade et date valides. Renvoie la fiche.
create function app_private.grade_guard(p_person uuid, p_belt text, p_stripes integer, p_on date) returns public.people
language plpgsql stable security definer set search_path = '' as $$
declare
  v_person public.people%rowtype;
  v_today date;
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select * into v_person from public.people where id = p_person;
  if v_person.id is null or not app_private.is_staff(v_person.academy_id)
     or v_person.archived_at is not null or v_person.anonymized_at is not null then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if not app_private.feature_enabled(v_person.academy_id, 'reports') then
    raise exception 'coachos:feature_disabled' using errcode = '42501';
  end if;
  select (now() at time zone a.timezone)::date into v_today from public.academies a where a.id = v_person.academy_id;
  if p_belt is null or p_stripes is null or p_stripes not between 0 and 4 or p_on is null or p_on > v_today or p_on < date '1990-01-01'
     or p_belt not in ('white', 'blue', 'purple', 'brown', 'black', 'grey_white', 'grey', 'grey_black', 'yellow_white', 'yellow', 'yellow_black',
                       'orange_white', 'orange', 'orange_black', 'green_white', 'green', 'green_black') then
    raise exception 'coachos:invalid_promotion' using errcode = 'P0001';
  end if;
  return v_person;
end
$$;
revoke all on function app_private.grade_guard(uuid, text, integer, date) from public;

create function public.add_past_grade(p_person uuid, p_belt text, p_stripes integer, p_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_person public.people := app_private.grade_guard(p_person, p_belt, p_stripes, p_on);
  v_last public.rank_promotions;
  v_today date;
begin
  v_last := app_private.latest_grade(p_person);
  if v_last.id is null and v_person.belt is not null then
    -- Fiche antérieure à l'historique : son grade actuel devient la ligne la plus récente avant d'y ajouter le passé.
    select (now() at time zone a.timezone)::date into v_today from public.academies a where a.id = v_person.academy_id;
    insert into public.rank_promotions (academy_id, person_id, belt, stripes, promoted_on, date_confirmed, source, recorded_by)
    values (v_person.academy_id, p_person, v_person.belt, v_person.belt_stripes, v_today, false, 'staff', (select auth.uid()));
    v_last := app_private.latest_grade(p_person);
  end if;
  if v_last.id is not null and p_on >= v_last.promoted_on then
    raise exception 'coachos:past_grade_after_current' using errcode = 'P0001';
  end if;
  insert into public.rank_promotions (academy_id, person_id, belt, stripes, promoted_on, date_confirmed, source, recorded_by)
  values (v_person.academy_id, p_person, p_belt, p_stripes, p_on, true, 'staff', (select auth.uid()));
  -- Fiche sans aucun grade : l'ancien grade est aussi le seul connu.
  if v_person.belt is null then
    perform app_private.grade_sync(p_person);
  end if;
  perform app_private.write_audit(v_person.academy_id, (select auth.uid()), 'member.past_grade_added', 'person', p_person, '{}'::jsonb);
end
$$;

create function public.update_grade(p_id uuid, p_belt text, p_stripes integer, p_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.rank_promotions%rowtype;
  v_person public.people;
  v_before uuid;
  v_after uuid;
begin
  select * into v_row from public.rank_promotions where id = p_id;
  if v_row.id is null then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  v_person := app_private.grade_guard(v_row.person_id, p_belt, p_stripes, p_on);
  v_before := (app_private.latest_grade(v_row.person_id)).id;
  update public.rank_promotions
  set belt = p_belt, stripes = p_stripes, promoted_on = p_on, date_confirmed = true, source = 'staff', recorded_by = (select auth.uid())
  where id = p_id;
  v_after := (app_private.latest_grade(v_row.person_id)).id;
  -- Une ligne ancienne ne devient pas le grade actuel (ni l'inverse) par une simple correction de date.
  if v_after is distinct from v_before then
    raise exception 'coachos:grade_order' using errcode = 'P0001';
  end if;
  if p_id = v_after then
    perform app_private.grade_sync(v_row.person_id);
  end if;
  perform app_private.write_audit(v_person.academy_id, (select auth.uid()), 'member.grade_updated', 'person', v_row.person_id, '{}'::jsonb);
end
$$;

create function public.delete_grade(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.rank_promotions%rowtype;
  v_person public.people;
  v_was_current boolean;
begin
  select * into v_row from public.rank_promotions where id = p_id;
  if v_row.id is null then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  v_person := app_private.grade_guard(v_row.person_id, v_row.belt, v_row.stripes, v_row.promoted_on);
  v_was_current := (app_private.latest_grade(v_row.person_id)).id = p_id;
  delete from public.rank_promotions where id = p_id;
  if v_was_current then
    perform app_private.grade_sync(v_row.person_id);
  end if;
  perform app_private.write_audit(v_person.academy_id, (select auth.uid()), 'member.grade_deleted', 'person', v_row.person_id, '{}'::jsonb);
end
$$;

-- Nouveau grade actuel : jamais daté avant le dernier grade enregistré (sinon c'est un ancien grade, ou une ligne à corriger).
create or replace function app_private.record_promotion_core(p_person uuid, p_belt text, p_stripes integer, p_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_person public.people%rowtype;
  v_today date;
  v_last public.rank_promotions;
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
  v_last := app_private.latest_grade(p_person);
  if v_last.id is not null and p_on < v_last.promoted_on then
    raise exception 'coachos:promotion_before_history' using errcode = 'P0001';
  end if;
  perform set_config('coachos.promotion', p_on::text, true);
  update public.people set belt = p_belt, belt_stripes = p_stripes where id = p_person;
  perform set_config('coachos.promotion', '', true);
  perform app_private.write_audit(v_person.academy_id, (select auth.uid()), 'member.promoted', 'person', p_person,
    jsonb_build_object('belt', p_belt, 'stripes', p_stripes));
end
$$;

revoke all on function public.add_past_grade(uuid, text, integer, date), public.update_grade(uuid, text, integer, date), public.delete_grade(uuid) from public, anon;
grant execute on function public.add_past_grade(uuid, text, integer, date), public.update_grade(uuid, text, integer, date), public.delete_grade(uuid) to authenticated;

-- Date de la ceinture actuelle : jamais avant (ou le jour d') un grade d'une autre couleur déjà enregistré, sinon l'ordre de
-- l'historique s'inverserait et le grade actuel ne serait plus la ligne la plus récente.
create or replace function app_private.set_belt_since_core(p_person uuid, p_on date) returns void
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
  if exists (select 1 from public.rank_promotions r where r.person_id = p_person
             and regexp_replace(r.belt, '_(white|black)$', '') <> v_group and r.promoted_on >= p_on) then
    raise exception 'coachos:grade_order' using errcode = 'P0001';
  end if;

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
