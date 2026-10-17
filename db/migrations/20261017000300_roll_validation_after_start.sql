-- Feuille d'appel : pas de validation avant le début du cours (audit du 2026-10-17).
--
-- Défaut corrigé : rien n'empêchait de valider la feuille d'un cours à venir (le lendemain, la semaine suivante), par exemple en ouvrant
-- la mauvaise séance du planning. La validation marquait alors ABSENTS tous les inscrits d'un cours qui n'avait pas eu lieu, fermait
-- les annulations, et rouvrir la feuille ne retirait pas ces absences (chacune devait être effacée à la main).
--
-- Règle : la validation n'est possible qu'une fois le cours commencé. La réouverture reste toujours possible. La clôture automatique
-- de minuit (close_due_rolls) ne concerne déjà que des cours terminés.
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
    if now() < v_session.starts_at then
      raise exception 'coachos:roll_too_early' using errcode = 'P0001';
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
revoke all on function public.roll_set_validated(uuid, boolean) from public, anon;
grant execute on function public.roll_set_validated(uuid, boolean) to authenticated;
