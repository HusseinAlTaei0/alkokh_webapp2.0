-- ============================================================
-- BAYTAR — Cron Jobs للمهام المجدولة (send-reminders)
-- مطبّقة فعلاً على المشروع. هذا الملف للتوثيق/إعادة الإنشاء.
-- الأسرار تُقرأ من Vault وقت التنفيذ (project_url, service_role_key).
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- (أ) يومي 07:00 UTC (10:00 بغداد) → reminder_24h (مواعيد الغد)
select cron.schedule(
  'baytar_reminders_daily',
  '0 7 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{"task":"daily"}'::jsonb
  );
  $$
);

-- (ب) كل ساعة عند الدقيقة 0 → reminder_2h + feedback_request
select cron.schedule(
  'baytar_reminders_hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{"task":"hourly"}'::jsonb
  );
  $$
);

-- للتحقق:
-- select jobid, jobname, schedule, active from cron.job order by jobid;
-- select * from cron.job_run_details order by start_time desc limit 10;
