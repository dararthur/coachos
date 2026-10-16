-- Coach OS — suspension d'un club par l'administrateur de la plateforme (impayé, abus, arrêt demandé).
--
-- Un club suspendu est INACCESSIBLE : pour la base, plus personne n'y est membre (member_role et is_member répondent « non »), donc toute
-- la RLS le ferme d'un seul geste, y compris les fonctions métier. Rien n'est supprimé : la réactivation rend tout tel quel. Les membres
-- reçoivent un message clair (public.my_suspended_academies), les rappels automatiques s'arrêtent. Le motif est INTERNE à la plateforme.

create table public.club_suspensions (
  academy_id uuid primary key references public.academies (id) on delete cascade,
  suspended_at timestamptz not null default now(),
  reason text check (reason is null or char_length(reason) <= 200)
);
alter table public.club_suspensions enable row level security;
alter table public.club_suspensions force row level security;
revoke all on public.club_suspensions from public, anon, authenticated;

create function app_private.is_suspended(p_academy uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.club_suspensions s where s.academy_id = p_academy)
$$;
revoke all on function app_private.is_suspended(uuid) from public, anon;
grant execute on function app_private.is_suspended(uuid) to authenticated;

-- Les deux briques de toute la RLS : un club suspendu n'a plus de membres.
create or replace function app_private.member_role(p_academy uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.academy_memberships m
  where m.academy_id = p_academy and m.user_id = (select auth.uid())
    and not app_private.is_suspended(p_academy);
$$;

create or replace function app_private.is_member(p_academy uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.academy_memberships m
    where m.academy_id = p_academy and m.user_id = (select auth.uid())
      and not app_private.is_suspended(p_academy)
  );
$$;

-- Les clubs suspendus où je suis membre (pour afficher un message au lieu d'un « introuvable »). Le motif n'est jamais renvoyé.
create function public.my_suspended_academies() returns table (id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  return query
    select a.id, a.name
    from public.academy_memberships m
    join public.academies a on a.id = m.academy_id
    join public.club_suspensions s on s.academy_id = a.id
    where m.user_id = (select auth.uid())
    order by a.name;
end
$$;
revoke all on function public.my_suspended_academies() from public, anon;
grant execute on function public.my_suspended_academies() to authenticated;

-- Console : lire et régler la suspension d'un club.
create function public.admin_club_suspension(p_academy uuid) returns table (suspended_at timestamptz, reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_platform_admin() then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  return query select s.suspended_at, s.reason from public.club_suspensions s where s.academy_id = p_academy;
end
$$;

create function public.admin_set_club_suspension(p_academy uuid, p_suspended boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_platform_admin() then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  if p_suspended is null or (p_reason is not null and char_length(p_reason) > 200) then
    raise exception 'coachos:validation' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.academies a where a.id = p_academy) then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if p_suspended then
    insert into public.club_suspensions (academy_id, reason) values (p_academy, nullif(btrim(coalesce(p_reason, '')), ''))
    on conflict (academy_id) do update set reason = excluded.reason;
  else
    delete from public.club_suspensions where academy_id = p_academy;
  end if;
end
$$;
revoke all on function public.admin_club_suspension(uuid) from public, anon;
revoke all on function public.admin_set_club_suspension(uuid, boolean, text) from public, anon;
grant execute on function public.admin_club_suspension(uuid) to authenticated;
grant execute on function public.admin_set_club_suspension(uuid, boolean, text) to authenticated;

-- Les rappels de séance ne partent plus pour un club suspendu.
create or replace function app_private.claim_session_reminders()
returns table (session_id uuid, academy_id uuid, academy_name text, class_name text, starts_at timestamptz, timezone text,
               sub_id uuid, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select s.id, s.academy_id, s.class_type_id, s.starts_at
    from public.sessions s
    where s.status = 'scheduled'
      and s.starts_at > now() + interval '35 minutes' and s.starts_at <= now() + interval '65 minutes'
      and not exists (select 1 from public.session_reminders r where r.session_id = s.id)
      and not exists (select 1 from public.club_suspensions z where z.academy_id = s.academy_id)
  ), marked as (
    insert into public.session_reminders (session_id, academy_id) select d.id, d.academy_id from due d on conflict do nothing returning session_id
  )
  select d.id, d.academy_id, a.name, ct.name, d.starts_at, a.timezone, ps.id, ps.endpoint, ps.p256dh, ps.auth
  from due d
  join marked m on m.session_id = d.id
  join public.academies a on a.id = d.academy_id
  join public.class_types ct on ct.id = d.class_type_id and ct.academy_id = d.academy_id
  join public.session_bookings b on b.session_id = d.id and b.academy_id = d.academy_id and b.status = 'booked'
  join public.people p on p.id = b.person_id and p.academy_id = b.academy_id
    and p.user_id is not null and p.archived_at is null and p.anonymized_at is null
  join public.academy_memberships am on am.academy_id = d.academy_id and am.user_id = p.user_id
  join public.push_subscriptions ps on ps.user_id = p.user_id;
end
$$;

-- La liste des clubs indique les clubs suspendus.
drop function public.admin_list_clubs();
create function public.admin_list_clubs() returns table (
  id uuid, name text, timezone text, created_at timestamptz,
  owner_email text, members integer, staff integer, sessions_30d integer,
  events_7d integer, events_30d integer, last_event_at timestamptz, disabled_features text[],
  events_prev_30d integer,
  plan_name text, subscription_status text, renews_on date, price_cents integer,
  suspended_at timestamptz
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
           coalesce((select array_agg(c.feature order by c.feature) from public.club_features c where c.academy_id = a.id and not c.enabled), '{}'),
           (select count(*)::integer from public.usage_events e where e.academy_id = a.id and e.created_at > now() - interval '60 days' and e.created_at <= now() - interval '30 days'),
           s.plan_name, s.status, s.renews_on, s.price_cents,
           z.suspended_at
    from public.academies a
    left join public.club_subscriptions s on s.academy_id = a.id
    left join public.club_suspensions z on z.academy_id = a.id
    order by a.created_at desc;
end
$$;
revoke all on function public.admin_list_clubs() from public, anon;
grant execute on function public.admin_list_clubs() to authenticated;
