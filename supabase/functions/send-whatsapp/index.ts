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

// خريطة نوع الرسالة → اسم سر الـ Template SID (يُضاف بعد موافقة Meta)
const TEMPLATE_ENV: Record<string, string> = {
  booking_received:  'TWILIO_TEMPLATE_BOOKING_RECEIVED',
  booking_confirmed: 'TWILIO_TEMPLATE_BOOKING_CONFIRMED',
  service_started:   'TWILIO_TEMPLATE_SERVICE_STARTED',
  service_completed: 'TWILIO_TEMPLATE_SERVICE_COMPLETED',
  feedback_request:  'TWILIO_TEMPLATE_FEEDBACK_REQUEST',
}

// الرسائل اللي تحتاج تاريخ/ساعة من الموعد المرتبط
const NEEDS_APPOINTMENT = new Set(['booking_received', 'booking_confirmed'])

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
      Deno.env.get('SUPABASE_URL')              ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // تحقق من المستخدم
    const { data: { user }, error: authErr } =
      await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authErr || !user) return json({ error: 'Invalid token' }, 401)

    const { message_type, visit_id } = await req.json()

    if (!message_type || !visit_id)
      return json({ error: 'message_type و visit_id مطلوبان' }, 400)

    if (!(message_type in TEMPLATE_ENV))
      return json({ error: `نوع رسالة غير مدعوم: ${message_type}` }, 400)

    // جلب بيانات الزيارة
    const { data: visit, error: visitErr } = await supabase
      .from('visits')
      .select(`
        id, clinic_id, intake_phone, intake_customer_name, intake_animal_type,
        source_appointment_id,
        clinics!inner ( name ),
        doctors:primary_doctor_id ( display_name ),
        patients:patient_id ( name )
      `)
      .eq('id', visit_id)
      .single()

    if (visitErr || !visit) return json({ error: 'الزيارة غير موجودة' }, 404)

    // booking_confirmed يُرسَل للحجوزات الجديدة فقط (مو زيارات المتابعة)
    if (message_type === 'booking_confirmed' && visit.source_appointment_id) {
      return json({ skipped: true, reason: 'follow-up visit — no booking_confirmed' })
    }

    const phone = visit.intake_phone
    if (!phone) return json({ error: 'لا يوجد رقم هاتف للمريض' }, 400)

    // القيم المشتركة
    const owner  = visit.intake_customer_name ?? 'عزيزي العميل'
    const clinic = (visit.clinics as any).name
    const pet    = (visit.patients as any)?.name ?? visit.intake_animal_type ?? 'حيوانك'
    const doctor = (visit.doctors as any)?.display_name ?? 'الطبيب'

    // تاريخ/ساعة من الموعد المرتبط (للحجز فقط)
    let dateStr = '', timeStr = ''
    if (NEEDS_APPOINTMENT.has(message_type)) {
      const { data: appt } = await supabase
        .from('visit_appointments')
        .select('scheduled_at')
        .eq('visit_id', visit.id)
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!appt?.scheduled_at)
        return json({ error: 'لا يوجد موعد مرتبط بالحجز (مطلوب للتاريخ/الساعة)' }, 400)

      dateStr = fmtDate(appt.scheduled_at)
      timeStr = fmtTime(appt.scheduled_at)
    }

    // بناء متغيرات الـ Template حسب الترتيب المعتمد على Twilio
    let variables: Record<string, string>
    switch (message_type) {
      case 'booking_received':   // {1}صاحب {2}عيادة {3}حيوان {4}تاريخ {5}ساعة
        variables = { '1': owner, '2': clinic, '3': pet, '4': dateStr, '5': timeStr }
        break
      case 'booking_confirmed':  // {1}صاحب {2}عيادة {3}طبيب {4}حيوان {5}تاريخ {6}ساعة
        variables = { '1': owner, '2': clinic, '3': doctor, '4': pet, '5': dateStr, '6': timeStr }
        break
      case 'service_started':    // {1}صاحب {2}طبيب {3}حيوان {4}عيادة
        variables = { '1': owner, '2': doctor, '3': pet, '4': clinic }
        break
      case 'service_completed':  // {1}صاحب {2}حيوان {3}عيادة
        variables = { '1': owner, '2': pet, '3': clinic }
        break
      case 'feedback_request':   // {1}صاحب {2}حيوان
        variables = { '1': owner, '2': pet }
        break
      default:
        return json({ error: 'نوع رسالة غير مدعوم' }, 400)
    }

    const templateSid = Deno.env.get(TEMPLATE_ENV[message_type]) ?? ''

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
      const twilioSid = await sendViaTwilio(phone, templateSid, variables)

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
// تنسيق التاريخ/الساعة بتوقيت بغداد
// ----------------------------------------------------------------
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ar-IQ', {
    weekday: 'long', day: 'numeric', month: 'long',
    timeZone: 'Asia/Baghdad',
  })
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ar-IQ', {
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Baghdad',
  })
}

// ----------------------------------------------------------------
// دالة الإرسال عبر Twilio API
// ----------------------------------------------------------------
async function sendViaTwilio(
  to: string,
  templateSid: string,
  variables: Record<string, string>
): Promise<string> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')    ?? ''
  const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')      ?? ''
  const fromNumber = Deno.env.get('TWILIO_WHATSAPP_NUMBER') ?? ''

  if (!accountSid || !authToken || !fromNumber)
    throw new Error('Twilio credentials غير مضبوطة في Secrets')

  const formattedTo   = formatPhone(to)
  const formattedFrom = fromNumber.startsWith('whatsapp:')
    ? fromNumber : `whatsapp:${fromNumber}`

  const params: Record<string, string> = {
    From: formattedFrom,
    To:   formattedTo,
  }

  // Template SID موجود → Content API (production)
  // فارغ → Sandbox mode (نص عادي للاختبار قبل موافقة Meta)
  if (templateSid) {
    params.ContentSid       = templateSid
    params.ContentVariables = JSON.stringify(variables)
  } else {
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
