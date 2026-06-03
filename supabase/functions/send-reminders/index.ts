import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ================================================================
// BAYTAR — المهام المجدولة (تُستدعى من cron):
//   task='daily'  → reminder_24h  (مواعيد الغد)
//   task='hourly' → reminder_2h + feedback_request
//   task='all' / بدون body → الكل (للاختبار اليدوي)
// كل مهمة محميّة بـ dedup عبر أعمدة قاعدة البيانات.
// ================================================================

const OFFSET_BAGHDAD_MS = 3 * 60 * 60 * 1000   // بغداد UTC+3 (بدون توقيت صيفي)

serve(async (req) => {
  try {
    // حماية: service_role فقط
    const auth = req.headers.get('Authorization') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!serviceKey || !auth.includes(serviceKey.slice(-20)))
      return new Response('Unauthorized', { status: 401 })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')              ?? '',
      serviceKey
    )

    const body = await req.json().catch(() => ({}))
    const task: string = body?.task ?? 'all'

    const result: Record<string, unknown> = { task }

    if (task === 'daily' || task === 'all')
      result.reminder_24h = await runReminder24h(supabase)

    if (task === 'hourly' || task === 'all') {
      result.reminder_2h = await runReminder2h(supabase)
      result.feedback    = await runFeedback(supabase)
    }

    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })

  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

// ----------------------------------------------------------------
// 1) تذكير 24 ساعة — مواعيد الغد (بتقويم بغداد) لم تُذكَّر بعد
// ----------------------------------------------------------------
async function runReminder24h(supabase: any) {
  const { start, end } = baghdadTomorrowBounds()

  const { data: appts, error } = await supabase
    .from('visit_appointments')
    .select(`
      id, scheduled_at, clinic_id, visit_id, time_specified,
      patients!inner ( name, customers!inner ( phone, name ) ),
      clinics!inner ( name )
    `)
    .eq('status', 'scheduled')
    .is('reminder_24h_sent_at', null)
    .gte('scheduled_at', start)
    .lte('scheduled_at', end)

  if (error) return { error: error.message }
  if (!appts?.length) return { sent: 0, total: 0 }

  let sent = 0, failed = 0
  for (const a of appts) {
    const customer = a.patients?.customers
    const phone    = customer?.phone
    if (!phone) continue

    const variables = {
      '1': customer?.name ?? 'عزيزي العميل',                                 // صاحب الحيوان
      '2': a.patients?.name ?? 'حيوانك',                                      // الحيوان
      '3': fmtDate(a.scheduled_at),                                          // التاريخ
      '4': a.time_specified ? fmtTime(a.scheduled_at) : 'سيتم التأكيد',      // الساعة
    }

    try {
      await sendTemplate(supabase, {
        messageType: 'reminder_24h',
        templateEnv: 'TWILIO_TEMPLATE_REMINDER_24H',
        phone, variables,
        clinic_id: a.clinic_id, visit_id: a.visit_id,
      })
      await supabase.from('visit_appointments')
        .update({ reminder_24h_sent_at: new Date().toISOString() })
        .eq('id', a.id)
      sent++
    } catch (e) {
      console.error('reminder_24h failed:', a.id, e)
      failed++
    }
  }
  return { sent, failed, total: appts.length }
}

// ----------------------------------------------------------------
// 2) تذكير الساعتين — مواعيد خلال ~2.5 ساعة، ساعة محددة، لم تُذكَّر
// ----------------------------------------------------------------
async function runReminder2h(supabase: any) {
  const now = Date.now()
  const start = new Date(now).toISOString()
  const end   = new Date(now + 150 * 60 * 1000).toISOString()  // حتى 2.5 ساعة قدّام

  const { data: appts, error } = await supabase
    .from('visit_appointments')
    .select(`
      id, scheduled_at, clinic_id, visit_id,
      patients!inner ( name, customers!inner ( phone, name ) ),
      clinics!inner ( name )
    `)
    .eq('status', 'scheduled')
    .eq('time_specified', true)
    .is('reminder_2h_sent_at', null)
    .gte('scheduled_at', start)
    .lte('scheduled_at', end)

  if (error) return { error: error.message }
  if (!appts?.length) return { sent: 0, total: 0 }

  let sent = 0, failed = 0
  for (const a of appts) {
    const customer = a.patients?.customers
    const phone    = customer?.phone
    if (!phone) continue

    const variables = {
      '1': customer?.name ?? 'عزيزي العميل',   // صاحب الحيوان
      '2': a.clinics?.name ?? 'العيادة',        // العيادة
      '3': fmtTime(a.scheduled_at),             // الساعة
    }

    try {
      await sendTemplate(supabase, {
        messageType: 'reminder_2h',
        templateEnv: 'TWILIO_TEMPLATE_REMINDER_2H',
        phone, variables,
        clinic_id: a.clinic_id, visit_id: a.visit_id,
      })
      await supabase.from('visit_appointments')
        .update({ reminder_2h_sent_at: new Date().toISOString() })
        .eq('id', a.id)
      sent++
    } catch (e) {
      console.error('reminder_2h failed:', a.id, e)
      failed++
    }
  }
  return { sent, failed, total: appts.length }
}

