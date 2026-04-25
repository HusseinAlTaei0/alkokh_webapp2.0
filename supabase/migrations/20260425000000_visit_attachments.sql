-- ============================================
-- VISIT ATTACHMENTS — صور تحاليل الحالة
-- يسمح للأطباء بإرفاق صور التحاليل بكل حالة
-- وعرضها لاحقاً للطبيب الأساسي والمتعاونين
-- ============================================

CREATE TABLE IF NOT EXISTS visit_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  uploaded_by UUID REFERENCES doctors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visit_attachments_visit
  ON visit_attachments(visit_id, created_at DESC);

ALTER TABLE visit_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "visit_attachments_doctor_crud" ON visit_attachments;
CREATE POLICY "visit_attachments_doctor_crud" ON visit_attachments
  FOR ALL
  USING (is_doctor())
  WITH CHECK (is_doctor());

-- ============================================
-- BUCKET: visit-attachments
-- ⚠️ يجب أيضاً إنشاء البكت من لوحة Supabase
--    Storage > Create bucket > Name: visit-attachments > Private
-- ============================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('visit-attachments', 'visit-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- سياسات storage.objects للأطباء فقط
DROP POLICY IF EXISTS "visit_attachments_storage_select" ON storage.objects;
CREATE POLICY "visit_attachments_storage_select" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'visit-attachments' AND is_doctor());

DROP POLICY IF EXISTS "visit_attachments_storage_insert" ON storage.objects;
CREATE POLICY "visit_attachments_storage_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'visit-attachments' AND is_doctor());

DROP POLICY IF EXISTS "visit_attachments_storage_delete" ON storage.objects;
CREATE POLICY "visit_attachments_storage_delete" ON storage.objects
  FOR DELETE
  USING (bucket_id = 'visit-attachments' AND is_doctor());
