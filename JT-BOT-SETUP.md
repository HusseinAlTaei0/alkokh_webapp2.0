# 📱 دليل إعداد JT-BOT Workflow

## المشكلة المكتشفة

حالياً JT-BOT workflow مُعَدّ لاستقبال **فقط** الرسائل من نوع `booking_confirmation`.
عندما الكود يرسل `task_started` أو `task_completed` أو `feedback_request`، JT-BOT لا يعرف ماذا يفعل بها → لا ترسل رسالة للزبون.

## البيانات التي يرسلها الكود لـ JT-BOT

لكل طلب، الكود يرسل POST (بصيغة `application/x-www-form-urlencoded`) لرابط الـ workflow:

```
https://jt-b.com/webhook/whatsapp-workflow/[JTBOT_WEBHOOK_ID]
```
> الرابط الحقيقي محفوظ في Netlify Environment Variables → `JTBOT_WEBHOOK_URL`

**الحقول**:
| الحقل | المحتوى | مثال |
|------|---------|------|
| `phone` | رقم الزبون بصيغة E.164 بدون + | `9647801234567` |
| `customer_name` | اسم الزبون | `أحمد علي` |
| `pet_name` | اسم الحيوان | `ماكس` |
| `service_name` | اسم الخدمة بالعربي | `تحميم طبي` |
| `event_type` | نوع الحدث | `booking_confirmation` / `task_started` / `task_completed` / `feedback_request` / `intake_received` / `doctor_patient_accepted` / `appointment_reminder` / `missed_followup` |
| `scheduled_at` | موعد المتابعة (لـ `appointment_reminder` فقط) | `2026-04-20 14:30` |
| `doctor_name` | اسم الطبيب (لـ `doctor_patient_accepted` فقط) | `د. ايمن` |

## الخطوات المطلوبة على JT-BOT

### 1. افتح الـ workflow الموجود
- سجل دخول إلى `jt-b.com`
- افتح الـ workflow الخاص بـ `whatsapp-workflow/270728.366423.354554.1776273183`

### 2. أضف Switch Node بعد الـ Webhook Trigger
- النوع: Switch / Condition / IF
- الحقل الذي يتم الفحص عليه: `{{ body.event_type }}`

### 3. أضف 4 فروع (branches) حسب قيمة `event_type`

#### الفرع 1: `booking_confirmation` (موجود حالياً — لا تعدله)
الرسالة الحالية تبقى كما هي.

#### الفرع 2: `task_started` (جديد)
**رسالة مقترحة بالعربي**:
```
مرحباً {{ body.customer_name }} 🐾
بدأنا العمل الآن على {{ body.pet_name }}
خدمة: {{ body.service_name }}
سنرسل لك إشعار فور الانتهاء.
— عيادة الكوخ البيطرية 🏠
```

#### الفرع 3: `task_completed` (جديد)
**رسالة مقترحة**:
```
✅ {{ body.customer_name }}, تم الانتهاء من خدمة {{ body.pet_name }} بنجاح!
خدمة: {{ body.service_name }}
يمكنك الحضور لاستلامه.
— عيادة الكوخ البيطرية 🏠💜
```

#### الفرع 4: `feedback_request` (جديد)
**رسالة مقترحة** (ترسل بعد ساعة من الإكمال تلقائياً):
```
مرحباً {{ body.customer_name }} 👋
نتمنى أن {{ body.pet_name }} استمتع بخدمة {{ body.service_name }}!
كيف كانت تجربتك معنا؟
رد بتقييم من 1 إلى 5 ⭐
رأيك يساعدنا نتحسن.
— عيادة الكوخ البيطرية 🏠
```

---

## 🆕 فروع نظام العيادة البيطرية (Medical Clinic)

هذه الفروع الأربعة الجديدة تُضاف للـ Switch Node نفسه لدعم تدفق **زيارة الطبيب** (المراجع → قبول الطبيب → موعد المتابعة → التذكير).

#### الفرع 5: `intake_received` (جديد — عند استلام طلب مراجع)
**متى يُرسل**: مباشرة بعد تعبئة فورم "زيارة طبيب" من الصفحة الرئيسية.
**رسالة مقترحة**:
```
مرحباً {{ body.customer_name }} 🐾
وصلنا طلبك الخاص بـ {{ body.pet_name }}
سيتم توجيهك إلى الطبيب المختص خلال دقائق، وسنتواصل معك فور الاستلام.
— عيادة الكوخ البيطرية 🏠
```

#### الفرع 6: `doctor_patient_accepted` (جديد — عند قبول الطبيب للحالة)
**متى يُرسل**: فور ما يضغط الطبيب زر "قبول" على لوحة الطبيب.
**رسالة مقترحة**:
```
✅ {{ body.customer_name }}
{{ body.doctor_name }} استلم حالة {{ body.pet_name }} وسيتواصل معك قريباً.
شكراً لثقتك بنا 💜
— عيادة الكوخ البيطرية 🏠
```

