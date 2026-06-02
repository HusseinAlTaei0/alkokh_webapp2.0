import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// تُشغَّل يومياً الساعة 10 صباحاً بغداد (07:00 UTC)
// ترسل تذكيرات المواعيد المقررة غداً
serve(async (req) => {
  try {
    // حماية بسيطة: service_role فقط يستدعيها
    const auth = req.headers.get('Authorization') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!auth.includes(serviceKey.slice(-20)))
      return new Response('Unauthorized', { status: 401 })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')              ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // مواعيد الغد
    const now       = new Date()
    const tomorrow  = new Date(now)
    tomorrow.setDate(now.getDate() + 1)

    const start = new Date(tomorrow.setHours(0,  0,  0, 0)).toISOString()
    const end   = new Date(tomorrow.setHours(23, 59, 59, 0)).toISOString()

    const { data: appointments } = await supabase
      .from('visit_appointments')
      .select(`
        id, scheduled_at, clinic_id,
        patients!inner (
          name,
          customers!inner ( phone, name )
        ),
        clinics!inner ( name )
      `)
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .eq('status', 'scheduled')

    if (!appointments?.length)
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 })

    let sent = 0, failed = 0

    for (const appt of appointments) {
      try {
        const customer = (appt.patients as any).customers
        const phone    = customer?.phone
        if (!phone) continue

        const dt       = new Date(appt.scheduled_at)
        const dateStr  = dt.toLocaleDateString('ar-IQ', {
          weekday: 'long', month: 'long', day: 'numeric'
        })
        const timeStr  = dt.toLocaleTimeString('ar-IQ', {
          hour: '2-digit', minute: '2-digit'
        })
        const clinicName = (appt.clinics as any).name

        await sendReminder(phone, clinicName, dateStr, timeStr)

        await supabase.from('messages_log').insert({
          clinic_id:       appt.clinic_id,
          visit_id:        null,
          recipient_phone: phone,
          message_type:    'appointment_reminder',
          status:          'sent',
          sent_at:         new Date().toISOString(),
        })

        sent++
      } catch (e) {
        console.error('Reminder failed for:', appt.id, e)
        failed++
      }
    }

    return new Response(
      JSON.stringify({ sent, failed, total: appointments.length }),
      { status: 200 }
    )

  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Error' }),
      { status: 500 }
    )
  }
})

async function sendReminder(
  phone: string,
  clinicName: string,
  date: string,
  time: string
): Promise<void> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')      ?? ''
  const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')        ?? ''
  const fromNumber = Deno.env.get('TWILIO_WHATSAPP_NUMBER')   ?? ''
  const templateSid = Deno.env.get('TWILIO_TEMPLATE_REMINDER') ?? ''

  const to   = formatPhone(phone)
  const from = fromNumber.startsWith('whatsapp:')
    ? fromNumber : `whatsapp:${fromNumber}`

  const params: Record<string, string> = { From: from, To: to }

  if (templateSid) {
    params.ContentSid       = templateSid
    params.ContentVariables = JSON.stringify({ '1': clinicName, '2': date, '3': time })
  } else {
    params.Body = `تذكير 🗓️\nلديك موعد في ${clinicName}\n${date} الساعة ${time}`
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

  if (!resp.ok) {
    const err = await resp.json()
    throw new Error(err.message ?? `HTTP ${resp.status}`)
  }
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
