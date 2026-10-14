-- Coach OS — 0014 photo de profil (facultative), stockée en base.
--
-- L'image est normalisée côté serveur (carré ~256 px, WebP) avant d'arriver ici ; la base borne malgré tout le type et la taille.
-- Table séparée de `people` pour ne jamais alourdir les listes. Lecture : le staff, le membre lui-même, et les autres membres
-- du club uniquement si la personne a accepté d'apparaître dans le classement (ranking_opt_in). Écriture : fonctions dédiées.
-- La photo est supprimée dès que la fiche est anonymisée ou supprimée.

create table public.person_photos (
  person_id uuid primary key,
  academy_id uuid not null references public.academies (id) on delete cascade,
  content_type text not null check (content_type in ('image/webp', 'image/jpeg', 'image/png')),
  data bytea not null check (octet_length(data) between 1 and 204800),
  updated_at timestamptz not null default now(),
  foreign key (person_id, academy_id) references public.people (id, academy_id) on delete cascade
);
create index person_photos_academy_idx on public.person_photos (academy_id);

alter table public.person_photos enable row level security;
alter table public.person_photos force row level security;

-- Les fiches des autres membres sont invisibles sous RLS : la décision de visibilité passe par une fonction définie côté base.
create function app_private.can_see_photo(p_person uuid, p_academy uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.is_staff(p_academy)
    or exists (
      select 1 from public.people p
      where p.id = p_person and p.academy_id = p_academy and p.anonymized_at is null
        and (p.user_id = (select auth.uid()) or (p.ranking_opt_in and app_private.is_member(p_academy)))
    )
$$;
revoke all on function app_private.can_see_photo(uuid, uuid) from public;
grant execute on function app_private.can_see_photo(uuid, uuid) to authenticated;

create policy person_photos_select on public.person_photos for select to authenticated
using (app_private.can_see_photo(person_id, academy_id));
revoke all on public.person_photos from public, anon, authenticated;
grant select on public.person_photos to authenticated;

-- Le membre pose ou remplace SA photo.
create function public.set_my_photo(p_academy uuid, p_content_type text, p_data bytea) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_person uuid;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  select id into v_person from public.people
  where academy_id = p_academy and user_id = v_uid and anonymized_at is null and archived_at is null;
  if v_person is null then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if p_content_type not in ('image/webp', 'image/jpeg', 'image/png') or p_data is null
     or octet_length(p_data) not between 1 and 204800 then
    raise exception 'coachos:photo_invalid' using errcode = 'P0001';
  end if;
  insert into public.person_photos (person_id, academy_id, content_type, data)
  values (v_person, p_academy, p_content_type, p_data)
  on conflict (person_id) do update set content_type = excluded.content_type, data = excluded.data, updated_at = now();
  perform app_private.write_audit(p_academy, v_uid, 'member.photo_set', 'person', v_person, '{}'::jsonb);
end
$$;

-- Le membre retire SA photo ; un administrateur peut retirer celle d'un membre (modération).
create function public.remove_person_photo(p_academy uuid, p_person uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_admin(p_academy)
     and not exists (select 1 from public.people where id = p_person and academy_id = p_academy and user_id = v_uid) then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  delete from public.person_photos where person_id = p_person and academy_id = p_academy;
  if found then
    perform app_private.write_audit(p_academy, v_uid, 'member.photo_removed', 'person', p_person, '{}'::jsonb);
  end if;
end
$$;

-- Anonymisation (manuelle ou par rétention) : la photo est effacée avec l'identité. Archiver seul la conserve.
create function app_private.drop_photo_on_anonymize() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.person_photos where person_id = new.id;
  return new;
end
$$;
create trigger people_drop_photo after update of anonymized_at on public.people
for each row when (old.anonymized_at is null and new.anonymized_at is not null)
execute function app_private.drop_photo_on_anonymize();

revoke all on function public.set_my_photo(uuid, text, bytea) from public, anon;
grant execute on function public.set_my_photo(uuid, text, bytea) to authenticated;
revoke all on function public.remove_person_photo(uuid, uuid) from public, anon;
grant execute on function public.remove_person_photo(uuid, uuid) to authenticated;
revoke all on function app_private.drop_photo_on_anonymize() from public;
