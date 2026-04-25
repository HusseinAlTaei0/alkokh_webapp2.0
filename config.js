/* =============================================
   SUPABASE CONFIGURATION
   ⚠️ الـ publishable key آمنة للاستخدام بالمتصفح
   الحماية الحقيقية تأتي من RLS policies بقاعدة البيانات
   ============================================= */

const SUPABASE_URL = 'https://hvvogxljniihayalgdvm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_h93ykLl9F3IXO4K-3TXe1w_wmllFy4_';

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
        storageKey: 'alkokh-auth',
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
