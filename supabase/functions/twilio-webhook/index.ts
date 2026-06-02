import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// هذه الدالة تستقبل status updates من Twilio
// لا تحتاج JWT — Twilio يتصل بها مباشرة
serve(async (req) => {
  try {
    if (req.method !== 'POST')
      return new Response('Method Not Allowed', { status: 405 })

    const form = await req.formData()

    const messageSid    = form.get('MessageSid')?.toString()
    const messageStatus = form.get('MessageStatus')?.toString()
    const errorCode     = form.get('ErrorCode')?.toString() ?? null

    if (!messageSid || !messageStatus)
      return new Response('Bad Request', { status: 400 })

    // تحويل Twilio status → BAYTAR status
    const statusMap: Record<string, string> = {
      queued:      'pending',
      sending:     'pending',
      sent:        'sent',
      delivered:   'delivered',
      read:        'read',
      failed:      'failed',
      undelivered: 'failed',
    }

    const ourStatus = statusMap[messageStatus] ?? 'pending'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')              ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    await supabase
      .from('messages_log')
      .update({
        status:        ourStatus,
        error_message: errorCode,
        updated_at:    new Date().toISOString(),
      })
      .eq('twilio_sid', messageSid)

    // Twilio يتوقع 200 OK
    return new Response('OK', { status: 200 })

  } catch (e) {
    console.error('Webhook error:', e)
    return new Response('Internal Error', { status: 500 })
  }
})
