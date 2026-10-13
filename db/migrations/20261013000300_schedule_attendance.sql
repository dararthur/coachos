-- Coach OS — 0003 séances (planning) et présences.

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete cascade,
  class_type_id uuid not null,
  instructor_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer check (capacity is null or capacity between 1 and 500),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  notes text check (notes is null or char_length(notes) <= 500),
  -- Séances générées ensemble par une récurrence (informatif, pas de logique dessus).
  series_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, academy_id),
  check (ends_at > starts_at and ends_at - starts_at <= interval '12 hours'),
  foreign key (class_type_id, academy_id) references public.class_types (id, academy_id),
  -- Le coach doit appartenir à la même académie ; s'il la quitte, la séance devient « sans coach ».
  foreign key (academy_id, instructor_id) references public.academy_memberships (academy_id, user_id)
    on delete set null (instructor_id)
);
create unique index sessions_slot_uq on public.sessions (academy_id, class_type_id, starts_at)
  where status = 'scheduled';
create index sessions_academy_start_idx on public.sessions (academy_id, starts_at);
create index sessions_instructor_idx on public.sessions (academy_id, instructor_id, starts_at);

create trigger sessions_updated_at before update on public.sessions
  for each row execute function app_private.set_updated_at();
create trigger sessions_academy_immutable before update on public.sessions
  for each row execute function app_private.forbid_academy_change();
create trigger sessions_created_by before insert on public.sessions
  for each row execute function app_private.set_created_by();

-- Seul un owner/admin/coach peut être responsable d'une séance (pas un simple « member »).
create function app_private.check_session_instructor() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.instructor_id is not null and not exists (
    select 1 from public.academy_memberships m
    where m.academy_id = new.academy_id and m.user_id = new.instructor_id
      and m.role in ('owner', 'admin', 'coach')
  ) then
    raise exception 'coachos:invalid_instructor' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger sessions_check_instructor before insert or update of instructor_id on public.sessions
  for each row execute function app_private.check_session_instructor();

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies (id) on delete cascade,
  session_id uuid not null,
  person_id uuid not null,
  status text not null check (status in ('present', 'late', 'absent')),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, person_id),
  foreign key (session_id, academy_id) references public.sessions (id, academy_id),  -- NO ACTION : une séance avec présences ne se supprime pas (mais la suppression d'une académie cascade)
  foreign key (person_id, academy_id) references public.people (id, academy_id) on delete cascade
);
create index attendance_person_idx on public.attendance (academy_id, person_id, recorded_at desc);
create index attendance_session_idx on public.attendance (session_id);

create trigger attendance_updated_at before update on public.attendance
  for each row execute function app_private.set_updated_at();
create trigger attendance_academy_immutable before update on public.attendance
  for each row execute function app_private.forbid_academy_change();

-- Horodatage/auteur imposés par la base ; pas de présence sur séance annulée ni sur membre archivé.
create function app_private.guard_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.recorded_by := (select auth.uid());
  if tg_op = 'INSERT' then
    new.recorded_at := now();
    if exists (select 1 from public.sessions s where s.id = new.session_id and s.status = 'cancelled') then
      raise exception 'coachos:session_cancelled' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.people p
      where p.id = new.person_id and (p.archived_at is not null or p.anonymized_at is not null)
    ) then
      raise exception 'coachos:person_archived' using errcode = 'P0001';
    end if;
  elsif new.session_id is distinct from old.session_id or new.person_id is distinct from old.person_id then
    raise exception 'coachos:attendance_key_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger attendance_guard before insert or update on public.attendance
  for each row execute function app_private.guard_attendance();

-- Owner/admin : toutes les séances ; coach : séances qui lui sont affectées ou sans coach.
create function app_private.can_record_attendance(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.sessions s
    join public.academy_memberships m on m.academy_id = s.academy_id and m.user_id = (select auth.uid())
    where s.id = p_session
      and (
        m.role in ('owner', 'admin')
        or (m.role = 'coach' and (s.instructor_id is null or s.instructor_id = m.user_id))
      )
  );
$$;
grant execute on function app_private.can_record_attendance(uuid) to authenticated;

alter table public.sessions enable row level security;
alter table public.attendance enable row level security;

create policy sessions_select on public.sessions for select to authenticated
  using (app_private.is_member(academy_id));
create policy sessions_insert on public.sessions for insert to authenticated
  with check (app_private.is_admin(academy_id));
create policy sessions_update on public.sessions for update to authenticated
  using (app_private.is_admin(academy_id)) with check (app_private.is_admin(academy_id));
create policy sessions_delete on public.sessions for delete to authenticated
  using (app_private.is_admin(academy_id));

-- Le staff lit toutes les présences ; un membre ne lit que les siennes.
create policy attendance_select on public.attendance for select to authenticated
  using (
    app_private.is_staff(academy_id)
    or exists (
      select 1 from public.people p
      where p.id = attendance.person_id and p.academy_id = attendance.academy_id
        and p.user_id = (select auth.uid())
    )
  );
create policy attendance_insert on public.attendance for insert to authenticated
  with check (app_private.can_record_attendance(session_id));
create policy attendance_update on public.attendance for update to authenticated
  using (app_private.can_record_attendance(session_id)) with check (app_private.can_record_attendance(session_id));
create policy attendance_delete on public.attendance for delete to authenticated
  using (app_private.can_record_attendance(session_id));

revoke all on public.sessions, public.attendance from anon, authenticated, public;
grant select, delete on public.sessions to authenticated;
grant insert (academy_id, class_type_id, instructor_id, starts_at, ends_at, capacity, notes, series_id)
  on public.sessions to authenticated;
grant update (instructor_id, starts_at, ends_at, capacity, status, notes) on public.sessions to authenticated;
grant select, delete on public.attendance to authenticated;
grant insert (academy_id, session_id, person_id, status) on public.attendance to authenticated;
grant update (status) on public.attendance to authenticated;
