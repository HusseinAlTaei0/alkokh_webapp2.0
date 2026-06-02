-- ============================================================
-- BAYTAR Security Patch v1.0
-- تُطبَّق فوق baytar_schema.sql الموجود
-- ============================================================

-- 1. دالة مساعدة: هل المستخدم الحالي أدمن؟
CREATE OR REPLACE FUNCTION is_clinic_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM doctors
     WHERE auth_user_id = auth.uid()
       AND is_active = true
     LIMIT 1),
    false
  );
$$;
REVOKE EXECUTE ON FUNCTION is_clinic_admin() FROM anon;

-- ============================================================
-- 2. إصلاح C1: doctors — كتابة للأدمن فقط
-- ============================================================
DROP POLICY IF EXISTS doctors_isolation ON doctors;

CREATE POLICY doctors_select ON doctors
  FOR SELECT
  USING (clinic_id = get_my_clinic_id());

CREATE POLICY doctors_admin_insert ON doctors
  FOR INSERT
  WITH CHECK (
    clinic_id = get_my_clinic_id()
    AND is_clinic_admin()
  );

CREATE POLICY doctors_admin_update ON doctors
  FOR UPDATE
  USING  (clinic_id = get_my_clinic_id() AND is_clinic_admin())
  WITH CHECK (clinic_id = get_my_clinic_id() AND is_clinic_admin());

CREATE POLICY doctors_admin_delete ON doctors
  FOR DELETE
  USING (clinic_id = get_my_clinic_id() AND is_clinic_admin());

-- ============================================================
-- 3. إصلاح I1: clinics — تعديل للأدمن فقط
-- ============================================================
DROP POLICY IF EXISTS clinics_isolation ON clinics;

CREATE POLICY clinics_select ON clinics
  FOR SELECT
  USING (id = get_my_clinic_id());

CREATE POLICY clinics_admin_update ON clinics
  FOR UPDATE
  USING  (id = get_my_clinic_id() AND is_clinic_admin())
  WITH CHECK (id = get_my_clinic_id() AND is_clinic_admin());

-- INSERT/DELETE عبر Edge Functions (service_role) فقط — لا policy هنا

-- ============================================================
-- 4. إضافة WITH CHECK الصريحة لكل الجداول (دفاع عمقي)
-- ============================================================

DROP POLICY IF EXISTS customers_isolation         ON customers;
DROP POLICY IF EXISTS patients_isolation          ON patients;
DROP POLICY IF EXISTS visits_isolation            ON visits;
DROP POLICY IF EXISTS visit_symptoms_isolation    ON visit_symptoms;
DROP POLICY IF EXISTS visit_attachments_isolation ON visit_attachments;
DROP POLICY IF EXISTS visit_notes_isolation       ON visit_notes;
DROP POLICY IF EXISTS visit_collaborators_isolation ON visit_collaborators;
DROP POLICY IF EXISTS visit_appointments_isolation ON visit_appointments;
DROP POLICY IF EXISTS chat_messages_isolation     ON chat_messages;
DROP POLICY IF EXISTS ai_reports_isolation        ON ai_reports;
DROP POLICY IF EXISTS messages_log_isolation      ON messages_log;

CREATE POLICY customers_isolation ON customers
  FOR ALL USING (clinic_id = get_my_clinic_id())
  WITH CHECK (clinic_id = get_my_clinic_id());

CREATE POLICY patients_isolation ON patients
  FOR ALL USING (clinic_id = get_my_clinic_id())
  WITH CHECK (clinic_id = get_my_clinic_id());

CREATE POLICY visits_isolation ON visits
  FOR ALL USING (clinic_id = get_my_clinic_id())
  WITH CHECK (clinic_id = get_my_clinic_id());

CREATE POLICY visit_symptoms_isolation ON visit_symptoms
  FOR ALL USING (clinic_id = get_my_clinic_id())
  WITH CHECK (clinic_id = get_my_clinic_id());

CREATE POLICY visit_attachments_isolation ON visit_attachments
  FOR ALL USING (clinic_id = get_my_clinic_id())
  WITH CHECK (clinic_id = get_my_clinic_id());

CREATE POLICY visit_notes_isolation ON visit_notes
  FOR ALL USING (clinic_id = get_my_clinic_id())
  WITH CHECK (clinic_id = get_my_clinic_id());

CREATE POLICY visit_collaborators_isolation ON visit_collaborators
  FOR ALL USING (clinic_id = get_my_clinic_id())
  WITH CHECK (clinic_id = get_my_clinic_id());

CREATE POLICY visit_appointments_isolation ON visit_appointments
  FOR ALL USING (clinic_id = get_my_clinic_id())
  WITH CHECK (clinic_id = get_my_clinic_id());

CREATE POLICY chat_messages_isolation ON chat_messages
  FOR ALL USING (clinic_id = get_my_clinic_id())
  WITH CHECK (clinic_id = get_my_clinic_id());

CREATE POLICY ai_reports_isolation ON ai_reports
  FOR ALL USING (clinic_id = get_my_clinic_id())
  WITH CHECK (clinic_id = get_my_clinic_id());

CREATE POLICY messages_log_isolation ON messages_log
  FOR ALL USING (clinic_id = get_my_clinic_id())
  WITH CHECK (clinic_id = get_my_clinic_id());
