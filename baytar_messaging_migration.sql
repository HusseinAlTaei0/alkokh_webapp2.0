-- ============================================================
-- BAYTAR — Messaging System Migration
-- يدعم: مراحل الخدمة (قبول→بدأ→انتهى)، تمييز المتابعة،
--       تذكيرات 24h/2h، طلب التقييم (feedback) — كلها مع dedup
-- آمن لإعادة التشغيل (idempotent)
-- ============================================================

-- ── 1) visits: مراحل الخدمة + تمييز المتابعة + dedup التقييم ──
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS service_started_at    timestamptz,
  ADD COLUMN IF NOT EXISTS feedback_sent         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_appointment_id uuid
    REFERENCES public.visit_appointments(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.visits.service_started_at IS
  'وقت ضغط زر "بدأ العمل" (الانتقال accepted → in_progress)';
COMMENT ON COLUMN public.visits.feedback_sent IS
  'علامة منع تكرار رسالة baytar_feedback_request';
COMMENT ON COLUMN public.visits.source_appointment_id IS
  'NULL = حجز جديد | ≠NULL = زيارة متابعة منشأة من هذا الموعد';

-- ── 2) visits.status: إضافة قيمة accepted ──
ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_status_check;
ALTER TABLE public.visits ADD CONSTRAINT visits_status_check
  CHECK (status = ANY (ARRAY[
    'waiting'::text, 'accepted'::text, 'in_progress'::text,
    'completed'::text, 'cancelled'::text
  ]));

-- ── 3) visit_appointments: التذكيرات + dedup + هل الساعة محددة ──
ALTER TABLE public.visit_appointments
  ADD COLUMN IF NOT EXISTS time_specified       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_2h_sent_at  timestamptz;

COMMENT ON COLUMN public.visit_appointments.time_specified IS
  'true = الطبيب حدد ساعة دقيقة (يُرسَل reminder_2h) | false = يوم فقط';
COMMENT ON COLUMN public.visit_appointments.reminder_24h_sent_at IS
  'ختم إرسال تذكير 24 ساعة (dedup)';
COMMENT ON COLUMN public.visit_appointments.reminder_2h_sent_at IS
  'ختم إرسال تذكير الساعتين (dedup)';

-- ── 4) فهارس مساعدة لاستعلامات الـ cron (اختيارية لكن مفيدة) ──
-- مواعيد قادمة غير ملغاة (للتذكيرات)
CREATE INDEX IF NOT EXISTS idx_appt_scheduled_status
  ON public.visit_appointments (scheduled_at)
  WHERE status = 'scheduled';

-- زيارات مكتملة تنتظر تقييم (للـ feedback delay)
CREATE INDEX IF NOT EXISTS idx_visits_completed_feedback
  ON public.visits (completed_at)
  WHERE status = 'completed' AND feedback_sent = false;
