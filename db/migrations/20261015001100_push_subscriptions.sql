-- Coach OS — notifications push (Web Push) : appareils abonnés par un compte.
--
-- Un abonnement = un appareil/navigateur (adresse du service de notification du navigateur + clés de chiffrement). C'est un
-- identifiant d'appareil : il est rattaché à UN compte, visible de ce seul compte, supprimé avec lui, et jamais lu par l'équipe d'un
-- club. L'envoi (rôle app_server) passe par des fonctions qui ne renvoient que ce qui sert à joindre l'appareil.
-- Le service de notification (Google, Mozilla, Apple, Microsoft) ne reçoit qu'un message chiffré de bout en bout.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 1000 and endpoint like 'https://%'),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;

-- Le titulaire voit et supprime ses appareils ; il n'en crée que par save_push_subscription (qui gère le changement de compte
-- sur un même appareil) et ne les modifie jamais.
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;

-- Enregistre l'appareil du compte connecté. Si l'appareil était abonné pour un autre compte (téléphone partagé, changement de
-- compte), il passe au compte courant : une notification n'est jamais envoyée à l'ancien titulaire. Au plus 10 appareils par compte
-- (les plus anciens sont retirés).
create function app_private.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'authentification requise' using errcode = '42501';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  delete from public.push_subscriptions d
  where d.user_id = uid
    and d.id in (select s.id from public.push_subscriptions s where s.user_id = uid order by s.created_at desc offset 10);
end
$$;
revoke all on function app_private.save_push_subscription(text, text, text) from public, anon;
grant execute on function app_private.save_push_subscription(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Envoi (rôle app_server uniquement)
-- ---------------------------------------------------------------------------
-- Appareils des comptes membres d'un club, hors l'auteur de la notification.
create function app_private.push_targets_for_club(p_academy uuid, p_exclude_user uuid)
returns table (id uuid, endpoint text, p256dh text, auth text)
language sql security definer stable set search_path = '' as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  join public.academy_memberships m on m.user_id = s.user_id and m.academy_id = p_academy
  where s.user_id is distinct from p_exclude_user
$$;

-- Appareils que le service de notification a déclarés disparus (404/410) : supprimés.
create function app_private.drop_push_subscriptions(p_ids uuid[]) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where id = any(p_ids)
$$;

revoke all on function app_private.push_targets_for_club(uuid, uuid), app_private.drop_push_subscriptions(uuid[])
  from public, anon, authenticated;
grant execute on function app_private.push_targets_for_club(uuid, uuid), app_private.drop_push_subscriptions(uuid[]) to app_server;
