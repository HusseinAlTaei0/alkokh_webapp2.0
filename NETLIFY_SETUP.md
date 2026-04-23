# 🔒 دليل تأمين موقعك على Netlify

## المشكلة الأمنية
أي مفتاح API أو token توضعه في كود Frontend (React, Vue, إلخ) سيكون **مكشوف 100%** عند فتح Developer Tools (F12) بالمتصفح.

```javascript
// ❌ خطر جداً - أي شخص يقدر يشوفها بـ F12
const WHATSAPP_TOKEN = 'eaabxyz123...';
const ADMIN_PASSWORD = 'MySecretPassword';
```

## الحل: Netlify Functions
استخدام **Serverless Functions** لإخفاء المفاتيح السرية على سيرفرات Netlify المغلقة.

```javascript
// ✅ آمن - المفاتيح محفوظة على الـ Server فقط
const response = await fetch('/.netlify/functions/api', {
  method: 'POST',
  body: JSON.stringify({
    action: 'send-whatsapp',
    recipientPhone: '+966501234567',
    messageBody: 'Hello'
  })
});
```

---

## خطوات التنفيذ

### 1️⃣ إضافة المتغيرات السرية إلى Netlify Dashboard

اذهب إلى: **Netlify Dashboard → Your Site → Environment variables**

أضف المتغيرات التالية:
```
WHATSAPP_BUSINESS_ACCOUNT_ID = xxxx
WHATSAPP_ACCESS_TOKEN = eaabxyz123...
WHATSAPP_PHONE_ID = 1234567890
ADMIN_PASSWORD = YourSecretPassword123
```

**ملاحظة مهمة:** لا تضع المتغيرات في ملفات `.env` بالـ repository!

### 2️⃣ استخدام الـ API من Frontend

بدل أن تستخدم WhatsApp API مباشرة من Frontend:

```javascript
// ❌ قديم - خطر
import { WHATSAPP_ACCESS_TOKEN } from './config.js';
await fetch(`https://graph.instagram.com/v20.0/${phoneId}/messages`, {
  headers: { 'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}` }
});

// ✅ جديد - آمن
import { sendWhatsAppMessage } from './netlify-api-client.js';
await sendWhatsAppMessage('+966501234567', 'Hello World');
```

### 3️⃣ إضافة الـ Functions الخاصة بك

في مجلد `netlify/functions/`:

```javascript
// netlify/functions/api.js
exports.handler = async (event) => {
  const { action } = JSON.parse(event.body);
  
  if (action === 'send-whatsapp') {
    const token = process.env.WHATSAPP_ACCESS_TOKEN; // محفوظ بأمان!
    // ... إرسال الرسالة
  }
};
```

---

## الملفات المضافة

```
project/
├── netlify.toml                 # ✨ إعدادات Netlify
├── netlify/functions/
│   └── api.js                   # ✨ Serverless Function
├── netlify-api-client.js        # ✨ Helper للاتصال بـ API
└── NETLIFY_SETUP.md            # هذا الملف
```

---

## أمثلة الاستخدام

### إرسال WhatsApp

```javascript
import { sendWhatsAppMessage } from './netlify-api-client.js';

// في أي مكان بـ Frontend
const result = await sendWhatsAppMessage(
  '+966501234567',
  'مرحبا بك في الخدمة!',
  null // بدون صورة
);

if (result.success) {
  console.log('تم الإرسال:', result.messageId);
} else {
  console.error('خطأ:', result.error);
}
```

### التحقق من الأدمن

```javascript
import { verifyAdminAccess } from './netlify-api-client.js';

const password = prompt('أدخل كلمة المرور:');
const { isAdmin } = await verifyAdminAccess(password);

if (isAdmin) {
  // إظهار صفحة الأدمن
} else {
  alert('كلمة مرور خاطئة');
}
```

---

## مراحل الرفع

### المرحلة 1: التطوير المحلي
```bash
npm run dev
# سيشتغل على http://localhost:5173
# الـ Functions سوف تشتغل على http://localhost:5173/.netlify/functions/api
```

### المرحلة 2: الرفع إلى GitHub
```bash
git add netlify/functions netlify-api-client.js netlify.toml NETLIFY_SETUP.md
git commit -m "feat: add secure Netlify Functions for sensitive APIs"
git push
```

### المرحلة 3: الرفع إلى Netlify
1. اذهب إلى [Netlify Dashboard](https://app.netlify.com)
2. اختر الموقع
3. اذهب إلى **Environment variables**
4. أضف المتغيرات السرية (WHATSAPP_*, ADMIN_*)
5. الموقع سيُرفع تلقائياً من GitHub

---

## قائمة الفحص الأمنية ✅

- [ ] لا توجد مفاتيح سرية في `config.js` أو `main.js`
- [ ] جميع المفاتيح موضوعة في متغيرات البيئة Netlify
- [ ] Netlify Function تقرأ من `process.env`
- [ ] Frontend تستخدم `netlify-api-client.js` فقط
- [ ] `.env` و `.env.local` موجودة في `.gitignore`
- [ ] تم اختبار Netlify Functions محلياً بـ `netlify dev`

---

## الفرق الأمني

| ما قبل | ما بعد |
|------|--------|
| المفاتيح في Frontend | المفاتيح على Netlify فقط |
| يرى أي شخص المفاتيح بـ F12 | محد يقدر يشوف المفاتيح |
| API مكشوف مباشرة | API خلف Serverless Function |
| خطر من اختراق الحساب | حماية إضافية (Double Layer) |

---

## الدعم والمساعدة

- [Netlify Functions Docs](https://docs.netlify.com/functions/overview)
- [Netlify Environment Variables](https://docs.netlify.com/build-deploy/configure-builds/environment)
- [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp/cloud-api)

---

**نصيحة ذهبية:** 🏆 أي بيانات حساسة = سيرفر، وأي بيانات عامة = متصفح.
