import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-setup-secret',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // حماية: مفتاح سري للإعداد فقط
    const secret = req.headers.get('x-setup-secret')
    if (secret !== Deno.env.get('SETUP_SECRET'))
      return json({ error: 'Unauthorized' }, 401)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const {
      clinic_name, clinic_slug, clinic_phone, clinic_address,
      admin_email, admin_password, admin_display_name, admin_full_name
    } = await req.json()

    // 1. إنشاء العيادة (service_role يتجاوز RLS)
    const { data: clinic, error: clinicErr } = await supabaseAdmin
      .from('clinics')
      .insert({
        name: clinic_name, slug: clinic_slug,
        phone: clinic_phone, address: clinic_address,
        is_active: true
      })
      .select().single()

    if (clinicErr) return json({ error: clinicErr.message }, 400)

    // 2. إنشاء حساب Auth للأدمن
    const { data: authUser, error: authErr } =
      await supabaseAdmin.auth.admin.createUser({
        email: admin_email, password: admin_password, email_confirm: true
      })

    if (authErr || !authUser.user) {
      await supabaseAdmin.from('clinics').delete().eq('id', clinic.id)
      return json({ error: authErr?.message }, 400)
    }

    // 3. إنشاء سجل الأدمن مع clinic_id صريح
    const { data: doctor, error: docErr } = await supabaseAdmin
      .from('doctors')
      .insert({
        clinic_id:    clinic.id,            // صريح — لا trigger هنا
        auth_user_id: authUser.user.id,
        display_name: admin_display_name,
        full_name:    admin_full_name,
        is_admin:  true,
        is_active: true,
        avatar_color: '#6366f1'
      })
      .select().single()

    if (docErr) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id)
      await supabaseAdmin.from('clinics').delete().eq('id', clinic.id)
      return json({ error: docErr.message }, 400)
    }

    return json({ success: true, clinic, doctor })

  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return json({ error: msg }, 500)
  }
})

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
