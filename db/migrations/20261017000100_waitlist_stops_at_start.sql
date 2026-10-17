-- Liste d'attente : aucune promotion automatique une fois le cours commencé.
--
-- Défaut corrigé (audit du 2026-10-17) : une place libérée APRÈS le début du cours (annulation après coup, permise tant que la feuille
-- n'est pas validée ; archivage ou effacement d'une fiche ; capacité modifiée) faisait passer la première personne en attente à « inscrite ».
-- Elle n'en était jamais prévenue (l'e-mail « place confirmée » n'est envoyé que pour un cours à venir), et la validation de la feuille,
-- manuelle ou automatique à minuit, la comptait ABSENTE à un cours où elle n'avait jamais eu de place. Un membre qui n'était pas venu
-- pouvait ainsi annuler après le cours et faire porter l'absence à quelqu'un d'autre.
--
-- Règle : la promotion automatique s'arrête au début du cours, et ne concerne qu'une séance programmée dont la feuille n'est pas validée.
-- Après le début, le coach peut toujours faire passer quelqu'un manuellement (promote_booking), par exemple une personne venue sans place.
create or replace function app_private.promote_waitlist(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sessions;
  v_free integer;
begin
  select * into v_session from public.sessions where id = p_session;
  if v_session.id is null or v_session.status <> 'scheduled' or v_session.starts_at <= now()
     or exists (select 1 from public.session_checkins c where c.session_id = p_session and c.validated_at is not null) then
    return;
  end if;
  if v_session.capacity is null then
    v_free := 1000000;
  else
    v_free := greatest(v_session.capacity - (select count(*) from public.session_bookings where session_id = p_session and status = 'booked'), 0);
  end if;
  update public.session_bookings set status = 'booked', confirmed_at = now()
  where id in (
    select id from public.session_bookings where session_id = p_session and status = 'waitlisted' order by seq limit v_free
  );
end
$$;
revoke all on function app_private.promote_waitlist(uuid) from public;
