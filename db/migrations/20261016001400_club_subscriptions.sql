-- Coach OS — formule et facturation de chaque club, tenues par l'administrateur de la plateforme.
--
-- Le paiement reste hors de l'application (virement, facture) : on enregistre seulement ce qu'il faut pour piloter — nom de la formule
-- (libre), état, début, échéance, prix mensuel indicatif et note interne. Donnée INTERNE à la plateforme : le club ne la voit pas, aucun
-- compte ne la lit. Lecture et écriture uniquement par les fonctions ci-dessous, qui refusent tout autre compte que l'administrateur.

create table public.club_subscriptions (
  academy_id uuid primary key references public.academies (id) on delete cascade,
  plan_name text not null check (char_length(btrim(plan_name)) between 1 and 60),
  status text not null check (status in ('trial', 'active', 'overdue', 'cancelled')),
  starts_on date,
  renews_on date,
  price_cents integer check (price_cents is null or price_cents between 0 and 1000000),
  note text check (note is null or char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  check (starts_on is null or renews_on is null or renews_on >= starts_on)
);
alter table public.club_subscriptions enable row level security;
alter table public.club_subscriptions force row level security;
revoke all on public.club_subscriptions from public, anon, authenticated;

create function public.admin_club_subscription(p_academy uuid) returns table (
  plan_name text, status text, starts_on date, renews_on date, price_cents integer, note text
)
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
  return query select s.plan_name, s.status, s.starts_on, s.renews_on, s.price_cents, s.note
               from public.club_subscriptions s where s.academy_id = p_academy;
end
$$;

create function public.admin_set_club_subscription(
  p_academy uuid, p_plan_name text, p_status text, p_starts_on date, p_renews_on date, p_price_cents integer, p_note text
) returns void
language plpgsql security definer set search_path = '' as $$
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
  if p_plan_name is null or char_length(btrim(p_plan_name)) not between 1 and 60
     or p_status is null or p_status not in ('trial', 'active', 'overdue', 'cancelled')
     or (p_starts_on is not null and p_renews_on is not null and p_renews_on < p_starts_on)
     or (p_price_cents is not null and p_price_cents not between 0 and 1000000)
     or (p_note is not null and char_length(p_note) > 500) then
    raise exception 'coachos:validation' using errcode = 'P0001';
  end if;
  insert into public.club_subscriptions (academy_id, plan_name, status, starts_on, renews_on, price_cents, note)
  values (p_academy, btrim(p_plan_name), p_status, p_starts_on, p_renews_on, p_price_cents, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (academy_id) do update set
    plan_name = excluded.plan_name, status = excluded.status, starts_on = excluded.starts_on, renews_on = excluded.renews_on,
    price_cents = excluded.price_cents, note = excluded.note, updated_at = now();
end
$$;

-- La liste des clubs porte la formule (pour l'afficher et en tirer des alertes d'échéance).
drop function public.admin_list_clubs();
create function public.admin_list_clubs() returns table (
  id uuid, name text, timezone text, created_at timestamptz,
  owner_email text, members integer, staff integer, sessions_30d integer,
  events_7d integer, events_30d integer, last_event_at timestamptz, disabled_features text[],
  events_prev_30d integer,
  plan_name text, subscription_status text, renews_on date, price_cents integer
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
           s.plan_name, s.status, s.renews_on, s.price_cents
    from public.academies a
    left join public.club_subscriptions s on s.academy_id = a.id
    order by a.created_at desc;
end
$$;

revoke all on function public.admin_club_subscription(uuid) from public, anon;
revoke all on function public.admin_set_club_subscription(uuid, text, text, date, date, integer, text) from public, anon;
revoke all on function public.admin_list_clubs() from public, anon;
grant execute on function public.admin_club_subscription(uuid) to authenticated;
grant execute on function public.admin_set_club_subscription(uuid, text, text, date, date, integer, text) to authenticated;
grant execute on function public.admin_list_clubs() to authenticated;
