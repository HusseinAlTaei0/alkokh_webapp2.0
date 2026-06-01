/* =============================================
   BAYTAR — SUPABASE CONFIGURATION
   ⚠️ الـ publishable key آمنة للاستخدام بالمتصفح
   الحماية الحقيقية تأتي من RLS policies بقاعدة البيانات

   📌 املأ القيمتين أدناه بمشروع Supabase الجديد عند توفّره.
   ============================================= */

const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_PUBLISHABLE_KEY';

// اسم العيادة (placeholder مؤقت — يأتي لاحقاً من جدول clinics لكل عيادة)
const CLINIC_NAME = 'بيطار';

// Initialize Supabase Client with safety check for CDN loading
let supabaseClient;

async function initSupabaseClient() {
  // Wait for window.supabase to be available (Supabase SDK from CDN)
  let attempts = 0;
  while (!window.supabase && attempts < 100) {
    await new Promise(resolve => setTimeout(resolve, 50));
    attempts++;
  }

  if (!window.supabase) {
    console.error('❌ Supabase SDK failed to load from CDN');
    return false;
  }

  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        storageKey: 'baytar-auth',
      },
    });
    console.log('✅ Supabase client initialized');
    return true;
  } catch (err) {
    console.error('❌ Failed to create Supabase client:', err);
    return false;
  }
}

// Initialize as soon as possible
initSupabaseClient();
