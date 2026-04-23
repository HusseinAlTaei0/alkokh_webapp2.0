/**
 * Netlify Serverless Function
 * تعالج جميع الطلبات الحساسة والمفاتيح السرية
 * المفاتيح مخفية تماماً عن Frontend 🔒
 */

exports.handler = async (event, context) => {
  // السماح فقط بـ POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { action } = body;

    // راوتر الـ actions المختلفة
    switch (action) {
      case 'send-whatsapp':
        return await handleWhatsAppMessage(body);

      case 'verify-token':
        return await verifyAdminToken(body);

      default:
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Unknown action' })
        };
    }
  } catch (error) {
    console.error('API Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

/**
 * إرسال رسالة WhatsApp بشكل آمن
 * المفاتيح السرية محفوظة في متغيرات البيئة
 */
async function handleWhatsAppMessage(data) {
  const {
    recipientPhone,
    messageBody,
    mediaUrl
  } = data;

  // المفاتيح السرية من متغيرات البيئة Netlify
  const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
  const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

  // تحقق من وجود المفاتيح
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_ID) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'WhatsApp credentials not configured',
        success: false
      })
    };
  }

  try {
    // تحضير الرسالة
    const messagePayload = {
      messaging_product: 'whatsapp',
      to: recipientPhone,
      type: mediaUrl ? 'image' : 'text'
    };

    if (mediaUrl) {
      messagePayload.image = {
        link: mediaUrl
      };
    } else {
      messagePayload.text = {
        body: messageBody
      };
    }

    // إرسال الطلب إلى WhatsApp API
    const response = await fetch(
      `https://graph.instagram.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(messagePayload)
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error?.message || 'Failed to send WhatsApp message');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        messageId: result.messages[0].id
      })
    };
  } catch (error) {
    console.error('WhatsApp Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
}

/**
 * التحقق من token الأدمن بشكل آمن
 * كل الفحوصات تتم بالسيرفر، لا بالمتصفح
 */
async function verifyAdminToken(data) {
  const { token } = data;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!ADMIN_PASSWORD) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Admin credentials not configured',
        isAdmin: false
      })
    };
  }

  // مقارنة secure
  const isAdmin = token === ADMIN_PASSWORD;

  return {
    statusCode: 200,
    body: JSON.stringify({
      isAdmin,
      // لا ترسل السر نفسه أبداً!
    })
  };
}
