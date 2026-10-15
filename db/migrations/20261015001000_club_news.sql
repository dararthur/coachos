-- Coach OS — actualités du club : publications de l'équipe (coach et plus) lisibles par tous les membres du club.
--
-- La colonne `visibility` prépare l'affichage de certaines publications sur le site web du club (« public ») ; l'application ne propose
-- pas encore ce choix et ne crée que des publications « members ». Rien n'est lisible sans compte : aucune politique ne s'adresse à `anon`.
-- Le jour où le site public existera, il lira via une fonction dédiée qui ne renvoie que les publications « public » (titre, texte, date),
-- jamais le reste. Aucune donnée de membre n'a sa place dans une publication (docs/news.md).

create table public.club_posts (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  visibility text not null default 'members' check (visibility in ('members', 'public')),
  author_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index club_posts_academy_idx on public.club_posts (academy_id, created_at desc);

alter table public.club_posts enable row level security;

-- Lecture : tous les membres du club (équipe comprise). Écriture : l'équipe ; le coach ne touche qu'à ses propres publications.
create policy club_posts_select on public.club_posts for select to authenticated
  using (app_private.is_member(academy_id));
create policy club_posts_insert on public.club_posts for insert to authenticated
  with check (app_private.is_staff(academy_id));
create policy club_posts_update on public.club_posts for update to authenticated
  using (app_private.is_admin(academy_id) or (app_private.is_staff(academy_id) and author_id = (select auth.uid())))
  with check (app_private.is_admin(academy_id) or (app_private.is_staff(academy_id) and author_id = (select auth.uid())));
create policy club_posts_delete on public.club_posts for delete to authenticated
  using (app_private.is_admin(academy_id) or (app_private.is_staff(academy_id) and author_id = (select auth.uid())));

grant select, delete on public.club_posts to authenticated;
grant insert (academy_id, title, body, visibility) on public.club_posts to authenticated;
grant update (title, body, visibility) on public.club_posts to authenticated;

-- L'auteur est fixé par la base, jamais par le client.
create function app_private.club_post_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.author_id := (select auth.uid());
  return new;
end
$$;
create trigger club_posts_stamp before insert on public.club_posts
  for each row execute function app_private.club_post_stamp();
create trigger club_posts_updated_at before update on public.club_posts
  for each row execute function app_private.set_updated_at();
create trigger club_posts_academy_immutable before update on public.club_posts
  for each row execute function app_private.forbid_academy_change();

create function app_private.audit_club_post() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform app_private.write_audit(new.academy_id, (select auth.uid()), 'news.published', 'club_post', new.id, '{}'::jsonb);
    return new;
  end if;
  -- Pas de trace par publication quand c'est la suppression du club entier qui les emporte.
  if exists (select 1 from public.academies a where a.id = old.academy_id) then
    perform app_private.write_audit(old.academy_id, (select auth.uid()), 'news.deleted', 'club_post', old.id, '{}'::jsonb);
  end if;
  return old;
end
$$;
revoke all on function app_private.audit_club_post() from public;
create trigger club_posts_audit_insert after insert on public.club_posts
  for each row execute function app_private.audit_club_post();
create trigger club_posts_audit_delete after delete on public.club_posts
  for each row execute function app_private.audit_club_post();
