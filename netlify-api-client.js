/**
 * Netlify API Client
 * استخدم هذا الملف في Frontend بدل استخدام المفاتيح السرية مباشرة
 *
 * مثال الاستخدام:
 * import { sendWhatsAppMessage } from './netlify-api-client.js';
 * await sendWhatsAppMessage('+966501234567', 'Hello World');
 */

const API_ENDPOINT = '/.netlify/functions/api';

/**
 * إرسال رسالة WhatsApp
 * @param {string} recipientPhone - رقم الهاتف المستقبل (مثل: +966501234567)
 * @param {string} messageBody - نص الرسالة
 * @param {string} mediaUrl - رابط الصورة (اختياري)
 * @returns {Promise<Object>} النتيجة {success, messageId, error}
 */
export async function sendWhatsAppMessage(recipientPhone, messageBody, mediaUrl = null) {
  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'send-whatsapp',
        recipientPhone,
        messageBody,
        mediaUrl
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to send WhatsApp message:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * التحقق من كون المستخدم أدمن
 * @param {string} token - كلمة المرور
 * @returns {Promise<Object>} النتيجة {isAdmin}
 */
export async function verifyAdminAccess(token) {
  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'verify-token',
        token
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to verify admin access:', error);
    return {
      isAdmin: false
    };
  }
}

/**
 * دالة عامة لأي طلب API
 * @param {string} action - اسم الـ action
 * @param {Object} data - البيانات المطلوبة
 * @returns {Promise<Object>} النتيجة
 */
export async function callNetlifyAPI(action, data = {}) {
  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action,
        ...data
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`API call failed (${action}):`, error);
    throw error;
  }
}
