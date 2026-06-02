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

// Template SIDs من Twilio (تُضاف بعد موافقة Meta)
const TEMPLATES: Record<string, string> = {
  intake_received:      Deno.env.get('TWILIO_TEMPLATE_INTAKE')   ?? '',
  doctor_accepted:      Deno.env.get('TWILIO_TEMPLATE_ACCEPTED') ?? '',
  appointment_reminder: Deno.env.get('TWILIO_TEMPLATE_REMINDER') ?? '',
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
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')            ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // تحقق من المستخدم
    const { data: { user }, error: authErr } =
      await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authErr || !user) return json({ error: 'Invalid token' }, 401)

    const { message_type, visit_id } = await req.json()

    if (!message_type || !visit_id)
      return json({ error: 'message_type و visit_id مطلوبان' }, 400)

    // جلب بيانات الزيارة
    const { data: visit, error: visitErr } = await supabase
      .from('visits')
      .select(`
        id, clinic_id, intake_phone, intake_customer_name, intake_animal_type,
        clinics!inner ( name ),
        doctors:primary_doctor_id ( display_name ),
        patients:patient_id ( name )
      `)
      .eq('id', visit_id)
      .single()

    if (visitErr || !visit) return json({ error: 'الزيارة غير موجودة' }, 404)

    const phone = visit.intake_phone
    if (!phone) return json({ error: 'لا يوجد رقم هاتف للمريض' }, 400)

    // بناء متغيرات الـ Template
    let variables: Record<string, string>

    if (message_type === 'intake_received') {
      variables = {
        '1': visit.intake_customer_name ?? 'عزيزي العميل',
        '2': (visit.clinics as any).name,
        '3': (visit.patients as any)?.name ?? visit.intake_animal_type ?? 'حيوانك',
      }
    } else if (message_type === 'doctor_accepted') {
      variables = {
        '1': visit.intake_customer_name ?? 'عزيزي العميل',
        '2': (visit.doctors as any)?.display_name ?? 'الطبيب',
        '3': (visit.patients as any)?.name ?? visit.intake_animal_type ?? 'حيوانك',
        '4': (visit.clinics as any).name,
      }
    } else {
      return json({ error: 'نوع رسالة غير مدعوم' }, 400)
    }

    // تسجيل مسبق في messages_log
    const { data: logEntry } = await supabase
      .from('messages_log')
      .insert({
        clinic_id:       visit.clinic_id,
        visit_id:        visit.id,
        recipient_phone: phone,
        message_type,
        status:          'pending',
      })
      .select()
      .single()

    // إرسال عبر Twilio
    try {
      const twilioSid = await sendViatwilio(phone, TEMPLATES[message_type], variables)

      if (logEntry) {
        await supabase.from('messages_log').update({
          status:     'sent',
          twilio_sid: twilioSid,
          sent_at:    new Date().toISOString(),
        }).eq('id', logEntry.id)
      }

      return json({ success: true, twilio_sid: twilioSid })

    } catch (sendErr) {
      const errMsg = sendErr instanceof Error ? sendErr.message : 'Twilio error'

      if (logEntry) {
        await supabase.from('messages_log').update({
          status:        'failed',
          error_message: errMsg,
        }).eq('id', logEntry.id)
      }

      return json({ error: errMsg }, 500)
    }

  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500)
  }
})

// ----------------------------------------------------------------
// دالة الإرسال عبر Twilio API
// ----------------------------------------------------------------
async function sendViatwilio(
  to: string,
  templateSid: string,
  variables: Record<string, string>
): Promise<string> {
  const accountSid  = Deno.env.get('TWILIO_ACCOUNT_SID')      ?? ''
  const authToken   = Deno.env.get('TWILIO_AUTH_TOKEN')        ?? ''
  const fromNumber  = Deno.env.get('TWILIO_WHATSAPP_NUMBER')   ?? ''

  if (!accountSid || !authToken || !fromNumber)
    throw new Error('Twilio credentials غير مضبوطة في Secrets')

  const formattedTo   = formatPhone(to)
  const formattedFrom = fromNumber.startsWith('whatsapp:')
    ? fromNumber : `whatsapp:${fromNumber}`

  const params: Record<string, string> = {
    From: formattedFrom,
    To:   formattedTo,
  }

  // لو Template SID موجود → استخدم Content API (production)
  // لو فارغ → Sandbox mode (testing)
  if (templateSid) {
    params.ContentSid       = templateSid
    params.ContentVariables = JSON.stringify(variables)
  } else {
    // Sandbox: أرسل الـ variables كنص عادي للاختبار
    params.Body = Object.entries(variables)
      .map(([k, v]) => `[${k}]: ${v}`)
      .join('\n')
  }

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method:  'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    }
  )

  const result = await resp.json()
  if (!resp.ok) throw new Error(result.message ?? `Twilio HTTP ${resp.status}`)
  return result.sid
}

// ----------------------------------------------------------------
// تنسيق رقم الهاتف العراقي لـ WhatsApp
// ----------------------------------------------------------------
function formatPhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-()]/g, '')
  let intl: string

  if      (cleaned.startsWith('+964')) intl = cleaned
  else if (cleaned.startsWith('964'))  intl = '+' + cleaned
  else if (cleaned.startsWith('07'))   intl = '+964' + cleaned.slice(1)
  else if (cleaned.startsWith('7'))    intl = '+964' + cleaned
  else                                  intl = '+' + cleaned

  return `whatsapp:${intl}`
}
