-- =============================================
-- إصلاح شامل لجميع مشاكل تسجيل الدخول والصلاحيات
-- نفّذ هذا الكود في Supabase SQL Editor
-- =============================================

-- =============================================
-- الإصلاح 1: كسر الحلقة المغلقة في سياسة doctors
-- (هذا هو السبب الرئيسي لتعليق تسجيل الدخول)
-- =============================================
DROP POLICY IF EXISTS "doctors_read_authenticated" ON doctors;

CREATE POLICY "doctors_read_authenticated" ON doctors
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- =============================================
-- الإصلاح 2: إضافة عمود is_operator المفقود
-- (بدونه المنظمون لا يستطيعون الدخول)
-- =============================================
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS is_operator BOOLEAN DEFAULT false;

-- تعيين المنظمين
UPDATE doctors SET is_operator = true 
WHERE auth_user_id IN (
  SELECT id FROM auth.users WHERE email IN (
    'baneen@alkokh.com', 'maher@alkokh.com', 
    'ruwaid@alkokh.com', 'rami@alkokh.com'
  )
);

-- =============================================
-- الإصلاح 3: إزالة سياسة employees المتعارضة
-- =============================================
DROP POLICY IF EXISTS "employees_read_self" ON public.employees;
