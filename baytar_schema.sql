-- ============================================================
-- BAYTAR Schema v1.0 — Multi-tenant Veterinary SaaS
-- ============================================================


-- ============================================================
-- 1. CLINICS (جدول العيادات — أساس الـ multi-tenancy)
-- ============================================================
CREATE TABLE clinics (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  slug            TEXT        UNIQUE NOT NULL,
  phone           TEXT,
  address         TEXT,
  working_hours   JSONB       DEFAULT '{}',
  is_active       BOOLEAN     DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- 2. DOCTORS (موظفو العيادة)
-- ============================================================
CREATE TABLE doctors (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  auth_user_id    UUID        UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name    TEXT        NOT NULL,
  full_name       TEXT,
  specialization  TEXT,
  phone           TEXT,
  is_admin        BOOLEAN     DEFAULT false,
  is_active       BOOLEAN     DEFAULT true,
  is_operator     BOOLEAN     DEFAULT false,
  avatar_color    TEXT        DEFAULT '#6366f1',
  bio             TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_doctors_auth_user_id ON doctors(auth_user_id);
CREATE INDEX idx_doctors_clinic_id    ON doctors(clinic_id);


-- ============================================================
-- 3. HELPER FUNCTION — قلب الـ RLS
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_clinic_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT clinic_id FROM doctors
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;


-- ============================================================
-- 4. AUTO clinic_id TRIGGER
-- الـ frontend ما يحتاج يرسل clinic_id — الـ trigger يضيفه
-- ============================================================
CREATE OR REPLACE FUNCTION auto_set_clinic_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.clinic_id IS NULL THEN
    NEW.clinic_id := get_my_clinic_id();
  END IF;
  RETURN NEW;
END;
$$;


-- ============================================================
-- 5. MEDICAL TABLES
-- ============================================================

-- أصحاب الحيوانات
CREATE TABLE customers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  phone       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_customers_clinic_id ON customers(clinic_id);
CREATE INDEX idx_customers_phone     ON customers(clinic_id, phone);

-- الحيوانات
CREATE TABLE patients (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  customer_id  UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  animal_type  TEXT,
  age_months   INTEGER,
  breed        TEXT,
  gender       TEXT,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_patients_clinic_id   ON patients(clinic_id);
CREATE INDEX idx_patients_customer_id ON patients(customer_id);

-- الزيارات الطبية
CREATE TABLE visits (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id            UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  customer_id          UUID        REFERENCES customers(id),
  patient_id           UUID        REFERENCES patients(id),
  primary_doctor_id    UUID        REFERENCES doctors(id),
  status               TEXT        DEFAULT 'waiting'
                                   CHECK (status IN ('waiting','in_progress','completed','cancelled')),
  severity             TEXT,
  diagnosis            TEXT,
  treatment            TEXT,
  intake_customer_name TEXT,
  intake_phone         TEXT,
  intake_area          TEXT,
  intake_animal_type   TEXT,
  intake_animal_age    TEXT,
  intake_notes         TEXT,
  accepted_at          TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_visits_clinic_id  ON visits(clinic_id);
CREATE INDEX idx_visits_status     ON visits(clinic_id, status);
CREATE INDEX idx_visits_patient_id ON visits(patient_id);

-- أعراض الزيارة
CREATE TABLE visit_symptoms (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  visit_id     UUID        NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  symptom_key  TEXT        NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_visit_symptoms_visit_id ON visit_symptoms(visit_id);

-- مرفقات الزيارة
CREATE TABLE visit_attachments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  visit_id      UUID        NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  storage_path  TEXT        NOT NULL,
  file_name     TEXT,
  mime_type     TEXT,
  size_bytes    INTEGER,
  uploaded_by   UUID        REFERENCES doctors(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_visit_attachments_visit_id ON visit_attachments(visit_id);

-- ملاحظات الزيارة
CREATE TABLE visit_notes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  visit_id   UUID        NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  doctor_id  UUID        REFERENCES doctors(id),
  note       TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_visit_notes_visit_id ON visit_notes(visit_id);

-- أطباء مشاركون في الزيارة
CREATE TABLE visit_collaborators (
  visit_id    UUID        NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  doctor_id   UUID        NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  invited_by  UUID        REFERENCES doctors(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (visit_id, doctor_id)
);
CREATE INDEX idx_visit_collaborators_doctor_id ON visit_collaborators(doctor_id);

-- مواعيد المتابعة
CREATE TABLE visit_appointments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  visit_id     UUID        REFERENCES visits(id),
  patient_id   UUID        REFERENCES patients(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  purpose      TEXT,
  created_by   UUID        REFERENCES doctors(id),
  status       TEXT        DEFAULT 'scheduled',
  attended_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_visit_appointments_clinic_id  ON visit_appointments(clinic_id);
CREATE INDEX idx_visit_appointments_patient_id ON visit_appointments(patient_id);

-- چات الفريق الداخلي
CREATE TABLE chat_messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  channel    TEXT        DEFAULT 'general',
  content    TEXT        NOT NULL,
  sender_id  UUID        REFERENCES doctors(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_chat_messages_channel ON chat_messages(clinic_id, channel);

-- تقارير الذكاء الصناعي
CREATE TABLE ai_reports (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  report_type   TEXT,
  period_start  DATE,
  period_end    DATE,
  content_md    TEXT,
  generated_by  UUID        REFERENCES doctors(id),
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ai_reports_clinic_id ON ai_reports(clinic_id);


-- ============================================================
-- 6. MESSAGES LOG (Twilio tracking — جديد)
-- ============================================================
CREATE TABLE messages_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  visit_id        UUID        REFERENCES visits(id),
  recipient_phone TEXT        NOT NULL,
  message_type    TEXT        NOT NULL,
  status          TEXT        DEFAULT 'pending'
                              CHECK (status IN ('pending','sent','delivered','failed','read')),
  twilio_sid      TEXT,
  error_message   TEXT,
  sent_at         TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_messages_log_clinic_id  ON messages_log(clinic_id);
CREATE INDEX idx_messages_log_twilio_sid ON messages_log(twilio_sid);


-- ============================================================
-- 7. APPLY AUTO TRIGGERS على كل الجداول
-- ============================================================
CREATE TRIGGER trg_customers_clinic_id
  BEFORE INSERT ON customers
  FOR EACH ROW EXECUTE FUNCTION auto_set_clinic_id();

CREATE TRIGGER trg_patients_clinic_id
  BEFORE INSERT ON patients
  FOR EACH ROW EXECUTE FUNCTION auto_set_clinic_id();

CREATE TRIGGER trg_visits_clinic_id
  BEFORE INSERT ON visits
  FOR EACH ROW EXECUTE FUNCTION auto_set_clinic_id();

CREATE TRIGGER trg_visit_symptoms_clinic_id
  BEFORE INSERT ON visit_symptoms
  FOR EACH ROW EXECUTE FUNCTION auto_set_clinic_id();

CREATE TRIGGER trg_visit_attachments_clinic_id
  BEFORE INSERT ON visit_attachments
  FOR EACH ROW EXECUTE FUNCTION auto_set_clinic_id();

CREATE TRIGGER trg_visit_notes_clinic_id
  BEFORE INSERT ON visit_notes
  FOR EACH ROW EXECUTE FUNCTION auto_set_clinic_id();

CREATE TRIGGER trg_visit_collaborators_clinic_id
  BEFORE INSERT ON visit_collaborators
  FOR EACH ROW EXECUTE FUNCTION auto_set_clinic_id();

CREATE TRIGGER trg_visit_appointments_clinic_id
  BEFORE INSERT ON visit_appointments
  FOR EACH ROW EXECUTE FUNCTION auto_set_clinic_id();

CREATE TRIGGER trg_chat_messages_clinic_id
  BEFORE INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION auto_set_clinic_id();

CREATE TRIGGER trg_ai_reports_clinic_id
  BEFORE INSERT ON ai_reports
  FOR EACH ROW EXECUTE FUNCTION auto_set_clinic_id();

CREATE TRIGGER trg_messages_log_clinic_id
  BEFORE INSERT ON messages_log
  FOR EACH ROW EXECUTE FUNCTION auto_set_clinic_id();


-- ============================================================
-- 8. ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE clinics            ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors            ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits             ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_symptoms     ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_attachments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_notes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_reports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages_log       ENABLE ROW LEVEL SECURITY;

-- كل جدول: المستخدم يشوف فقط بيانات عيادته
CREATE POLICY "clinics_isolation"
  ON clinics FOR ALL USING (id = get_my_clinic_id());

CREATE POLICY "doctors_isolation"
  ON doctors FOR ALL USING (clinic_id = get_my_clinic_id());

CREATE POLICY "customers_isolation"
  ON customers FOR ALL USING (clinic_id = get_my_clinic_id());

CREATE POLICY "patients_isolation"
  ON patients FOR ALL USING (clinic_id = get_my_clinic_id());

CREATE POLICY "visits_isolation"
  ON visits FOR ALL USING (clinic_id = get_my_clinic_id());

CREATE POLICY "visit_symptoms_isolation"
  ON visit_symptoms FOR ALL USING (clinic_id = get_my_clinic_id());

CREATE POLICY "visit_attachments_isolation"
  ON visit_attachments FOR ALL USING (clinic_id = get_my_clinic_id());

CREATE POLICY "visit_notes_isolation"
  ON visit_notes FOR ALL USING (clinic_id = get_my_clinic_id());

CREATE POLICY "visit_collaborators_isolation"
  ON visit_collaborators FOR ALL USING (clinic_id = get_my_clinic_id());

CREATE POLICY "visit_appointments_isolation"
  ON visit_appointments FOR ALL USING (clinic_id = get_my_clinic_id());

CREATE POLICY "chat_messages_isolation"
  ON chat_messages FOR ALL USING (clinic_id = get_my_clinic_id());

CREATE POLICY "ai_reports_isolation"
  ON ai_reports FOR ALL USING (clinic_id = get_my_clinic_id());

CREATE POLICY "messages_log_isolation"
  ON messages_log FOR ALL USING (clinic_id = get_my_clinic_id());


-- ============================================================
-- 9. REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE visits;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;


-- ============================================================
-- 10. STORAGE BUCKET
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('visit-attachments', 'visit-attachments', false);

-- المسار المتوقع: {clinic_id}/{visit_id}/{filename}
-- كل عيادة تشوف فقط مجلدها

CREATE POLICY "clinic_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'visit-attachments'
    AND (storage.foldername(name))[1] = get_my_clinic_id()::text
  );

CREATE POLICY "clinic_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'visit-attachments'
    AND (storage.foldername(name))[1] = get_my_clinic_id()::text
  );

CREATE POLICY "clinic_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'visit-attachments'
    AND (storage.foldername(name))[1] = get_my_clinic_id()::text
  );
