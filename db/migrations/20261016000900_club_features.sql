-- Coach OS — fonctionnalités activables club par club, depuis la console de l'administrateur de la plateforme.
--
-- Trois modules : « ranking » (classement et assiduité), « news » (actualités et notifications), « reports » (grades et rapports).
-- Par défaut TOUT est activé : l'absence de ligne signifie « activé », donc aucun club existant ne perd quoi que ce soit.
-- Seul l'administrateur de la plateforme écrit (admin_set_club_feature). Les membres du club peuvent LIRE leurs interrupteurs
-- (le serveur masque la navigation) mais pas les modifier. Une fonctionnalité coupée est bloquée jusque dans la base, et les données
-- déjà saisies sont conservées : rien n'est supprimé, tout redevient visible à la réactivation.

create table public.club_features (
  academy_id uuid not null references public.academies (id) on delete cascade,
  feature text not null check (feature in ('ranking', 'news', 'reports')),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (academy_id, feature)
);
alter table public.club_features enable row level security;
alter table public.club_features force row level security;
create policy club_features_select on public.club_features for select to authenticated
  using (app_private.is_member(academy_id));
revoke all on public.club_features from public, anon, authenticated;
grant select on public.club_features to authenticated;

create function app_private.feature_enabled(p_academy uuid, p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select f.enabled from public.club_features f where f.academy_id = p_academy and f.feature = p_feature), true)
$$;
revoke all on function app_private.feature_enabled(uuid, text) from public, anon;
grant execute on function app_private.feature_enabled(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Actualités : plus aucune lecture ni écriture tant que le module est coupé (politique restrictive, en plus des politiques existantes)
-- ---------------------------------------------------------------------------
create policy club_posts_feature on public.club_posts as restrictive for all to authenticated
  using (app_private.feature_enabled(academy_id, 'news'))
  with check (app_private.feature_enabled(academy_id, 'news'));

-- ---------------------------------------------------------------------------
-- Fonctions métier protégées : l'originale devient interne (app_private, plus exécutable par les comptes) ; la fonction publique
-- de même nom et même signature contrôle l'interrupteur puis délègue. Le contrôle ne s'applique qu'aux membres du club
-- (pour tout autre compte, l'originale répond comme avant : introuvable).
-- ---------------------------------------------------------------------------
alter function public.record_promotion(uuid, text, integer, date) rename to record_promotion_core;
alter function public.record_promotion_core(uuid, text, integer, date) set schema app_private;
revoke all on function app_private.record_promotion_core(uuid, text, integer, date) from public, anon, authenticated;

create function public.record_promotion(p_person uuid, p_belt text, p_stripes integer, p_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_academy uuid;
begin
  select p.academy_id into v_academy from public.people p where p.id = p_person;
  if v_academy is not null and app_private.is_member(v_academy) and not app_private.feature_enabled(v_academy, 'reports') then
    raise exception 'coachos:feature_disabled' using errcode = '42501';
  end if;
  perform app_private.record_promotion_core(p_person, p_belt, p_stripes, p_on);
end
$$;

alter function public.set_belt_since(uuid, date) rename to set_belt_since_core;
alter function public.set_belt_since_core(uuid, date) set schema app_private;
revoke all on function app_private.set_belt_since_core(uuid, date) from public, anon, authenticated;

create function public.set_belt_since(p_person uuid, p_on date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_academy uuid;
begin
  select p.academy_id into v_academy from public.people p where p.id = p_person;
  if v_academy is not null and app_private.is_member(v_academy) and not app_private.feature_enabled(v_academy, 'reports') then
    raise exception 'coachos:feature_disabled' using errcode = '42501';
  end if;
  perform app_private.set_belt_since_core(p_person, p_on);
end
$$;

alter function public.attendance_ranking(uuid, date, date) rename to attendance_ranking_core;
alter function public.attendance_ranking_core(uuid, date, date) set schema app_private;
revoke all on function app_private.attendance_ranking_core(uuid, date, date) from public, anon, authenticated;

create function public.attendance_ranking(p_academy uuid, p_from date, p_to date)
returns table (
  person_id uuid, first_name text, last_name text, visits integer, rank integer, ranked_total integer, is_me boolean,
  belt text, belt_stripes integer, avatar_style text, has_photo boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if app_private.is_member(p_academy) and not app_private.feature_enabled(p_academy, 'ranking') then
    raise exception 'coachos:feature_disabled' using errcode = '42501';
  end if;
  return query select * from app_private.attendance_ranking_core(p_academy, p_from, p_to);
end
$$;

revoke all on function public.record_promotion(uuid, text, integer, date) from public, anon;
revoke all on function public.set_belt_since(uuid, date) from public, anon;
revoke all on function public.attendance_ranking(uuid, date, date) from public, anon;
grant execute on function public.record_promotion(uuid, text, integer, date) to authenticated;
grant execute on function public.set_belt_since(uuid, date) to authenticated;
grant execute on function public.attendance_ranking(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Console de l'administrateur : lire et régler les interrupteurs d'un club
-- ---------------------------------------------------------------------------
create function public.admin_club_features(p_academy uuid) returns table (feature text, enabled boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_platform_admin() then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.academies a where a.id = p_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  return query
    select f.feature, coalesce(c.enabled, true)
    from (values ('ranking'), ('news'), ('reports')) as f (feature)
    left join public.club_features c on c.academy_id = p_academy and c.feature = f.feature
    order by f.feature;
end
$$;

create function public.admin_set_club_feature(p_academy uuid, p_feature text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_platform_admin() then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  if p_feature is null or p_feature not in ('ranking', 'news', 'reports') or p_enabled is null then
    raise exception 'coachos:validation' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.academies a where a.id = p_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  insert into public.club_features (academy_id, feature, enabled) values (p_academy, p_feature, p_enabled)
  on conflict (academy_id, feature) do update set enabled = excluded.enabled, updated_at = now();
  -- Tracé dans le journal du club (visible de ses administrateurs) : le club sait qu'un réglage de formule a changé.
  perform app_private.write_audit(p_academy, v_uid, 'platform.feature_set', 'academy', p_academy,
    jsonb_build_object('feature', p_feature, 'enabled', p_enabled));
end
$$;

revoke all on function public.admin_club_features(uuid) from public, anon;
revoke all on function public.admin_set_club_feature(uuid, text, boolean) from public, anon;
grant execute on function public.admin_club_features(uuid) to authenticated;
grant execute on function public.admin_set_club_feature(uuid, text, boolean) to authenticated;

-- La liste des clubs indique combien de modules sont coupés pour chacun.
drop function public.admin_list_clubs();
create function public.admin_list_clubs() returns table (
  id uuid, name text, timezone text, created_at timestamptz,
  owner_email text, members integer, staff integer, sessions_30d integer,
  events_7d integer, events_30d integer, last_event_at timestamptz, disabled_features text[]
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_platform_admin() then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  return query
    select a.id, a.name, a.timezone, a.created_at,
           (select u.email from public.academy_memberships m join auth.users u on u.id = m.user_id
             where m.academy_id = a.id and m.role = 'owner' order by m.created_at limit 1),
           (select count(*)::integer from public.people p where p.academy_id = a.id and p.archived_at is null and p.anonymized_at is null),
           (select count(*)::integer from public.academy_memberships m where m.academy_id = a.id and m.role in ('owner', 'admin', 'coach')),
           (select count(*)::integer from public.sessions s where s.academy_id = a.id and s.status = 'scheduled' and s.starts_at > now() - interval '30 days' and s.starts_at <= now()),
           (select count(*)::integer from public.usage_events e where e.academy_id = a.id and e.created_at > now() - interval '7 days'),
           (select count(*)::integer from public.usage_events e where e.academy_id = a.id and e.created_at > now() - interval '30 days'),
           (select max(e.created_at) from public.usage_events e where e.academy_id = a.id),
           coalesce((select array_agg(c.feature order by c.feature) from public.club_features c where c.academy_id = a.id and not c.enabled), '{}')
    from public.academies a
    order by a.created_at desc;
end
$$;
revoke all on function public.admin_list_clubs() from public, anon;
grant execute on function public.admin_list_clubs() to authenticated;
