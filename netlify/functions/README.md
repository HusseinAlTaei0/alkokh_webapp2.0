# Netlify Functions - المفاتيح السرية المحمية

هذا المجلد يحتوي على **Serverless Functions** - دوال بدون خادم تُشغلها Netlify بأمان تام.

## البنية

```
netlify/functions/
├── api.js           # الـ Function الرئيسية (معالج جميع الطلبات)
└── README.md        # هذا الملف
```

## كيفية العمل

### الطلب من Frontend
```javascript
// frontend code
fetch('/.netlify/functions/api', {
  method: 'POST',
  body: JSON.stringify({
    action: 'send-whatsapp',
    recipientPhone: '+966501234567',
    messageBody: 'Hello'
  })
})
```

### المعالجة بـ Netlify (آمن تماماً)
```javascript
// netlify/functions/api.js
exports.handler = async (event) => {
  const { action } = JSON.parse(event.body);
  
  // المفاتيح السرية آمنة هنا! 🔒
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  // ... معالجة الطلب
}
```

---

## إضافة Function جديدة

### الطريقة 1: إضافة action جديد في `api.js`

```javascript
// في api.js
switch (action) {
  case 'send-email':
    return await handleEmail(body);
  // أضف case جديد هنا
}

async function handleEmail(data) {
  const SMTP_TOKEN = process.env.SMTP_TOKEN; // آمن! ✅
  // ... كود الإرسال
}
```

### الطريقة 2: إنشاء Function منفصلة

```javascript
// netlify/functions/send-email.js
exports.handler = async (event) => {
  const SMTP_TOKEN = process.env.SMTP_TOKEN; // آمن! ✅
  // ... معالجة الإرسال
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true })
  };
};
```

ثم من Frontend:
```javascript
fetch('/.netlify/functions/send-email', { ... })
```

---

## متغيرات البيئة (Environment Variables)

**الموقع الآمن الوحيد:** Netlify Dashboard → Environment variables

❌ **لا تضعها هنا:**
- في الكود مباشرة
- في `.env` بالـ repository
- في ملفات عامة

✅ **ضعها هنا:**
- Netlify Dashboard فقط
- أثناء التطوير المحلي: استخدم `.env.local` (في .gitignore)

### مثال `.env.local` (للتطوير فقط)
```
WHATSAPP_ACCESS_TOKEN=xxxx
WHATSAPP_PHONE_ID=yyyy
ADMIN_PASSWORD=secret123
```

---

## الاختبار المحلي

```bash
# تثبيت netlify-cli
npm install -g netlify-cli

# تشغيل مع Netlify Functions محلياً
npm run dev:netlify
# أو
netlify dev

# سيشتغل على: http://localhost:8888
# الـ Functions ستكون على: http://localhost:8888/.netlify/functions/api
```

---

## أمثلة الاستجابات

### نجاح ✅
```json
{
  "statusCode": 200,
  "body": {
    "success": true,
    "messageId": "wamid.xxx"
  }
}
```

### خطأ ❌
```json
{
  "statusCode": 500,
  "body": {
    "success": false,
    "error": "WhatsApp credentials not configured"
  }
}
```

---

## نصائح الأمان

1. **لا تعيد المفتاح السري** - أعد رسالة نجاح فقط
2. **حقق من الإدخال** - لا تثق بـ Frontend blindly
3. **استخدم HTTPS فقط** - Netlify يفرضه تلقائياً
4. **قيّد الـ Rate Limiting** - لتجنب الإساءة
5. **سجّل الأخطاء** - للتصحيح والمراقبة

---

## الخطأ الشائع

```javascript
// ❌ خطأ - المفتاح مكشوف!
const API_KEY = 'eaabxyz123...';
export async function sendMessage() {
  // ...
}

// ✅ صحيح - المفتاح محمي!
exports.handler = async (event) => {
  const API_KEY = process.env.API_KEY;
  // ...
}
```

---

## المراجع

- [Netlify Functions Docs](https://docs.netlify.com/functions/overview)
- [Environment Variables](https://docs.netlify.com/build-deploy/configure-builds/environment)
