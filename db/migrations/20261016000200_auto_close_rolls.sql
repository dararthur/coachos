-- Coach OS — clôture automatique des feuilles d'appel (roadmap P0.2).
--
-- Une feuille jamais validée laisse les absences non enregistrées : classement faux, brief aveugle. Une tâche planifiée appelle
-- app_private.close_due_rolls() : toute séance « programmée » dont la FIN est passée de plus d'un jour calendaire (date locale du
-- club, fuseau de l'académie) et dont la feuille n'est pas validée est clôturée avec EXACTEMENT les mêmes règles que la validation
-- manuelle (app_private.roll_apply_validation, désormais partagée) : coach affecté présent, autres réservations confirmées sans
-- présence absentes. Différences : validated_by reste vide, validated_auto vaut vrai, l'audit est « roll.auto_closed » (acteur
-- vide = système). Un coach ou un admin peut rouvrir puis corriger, comme pour une feuille validée à la main.
--
-- Idempotent : une feuille déjà validée (y compris par un coach qui valide en même temps) n'est jamais touchée. Fenêtre de 3 jours
-- en arrière : l'historique antérieur n'est pas réécrit au premier passage. Une séance en échec n'empêche pas les autres.

alter table public.session_checkins add column validated_auto boolean not null default false;

-- Cœur commun de la validation. Renvoie le nombre d'absences créées, ou -1 si (mode automatique) la feuille était déjà validée.
create function app_private.roll_apply_validation(p_session uuid, p_actor uuid, p_auto boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_academy uuid;
  v_done uuid;
  v_no_shows integer := 0;
begin
  select academy_id into v_academy from public.sessions where id = p_session;
  insert into public.session_checkins as c (session_id, academy_id, status, closed_at, validated_at, validated_by, validated_auto)
  values (p_session, v_academy, 'closed', now(), now(), p_actor, p_auto)
  on conflict (session_id) do update
    set status = 'closed', closed_at = now(), validated_at = now(), validated_by = p_actor, validated_auto = p_auto
    where not p_auto or c.validated_at is null
  returning c.session_id into v_done;
  if v_done is null then
    return -1;
  end if;
  perform app_private.checkin_revoke_tokens(p_session);

  insert into public.attendance (academy_id, session_id, person_id, status)
  select b.academy_id, b.session_id, b.person_id, 'present'
  from public.session_bookings b
  join public.people p on p.id = b.person_id and p.academy_id = b.academy_id and p.archived_at is null and p.anonymized_at is null
  where b.session_id = p_session and b.status = 'booked' and b.is_instructor
  on conflict (session_id, person_id) do nothing;

  insert into public.attendance (academy_id, session_id, person_id, status)
  select b.academy_id, b.session_id, b.person_id, 'absent'
  from public.session_bookings b
  join public.people p on p.id = b.person_id and p.academy_id = b.academy_id and p.archived_at is null and p.anonymized_at is null
  where b.session_id = p_session and b.status = 'booked' and not b.is_instructor
  on conflict (session_id, person_id) do nothing;
  get diagnostics v_no_shows = row_count;
  return v_no_shows;
end
$$;
revoke all on function app_private.roll_apply_validation(uuid, uuid, boolean) from public;

create or replace function public.roll_set_validated(p_session uuid, p_validated boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.sessions := app_private.checkin_authorize(p_session);
  v_no_shows integer := 0;
begin
  if p_validated then
    if v_session.status <> 'scheduled' then
      raise exception 'coachos:session_cancelled' using errcode = 'P0001';
    end if;
    v_no_shows := app_private.roll_apply_validation(p_session, v_uid, false);
    perform app_private.write_audit(v_session.academy_id, v_uid, 'roll.validated', 'session', p_session,
      jsonb_build_object('no_shows', v_no_shows));
  else
    update public.session_checkins set validated_at = null, validated_by = null, validated_auto = false where session_id = p_session;
    perform app_private.write_audit(v_session.academy_id, v_uid, 'roll.reopened', 'session', p_session, '{}'::jsonb);
  end if;
  return jsonb_build_object('validated', p_validated, 'no_shows', v_no_shows);
end
$$;

-- Tâche planifiée (app_server). Renvoie { closed, failed, no_shows }.
create function app_private.close_due_rolls() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_n integer;
  v_closed integer := 0;
  v_failed integer := 0;
  v_no_shows integer := 0;
begin
  for r in
    select s.id, s.academy_id
    from public.sessions s
    join public.academies a on a.id = s.academy_id
    left join public.session_checkins c on c.session_id = s.id
    where s.status = 'scheduled'
      and s.starts_at > now() - interval '3 days'
      and (s.ends_at at time zone a.timezone)::date < (now() at time zone a.timezone)::date
      and c.validated_at is null
    order by s.starts_at
    limit 500
  loop
    begin
      v_n := app_private.roll_apply_validation(r.id, null, true);
      if v_n >= 0 then
        perform app_private.write_audit(r.academy_id, null, 'roll.auto_closed', 'session', r.id, jsonb_build_object('no_shows', v_n));
        v_closed := v_closed + 1;
        v_no_shows := v_no_shows + v_n;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'coachos: close_due_rolls session % : %', r.id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('closed', v_closed, 'failed', v_failed, 'no_shows', v_no_shows);
end
$$;
revoke all on function app_private.close_due_rolls() from public, anon, authenticated;
grant execute on function app_private.close_due_rolls() to app_server;
