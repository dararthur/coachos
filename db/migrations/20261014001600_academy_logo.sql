-- Coach OS — 0016 logo du club, stocké en base (même principe que les photos de profil).
--
-- L'image est normalisée côté serveur (256 px maximum, WebP, transparence conservée). Lecture : tout membre du club (il est affiché
-- dans la barre de navigation). Écriture : administrateurs et propriétaire, par fonctions dédiées. Supprimé avec le club.

create table public.academy_logos (
  academy_id uuid primary key references public.academies (id) on delete cascade,
  content_type text not null check (content_type in ('image/webp', 'image/jpeg', 'image/png')),
  data bytea not null check (octet_length(data) between 1 and 204800),
  updated_at timestamptz not null default now()
);

alter table public.academy_logos enable row level security;
alter table public.academy_logos force row level security;
create policy academy_logos_select on public.academy_logos for select to authenticated
using (app_private.is_member(academy_id));
revoke all on public.academy_logos from public, anon, authenticated;
grant select on public.academy_logos to authenticated;

create function public.set_academy_logo(p_academy uuid, p_content_type text, p_data bytea) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_admin(p_academy) then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  if p_content_type not in ('image/webp', 'image/jpeg', 'image/png') or p_data is null
     or octet_length(p_data) not between 1 and 204800 then
    raise exception 'coachos:photo_invalid' using errcode = 'P0001';
  end if;
  insert into public.academy_logos (academy_id, content_type, data) values (p_academy, p_content_type, p_data)
  on conflict (academy_id) do update set content_type = excluded.content_type, data = excluded.data, updated_at = now();
  perform app_private.write_audit(p_academy, v_uid, 'academy.logo_set', 'academy', p_academy, '{}'::jsonb);
end
$$;

create function public.remove_academy_logo(p_academy uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_admin(p_academy) then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  delete from public.academy_logos where academy_id = p_academy;
  if found then
    perform app_private.write_audit(p_academy, v_uid, 'academy.logo_removed', 'academy', p_academy, '{}'::jsonb);
  end if;
end
$$;

revoke all on function public.set_academy_logo(uuid, text, bytea) from public, anon;
grant execute on function public.set_academy_logo(uuid, text, bytea) to authenticated;
revoke all on function public.remove_academy_logo(uuid) from public, anon;
grant execute on function public.remove_academy_logo(uuid) to authenticated;
