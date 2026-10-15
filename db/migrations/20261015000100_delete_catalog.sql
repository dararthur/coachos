-- Coach OS — 0023 suppression définitive d'un type de cours ou d'une discipline (en plus de l'archivage).
--
-- Règle : on ne supprime que ce qui n'a jamais servi. Dès qu'une séance (passée, à venir ou annulée) utilise le type de cours, ou l'un des types
-- de la discipline, la suppression est refusée : l'historique des présences resterait sans libellé. Il faut alors archiver, ou supprimer
-- d'abord les séances concernées. Supprimer une discipline supprime aussi ses types de cours (tous inutilisés). Réservé aux administrateurs.

create function public.delete_class_type(p_academy uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_admin(p_academy) then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  select name into v_name from public.class_types where id = p_id and academy_id = p_academy for update;
  if not found then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.sessions where class_type_id = p_id and academy_id = p_academy) then
    raise exception 'coachos:catalog_in_use' using errcode = 'P0001';
  end if;
  delete from public.class_types where id = p_id and academy_id = p_academy;
  perform app_private.write_audit(p_academy, v_uid, 'catalog.class_type_deleted', 'class_type', p_id, jsonb_build_object('name', v_name));
end
$$;

create function public.delete_discipline(p_academy uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_types integer;
begin
  if v_uid is null then
    raise exception 'coachos:not_authenticated' using errcode = '28000';
  end if;
  if not app_private.is_admin(p_academy) then
    raise exception 'coachos:forbidden' using errcode = '42501';
  end if;
  select name into v_name from public.disciplines where id = p_id and academy_id = p_academy for update;
  if not found then
    raise exception 'coachos:not_found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.sessions s join public.class_types ct on ct.id = s.class_type_id and ct.academy_id = s.academy_id
    where ct.discipline_id = p_id and s.academy_id = p_academy
  ) then
    raise exception 'coachos:catalog_in_use' using errcode = 'P0001';
  end if;
  delete from public.class_types where discipline_id = p_id and academy_id = p_academy;
  get diagnostics v_types = row_count;
  delete from public.disciplines where id = p_id and academy_id = p_academy;
  perform app_private.write_audit(p_academy, v_uid, 'catalog.discipline_deleted', 'discipline', p_id, jsonb_build_object('name', v_name, 'class_types', v_types));
end
$$;

revoke all on function public.delete_class_type(uuid, uuid) from public, anon;
revoke all on function public.delete_discipline(uuid, uuid) from public, anon;
grant execute on function public.delete_class_type(uuid, uuid) to authenticated;
grant execute on function public.delete_discipline(uuid, uuid) to authenticated;
