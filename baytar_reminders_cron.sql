-- ============================================================
-- BAYTAR — Cron Job للتذكيرات اليومية
-- شغّله مرة واحدة في Supabase SQL Editor
-- ============================================================

-- تفعيل الامتداد
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- جدولة send-reminders يومياً الساعة 07:00 UTC (10:00 بغداد)
select cron.schedule(
  'baytar-appointment-reminders',
  '0 7 * * *',
  $$
  select net.http_post(
    url     := (select value from vault.secrets where name = 'supabase_url')
               || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer '
        || (select value from vault.secrets where name = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);

-- للتحقق:
-- select * from cron.job;
