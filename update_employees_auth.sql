-- تحديث جدول الموظفين ليدعم ربطهم بحسابات Supabase Auth
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL UNIQUE;

-- إضافة سياسة تسمح للموظف بقراءة بياناته الخاصة بناءً على الـ UUID
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'employees' AND policyname = 'employees_read_self'
    ) THEN
        ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "employees_read_self" ON public.employees
        FOR SELECT USING (auth_user_id = auth.uid());
    END IF;
END $$;