#### الفرع 7: `appointment_reminder` (جديد — تذكير بموعد متابعة)
**متى يُرسل**: تلقائياً قبل الموعد بساعة (عبر `process-appointment-reminders` كل 10 دقائق).
**رسالة مقترحة**:
```
🔔 تذكير، {{ body.customer_name }}
موعد متابعة {{ body.pet_name }} بعد ساعة
⏰ {{ body.scheduled_at }}
نراك قريباً في العيادة.
— عيادة الكوخ البيطرية 🏠
```

#### الفرع 8: `missed_followup` (جديد — الزبون ما حضر الموعد)
**متى يُرسل**: تلقائياً بعد ساعتين من الموعد في حال لم يُسجَّل حضور (عبر `process-appointment-reminders`).
**رسالة مقترحة**:
```
مرحباً {{ body.customer_name }} 💜
لاحظنا أنك ما حضرت موعد متابعة {{ body.pet_name }} اليوم.
هل تحتاج إعادة جدولة؟ تواصل معنا.
صحة حيوانك الأليف أولويتنا.
— عيادة الكوخ البيطرية 🏠
```

### 4. احفظ وفعّل الـ workflow
- تأكد أن الـ workflow **Active** (مش Inactive)
- احفظ التغييرات
- جرّب من لوحة JT-BOT: اختبر كل فرع يدوياً

## كيف تتحقق أن كل شي يشتغل

### من لوحة Supabase (الأدمن)
1. افتح موقعك → تبويب **التقارير والإحصائيات**
2. انزل للقسم الجديد: **📱 سجل رسائل الواتساب**
3. راح تشوف آخر 20 رسالة مع:
   - الحالة (✅ نجح / ❌ فشل / ⏳ قيد الإرسال)
   - الخطأ (إذا فشل)
   - عدد المحاولات

### اختبار تدريجي
1. **Booking**: املأ فورم حجز برقم هاتفك الشخصي → يفترض تصلك رسالة التأكيد خلال ثواني
2. **Task started**: من واجهة الموظف، اقبل الطلب → يفترض تصلك رسالة بداية العمل
3. **Task completed**: أكمل الطلب → يفترض تصلك رسالة الإنجاز
4. **Feedback**: انتظر ساعة بعد الإكمال → يفترض تصلك رسالة التقييم (يعمل بـ pg_cron كل 5 دقايق يفحص الرسائل المستحقة)

## ماذا لو رسالة فشلت؟

### في الموقع
- تبويب **التقارير** → قسم سجل الرسائل → فلتر **فاشلة**
- كل صف فيه زر **↻ إعادة** يحاول الإرسال مرة ثانية

### في قاعدة البيانات
```sql
-- اعرض كل الرسائل الفاشلة
SELECT event_type, customer_name, phone, error_message, attempt_count, created_at
FROM notification_logs
WHERE status = 'failed'
ORDER BY created_at DESC;

-- اعرض الرسائل المجدولة المعلقة (feedback غير مُرسل بعد)
SELECT event_type, phone, customer_name, scheduled_at
FROM pending_notifications
WHERE processed = false
ORDER BY scheduled_at ASC;
```

## ملاحظات أمنية

- `JTBOT_WEBHOOK_URL` ينتقل تلقائياً من env إلى Edge Function secret في Supabase
- الـ Edge Function تستخدم `SUPABASE_SERVICE_ROLE_KEY` داخلياً (لا يُكشف للمتصفح أبداً)
- جدول `notification_logs` محمي بـ RLS: **القراءة** للأدمن المسجل فقط

## معمارية النظام الجديدة

```
┌─────────────┐
│   الزبون   │
│ (فورم حجز) │
└──────┬──────┘
       │ يعبّئ الحجز
       ↓
┌────────────────┐
│    Frontend    │
│   (main.js)    │
└──────┬─────────┘
       │ supabase.functions.invoke('send-whatsapp')
       ↓
┌───────────────────────────────────┐
│  Edge Function: send-whatsapp    │
│  1. يسجل pending في logs         │
│  2. يرسل لـ JT-BOT (3 محاولات)  │
│  3. يحدّث logs بالنتيجة          │
└──────┬────────────────────────────┘
       │ POST
       ↓
┌───────────────┐         ┌─────────────┐
│    JT-BOT     │────────►│  WhatsApp   │
│   (workflow)  │         │  للزبون     │
└───────────────┘         └─────────────┘


┌────────────────┐
│  pg_cron */5   │ كل 5 دقايق
└──────┬─────────┘
       ↓
┌──────────────────────────────────────┐
│ Edge Function:                        │
│ process-pending-notifications         │
│ يفحص pending_notifications المستحقة  │
│ (feedback بعد ساعة)                  │
└──────┬───────────────────────────────┘
       │ يستدعي داخلياً
       ↓
   send-whatsapp → JT-BOT → WhatsApp
```