// ----------------------------------------------------------------
// 3) طلب التقييم — زيارات مكتملة قبل >2h، بدون موعد قادم، لم تُرسَل
// ----------------------------------------------------------------
async function runFeedback(supabase: any) {
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const nowIso = new Date().toISOString()

  const { data: visits, error } = await supabase
    .from('visits')
    .select(`
      id, clinic_id, intake_phone, intake_customer_name, intake_animal_type,
      patients:patient_id ( name )
    `)
    .eq('status', 'completed')
    .eq('feedback_sent', false)
    .lte('completed_at', cutoff)

  if (error) return { error: error.message }
  if (!visits?.length) return { sent: 0, total: 0 }

  let sent = 0, failed = 0, skipped = 0
  for (const v of visits) {
    // شرط: ماكو موعد متابعة قادم لهذه الزيارة
    const { count } = await supabase
      .from('visit_appointments')
      .select('id', { count: 'exact', head: true })
      .eq('visit_id', v.id)
      .eq('status', 'scheduled')
      .gt('scheduled_at', nowIso)

    if ((count ?? 0) > 0) { skipped++; continue }   // عنده موعد قادم → لا تقييم

    const phone = v.intake_phone
    if (!phone) { skipped++; continue }

    const variables = {
      '1': v.intake_customer_name ?? 'عزيزي العميل',                      // صاحب الحيوان
      '2': (v.patients as any)?.name ?? v.intake_animal_type ?? 'حيوانك', // الحيوان
    }

    try {
      await sendTemplate(supabase, {
        messageType: 'feedback_request',
        templateEnv: 'TWILIO_TEMPLATE_FEEDBACK_REQUEST',
        phone, variables,
        clinic_id: v.clinic_id, visit_id: v.id,
      })
      await supabase.from('visits')
        .update({ feedback_sent: true })
        .eq('id', v.id)
      sent++
    } catch (e) {
      console.error('feedback failed:', v.id, e)
      failed++
    }
  }
  return { sent, failed, skipped, total: visits.length }
}

// ----------------------------------------------------------------
// إرسال template عبر Twilio + تسجيل في messages_log
// ----------------------------------------------------------------
async function sendTemplate(supabase: any, opts: {
  messageType: string
  templateEnv: string
  phone: string
  variables: Record<string, string>
  clinic_id: string
  visit_id: string | null
}) {
  const templateSid = Deno.env.get(opts.templateEnv) ?? ''
  try {
    const twilioSid = await sendViaTwilio(opts.phone, templateSid, opts.variables)
    await supabase.from('messages_log').insert({
      clinic_id:       opts.clinic_id,
      visit_id:        opts.visit_id,
      recipient_phone: opts.phone,
      message_type:    opts.messageType,
      status:          'sent',
      twilio_sid:      twilioSid,
      sent_at:         new Date().toISOString(),
    })
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Twilio error'
    await supabase.from('messages_log').insert({
      clinic_id:       opts.clinic_id,
      visit_id:        opts.visit_id,
      recipient_phone: opts.phone,
      message_type:    opts.messageType,
      status:          'failed',
      error_message:   errMsg,
    })
    throw e   // عشان المُستدعي ما يختم الـ dedup
  }
}

// ----------------------------------------------------------------
// أدوات مساعدة
// ----------------------------------------------------------------
function baghdadTomorrowBounds() {
  // حدود "غداً" بتقويم بغداد، مُعبَّر عنها UTC ISO
  const nowBg = new Date(Date.now() + OFFSET_BAGHDAD_MS)
  const y = nowBg.getUTCFullYear(), m = nowBg.getUTCMonth(), d = nowBg.getUTCDate()
  const startUtcMs = Date.UTC(y, m, d + 1, 0, 0, 0) - OFFSET_BAGHDAD_MS
  const endUtcMs   = startUtcMs + 24 * 60 * 60 * 1000 - 1000
  return { start: new Date(startUtcMs).toISOString(), end: new Date(endUtcMs).toISOString() }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ar-IQ', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Baghdad',
  })
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ar-IQ', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Baghdad',
  })
}

async function sendViaTwilio(
  to: string, templateSid: string, variables: Record<string, string>
): Promise<string> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')    ?? ''
  const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')      ?? ''
  const fromNumber = Deno.env.get('TWILIO_WHATSAPP_NUMBER') ?? ''
  if (!accountSid || !authToken || !fromNumber)
    throw new Error('Twilio credentials غير مضبوطة في Secrets')

  const to2   = formatPhone(to)
  const from2 = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`

  const params: Record<string, string> = { From: from2, To: to2 }
  if (templateSid) {
    params.ContentSid       = templateSid
    params.ContentVariables = JSON.stringify(variables)
  } else {
    params.Body = Object.entries(variables).map(([k, v]) => `[${k}]: ${v}`).join('\n')
  }

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
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

function formatPhone(phone: string): string {
  const c = phone.replace(/[\s\-()]/g, '')
  let intl: string
  if      (c.startsWith('+964')) intl = c
  else if (c.startsWith('964'))  intl = '+' + c
  else if (c.startsWith('07'))   intl = '+964' + c.slice(1)
  else if (c.startsWith('7'))    intl = '+964' + c
  else                            intl = '+' + c
  return `whatsapp:${intl}`
}
