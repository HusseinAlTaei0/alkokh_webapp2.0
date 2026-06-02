import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ALLOWED_ORIGINS = [
  Deno.env.get('APP_URL') ?? '',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
].filter(Boolean)

function corsFor(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : (ALLOWED_ORIGINS[0] || '*')
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
  }
}

serve(async (req) => {
  const cors = corsFor(req)
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No authorization header' }, 401)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. تحقق من هوية الأدمن الطالب
    const { data: { user: caller }, error: authErr } =
      await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authErr || !caller) return json({ error: 'Invalid token' }, 401)

    // 2. جيب clinic_id وتأكد إنه أدمن
    const { data: adminDoc } = await supabaseAdmin
      .from('doctors')
      .select('clinic_id, is_admin')
      .eq('auth_user_id', caller.id)
      .single()

    if (!adminDoc)        return json({ error: 'Doctor not found' }, 403)
    if (!adminDoc.is_admin) return json({ error: 'Admins only' }, 403)

    // 3. بيانات الطبيب الجديد
    const {
      email, password, full_name, display_name,
      specialization, phone, is_admin, avatar_color, bio
    } = await req.json()

    // Input validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!email || !emailRegex.test(email))
      return json({ error: 'صيغة الإيميل غير صحيحة' }, 400)
    if (!password || password.length < 8)
      return json({ error: 'كلمة السر يجب أن تكون 8 أحرف على الأقل' }, 400)
    if (!display_name || display_name.trim().length === 0)
      return json({ error: 'الاسم المعروض مطلوب' }, 400)
    if (display_name.length > 100)
      return json({ error: 'الاسم المعروض طويل جداً (100 حرف كحد أقصى)' }, 400)

    // 4. إنشاء حساب Auth
    const { data: newAuth, error: createErr } =
      await supabaseAdmin.auth.admin.createUser({
        email, password, email_confirm: true
      })
    if (createErr || !newAuth.user)
      return json({ error: createErr?.message ?? 'Auth creation failed' }, 400)

    // 5. إنشاء سجل الطبيب بنفس clinic_id الأدمن
    const { data: doctor, error: insertErr } = await supabaseAdmin
      .from('doctors')
      .insert({
        clinic_id:    adminDoc.clinic_id,   // ← نفس العيادة
        auth_user_id: newAuth.user.id,
        display_name, full_name, specialization,
        phone, is_admin: is_admin ?? false,
        is_active: true,
        avatar_color: avatar_color ?? '#6366f1',
        bio
      })
      .select()
      .single()

    if (insertErr) {
      await supabaseAdmin.auth.admin.deleteUser(newAuth.user.id) // rollback
      return json({ error: insertErr.message }, 400)
    }

    return json({ doctor })

  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return json({ error: msg }, 500)
  }
})
