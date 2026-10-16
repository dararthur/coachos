-- Coach OS — « dead man's switch » de la sauvegarde.
--
-- La sauvegarde est lancée par systemd, hors application : si son minuteur s'arrête en silence, rien ne l'annonce (l'alerte OnFailure ne voit
-- que les échecs). Après chaque sauvegarde réussie, systemd signale à l'application « sauvegarde faite » (route /api/cron/heartbeat) ; elle
-- l'enregistre comme les autres tâches et la purge nocturne prévient l'administrateur de la plateforme si le signal manque depuis trop longtemps.
-- Aucune donnée : un nom de tâche et un instant.

alter table public.job_runs drop constraint job_runs_job_check;
alter table public.job_runs add constraint job_runs_job_check check (job in ('reminders', 'close_rolls', 'purge', 'weekly_digest', 'backup'));
