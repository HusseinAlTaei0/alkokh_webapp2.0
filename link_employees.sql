-- هذا الكود يربط حسابات تسجيل الدخول (في جدول auth.users) بالموظفين (في جدول public.employees)
-- بالاعتماد على إيميل كل موظف.

UPDATE public.employees e
SET auth_user_id = u.id
FROM auth.users u
WHERE 
  (u.email = 'abbas@alkokh.com' AND e.id = 'e1') OR
  (u.email = 'anwar@alkokh.com' AND e.id = 'e2') OR
  (u.email = 'suheil@alkokh.com' AND e.id = 'e3') OR
  (u.email = 'qasim@alkokh.com' AND e.id = 'e4');
