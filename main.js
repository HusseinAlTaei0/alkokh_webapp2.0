/* =============================================
   BAYTAR — MAIN APPLICATION
   Veterinary Clinic Management System (multi-tenant)
   with Supabase Authentication & Database
   ============================================= */

// Theme is now hardcoded to 'dark' in index.html, no switching logic needed.


// ==========================================
// AUTH MODULE
// ==========================================
const Auth = {
  _user: null,
  _doctor: null,

  async init() {
    let waited = 0;
    while (!supabaseClient && waited < 5000) {
      await new Promise(r => setTimeout(r, 50));
      waited += 50;
    }
    if (!supabaseClient) {
      console.warn('Supabase client not ready at Auth.init — will rely on onAuthStateChange');
      return;
    }
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      this._user = session?.user || null;
      if (this._user) await this._loadProfiles();
    } catch (err) {
      console.warn('getSession failed:', err);
    }
    this._updateUI();

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      this._user = session?.user || null;
      await this._loadProfiles();
      this._updateUI();
    });
  },

  async login(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this._user = data.user;
    await this._loadProfiles();
    this._updateUI();
    return data;
  },

  async logout() {
    await supabaseClient.auth.signOut();
    this._user = null;
    this._doctor = null;
    this._updateUI();
  },

  isAuthenticated() { return !!this._user; },
  getUser() { return this._user; },
  getDoctor() { return this._doctor; },

  // medical doctor (not a pure operator)
  isDoctor() {
    return !!this._doctor && this._doctor.is_active !== false
      && this._doctor.specialization !== 'operator';
  },

  isClinicAdmin() {
    return !!this._doctor && this._doctor.is_admin === true && this._doctor.is_active !== false;
  },

  // can access operator/queue page (operators + admins)
  isOperator() {
    return !!this._doctor && this._doctor.is_operator === true && this._doctor.is_active !== false;
  },

  async _loadProfiles() {
    if (!this._user) {
      this._doctor = null;
      return;
    }
    console.log('🔍 Loading doctor profile...');

    // Add timeout protection (10 seconds max)
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Profile lookup timed out')), ms));

    try {
      const docResult = await Promise.race([
        supabaseClient.from('doctors').select('*').eq('auth_user_id', this._user.id).maybeSingle(),
        timeout(10000)
      ]);

      if (!docResult.error) {
        this._doctor = docResult.data || null;
      } else {
        console.warn('Doctor profile lookup failed:', docResult.error);
        this._doctor = null;
      }

      console.log('👨‍⚕️ Doctor profile:', this._doctor ? 'loaded' : 'not found');
    } catch (err) {
      console.error('⏰ Profile loading error:', err.message);
      this._doctor = null;
    }
  },

  _updateUI() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.style.display = this._user ? 'flex' : 'none';
    }

    // تحكم كامل بالقائمة حسب الدور
    const allMenuLinks = document.querySelectorAll('.menu-link[data-role]');
    allMenuLinks.forEach(link => {
      const role = link.dataset.role;
      let show = false;
      if (role === 'anonymous') {
        // يظهر فقط للزوار غير المسجلين
        show = !this._user;
      } else if (role === 'doctor') {
        // يظهر للأطباء والمدراء
        show = this.isDoctor() || this.isClinicAdmin();
      } else if (role === 'operator') {
        // يظهر للمنظمين والمدراء
        show = this.isOperator() || this.isClinicAdmin();
      } else if (role === 'clinic-admin') {
        // يظهر للمدراء فقط
        show = this.isClinicAdmin();
      }
      link.style.display = show ? '' : 'none';
    });
  }
};


// ==========================================
// DATABASE LAYER (Supabase)
// ==========================================
const DB = {
  // =========================================================
  // ===== MEDICAL CLINIC — Doctors / Patients / Visits  =====
  // =========================================================

  // --- Doctors ---
  async getDoctorByAuthId(uid) {
    const { data, error } = await supabaseClient
      .from('doctors').select('*').eq('auth_user_id', uid).maybeSingle();
    if (error) { console.error(error); return null; }
    return data;
  },

  async getAllDoctors() {
    const { data, error } = await supabaseClient
      .from('doctors').select('*').order('is_admin', { ascending: false }).order('display_name');
    if (error) { console.error(error); return []; }
    return data || [];
  },

  async getActiveDoctors() {
    const { data, error } = await supabaseClient
      .from('doctors').select('*').eq('is_active', true).order('display_name');
    if (error) { console.error(error); return []; }
    return data || [];
  },

  async toggleDoctorActive(id, isActive) {
    const { error } = await supabaseClient
      .from('doctors').update({ is_active: isActive }).eq('id', id);
    if (error) throw error;
    return true;
  },

  async createDoctor({ email, password, full_name, display_name, specialization, phone, is_admin, avatar_color, bio }) {
    const { data, error } = await supabaseClient.functions.invoke('create-doctor', {
      body: { email, password, full_name, display_name, specialization, phone, is_admin, avatar_color, bio }
    });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    return data?.doctor;
  },

  // --- Customers helper ---
  async upsertCustomerByPhone({ name, phone }) {
    // try find first
    const { data: existing } = await supabaseClient
      .from('customers').select('*').eq('phone', phone).maybeSingle();
    if (existing) return existing;
    const { data, error } = await supabaseClient
      .from('customers').insert({ name, phone }).select().single();
    if (error) { console.warn('customer insert failed:', error); return null; }
    return data;
  },

  async getCustomerByPhone(phone) {
    if (!phone) return null;
    const { data } = await supabaseClient
      .from('customers').select('*').eq('phone', phone).maybeSingle();
    return data || null;
  },

  async getCustomerProfileByPhone(phone) {
    const customer = await this.getCustomerByPhone(phone);
    if (!customer) return null;
    const { data: patients } = await supabaseClient
      .from('patients').select('*')
      .eq('customer_id', customer.id)
      .order('updated_at', { ascending: false });
    const { data: lastVisit } = await supabaseClient
      .from('visits').select('*')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle();
    return { customer, patients: patients || [], lastVisit: lastVisit || null };
  },

  // --- Patients (animal files) ---
  async findOrCreatePatient({ customer_id, name, animal_type, age_months, breed, gender }) {
    if (customer_id) {
      const { data: existing } = await supabaseClient
        .from('patients').select('*')
        .eq('customer_id', customer_id)
        .eq('animal_type', animal_type)
        .limit(1).maybeSingle();
      if (existing) {
        // optionally update name / age if provided
        const updates = {};
        if (name && !existing.name) updates.name = name;
        if (age_months != null && existing.age_months == null) updates.age_months = age_months;
        if (breed && !existing.breed) updates.breed = breed;
        if (gender && !existing.gender) updates.gender = gender;
        if (Object.keys(updates).length) {
          updates.updated_at = new Date().toISOString();
          await supabaseClient.from('patients').update(updates).eq('id', existing.id);
        }
        return existing;
      }
    }
    const { data, error } = await supabaseClient.from('patients').insert({
      customer_id, name, animal_type, age_months, breed, gender
    }).select().single();
    if (error) { console.error('patient insert failed:', error); throw error; }
    return data;
  },

  async getPatient(id) {
    const { data } = await supabaseClient.from('patients').select('*').eq('id', id).maybeSingle();
    return data;
  },

  async updatePatient(id, fields) {
    const { error } = await supabaseClient.from('patients')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  },

  // --- Visits (clinical) ---
  async createVisit({ customer_id, patient_id, intake, symptoms }) {
    const { data, error } = await supabaseClient.from('visits').insert({
      customer_id, patient_id,
      status: 'waiting',
      intake_customer_name: intake.customer_name,
      intake_phone: intake.phone,
      intake_area: intake.area || null,
      intake_animal_type: intake.animal_type,
      intake_animal_age: intake.animal_age || null,
      intake_notes: intake.notes || null,
    }).select().single();
    if (error) throw error;

    if (symptoms && symptoms.length) {
      const rows = symptoms.map(s => ({ visit_id: data.id, symptom_key: s }));
      const { error: symErr } = await supabaseClient.from('visit_symptoms').insert(rows);
      if (symErr) console.warn('visit_symptoms insert failed:', symErr);
    }
    return data;
  },

  // إنشاء زيارة متابعة من موعد مجدول — تبدأ بحالة accepted وتعلّم الموعد المصدر "حضر"
  async createFollowupVisit({ patient_id, customer_id, source_appointment_id, doctor_id, intake }) {
    const { data, error } = await supabaseClient.from('visits').insert({
      customer_id,
      patient_id,
      primary_doctor_id: doctor_id,
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      source_appointment_id,
      intake_customer_name: intake.customer_name,
      intake_phone: intake.phone,
      intake_animal_type: intake.animal_type,
      intake_area: intake.area || null,
      intake_animal_age: intake.animal_age || null,
      intake_notes: intake.notes || null,
    }).select().single();
    if (error) throw error;
    // علّم الموعد المصدر كـ "حضر"
    await supabaseClient.from('visit_appointments')
      .update({ status: 'attended', attended_at: new Date().toISOString() })
      .eq('id', source_appointment_id);
    return data;
  },

  async getWaitingVisits() {
    const { data, error } = await supabaseClient
      .from('visits')
      .select('*, visit_symptoms(symptom_key), patients(name, age_months, breed)')
      .eq('status', 'waiting')
      .order('created_at', { ascending: true });
    if (error) { console.error(error); return []; }
    return data || [];
  },

  async getMyVisits(doctorId) {
    // visits where I'm primary OR I'm a collaborator
    const { data: primary, error: e1 } = await supabaseClient
      .from('visits')
      .select('*, visit_symptoms(symptom_key), patients(name, age_months, breed), primary_doctor:doctors!visits_primary_doctor_id_fkey(display_name, full_name)')
      .eq('primary_doctor_id', doctorId)
      .order('created_at', { ascending: false });
    if (e1) console.error(e1);
    const { data: collabRows, error: e2 } = await supabaseClient
      .from('visit_collaborators')
      .select('visit_id')
      .eq('doctor_id', doctorId);
    if (e2) console.error(e2);
    const collabIds = (collabRows || []).map(r => r.visit_id);
    let collabVisits = [];
    if (collabIds.length) {
      const { data: cv } = await supabaseClient
        .from('visits')
        .select('*, visit_symptoms(symptom_key), patients(name, age_months, breed), primary_doctor:doctors!visits_primary_doctor_id_fkey(display_name, full_name)')
        .in('id', collabIds);
      collabVisits = cv || [];
    }
    const merged = [...(primary || []), ...collabVisits];
    // dedupe
    const seen = new Set();
    return merged.filter(v => { if (seen.has(v.id)) return false; seen.add(v.id); return true; });
  },

  async getVisitById(id) {
    const { data, error } = await supabaseClient
      .from('visits')
      .select('*, visit_symptoms(symptom_key), patients(*), primary_doctor:doctors!visits_primary_doctor_id_fkey(*)')
      .eq('id', id).maybeSingle();
    if (error) { console.error(error); return null; }
    return data;
  },

  async acceptVisit(visitId, doctorId) {
    const { data, error } = await supabaseClient
      .from('visits')
      .update({
        primary_doctor_id: doctorId,
        status: 'accepted',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', visitId)
      .eq('status', 'waiting') // only if still waiting
      .select().maybeSingle();
    if (error) throw error;
    return data;
  },

  // بدء العمل (accepted → in_progress)
  async startVisit(id) {
    const { error } = await supabaseClient.from('visits').update({
      status: 'in_progress',
      service_started_at: new Date().toISOString(),
    }).eq('id', id).eq('status', 'accepted');
    if (error) throw error;
  },

  async updateVisit(id, fields) {
    const { data, error } = await supabaseClient
      .from('visits')
      .update(fields)
      .eq('id', id)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('لم يتم الحفظ — تحقق من صلاحيات حسابك (الطبيب يجب أن يكون مفعّلاً ومرتبطاً بحساب).');
    }
    return data[0];
  },

  async getVisitAttachments(visitId) {
    const { data, error } = await supabaseClient
      .from('visit_attachments')
      .select('*, uploaded_by_doctor:doctors!visit_attachments_uploaded_by_fkey(display_name)')
      .eq('visit_id', visitId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async uploadVisitAttachment(visitId, file, doctorId) {
    // المسار لازم يبدأ بـ clinic_id حتى تمر سياسات الـ Storage RLS:
    // {clinic_id}/{visit_id}/{filename}
    const clinicId = Auth.getDoctor()?.clinic_id;
    if (!clinicId) throw new Error('تعذّر تحديد العيادة الحالية — أعد تسجيل الدخول.');

    // --- File Validation ---
    const rawExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const ext    = rawExt.replace(/[^a-z0-9]/g, '') || 'jpg';
    const ALLOWED_TYPES = ['jpg','jpeg','png','gif','pdf','webp'];
    const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
    if (!ALLOWED_TYPES.includes(ext))
      throw new Error(`نوع الملف غير مسموح. المسموح: ${ALLOWED_TYPES.join(', ')}`);
    if (file.size > MAX_SIZE_BYTES)
      throw new Error('حجم الملف يتجاوز 10MB');
    // --- End Validation ---

    const uid = (crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2);
    const path = `${clinicId}/${visitId}/${Date.now()}-${uid}.${ext}`;
    const { error: upErr } = await supabaseClient.storage
      .from('visit-attachments')
      .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
    if (upErr) throw upErr;
    const { data, error } = await supabaseClient
      .from('visit_attachments')
      .insert({
        visit_id: visitId,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        uploaded_by: doctorId || null,
      })
      .select()
      .single();
    if (error) {
      await supabaseClient.storage.from('visit-attachments').remove([path]).catch(() => {});
      throw error;
    }
    return data;
  },

  async getVisitAttachmentUrl(path) {
    const { data, error } = await supabaseClient.storage
      .from('visit-attachments')
      .createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  },

  async deleteVisitAttachment(id, storagePath) {
    if (storagePath) {
      await supabaseClient.storage.from('visit-attachments').remove([storagePath]).catch(() => {});
    }
    const { error } = await supabaseClient.from('visit_attachments').delete().eq('id', id);
    if (error) throw error;
  },

  async completeVisit(id) {
    const { error } = await supabaseClient.from('visits').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  },

  async cancelVisit(id) {
    const { error } = await supabaseClient.from('visits').update({
      status: 'cancelled',
    }).eq('id', id);
    if (error) throw error;
  },

  // --- Notes (timeline) ---
  async addVisitNote(visitId, doctorId, note) {
    const { data, error } = await supabaseClient
      .from('visit_notes').insert({ visit_id: visitId, doctor_id: doctorId, note })
      .select().single();
    if (error) throw error;
    return data;
  },

  async getVisitNotes(visitId) {
    const { data, error } = await supabaseClient
      .from('visit_notes')
      .select('*, doctor:doctors(display_name, avatar_color)')
      .eq('visit_id', visitId)
      .order('created_at', { ascending: false });
    if (error) { console.error(error); return []; }
    return data || [];
  },

  // --- Collaborators (invited doctors) ---
  async addCollaborator(visitId, doctorId, invitedBy) {
    const { error } = await supabaseClient
      .from('visit_collaborators')
      .upsert({ visit_id: visitId, doctor_id: doctorId, invited_by: invitedBy }, { onConflict: 'visit_id,doctor_id' });
    if (error) throw error;
  },

  async removeCollaborator(visitId, doctorId) {
    const { error } = await supabaseClient
      .from('visit_collaborators').delete()
      .eq('visit_id', visitId).eq('doctor_id', doctorId);
    if (error) throw error;
  },

  async getCollaborators(visitId) {
    const { data } = await supabaseClient
      .from('visit_collaborators')
      .select('*, doctor:doctors(id, display_name, full_name, avatar_color)')
      .eq('visit_id', visitId);
    return data || [];
  },

  // --- Appointments (follow-up schedule) ---
  async addAppointment({ visit_id, patient_id, scheduled_at, purpose, created_by, time_specified = true }) {
    const { data, error } = await supabaseClient
      .from('visit_appointments')
      .insert({ visit_id, patient_id, scheduled_at, purpose, created_by, time_specified })
      .select().single();
    if (error) throw error;
    return data;
  },

  async getAppointmentsForVisit(visitId) {
    const { data } = await supabaseClient
      .from('visit_appointments').select('*')
      .eq('visit_id', visitId)
      .order('scheduled_at');
    return data || [];
  },

  async markAppointmentAttended(id) {
    const { error } = await supabaseClient
      .from('visit_appointments')
      .update({ status: 'attended', attended_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async cancelAppointment(id) {
    const { error } = await supabaseClient
      .from('visit_appointments').update({ status: 'cancelled' }).eq('id', id);
    if (error) throw error;
  },

  // --- Patient history (all visits for a patient) ---
  async getPatientHistory(patientId) {
    const { data } = await supabaseClient
      .from('visits')
      .select('id, status, created_at, diagnosis, treatment, severity, primary_doctor:doctors!visits_primary_doctor_id_fkey(display_name)')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    return data || [];
  },

  // --- Chat messages ---
  async sendChatMessage(channel, content) {
    const doctorId = Auth.getDoctor()?.id;
    if (!doctorId) throw new Error('Not a doctor');
    const { data, error } = await supabaseClient
      .from('chat_messages')
      .insert({ channel, content, sender_id: doctorId })
      .select().single();
    if (error) throw error;
    return data;
  },

  async getChatMessages(channel, limit = 100) {
    const { data } = await supabaseClient
      .from('chat_messages')
      .select('*, sender:doctors!chat_messages_sender_id_fkey(id, display_name, avatar_color)')
      .eq('channel', channel)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data || []).reverse(); // oldest first for UI
  },

  // --- Reports ---
  async getReportStats(fromISO, toISO) {
    const { data: visits } = await supabaseClient
      .from('visits')
      .select('id, status, severity, primary_doctor_id, intake_animal_type, created_at')
      .gte('created_at', fromISO).lte('created_at', toISO);
    const { data: syms } = await supabaseClient
      .from('visit_symptoms')
      .select('symptom_key, visit_id, visits!inner(created_at)')
      .gte('visits.created_at', fromISO).lte('visits.created_at', toISO);
    const { data: docs } = await supabaseClient.from('doctors').select('id, display_name, full_name');
    return { visits: visits || [], syms: syms || [], doctors: docs || [] };
  },

  async getDoctorReportStats(doctorId, fromISO, toISO) {
    const { data: visits } = await supabaseClient
      .from('visits')
      .select('id, status, severity, primary_doctor_id, intake_animal_type, intake_customer_name, created_at')
      .eq('primary_doctor_id', doctorId)
      .gte('created_at', fromISO).lte('created_at', toISO);
    const visitIds = (visits || []).map(v => v.id);
    let syms = [];
    if (visitIds.length) {
      const { data: s } = await supabaseClient
        .from('visit_symptoms')
        .select('symptom_key, visit_id')
        .in('visit_id', visitIds);
      syms = s || [];
    }
    return { visits: visits || [], syms };
  },

  async getClinicReportStats(fromISO, toISO) {
    return await this.getReportStats(fromISO, toISO);
  },

  // --- Case History (search across medical visits) ---
  async searchCaseHistory(query) {
    const q = (query || '').trim();
    const limit = q ? 100 : 50;

    let visitsQ = supabaseClient
      .from('visits')
      .select('id, status, severity, created_at, primary_doctor_id, intake_animal_type, intake_customer_name, intake_phone, intake_notes, patient_id, customer_id, primary_doctor:doctors!visits_primary_doctor_id_fkey(display_name, full_name), patients(name, animal_type, breed), customers(name, phone)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (q) {
      const like = `%${q}%`;
      visitsQ = visitsQ.or(`intake_phone.ilike.${like},intake_customer_name.ilike.${like},intake_animal_type.ilike.${like}`);
    }

    const visitsRes = await visitsQ;
    const visits = visitsRes.data || [];

    // fetch collaborators for matched visits
    const visitIds = visits.map(v => v.id);
    let collabsByVisit = {};
    if (visitIds.length) {
      const { data: collabs } = await supabaseClient
        .from('visit_collaborators')
        .select('visit_id, doctor:doctors(display_name)')
        .in('visit_id', visitIds);
      (collabs || []).forEach(c => {
        if (!collabsByVisit[c.visit_id]) collabsByVisit[c.visit_id] = [];
        if (c.doctor?.display_name) collabsByVisit[c.visit_id].push(c.doctor.display_name);
      });
    }

    const items = [];
    visits.forEach(v => items.push({
      kind: 'medical',
      id: v.id,
      created_at: v.created_at,
      status: v.status,
      severity: v.severity,
      owner_name: v.customers?.name || v.intake_customer_name || '—',
      owner_phone: v.customers?.phone || v.intake_phone || '',
      pet_name: v.patients?.name || '',
      pet_type: v.patients?.animal_type || v.intake_animal_type || '',
      handler: v.primary_doctor?.display_name ? `د. ${v.primary_doctor.display_name}` : '—',
      collaborators: collabsByVisit[v.id] || [],
      patient_id: v.patient_id,
      raw: v,
    }));

    items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return items;
  },

  async getRecentAIReports(limit = 20) {
    const { data } = await supabaseClient
      .from('ai_reports')
      .select('*, generated_by:doctors(display_name)')
      .order('created_at', { ascending: false })
      .limit(limit);
    return data || [];
  },

  async getAIReport(id) {
    const { data } = await supabaseClient.from('ai_reports').select('*, generated_by:doctors(display_name)').eq('id', id).maybeSingle();
    return data;
  },
};


// ==========================================
// UTILITY FUNCTIONS (Radix Select Auto-Upgrader)
// ==========================================
function upgradeSelectsToRadix(container) {
  const selects = container.querySelectorAll('select:not([data-radix-upgraded]):not(.swal2-select)');

  selects.forEach(select => {
    // If select doesn't have parentNode, abort (rare case)
    if (!select.parentNode) return;

    select.setAttribute('data-radix-upgraded', 'true');
    select.style.display = 'none';

    const wrapper = document.createElement('div');
    wrapper.className = 'radix-select';

    if (select.style.flex) wrapper.style.flex = select.style.flex;
    if (select.style.marginTop) wrapper.style.marginTop = select.style.marginTop;

    const triggerHeight = select.classList.contains('form-input') ? '48px' : (select.style.padding ? '38px' : '48px');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = `radix-select-trigger ${select.className}`;
    trigger.style.height = triggerHeight;
    trigger.style.padding = '0 16px';
    if (select.disabled) trigger.disabled = true;

    const valSpan = document.createElement('span');
    valSpan.className = 'radix-select-value';
    const selectedOpt = select.options[select.selectedIndex];
    valSpan.textContent = selectedOpt ? selectedOpt.textContent : 'اختر...';

    const caretOpts = `<svg class="radix-caret" width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M4.93 5.43c-.17.18-.17.47 0 .64l2.5 2.5c.18.18.47.18.64 0l2.5-2.5c.18-.18.18-.47 0-.64-.18-.18-.47-.18-.64 0L7.5 7.86 5.57 5.43c-.18-.18-.47-.18-.64 0z" fill="currentColor"></path></svg>`;
    trigger.innerHTML = valSpan.outerHTML + caretOpts;

    const content = document.createElement('div');
    content.className = 'radix-select-content';
    content.setAttribute('role', 'listbox');

    const checkSvg = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M11.47 3.73c.29.19.37.58.18.86L7.4 11.09c-.1.15-.26.25-.44.28-.18.02-.36-.04-.5-.16L3.7 8.71c-.25-.23-.27-.63-.04-.88.23-.25.63-.27.88-.04l2.2 2 3.85-5.88c.19-.29.58-.37.87-.18z" fill="currentColor"></path></svg>`;

    Array.from(select.options).forEach(opt => {
      const item = document.createElement('div');
      item.className = 'radix-select-item';
      item.setAttribute('role', 'option');
      item.setAttribute('data-value', opt.value);
      if (opt.selected) item.setAttribute('data-state', 'checked');

      item.innerHTML = `<span class="radix-select-item-indicator">${checkSvg}</span><span class="radix-select-item-text">${opt.textContent}</span>`;

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        content.querySelectorAll('.radix-select-item').forEach(i => i.setAttribute('data-state', 'unchecked'));
        item.setAttribute('data-state', 'checked');

        trigger.querySelector('.radix-select-value').textContent = opt.textContent;
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));

        wrapper.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      });

      content.appendChild(item);
    });

    wrapper.appendChild(trigger);
    wrapper.appendChild(content);

    select.parentNode.insertBefore(wrapper, select.nextSibling);

    const closeMenu = (e) => {
      if (!wrapper.contains(e.target)) {
        wrapper.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = wrapper.classList.toggle('open');
      trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (isOpen) {
        document.addEventListener('click', closeMenu, { once: true });
      }
    });

    select.addEventListener('change', () => {
      const matchingOpt = Array.from(select.options).find(o => o.value === select.value);
      if (matchingOpt) {
        trigger.querySelector('.radix-select-value').textContent = matchingOpt.textContent;
        content.querySelectorAll('.radix-select-item').forEach(i => i.setAttribute('data-state', i.dataset.value === select.value ? 'checked' : 'unchecked'));
      }
    });
  });
}

function upgradeDateInputsToCalendar(container) {
  const dateInputs = container.querySelectorAll('input[type="date"]:not([data-calendar-upgraded])');

  dateInputs.forEach(input => {
    input.setAttribute('data-calendar-upgraded', 'true');
    input.style.display = 'none';

    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.alignItems = 'center';
    wrapper.style.width = '100%';

    const cal = document.createElement('div');
    cal.className = 'radix-calendar';

    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const days = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

    let currentDate = new Date();
    let selectedDate = null;

    if (input.value) {
      selectedDate = new Date(input.value);
      currentDate = new Date(input.value);
    }

    function renderCalendar() {
      cal.innerHTML = '';

      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();

      const header = document.createElement('div');
      header.className = 'radix-cal-header';

      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'radix-cal-nav';
      prevBtn.innerHTML = '❯';
      prevBtn.onclick = () => {
        currentDate.setMonth(month - 1);
        renderCalendar();
      };

      const title = document.createElement('div');
      title.className = 'radix-cal-title';
      title.textContent = `${months[month]} ${year}`;

      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'radix-cal-nav';
      nextBtn.innerHTML = '❮';
      nextBtn.onclick = () => {
        currentDate.setMonth(month + 1);
        renderCalendar();
      };

      header.appendChild(prevBtn);
      header.appendChild(title);
      header.appendChild(nextBtn);

      const grid = document.createElement('div');
      grid.className = 'radix-cal-grid';

      days.forEach(d => {
        const wd = document.createElement('div');
        wd.className = 'radix-cal-weekday';
        wd.textContent = d;
        grid.appendChild(wd);
      });

      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement('div');
        empty.className = 'radix-cal-day empty';
        grid.appendChild(empty);
      }

      const today = new Date();

      for (let i = 1; i <= daysInMonth; i++) {
        const dayBtn = document.createElement('button');
        dayBtn.type = 'button';
        dayBtn.className = 'radix-cal-day';
        dayBtn.textContent = i;

        if (selectedDate &&
          selectedDate.getDate() === i &&
          selectedDate.getMonth() === month &&
          selectedDate.getFullYear() === year) {
          dayBtn.classList.add('selected');
        }

        if (today.getDate() === i &&
          today.getMonth() === month &&
          today.getFullYear() === year) {
          dayBtn.classList.add('today');
        }

        dayBtn.onclick = () => {
          selectedDate = new Date(year, month, i);

          const y = selectedDate.getFullYear();
          const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
          const d = String(selectedDate.getDate()).padStart(2, '0');
          input.value = `${y}-${m}-${d}`;

          renderCalendar();
        };

        grid.appendChild(dayBtn);
      }

      cal.appendChild(header);
      cal.appendChild(grid);
    }

    renderCalendar();
    wrapper.appendChild(cal);
    input.parentNode.insertBefore(wrapper, input.nextSibling);

    const subTitle = document.createElement('div');
    subTitle.style.marginTop = '12px';
    subTitle.style.fontSize = '0.75rem';
    subTitle.style.color = 'var(--text-secondary)';
    subTitle.textContent = 'اختر يوم الموعد';
    wrapper.appendChild(subTitle);
  });
}

const selectObserver = new MutationObserver((mutations) => {
  let shouldCheck = false;
  for (let m of mutations) {
    if (m.addedNodes.length > 0) {
      shouldCheck = true;
      break;
    }
  }
  if (shouldCheck) {
    upgradeSelectsToRadix(document.body);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  upgradeSelectsToRadix(document.body);
  selectObserver.observe(document.body, { childList: true, subtree: true });
});

upgradeSelectsToRadix(document.body);
selectObserver.observe(document.body, { childList: true, subtree: true });

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return document.querySelectorAll(selector);
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `${days} يوم`;
}

function elapsedTimer(dateStr) {
  if (!dateStr) return '00:00';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function showToast(message, type = 'info', _duration) {
  // _duration parameter kept for backward compatibility (ignored)
  const container = document.querySelector('#toast-container')
    || document.querySelector('.toast-container');
  if (!container) return;

  const ICONS = {
    success: '✅', warning: '⚠️', error: '❌', info: '💜'
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = document.createElement('span');
  icon.textContent = ICONS[type] ?? '💜';

  // textContent بدل innerHTML — يمنع XSS تماماً
  const text = document.createTextNode(' ' + message);

  toast.appendChild(icon);
  toast.appendChild(text);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function playNotificationSound() {
  try {
    const audio = $('#notification-sound');
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => { });
    }
  } catch { }
}

function showLoading(container) {
  container.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>جاري التحميل...</p>
    </div>
  `;
}



// ==========================================
// ===== MEDICAL CLINIC — shared constants & modules =====
// ==========================================

// Canonical list of intake symptoms (key -> Arabic label)
const SYMPTOMS = [
  { key: 'vomit', label: 'قيء', icon: '🤮' },
  { key: 'diarrhea', label: 'إسهال', icon: '💩' },
  { key: 'appetite_loss', label: 'انقطاع شهية', icon: '🍽️' },
  { key: 'fever', label: 'ارتفاع درجة حرارة', icon: '🌡️' },
  { key: 'lethargy', label: 'خمول', icon: '😴' },
  { key: 'mobility_issue', label: 'صعوبة حركة', icon: '🦴' },
  { key: 'urination_issue', label: 'مشكلة بالإدرار', icon: '💧' },
  { key: 'defecation_issue', label: 'مشكلة بالخروج', icon: '🚽' },
  { key: 'labor', label: 'ولادة', icon: '🤰' },
  { key: 'ultrasound', label: 'سونار', icon: '📡' },
  { key: 'lab_test', label: 'فحص مختبري', icon: '🧪' },
];
const SYMPTOM_LABEL = SYMPTOMS.reduce((acc, s) => { acc[s.key] = s.label; return acc; }, {});

const ANIMAL_TYPES = [
  { value: 'قطة', icon: '🐱' },
  { value: 'كلب', icon: '🐶' },
  { value: 'طائر', icon: '🐦' },
  { value: 'أرنب', icon: '🐰' },
  { value: 'هامستر', icon: '🐹' },
  { value: 'زواحف', icon: '🦎' },
  { value: 'حيوان آخر', icon: '🐾' },
];

// Realtime subscriptions manager
const Realtime = {
  _channels: {},

  subscribe(name, tableConfig, callback) {
    // tableConfig: { event: '*' | 'INSERT' | 'UPDATE' | 'DELETE', schema: 'public', table, filter? }
    this.unsubscribe(name);
    const ch = supabaseClient.channel(name)
      .on('postgres_changes', tableConfig, callback)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') console.log(`[Realtime] ${name} subscribed`);
      });
    this._channels[name] = ch;
    return ch;
  },

  unsubscribe(name) {
    const ch = this._channels[name];
    if (ch) {
      supabaseClient.removeChannel(ch);
      delete this._channels[name];
    }
  },

  unsubscribeAll() {
    Object.keys(this._channels).forEach(n => this.unsubscribe(n));
  }
};

// AI module — calls ai-assist Edge Function
const AI = {
  async suggestDiagnosis({ animal_type, age, symptoms, findings, history }) {
    const { data, error } = await supabaseClient.functions.invoke('ai-assist', {
      body: { mode: 'diagnose', payload: { animal_type, age, symptoms, findings, history } }
    });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    return data;
  },

  async generateReport({ period_start, period_end, report_type }) {
    const { data, error } = await supabaseClient.functions.invoke('ai-assist', {
      body: { mode: 'report', payload: { period_start, period_end, report_type } }
    });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    return data;
  }
};

// Minimal markdown -> HTML renderer (safe-ish; sanitizes basic tags)
function renderMarkdown(md) {
  if (!md) return '';
  // escape html
  let s = md.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // headings
  s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  // bold / italic
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  // lists
  s = s.replace(/^(?:-|\*) (.*)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
  // paragraphs
  s = s.split(/\n{2,}/).map(p => /^<(h\d|ul|ol|blockquote)/.test(p) ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');
  return s;
}


// ==========================================
// ROUTER & MENU
// ==========================================
const Router = {
  currentView: null,

  init() {
    window.addEventListener('hashchange', () => this.route());
    this.route();
    this._initMenu();
    this._initLogout();
  },

  _initMenu() {
    const menuToggle = $('#menu-toggle');
    const fullscreenMenu = $('#fullscreen-menu');
    const nav = $('#main-nav');
    const menuLinks = $$('.menu-link');

    if (!menuToggle || !fullscreenMenu || !nav) return;

    menuToggle.addEventListener('click', () => {
      const isActive = fullscreenMenu.classList.toggle('is-active');
      nav.classList.toggle('menu-open');
      menuToggle.querySelector('.menu-text').textContent = isActive ? 'إغلاق' : 'القائمة';
    });

    menuLinks.forEach(link => {
      link.addEventListener('click', () => {
        fullscreenMenu.classList.remove('is-active');
        nav.classList.remove('menu-open');
        menuToggle.querySelector('.menu-text').textContent = 'القائمة';
      });
    });
  },

  _initLogout() {
    const logoutBtn = $('#logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await Auth.logout();
        showToast('تم تسجيل الخروج بنجاح', 'info');
        Realtime.unsubscribeAll();
        window.location.hash = '#home';
      });
    }
  },

  route() {
    const hash = window.location.hash.replace(/^#/, '') || 'home';
    this.navigate(hash);
  },

  async navigate(hash) {
    // hash can contain slashes: "booking/medical", "doctor/visit/<id>"
    const parts = hash.split('/').filter(Boolean);
    const head = parts[0] || 'home';
    const subPath = parts.slice(1);

    // Clear any realtime subscriptions when navigating between top-level views
    if (this.currentView !== head) {
      Realtime.unsubscribeAll();
    }

    // --- Auth gates ---
    if (head === 'reports') {
      if (!Auth.isAuthenticated()) {
        this.currentView = 'login';
        LoginView.render($('#app'), 'reports');
        return;
      }
      // التقارير للأطباء والمدراء
      if (!Auth.isClinicAdmin() && !Auth.isDoctor()) {
        showToast('⛔ هذه الصفحة للأطباء والمدراء فقط', 'warning');
        window.location.hash = '#home';
        return;
      }
    }
    if (head === 'case-history') {
      if (!Auth.isAuthenticated()) {
        this.currentView = 'login';
        LoginView.render($('#app'), 'case-history');
        return;
      }
      if (!Auth.isClinicAdmin() && !Auth.isOperator()) {
        showToast('⛔ هذه الصفحة للمنظمين والمدراء فقط', 'warning');
        window.location.hash = '#home';
        return;
      }
    }
    if (head === 'doctor') {
      if (!Auth.isAuthenticated()) {
        this.currentView = 'login';
        LoginView.render($('#app'), 'doctor');
        return;
      }
      if (!Auth.isDoctor()) {
        showToast('⛔ هذه الصفحة للأطباء فقط', 'warning');
        window.location.hash = '#home';
        return;
      }
    }
    if (head === 'admin') {
      if (!Auth.isAuthenticated()) {
        this.currentView = 'login';
        LoginView.render($('#app'), 'admin/doctors');
        return;
      }
      if (!Auth.isClinicAdmin()) {
        showToast('⛔ صلاحيات المدير مطلوبة', 'warning');
        window.location.hash = '#doctor';
        return;
      }
    }

    this.currentView = head;

    // Remove active state from nav links
    $$('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.view === head);
    });

    // Render view
    const app = $('#app');

    switch (head) {
      case 'home':
        await LandingView.render(app);
        break;
      case 'login':
        LoginView.render(app);
        break;
      case 'booking':
        if (subPath[0] === 'medical') {
          await MedicalIntakeView.render(app);
        } else {
          await LandingView.render(app);
        }
        break;
      case 'reports':
        if (subPath[0] === 'medical') {
          if (!Auth.isDoctor()) { window.location.hash = '#home'; break; }
          await MedicalReportsView.render(app);
        } else if (subPath[0] === 'clinic') {
          if (!Auth.isClinicAdmin()) { window.location.hash = '#home'; break; }
          await ClinicReportsView.render(app);
        } else {
          // Backward-compat: route to the right page based on role
          if (Auth.isClinicAdmin()) window.location.hash = '#reports/clinic';
          else if (Auth.isDoctor()) window.location.hash = '#reports/medical';
          else window.location.hash = '#home';
        }
        break;
      case 'doctor':
        if (subPath[0] === 'visit' && subPath[1]) {
          await DoctorVisitDetailView.render(app, subPath[1]);
        } else if (subPath[0] === 'chat') {
          await DoctorChatView.render(app);
        } else if (subPath[0] === 'reports') {
          window.location.hash = '#reports/medical';
        } else {
          await DoctorView.render(app);
        }
        break;
      case 'admin':
        if (subPath[0] === 'doctors') {
          await AdminDoctorsView.render(app);
        } else {
          await LandingView.render(app);
        }
        break;
      case 'case-history':
        if (!Auth.isOperator() && !Auth.isClinicAdmin()) { window.location.hash = '#home'; break; }
        await CaseHistoryView.render(app);
        break;
      case 'patient':
        await PatientProfileView.render(app, subPath[0]);
        break;
      default:
        await LandingView.render(app);
    }
  }
};


// ==========================================
// LOGIN VIEW
// ==========================================
const LoginView = {
  _redirectTo: 'case-history',
  _activeTab: 'staff', // 'staff' | 'employee'

  render(container, redirectTo = 'operator') {
    this._redirectTo = redirectTo;
    this._activeTab = 'staff';

    container.innerHTML = `
      <div class="login-container animate-in">
        <div class="login-card">
          <div class="login-header">
            <div class="login-logo">
              <img src="assets/logo.svg" alt="${CLINIC_NAME}">
            </div>
            <h1>${CLINIC_NAME}</h1>
            <p>سجّل دخولك للوصول إلى لوحة التحكم</p>
          </div>

          <div class="login-body" id="tab-staff">
            <div class="login-alert" id="login-error" style="display:none;">
              <span>❌</span>
              <span id="login-error-msg">البريد الإلكتروني أو كلمة المرور غير صحيحة</span>
            </div>
            <div class="form-group">
              <label class="form-label">البريد الإلكتروني</label>
              <input type="email" class="form-input login-input" id="login-email" placeholder="user@example.com" autocomplete="email" dir="ltr" value="${localStorage.getItem('baytar_remember_email') || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">كلمة المرور</label>
              <div class="password-wrapper">
                <input type="password" class="form-input login-input" id="login-password" placeholder="••••••••" autocomplete="current-password" dir="ltr">
                <button class="password-toggle" id="toggle-password" type="button" title="إظهار/إخفاء">👁️</button>
              </div>
            </div>
            <div class="form-group" style="display:flex; align-items:center; gap:10px; margin-top:-4px;">
              <input type="checkbox" id="remember-me" style="width:18px; height:18px; accent-color: var(--purple-500); cursor:pointer;"
                ${localStorage.getItem('baytar_remember_email') ? 'checked' : ''}>
              <label for="remember-me" style="color:var(--text-muted); font-size:0.9rem; cursor:pointer; user-select:none;">تذكرني</label>
            </div>
            <button class="btn btn-primary btn-lg btn-block login-submit" id="login-submit">
              <span id="login-btn-text">🔐 تسجيل الدخول</span>
              <span id="login-btn-loading" style="display:none;">
                <span class="btn-spinner"></span> جاري الدخول...
              </span>
            </button>
          </div>

          <div class="login-footer">
            <a href="#home" class="login-back-link btn-back-oval">← العودة للرئيسية</a>
          </div>
        </div>
      </div>
    `;

    this._bindEvents(container);
    setTimeout(() => container.querySelector('#login-email')?.focus(), 300);
  },

  _bindEvents(container) {
    const submitBtn = container.querySelector('#login-submit');
    const emailInput = container.querySelector('#login-email');
    const passwordInput = container.querySelector('#login-password');
    const errorDiv = container.querySelector('#login-error');
    const errorMsg = container.querySelector('#login-error-msg');

    container.querySelector('#toggle-password')?.addEventListener('click', () => {
      const type = passwordInput.type === 'password' ? 'text' : 'password';
      passwordInput.type = type;
      container.querySelector('#toggle-password').textContent = type === 'password' ? '👁️' : '🙈';
    });

    const handleLogin = async () => {
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      if (!email || !password) {
        errorDiv.style.display = 'flex';
        errorMsg.textContent = 'الرجاء إدخال البريد الإلكتروني وكلمة المرور';
        return;
      }
      const btnText = container.querySelector('#login-btn-text');
      const btnLoading = container.querySelector('#login-btn-loading');
      if (btnText) btnText.style.display = 'none';
      if (btnLoading) btnLoading.style.display = 'inline-flex';
      submitBtn.disabled = true;
      errorDiv.style.display = 'none';
      let navigated = false;
      try {
        await Auth.login(email, password);
        // حفظ الإيميل إذا فعّل "تذكرني"
        const rememberMe = container.querySelector('#remember-me')?.checked;
        if (rememberMe) {
          localStorage.setItem('baytar_remember_email', email);
        } else {
          localStorage.removeItem('baytar_remember_email');
        }
        showToast('تم تسجيل الدخول بنجاح! مرحباً بك 👋', 'success');
        playNotificationSound();
        let dest = null;
        if (Auth.isClinicAdmin()) dest = this._redirectTo;
        else if (Auth.isDoctor()) dest = 'doctor';
        else if (Auth.isOperator()) dest = 'case-history';
        if (dest) {
          navigated = true;
          history.replaceState(null, null, '#' + dest);
          await Router.navigate(dest);
        } else {
          errorDiv.style.display = 'flex';
          errorMsg.textContent = '⛔ هذا الحساب لا يملك صلاحية الدخول';
          await Auth.logout();
        }
      } catch (err) {
        console.error('Login error:', err);
        errorDiv.style.display = 'flex';
        errorMsg.textContent = err.message === 'Invalid login credentials'
          ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
          : 'حدث خطأ أثناء تسجيل الدخول. يرجى المحاولة مرة أخرى.';
      } finally {
        if (!navigated) {
          const t = container.querySelector('#login-btn-text');
          const l = container.querySelector('#login-btn-loading');
          if (t) t.style.display = 'inline';
          if (l) l.style.display = 'none';
          submitBtn.disabled = false;
        }
      }
    };

    submitBtn?.addEventListener('click', handleLogin);
    passwordInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
    emailInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') passwordInput?.focus(); });
  }
};






// ==========================================
// BACKGROUND ANIMATION
// ==========================================
function initAnimatedBackground() {
  const container = document.getElementById('animated-bg');
  if (!container) return;

  const pawSvg = `<svg viewBox="0 0 200 220" width="100%" height="100%" fill="var(--white)" xmlns="http://www.w3.org/2000/svg">
    <path d="M100 155 C100 155 70 130 70 115 C70 105 78 98 88 98 C93 98 97 100 100 104 C103 100 107 98 112 98 C122 98 130 105 130 115 C130 130 100 155 100 155Z"/>
    <ellipse cx="75" cy="92" rx="11" ry="13"/>
    <ellipse cx="125" cy="92" rx="11" ry="13"/>
    <ellipse cx="93" cy="78" rx="9" ry="11"/>
    <ellipse cx="107" cy="78" rx="9" ry="11"/>
  </svg>`;

  const particleCount = 8;
  for (let i = 0; i < particleCount; i++) {
    const paw = document.createElement('div');
    paw.className = 'floating-paw';
    paw.innerHTML = pawSvg;

    const size = Math.random() * 40 + 30;
    const left = Math.random() * 100;
    const duration = Math.random() * 20 + 25;
    const delay = Math.random() * -40;
    const opacity = Math.random() * 0.05 + 0.02;
    const rotStart = Math.random() * 360;
    const rotEnd = rotStart + (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 180 + 90);
    const scale = Math.random() * 0.5 + 0.8;

    paw.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      left: ${left}vw;
      --duration: ${duration}s;
      --delay: ${delay}s;
      --opacity: ${opacity};
      --rot-start: ${rotStart}deg;
      --rot-end: ${rotEnd}deg;
      --scale: ${scale};
    `;

    container.appendChild(paw);
  }
}


// =============================================================
// ===== MEDICAL CLINIC VIEWS (Landing / Medical / Doctor) =====
// =============================================================

// ---------- helpers for clinic UI ----------
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatDateTimeAr(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ar-IQ', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function formatRelativeAr(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `قبل ${hrs} ساعة`;
  const days = Math.floor(hrs / 24);
  return `قبل ${days} يوم`;
}
function severityBadge(sev) {
  const map = { low: { txt: 'منخفضة', cls: 'sev-low' }, medium: { txt: 'متوسطة', cls: 'sev-medium' }, high: { txt: 'عالية', cls: 'sev-high' }, critical: { txt: 'حرجة', cls: 'sev-critical' } };
  const m = map[sev]; if (!m) return '';
  return `<span class="sev-badge ${m.cls}">${m.txt}</span>`;
}
function statusLabel(status) {
  return ({ waiting: 'بانتظار القبول', accepted: 'تم القبول', in_progress: 'قيد المعالجة', completed: 'مكتملة', cancelled: 'ملغاة' }[status] || status);
}

// إشعار WhatsApp عبر Edge Function — fire-and-forget (لا يوقف العملية لو فشل)
function notifyWhatsApp(messageType, visitId) {
  (async () => {
    try {
      const { data, error } = await supabaseClient.functions.invoke('send-whatsapp', {
        body: { message_type: messageType, visit_id: visitId }
      });
      if (error) console.error(`❌ send-whatsapp(${messageType}):`, error);
      else console.log(`✅ send-whatsapp(${messageType}):`, data);
    } catch (e) {
      console.error(`❌ send-whatsapp(${messageType}) exception:`, e?.message);
    }
  })();
}
function playNotifSound() {
  try { const a = document.getElementById('notification-sound'); if (a) { a.currentTime = 0; a.play().catch(() => { }); } } catch { }
}


// =============================================================
// LANDING VIEW — medical entry point
// =============================================================
const LandingView = {
  async render(container) {
    container.innerHTML = `
      <div class="home-view animate-in">

        <div class="home-hero">
          <div class="home-hero-inner">
            <img src="assets/logo.svg" alt="${CLINIC_NAME}" class="home-logo">
            <div class="home-hero-text">
              <h1 class="home-clinic-name">${CLINIC_NAME}</h1>
              <p class="home-clinic-sub">اختر نوع الخدمة</p>
            </div>
          </div>
        </div>

        <div class="home-services-grid">
          <a href="#booking/medical" class="home-service-card service-medical">
            <div class="service-glow"></div>
            <div class="service-icon">🩺</div>
            <h2 class="service-title">زيارة طبيب</h2>
            <p class="service-desc">استشارة طبية وفحص شامل للحيوان الأليف مع نخبة من الأطباء البيطريين</p>
            <span class="service-cta">احجز استشارة ←</span>
          </a>
        </div>

      </div>
    `;
  }
};


// =============================================================
// MEDICAL INTAKE VIEW — public intake form
// =============================================================
const MedicalIntakeView = {
  _selectedSymptoms: new Set(),

  async render(container) {
    this._selectedSymptoms = new Set();
    container.innerHTML = `
      <div class="intake-view animate-in">
        <div class="intake-header">
          <a href="#home" class="btn-back-oval">← عودة</a>
          <h1>🩺 زيارة طبيب</h1>
          <p>يرجى تعبئة البيانات ليتم توجيهك للطبيب المختص</p>
        </div>

        <form id="intake-form" class="intake-form" autocomplete="off">
          <div class="form-grid">
            <label class="form-field">
              <span>الاسم الثلاثي <em>*</em></span>
              <input type="text" name="customer_name" required placeholder="مثال: أحمد علي حسين">
            </label>
            <label class="form-field">
              <span>رقم الهاتف <em>*</em></span>
              <input type="tel" name="phone" required placeholder="07XXXXXXXXX" pattern="[0-9+\\- ]{8,15}">
            </label>
            <label class="form-field">
              <span>المنطقة</span>
              <input type="text" name="area" placeholder="مثال: الكرادة">
            </label>
            <label class="form-field">
              <span>عمر الحيوان</span>
              <input type="text" name="animal_age" placeholder="مثال: سنتين أو 6 أشهر">
            </label>
            <label class="form-field">
              <span>اسم الحيوان (اختياري)</span>
              <input type="text" name="pet_name" placeholder="مثال: ماكس">
            </label>
          </div>

          <div class="form-section">
            <label class="form-label">نوع الحيوان <em>*</em></label>
            <input type="hidden" name="animal_type" id="animal_type_hidden" required>
            <div class="animal-type-grid">
              ${ANIMAL_TYPES.map(t => `
                <button type="button" class="animal-type-btn" data-value="${escHtml(t.value)}">
                  <span class="animal-icon">${t.icon}</span>
                  <span class="animal-label">${escHtml(t.value)}</span>
                </button>
              `).join('')}
            </div>
          </div>

          <div class="form-section">
            <label class="form-label">الأعراض (اختر ما ينطبق)</label>
            <div class="symptom-list">
              ${SYMPTOMS.map(s => `
                <label class="symptom-row" data-key="${s.key}">
                  <span class="symptom-check">
                    <input type="checkbox" value="${s.key}" class="symptom-cb">
                    <span class="symptom-checkmark"></span>
                  </span>
                  <span class="symptom-icon-sm">${s.icon}</span>
                  <span class="symptom-text">${s.label}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="form-section">
            <label class="form-field">
              <span>ملاحظات إضافية</span>
              <textarea name="notes" rows="3" placeholder="صف الحالة بتفصيل أكثر (اختياري)"></textarea>
            </label>
          </div>

          <div class="form-section">
            <label class="form-label">موعد الزيارة <em>*</em></label>
            <div class="form-grid">
              <label class="form-field">
                <span>اليوم</span>
                <input type="date" name="booking_date" required min="${new Date().toISOString().slice(0, 10)}">
              </label>
              <label class="form-field">
                <span>الساعة</span>
                <input type="time" name="booking_time" required>
              </label>
            </div>
          </div>

          <button type="submit" class="btn btn-primary btn-lg intake-submit">
            <span>📨</span>
            <span>إرسال الطلب</span>
          </button>
        </form>
      </div>
    `;

    const form = $('#intake-form');

    // --- Animal type picker ---
    const animalHidden = form.querySelector('#animal_type_hidden');
    form.querySelectorAll('.animal-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        form.querySelectorAll('.animal-type-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        animalHidden.value = btn.dataset.value;
      });
    });

    // --- Symptom checkboxes ---
    // <label> auto-toggles the checkbox on click, so only listen to change
    form.querySelectorAll('.symptom-row').forEach(row => {
      row.querySelector('.symptom-cb').addEventListener('change', function () {
        row.classList.toggle('active', this.checked);
      });
    });

    // --- Autofill memory: lookup by phone ---
    const phoneInput = form.querySelector('input[name="phone"]');
    let autofillTimer = null;
    const tryAutofill = async () => {
      const phone = String(phoneInput.value || '').trim();
      if (phone.length < 8) return;
      try {
        const profile = await DB.getCustomerProfileByPhone(phone);
        if (!profile) return;
        const setIfEmpty = (name, val) => {
          const el = form.querySelector(`[name="${name}"]`);
          if (el && !el.value && val) el.value = val;
        };
        setIfEmpty('customer_name', profile.customer.name);
        const p = profile.patients[0];
        const lv = profile.lastVisit;
        if (p) {
          // Animal type: set hidden input + visually select the matching button
          if (p.animal_type && !animalHidden.value) {
            animalHidden.value = p.animal_type;
            const match = form.querySelector(`.animal-type-btn[data-value="${p.animal_type}"]`);
            if (match) match.classList.add('selected');
          }
          setIfEmpty('pet_name', p.name);
        }
        if (lv) {
          setIfEmpty('area', lv.intake_area);
          setIfEmpty('animal_age', lv.intake_animal_age);
        }
        let badge = form.querySelector('.autofill-badge');
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'autofill-badge';
          badge.innerHTML = `✨ أهلاً بعودتك ${escHtml(profile.customer.name || '')} — تم تعبئة بياناتك`;
          form.insertBefore(badge, form.firstChild);
        }
      } catch (err) { console.warn('autofill failed:', err); }
    };
    phoneInput.addEventListener('blur', tryAutofill);
    phoneInput.addEventListener('input', () => {
      clearTimeout(autofillTimer);
      autofillTimer = setTimeout(tryAutofill, 600);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const phone = String(fd.get('phone') || '').trim();
      const customer_name = String(fd.get('customer_name') || '').trim();
      const animal_type = String(fd.get('animal_type') || '').trim();
      if (!phone || !customer_name || !animal_type) {
        showToast('يرجى تعبئة الحقول المطلوبة', 'warning');
        return;
      }
      const symptoms = Array.from(form.querySelectorAll('.symptom-cb:checked')).map(i => i.value);
      const pet_name = String(fd.get('pet_name') || '').trim();

      const submitBtn = form.querySelector('.intake-submit');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>⏳</span><span>جاري الإرسال...</span>';

      try {
        // 1. upsert customer
        const customer = await DB.upsertCustomerByPhone({ name: customer_name, phone });
        // 2. find/create patient (animal file)
        const patient = await DB.findOrCreatePatient({
          customer_id: customer?.id ?? null,
          name: pet_name || null,
          animal_type,
        });
        // 3. insert visit
        const visit = await DB.createVisit({
          customer_id: customer?.id ?? null,
          patient_id: patient?.id ?? null,
          intake: {
            customer_name,
            phone,
            area: fd.get('area') || '',
            animal_type,
            animal_age: fd.get('animal_age') || '',
            notes: fd.get('notes') || '',
          },
          symptoms,
        });
        // 3ب. إنشاء موعد الحجز (الوقت اللي اختاره الزبون)
        const bookingDate = fd.get('booking_date');
        const bookingTime = fd.get('booking_time');
        if (bookingDate && bookingTime) {
          try {
            await DB.addAppointment({
              visit_id: visit.id,
              patient_id: patient?.id ?? null,
              scheduled_at: new Date(`${bookingDate}T${bookingTime}`).toISOString(),
              purpose: 'الحجز الأولي',
              created_by: Auth.getDoctor()?.id ?? null,
              time_specified: true,
            });
          } catch (apptErr) { console.warn('booking appointment failed:', apptErr); }
        }
        // 4. إشعار WhatsApp — استلام الحجز (اختياري، لا يوقف العملية)
        notifyWhatsApp('booking_received', visit.id);

        // success screen with QR code (fallback to visit id if patient missing)
        const patientId = patient?.id ?? '';
        const qrTarget = patientId ? `patient/${patientId}` : (visit?.id ? `visit/${visit.id}` : '');
        const qrUrl = `${window.location.origin}${window.location.pathname}#${qrTarget}`;
        container.innerHTML = `
          <div class="qr-success-page animate-in">

            <!-- Top: success message -->
            <div class="qr-success-header">
              <div class="qr-success-checkmark">
                <svg viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="26" cy="26" r="25" stroke="currentColor" stroke-width="2" fill="none" opacity="0.3"/>
                  <path d="M14 27l8 8 16-16" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <h1 class="qr-success-title">تم إرسال طلبك!</h1>
              <p class="qr-success-sub">سيتم استدعاؤك خلال دقائق</p>
              ${phone ? `<div class="qr-phone-badge">📱 ${escHtml(phone)}</div>` : ''}
            </div>

            ${qrTarget ? `
            <!-- QR Section -->
            <div class="qr-glass-card">
              <div class="qr-glass-card-label">
                <span class="qr-label-dot"></span>
                رمز ملفك الطبي
              </div>

              <div class="qr-code-wrapper">
                <div id="patient-qr" class="qr-canvas"></div>
              </div>

              <p class="qr-glass-hint">
                📌 احتفظ بهذا الرمز — الطبيب يمسحه لعرض ملفك الطبي كاملاً في الزيارات القادمة
              </p>

              <div class="qr-glass-actions">
                <button type="button" id="qr-download" class="qr-action-btn">
                  <span>⬇️</span> حفظ
                </button>
                <button type="button" id="qr-print" class="qr-action-btn">
                  <span>🖨️</span> طباعة
                </button>
              </div>
            </div>
            ` : ''}

            <a href="#home" class="qr-back-btn">← العودة للرئيسية</a>
          </div>
        `;

        if (qrTarget) {
          const qrEl = document.getElementById('patient-qr');
          const renderQR = () => {
            if (!window.QRCode) return setTimeout(renderQR, 200);
            try {
              new window.QRCode(qrEl, {
                text: qrUrl,
                width: 240,
                height: 240,
                colorDark: '#1a1a1a',
                colorLight: '#ffffff',
                correctLevel: window.QRCode.CorrectLevel.H,
              });
            } catch (qe) { console.warn('QR render failed:', qe); qrEl.textContent = qrUrl; }
          };
          renderQR();
          document.getElementById('qr-download')?.addEventListener('click', () => {
            const img = qrEl.querySelector('img') || qrEl.querySelector('canvas');
            if (!img) return;
            const src = img.tagName === 'IMG' ? img.src : img.toDataURL('image/png');
            const link = document.createElement('a');
            link.download = `baytar-${qrTarget.replace('/', '-')}.png`;
            link.href = src;
            link.click();
          });
          document.getElementById('qr-print')?.addEventListener('click', () => window.print());
        }
      } catch (err) {
        console.error('Intake submit failed:', err);
        showToast(`❌ فشل إرسال الطلب: ${err?.message || 'خطأ غير معروف'}`, 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>📨</span><span>إرسال الطلب</span>';
      }
    });
  }
};


// =============================================================
// PATIENT PROFILE VIEW — opened via QR code scan
// =============================================================
const PatientProfileView = {
  async render(container, patientId) {
    if (!patientId) {
      container.innerHTML = `<div class="empty-state">⛔ معرّف الحيوان مفقود</div>`;
      return;
    }
    container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>جاري تحميل الملف...</p></div>`;
    try {
      const patient = await DB.getPatient(patientId);
      if (!patient) {
        container.innerHTML = `<div class="empty-state">❓ لم يتم العثور على هذا الملف</div>`;
        return;
      }
      const history = await DB.getPatientHistory(patientId);
      const customer = patient.customer_id
        ? (await supabaseClient.from('customers').select('*').eq('id', patient.customer_id).maybeSingle()).data
        : null;

      container.innerHTML = `
        <div class="patient-profile animate-in">
          <div class="intake-header">
            <a href="#home" class="btn-back-oval">← عودة</a>
            <h1>📋 ملف الحيوان</h1>
          </div>

          <div class="patient-hero">
            <div class="patient-avatar">${escHtml(patient.animal_type?.[0] || '🐾')}</div>
            <div class="patient-hero-info">
              <h2>${escHtml(patient.name || 'بدون اسم')}</h2>
              <p class="patient-meta">
                <span>🐾 ${escHtml(patient.animal_type || '-')}</span>
                ${patient.breed ? `<span>🧬 ${escHtml(patient.breed)}</span>` : ''}
                ${patient.age_months != null ? `<span>📅 ${patient.age_months} شهر</span>` : ''}
                ${patient.gender ? `<span>⚧ ${escHtml(patient.gender)}</span>` : ''}
              </p>
              ${customer ? `<p class="patient-owner">👤 ${escHtml(customer.name || '')} — 📞 ${escHtml(customer.phone || '')}</p>` : ''}
            </div>
          </div>

          <div class="panel">
            <h3>📜 سجل الزيارات (${history.length})</h3>
            ${history.length === 0 ? `<p class="empty-state">لا توجد زيارات سابقة</p>` : `
              <div class="visit-history">
                ${history.map(v => `
                  <div class="visit-history-item">
                    <div class="visit-history-head">
                      <span class="visit-date">${new Date(v.created_at).toLocaleString('ar')}</span>
                      <span class="visit-status status-${escHtml(v.status || 'waiting')}">${escHtml(v.status || '-')}</span>
                    </div>
                    ${v.intake_notes ? `<p class="visit-notes">${escHtml(v.intake_notes)}</p>` : ''}
                    ${v.diagnosis ? `<p class="visit-diagnosis"><strong>التشخيص:</strong> ${escHtml(v.diagnosis)}</p>` : ''}
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      `;
    } catch (err) {
      console.error('PatientProfileView error:', err);
      container.innerHTML = `<div class="empty-state">❌ خطأ في تحميل الملف: ${escHtml(err?.message || '')}</div>`;
    }
  }
};


// =============================================================
// DOCTOR VIEW — doctor portal dashboard
// =============================================================
const DoctorView = {
  _tab: 'waiting',

  async render(container) {
    const doctor = Auth.getDoctor();
    if (!doctor) {
      container.innerHTML = `<div class="empty-state">⛔ غير مصرح</div>`;
      return;
    }
    container.innerHTML = `
      <div class="doctor-view animate-in">
        <div class="doctor-header">
          <div class="doctor-header-main">
            <div class="doctor-avatar" style="background:${escHtml(doctor.avatar_color || '#7c3aed')}">${escHtml((doctor.display_name || 'د').slice(0, 1))}</div>
            <div>
              <h1>مرحباً د. ${escHtml(doctor.display_name)}${doctor.is_admin ? ' <span class="admin-badge">مدير</span>' : ''}</h1>
              <p>${escHtml(doctor.specialization || 'طبيب بيطري')}</p>
            </div>
          </div>
          <div class="doctor-header-actions">
            <a href="#doctor/chat" class="btn btn-ghost">💬 الچات</a>
            <a href="#reports" class="btn btn-ghost">📊 التقارير</a>
            ${doctor.is_admin ? '<a href="#admin/doctors" class="btn btn-ghost">👨‍⚕️ الأطباء</a>' : ''}
          </div>
        </div>

        <div class="doctor-tabs">
          <button class="doctor-tab ${this._tab === 'waiting' ? 'active' : ''}" data-tab="waiting">⏳ الحالات المعلقة <span id="waiting-count" class="tab-count">0</span></button>
          <button class="doctor-tab ${this._tab === 'mine' ? 'active' : ''}" data-tab="mine">👨‍⚕️ حالاتي <span id="mine-count" class="tab-count">0</span></button>
        </div>

        <div id="doctor-cases" class="doctor-cases"></div>
      </div>
    `;

    $$('.doctor-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this._tab = btn.dataset.tab;
        $$('.doctor-tab').forEach(b => b.classList.toggle('active', b === btn));
        this._loadCases();
      });
    });

    await this._loadCases();

    // realtime: listen for new visits & status changes
    Realtime.subscribe('doctor-visits', { event: '*', schema: 'public', table: 'visits' }, async (payload) => {
      // notify on new incoming patients (INSERT with status=waiting)
      if (payload.eventType === 'INSERT' && payload.new?.status === 'waiting') {
        playNotifSound();
        showToast(`🚨 مريض جديد: ${payload.new.intake_customer_name} (${payload.new.intake_animal_type})`, 'info', 6000);
      }
      await this._loadCases();
    });
  },

  async _loadCases() {
    const doctorId = Auth.getDoctor()?.id;
    const pane = $('#doctor-cases');
    if (!pane) return;
    pane.innerHTML = '<div class="loading-spinner"></div>';

    let visits = [];
    if (this._tab === 'waiting') {
      visits = await DB.getWaitingVisits();
    } else {
      visits = await DB.getMyVisits(doctorId);
    }

    const waitingCount = this._tab === 'waiting' ? visits.length : (await DB.getWaitingVisits()).length;
    const mineCount = this._tab === 'mine' ? visits.length : (await DB.getMyVisits(doctorId)).length;
    const wc = $('#waiting-count'); if (wc) wc.textContent = waitingCount;
    const mc = $('#mine-count'); if (mc) mc.textContent = mineCount;

    if (!visits.length) {
      pane.innerHTML = `<div class="empty-state">لا توجد حالات ${this._tab === 'waiting' ? 'معلقة' : 'مسجلة لك'}.</div>`;
      return;
    }

    pane.innerHTML = visits.map(v => {
      const symptoms = (v.visit_symptoms || []).map(s => SYMPTOM_LABEL[s.symptom_key] || s.symptom_key).join('، ');
      const pet = v.patients?.name || v.intake_animal_type;
      const primaryDocName = v.primary_doctor?.display_name ? `د. ${v.primary_doctor.display_name}` : '';
      return `
        <div class="case-card status-${v.status}">
          <div class="case-card-header">
            <div>
              <h3>${escHtml(v.intake_customer_name)}</h3>
              <div class="case-meta">
                <span>📞 ${Auth.isClinicAdmin() ? escHtml(v.intake_phone) : escHtml((v.intake_phone || '').substring(0, 4) + '***' + (v.intake_phone || '').substring((v.intake_phone || '').length - 3))}</span>
                ${v.intake_area ? `<span>📍 ${escHtml(v.intake_area)}</span>` : ''}
                <span>🐾 ${escHtml(pet)}${v.intake_animal_age ? ` · ${escHtml(v.intake_animal_age)}` : ''}</span>
              </div>
            </div>
            <div class="case-card-status">
              <span class="status-pill status-${v.status}">${statusLabel(v.status)}</span>
              ${severityBadge(v.severity)}
              <small>${formatRelativeAr(v.created_at)}</small>
            </div>
          </div>
          ${symptoms ? `<div class="case-symptoms"><strong>الأعراض:</strong> ${escHtml(symptoms)}</div>` : ''}
          ${primaryDocName ? `<div class="case-doctor">الطبيب المعالج: ${escHtml(primaryDocName)}</div>` : ''}
          <div class="case-actions">
            ${v.status === 'waiting'
          ? `<button class="btn btn-primary" data-accept-id="${v.id}">قبول الحالة</button>`
          : ''}
            <a href="#doctor/visit/${v.id}" class="btn btn-ghost">فتح الحالة ←</a>
          </div>
        </div>
      `;
    }).join('');

    // wire accept buttons
    pane.querySelectorAll('[data-accept-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const visitId = btn.dataset.acceptId;
        btn.disabled = true;
        btn.textContent = 'جاري القبول...';
        try {
          const accepted = await DB.acceptVisit(visitId, Auth.getDoctor().id);
          if (!accepted) {
            showToast('الحالة قُبِلت من طبيب آخر', 'warning');
            await this._loadCases();
            return;
          }
          // notify customer — تأكيد الحجز (حجز جديد فقط؛ محميّة بالباك-إند)
          notifyWhatsApp('booking_confirmed', visitId);
          showToast('✅ تم قبول الحالة', 'success');
          window.location.hash = `#doctor/visit/${visitId}`;
        } catch (err) {
          showToast(`❌ ${err.message || 'فشل قبول الحالة'}`, 'error');
          btn.disabled = false;
          btn.textContent = 'قبول الحالة';
        }
      });
    });
  }
};


// =============================================================
// DOCTOR VISIT DETAIL VIEW — full case management
// =============================================================
const DoctorVisitDetailView = {
  _visitId: null,

  async render(container, visitId) {
    this._visitId = visitId;
    const doctor = Auth.getDoctor();
    container.innerHTML = '<div class="loading-spinner"></div>';

    const visit = await DB.getVisitById(visitId);
    if (!visit) {
      container.innerHTML = `<div class="empty-state">الحالة غير موجودة.</div>`;
      return;
    }

    const [notes, appointments, collaborators, allDoctors, history] = await Promise.all([
      DB.getVisitNotes(visitId),
      DB.getAppointmentsForVisit(visitId),
      DB.getCollaborators(visitId),
      DB.getActiveDoctors(),
      visit.patient_id ? DB.getPatientHistory(visit.patient_id) : Promise.resolve([]),
    ]);

    const pastVisits = (history || []).filter(h => h.id !== visit.id);
    const symptoms = (visit.visit_symptoms || []).map(s => SYMPTOM_LABEL[s.symptom_key] || s.symptom_key);
    const isPrimary = visit.primary_doctor_id === doctor?.id;
    const isCollab = collaborators.some(c => c.doctor_id === doctor?.id);
    const canEdit = isPrimary || isCollab || doctor?.is_admin;

    container.innerHTML = `
      <div class="visit-detail animate-in">
        <div class="visit-back"><a href="#doctor" class="btn-back-oval">← عودة للحالات</a></div>

        <div class="visit-header">
          <div>
            <h1>ملف الحالة</h1>
            <div class="visit-meta">
              <span class="status-pill status-${visit.status}">${statusLabel(visit.status)}</span>
              ${severityBadge(visit.severity)}
              <small>${formatDateTimeAr(visit.created_at)}</small>
            </div>
          </div>
          <div class="visit-header-actions">
            ${visit.status === 'waiting' ? `<button class="btn btn-primary" id="accept-visit-btn">قبول الحالة</button>` : ''}
            ${visit.status === 'accepted' && canEdit ? `<button class="btn btn-primary" id="start-visit-btn">▶️ بدأ العمل</button>` : ''}
            ${visit.status === 'in_progress' && canEdit ? `<button class="btn btn-success" id="complete-visit-btn">✅ تم الانتهاء</button>` : ''}
          </div>
        </div>

        <div class="visit-grid">
          <!-- Patient info card -->
          <section class="visit-card">
            <h2>🐾 معلومات المريض</h2>
            <div class="info-row"><strong>الزبون:</strong> ${escHtml(visit.intake_customer_name)}</div>
            ${Auth.isClinicAdmin() ? `<div class="info-row"><strong>الهاتف:</strong> ${escHtml(visit.intake_phone)}</div>` : ''}
            <div class="info-row"><strong>المنطقة:</strong> ${escHtml(visit.intake_area || '—')}</div>
            <div class="info-row"><strong>الحيوان:</strong> ${escHtml(visit.patients?.name || '—')} (${escHtml(visit.intake_animal_type)})</div>
            <div class="info-row"><strong>العمر:</strong> ${escHtml(visit.intake_animal_age || '—')}</div>
            ${symptoms.length ? `<div class="info-row"><strong>الأعراض:</strong> ${escHtml(symptoms.join('، '))}</div>` : ''}
            ${visit.intake_notes ? `<div class="info-row"><strong>ملاحظات المريض:</strong> ${escHtml(visit.intake_notes)}</div>` : ''}
          </section>

          <!-- Past visits (patient history) -->
          <section class="visit-card">
            <h2>📜 تاريخ المريض</h2>
            ${pastVisits.length === 0 ? `<p class="muted">لا يوجد زيارات سابقة لهذا الحيوان.</p>` : `
              <ul class="history-list">
                ${pastVisits.slice(0, 8).map(h => `
                  <li>
                    <div class="history-date">${formatDateTimeAr(h.created_at)}</div>
                    <div><strong>التشخيص:</strong> ${escHtml(h.diagnosis || '—')}</div>
                    <div><strong>العلاج:</strong> ${escHtml(h.treatment || '—')}</div>
                    ${h.primary_doctor?.display_name ? `<div class="muted">د. ${escHtml(h.primary_doctor.display_name)}</div>` : ''}
                  </li>
                `).join('')}
              </ul>
            `}
          </section>

          <!-- Exam form -->
          <section class="visit-card visit-exam" style="grid-column: 1 / -1;">
            <h2>🔬 فورم الفحص والتشخيص</h2>
            <form id="exam-form" ${canEdit ? '' : 'data-readonly="1"'}>
              <div class="form-grid">
                <label class="form-field"><span>درجة الحرارة (°C)</span><input type="number" step="0.1" name="vital_temperature" value="${visit.vital_temperature ?? ''}"></label>
                <label class="form-field"><span>الوزن (kg)</span><input type="number" step="0.1" name="vital_weight_kg" value="${visit.vital_weight_kg ?? ''}"></label>
                <label class="form-field"><span>معدل النبض</span><input type="number" name="vital_heart_rate" value="${visit.vital_heart_rate ?? ''}"></label>
                <div class="doctor-form-field" style="margin-bottom: 20px;">
                  <span>درجة الخطورة</span>
                  <div class="radix-select" id="severity-radix">
                    <input type="hidden" name="severity" value="${visit.severity || ''}" />
                    <button type="button" class="radix-select-trigger" aria-haspopup="listbox" aria-expanded="false" ${canEdit ? '' : 'disabled'}>
                      <span class="radix-select-value">
                        ${visit.severity === 'low' ? 'منخفضة' : visit.severity === 'medium' ? 'متوسطة' : visit.severity === 'high' ? 'عالية' : visit.severity === 'critical' ? 'حرجة' : '— اختر الخطورة —'}
                      </span>
                      <svg class="radix-caret" width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M4.93179 5.43179C4.75605 5.60753 4.75605 5.89245 4.93179 6.06819L7.43179 8.56819C7.60753 8.74393 7.89245 8.74393 8.06819 8.56819L10.5682 6.06819C10.7439 5.89245 10.7439 5.60753 10.5682 5.43179C10.3924 5.25605 10.1075 5.25605 9.93179 5.43179L7.5 7.86358L5.06819 5.43179C4.89245 5.25605 4.60753 5.25605 4.43179 5.43179Z" fill="currentColor"></path></svg>
                    </button>
                    <div class="radix-select-content" role="listbox">
                      <div class="radix-select-item" role="option" data-value="low" data-state="${visit.severity === 'low' ? 'checked' : 'unchecked'}">
                        <span class="radix-select-item-indicator">
                          <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M11.4669 3.72684C11.7558 3.91574 11.8369 4.30308 11.648 4.59198L7.39799 11.092C7.29783 11.2452 7.13556 11.3467 6.95402 11.3699C6.77247 11.3931 6.58989 11.3355 6.45446 11.2124L3.70446 8.71241C3.44905 8.48022 3.43023 8.08494 3.66242 7.82953C3.89461 7.57412 4.28989 7.55529 4.5453 7.78749L6.75292 9.79441L10.6018 3.90792C10.7907 3.61902 11.178 3.53795 11.4669 3.72684Z" fill="currentColor"></path></svg>
                        </span>
                        <span class="radix-select-item-text">منخفضة</span>
                      </div>
                      <div class="radix-select-item" role="option" data-value="medium" data-state="${visit.severity === 'medium' ? 'checked' : 'unchecked'}">
                        <span class="radix-select-item-indicator">
                          <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M11.4669 3.72684C11.7558 3.91574 11.8369 4.30308 11.648 4.59198L7.39799 11.092C7.29783 11.2452 7.13556 11.3467 6.95402 11.3699C6.77247 11.3931 6.58989 11.3355 6.45446 11.2124L3.70446 8.71241C3.44905 8.48022 3.43023 8.08494 3.66242 7.82953C3.89461 7.57412 4.28989 7.55529 4.5453 7.78749L6.75292 9.79441L10.6018 3.90792C10.7907 3.61902 11.178 3.53795 11.4669 3.72684Z" fill="currentColor"></path></svg>
                        </span>
                        <span class="radix-select-item-text">متوسطة</span>
                      </div>
                      <div class="radix-select-item" role="option" data-value="high" data-state="${visit.severity === 'high' ? 'checked' : 'unchecked'}">
                        <span class="radix-select-item-indicator">
                          <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M11.4669 3.72684C11.7558 3.91574 11.8369 4.30308 11.648 4.59198L7.39799 11.092C7.29783 11.2452 7.13556 11.3467 6.95402 11.3699C6.77247 11.3931 6.58989 11.3355 6.45446 11.2124L3.70446 8.71241C3.44905 8.48022 3.43023 8.08494 3.66242 7.82953C3.89461 7.57412 4.28989 7.55529 4.5453 7.78749L6.75292 9.79441L10.6018 3.90792C10.7907 3.61902 11.178 3.53795 11.4669 3.72684Z" fill="currentColor"></path></svg>
                        </span>
                        <span class="radix-select-item-text">عالية</span>
                      </div>
                      <div class="radix-select-item" role="option" data-value="critical" data-state="${visit.severity === 'critical' ? 'checked' : 'unchecked'}">
                        <span class="radix-select-item-indicator">
                          <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M11.4669 3.72684C11.7558 3.91574 11.8369 4.30308 11.648 4.59198L7.39799 11.092C7.29783 11.2452 7.13556 11.3467 6.95402 11.3699C6.77247 11.3931 6.58989 11.3355 6.45446 11.2124L3.70446 8.71241C3.44905 8.48022 3.43023 8.08494 3.66242 7.82953C3.89461 7.57412 4.28989 7.55529 4.5453 7.78749L6.75292 9.79441L10.6018 3.90792C10.7907 3.61902 11.178 3.53795 11.4669 3.72684Z" fill="currentColor"></path></svg>
                        </span>
                        <span class="radix-select-item-text">حرجة</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <label class="form-field"><span>التشخيص</span><textarea name="diagnosis" rows="2">${escHtml(visit.diagnosis || '')}</textarea></label>
              <label class="form-field"><span>العلاج</span><textarea name="treatment" rows="2">${escHtml(visit.treatment || '')}</textarea></label>
              <label class="form-field"><span>الوصفة الطبية</span><textarea name="prescription" rows="2">${escHtml(visit.prescription || '')}</textarea></label>
              <label class="form-field"><span>نتائج مختبرية</span><textarea name="lab_results" rows="2">${escHtml(visit.lab_results || '')}</textarea></label>
              ${canEdit ? `
                <div class="exam-actions">
                  <button type="button" class="btn btn-ghost" id="ai-suggest-btn">💡 اقترح تشخيص بالذكاء الصناعي</button>
                  <button type="button" class="btn btn-ghost" id="capture-lab-btn">📸 التقاط صورة للتحاليل</button>
                  <input type="file" id="capture-lab-input" accept="image/*" capture="environment" multiple style="display:none">
                  <button type="submit" class="btn btn-primary">💾 حفظ</button>
                </div>
              ` : '<p class="muted">عرض فقط (لست من الأطباء المسموح لهم بتعديل هذه الحالة).</p>'}
            </form>
            <div id="ai-result" class="ai-result" style="display:none;"></div>
          </section>

          <!-- Lab attachments -->
          <section class="visit-card visit-attachments-card" style="grid-column: 1 / -1;">
            <h2>📸 صور التحاليل</h2>
            <div id="attachments-grid" class="attachments-grid"><div class="loading-spinner"></div></div>
          </section>

          <!-- Appointments -->
          <section class="visit-card">
            <h2>📅 مواعيد المتابعة</h2>
            ${canEdit ? `
              <form id="add-appt-form" class="appt-form" style="display: flex; flex-direction: column; background: rgba(0,0,0,0.2); padding: 16px; border-radius: 12px; border: 1px solid rgba(192, 38, 211, 0.2); margin-bottom: 24px;">
                <h3 style="color: var(--white); margin-bottom: 16px; font-size: 1rem;">📅 تحديد موعد مراجعة</h3>
                
                <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px;">
                  <div class="doctor-form-field" style="flex: 2; min-width: 150px; margin-bottom: 0;">
                    <span>يوم الموعد (التاريخ)</span>
                    <input type="date" class="doctor-custom-input doctor-date-input" name="scheduled_date" style="padding: 10px; font-size: 0.9rem;" required>
                  </div>
                  
                  <div class="doctor-form-field" style="flex: 1; min-width: 100px; margin-bottom: 0;">
                    <span>الوقت</span>
                    <input type="time" class="doctor-custom-input doctor-time-input" name="scheduled_time" style="padding: 10px; font-size: 0.9rem;">
                  </div>
                </div>

                <label style="display:flex; align-items:center; gap:8px; margin-bottom:12px; color:var(--white); font-size:0.85rem; cursor:pointer;">
                  <input type="checkbox" name="no_time" id="appt-no-time">
                  <span>بدون ساعة محددة (يوم فقط — بدون تذكير الساعتين)</span>
                </label>

                <div class="doctor-form-field" style="margin-bottom: 16px;">
                  <span>الغرض من الموعد (اختياري)</span>
                  <input type="text" class="doctor-custom-input" name="purpose" style="padding: 10px; font-size: 0.9rem;" placeholder="مثال: متابعة العلاج، إزالة الخيوط، فحص...">
                </div>
                
                <button type="submit" class="btn btn-primary" style="width: 100%; font-size: 0.95rem; padding: 10px; border-radius: 8px;">➕ تأكيد وجدولة الموعد</button>
              </form>
            ` : ''}
            <ul id="appt-list" class="appt-list">
              ${appointments.map(a => `
                <li class="appt-item appt-status-${a.status}">
                  <div>
                    <strong>${formatDateTimeAr(a.scheduled_at)}</strong>
                    ${a.purpose ? ` — ${escHtml(a.purpose)}` : ''}
                    <span class="appt-status-pill">${({ scheduled: 'مجدول', pending: 'معلق', reminded: 'تم التذكير', attended: 'حضر', missed: 'فوّت', cancelled: 'ملغى' }[a.status] || a.status)}</span>
                  </div>
                  ${canEdit && a.status !== 'attended' && a.status !== 'cancelled' ? `
                    <div class="appt-actions">
                      <button class="btn btn-sm btn-primary" data-start-followup="${a.id}">🩺 بدء الزيارة</button>
                      <button class="btn btn-sm btn-success" data-attend="${a.id}">✓ حضر</button>
                      <button class="btn btn-sm btn-ghost" data-cancel="${a.id}">إلغاء</button>
                    </div>
                  ` : ''}
                </li>
              `).join('') || '<li class="muted">لا توجد مواعيد مجدولة.</li>'}
            </ul>
          </section>

          <!-- Collaborators -->
          <section class="visit-card">
            <h2>👥 الأطباء المشاركون</h2>
            ${canEdit ? `
              <form id="add-collab-form" class="collab-form">
                <select name="doctor_id" required>
                  <option value="">اختر طبيب للمساعدة</option>
                  ${allDoctors.filter(d => d.id !== visit.primary_doctor_id && !collaborators.some(c => c.doctor_id === d.id)).map(d => `<option value="${d.id}">د. ${escHtml(d.display_name)} (${escHtml(d.specialization || 'عام')})</option>`).join('')}
                </select>
                <button type="submit" class="btn btn-sm btn-primary">+ دعوة</button>
              </form>
            ` : ''}
            <ul class="collab-list">
              ${visit.primary_doctor ? `<li><strong>د. ${escHtml(visit.primary_doctor.display_name)}</strong> <small>(الطبيب الأساسي)</small></li>` : ''}
              ${collaborators.map(c => `<li>د. ${escHtml(c.doctor?.display_name)} <small>(مساعد)</small>${canEdit && c.doctor?.id !== doctor.id ? ` <button class="btn-tiny" data-remove-collab="${c.doctor_id}">✕</button>` : ''}</li>`).join('')}
            </ul>
          </section>
        </div>
      </div>
    `;

    this._wireDetailEvents(visit, doctor, canEdit);
  },

  _wireDetailEvents(visit, doctor, canEdit) {
    // accept button (rare case — loaded detail of a still-waiting visit)
    const acceptBtn = document.getElementById('accept-visit-btn');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', async () => {
        try {
          await DB.acceptVisit(visit.id, doctor.id);
          notifyWhatsApp('booking_confirmed', visit.id);
          showToast('✅ تم قبول الحالة', 'success');
          Router.navigate(`doctor/visit/${visit.id}`);
        } catch (err) { showToast(err.message, 'error'); }
      });
    }

    // بدأ العمل (accepted → in_progress)
    const startBtn = document.getElementById('start-visit-btn');
    if (startBtn) {
      startBtn.addEventListener('click', async () => {
        try {
          await DB.startVisit(visit.id);
          notifyWhatsApp('service_started', visit.id);
          showToast('▶️ تم بدء العمل', 'success');
          Router.navigate(`doctor/visit/${visit.id}`);
        } catch (err) { showToast(err.message, 'error'); }
      });
    }

    const completeBtn = document.getElementById('complete-visit-btn');
    if (completeBtn) {
      completeBtn.addEventListener('click', async () => {
        if (!confirm('هل أنت متأكد من إنهاء الحالة؟')) return;
        try {
          await DB.completeVisit(visit.id);
          notifyWhatsApp('service_completed', visit.id);
          showToast('✅ تم إنهاء الحالة', 'success');
          Router.navigate(`doctor/visit/${visit.id}`);
        } catch (err) { showToast(err.message, 'error'); }
      });
    }

    if (!canEdit) return;

    const examForm = document.getElementById('exam-form');
    if (examForm) {
      // Radix-style select logic
      const radixWrapper = document.getElementById('severity-radix');
      if (radixWrapper && canEdit) {
        const trigger = radixWrapper.querySelector('.radix-select-trigger');
        const content = radixWrapper.querySelector('.radix-select-content');
        const hiddenInput = radixWrapper.querySelector('input[type="hidden"]');
        const valueSpan = radixWrapper.querySelector('.radix-select-value');
        const items = content.querySelectorAll('.radix-select-item');

        const closeMenu = (e) => {
          if (!radixWrapper.contains(e.target)) {
            radixWrapper.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
            document.removeEventListener('click', closeMenu);
          }
        };

        trigger.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = radixWrapper.classList.toggle('open');
          trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
          if (isOpen) {
            document.addEventListener('click', closeMenu);
          } else {
            document.removeEventListener('click', closeMenu);
          }
        });

        items.forEach(item => {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            items.forEach(i => i.setAttribute('data-state', 'unchecked'));
            item.setAttribute('data-state', 'checked');
            hiddenInput.value = item.getAttribute('data-value');
            valueSpan.textContent = item.querySelector('.radix-select-item-text').textContent;
            radixWrapper.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
            document.removeEventListener('click', closeMenu);
          });
        });
      }

      examForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(examForm);
        const fields = {
          vital_temperature: fd.get('vital_temperature') ? parseFloat(fd.get('vital_temperature')) : null,
          vital_weight_kg: fd.get('vital_weight_kg') ? parseFloat(fd.get('vital_weight_kg')) : null,
          vital_heart_rate: fd.get('vital_heart_rate') ? parseInt(fd.get('vital_heart_rate')) : null,
          severity: fd.get('severity') || null,
          diagnosis: fd.get('diagnosis') || null,
          treatment: fd.get('treatment') || null,
          prescription: fd.get('prescription') || null,
          lab_results: fd.get('lab_results') || null,
        };
        try {
          await DB.updateVisit(visit.id, fields);
          showToast('✅ تم الحفظ', 'success');
        } catch (err) { showToast(err.message, 'error'); }
      });
    }

    // AI suggest
    const aiBtn = document.getElementById('ai-suggest-btn');
    if (aiBtn) {
      aiBtn.addEventListener('click', async () => {
        const fd = new FormData(examForm);
        const symptoms = (visit.visit_symptoms || []).map(s => s.symptom_key);
        const findings = [
          fd.get('vital_temperature') ? `حرارة: ${fd.get('vital_temperature')}°C` : '',
          fd.get('vital_weight_kg') ? `وزن: ${fd.get('vital_weight_kg')}kg` : '',
          fd.get('vital_heart_rate') ? `نبض: ${fd.get('vital_heart_rate')}` : '',
          fd.get('lab_results') ? `نتائج: ${fd.get('lab_results')}` : '',
        ].filter(Boolean).join('؛ ');

        const history = visit.patient_id ? await DB.getPatientHistory(visit.patient_id) : [];

        aiBtn.disabled = true;
        aiBtn.textContent = '⏳ يحلل الذكاء الصناعي...';
        const resultBox = document.getElementById('ai-result');
        resultBox.style.display = 'block';
        resultBox.innerHTML = '<div class="loading-spinner"></div>';
        try {
          const result = await AI.suggestDiagnosis({
            animal_type: visit.intake_animal_type,
            age: visit.intake_animal_age,
            symptoms,
            findings,
            history: history.filter(h => h.id !== visit.id).slice(0, 5),
          });
          const p = result.parsed;
          let html = `<div class="ai-box">
            <h3>💡 اقتراحات الذكاء الصناعي</h3>`;
          if (p?.differential_diagnoses?.length) {
            html += `<div class="ai-section"><h4>التشخيصات التفاضلية:</h4><ol>${p.differential_diagnoses.map(d => `<li><strong>${escHtml(d.name)}</strong> <span class="likelihood">(${escHtml(d.likelihood)})</span><br><small>${escHtml(d.reasoning || '')}</small></li>`).join('')}</ol></div>`;
          }
          if (p?.recommended_tests?.length) {
            html += `<div class="ai-section"><h4>الفحوصات الموصى بها:</h4><ul>${p.recommended_tests.map(t => `<li>${escHtml(t)}</li>`).join('')}</ul></div>`;
          }
          if (p?.initial_treatment) {
            html += `<div class="ai-section"><h4>العلاج الأولي:</h4><p>${escHtml(p.initial_treatment)}</p></div>`;
          }
          if (p?.red_flags?.length) {
            html += `<div class="ai-section red-flags"><h4>⚠️ علامات تحذيرية:</h4><ul>${p.red_flags.map(r => `<li>${escHtml(r)}</li>`).join('')}</ul></div>`;
          }
          if (!p) {
            html += `<pre class="ai-raw">${escHtml(result.raw || '')}</pre>`;
          }
          html += `<p class="ai-disclaimer">${escHtml(result.disclaimer || '')}</p></div>`;
          resultBox.innerHTML = html;
        } catch (err) {
          resultBox.innerHTML = `<div class="ai-error">❌ ${escHtml(err.message || 'فشل الاستدعاء')}</div>`;
        }
        aiBtn.disabled = false;
        aiBtn.textContent = '💡 اقترح تشخيص بالذكاء الصناعي';
      });
    }

    // Lab attachments — capture & list
    const renderAttachments = async () => {
      const grid = document.getElementById('attachments-grid');
      if (!grid) return;
      try {
        const items = await DB.getVisitAttachments(visit.id);
        if (!items.length) {
          grid.innerHTML = '<p class="muted">لا توجد صور مرفوعة بعد.</p>';
          return;
        }
        const cards = await Promise.all(items.map(async (it) => {
          let url = '';
          try { url = await DB.getVisitAttachmentUrl(it.storage_path); } catch (_) {}
          const docName = it.uploaded_by_doctor?.display_name ? ` — د. ${escHtml(it.uploaded_by_doctor.display_name)}` : '';
          return `
            <figure class="attachment-card">
              ${url ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${escHtml(it.file_name || 'تحليل')}" loading="lazy"></a>` : '<div class="attachment-error">⚠️ تعذر تحميل الصورة</div>'}
              <figcaption>
                <small>${formatDateTimeAr(it.created_at)}${docName}</small>
                ${canEdit ? `<button class="attachment-del-btn" data-del="${it.id}" data-path="${escHtml(it.storage_path)}" title="حذف">🗑️</button>` : ''}
              </figcaption>
            </figure>`;
        }));
        grid.innerHTML = cards.join('');
        grid.querySelectorAll('[data-del]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('هل تريد حذف هذه الصورة؟')) return;
            try {
              await DB.deleteVisitAttachment(btn.dataset.del, btn.dataset.path);
              showToast('🗑️ تم الحذف', 'success');
              renderAttachments();
            } catch (err) {
              showToast(err.message || 'فشل الحذف', 'error');
            }
          });
        });
      } catch (err) {
        grid.innerHTML = `<p class="ai-error">❌ ${escHtml(err.message || 'فشل تحميل الصور')}</p>`;
      }
    };

    const captureBtn = document.getElementById('capture-lab-btn');
    const captureInput = document.getElementById('capture-lab-input');
    if (captureBtn && captureInput) {
      captureBtn.addEventListener('click', () => captureInput.click());
      captureInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        captureBtn.disabled = true;
        const originalText = captureBtn.textContent;
        captureBtn.textContent = '⏳ جارٍ الرفع...';
        try {
          for (const f of files) {
            await DB.uploadVisitAttachment(visit.id, f, doctor?.id);
          }
          showToast(`✅ تم رفع ${files.length} صورة`, 'success');
          await renderAttachments();
        } catch (err) {
          showToast(err.message || 'فشل الرفع', 'error');
        } finally {
          captureBtn.disabled = false;
          captureBtn.textContent = originalText;
          captureInput.value = '';
        }
      });
    }

    renderAttachments();

    // add appointment
    const apptForm = document.getElementById('add-appt-form');
    if (apptForm) {
      // checkbox "بدون ساعة محددة" يعطّل حقل الوقت
      const noTimeCb = apptForm.querySelector('#appt-no-time');
      const timeInput = apptForm.querySelector('input[name="scheduled_time"]');
      if (noTimeCb && timeInput) {
        noTimeCb.addEventListener('change', () => {
          timeInput.disabled = noTimeCb.checked;
          if (noTimeCb.checked) timeInput.value = '';
        });
      }
      apptForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(apptForm);
        const rawDate = fd.get('scheduled_date');
        const noTime  = fd.get('no_time') === 'on';
        const rawTime = fd.get('scheduled_time');
        if (!rawDate) return;
        if (!noTime && !rawTime) {
          showToast('حدد الساعة أو فعّل "بدون ساعة محددة"', 'warning');
          return;
        }
        const timeStr = noTime ? '00:00' : rawTime;
        const scheduled_at = new Date(`${rawDate}T${timeStr}`).toISOString();
        try {
          await DB.addAppointment({
            visit_id: visit.id,
            patient_id: visit.patient_id,
            scheduled_at,
            purpose: fd.get('purpose') || null,
            created_by: doctor.id,
            time_specified: !noTime,
          });
          apptForm.reset();
          showToast('✅ تم جدولة الموعد', 'success');
          Router.navigate(`doctor/visit/${visit.id}`);
        } catch (err) { showToast(err.message, 'error'); }
      });
    }

    // appt actions (attend / cancel)
    document.querySelectorAll('[data-attend]').forEach(b => b.addEventListener('click', async () => {
      try { await DB.markAppointmentAttended(b.dataset.attend); Router.navigate(`doctor/visit/${visit.id}`); } catch (err) { showToast(err.message, 'error'); }
    }));
    document.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('إلغاء هذا الموعد؟')) return;
      try { await DB.cancelAppointment(b.dataset.cancel); Router.navigate(`doctor/visit/${visit.id}`); } catch (err) { showToast(err.message, 'error'); }
    }));

    // بدء زيارة متابعة من موعد مجدول
    document.querySelectorAll('[data-start-followup]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('بدء زيارة متابعة جديدة من هذا الموعد؟')) return;
      try {
        const newVisit = await DB.createFollowupVisit({
          patient_id: visit.patient_id,
          customer_id: visit.customer_id,
          source_appointment_id: b.dataset.startFollowup,
          doctor_id: doctor.id,
          intake: {
            customer_name: visit.intake_customer_name,
            phone: visit.intake_phone,
            animal_type: visit.intake_animal_type,
            area: visit.intake_area,
            animal_age: visit.intake_animal_age,
            notes: null,
          },
        });
        showToast('🩺 تم إنشاء زيارة متابعة', 'success');
        Router.navigate(`doctor/visit/${newVisit.id}`);
      } catch (err) { showToast(err.message, 'error'); }
    }));

    // collaborators
    const collabForm = document.getElementById('add-collab-form');
    if (collabForm) {
      collabForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(collabForm);
        const doctorId = fd.get('doctor_id');
        if (!doctorId) return;
        try {
          await DB.addCollaborator(visit.id, doctorId, doctor.id);
          showToast('✅ تمت دعوة الطبيب', 'success');
          Router.navigate(`doctor/visit/${visit.id}`);
        } catch (err) { showToast(err.message, 'error'); }
      });
    }
    document.querySelectorAll('[data-remove-collab]').forEach(b => b.addEventListener('click', async () => {
      try { await DB.removeCollaborator(visit.id, b.dataset.removeCollab); Router.navigate(`doctor/visit/${visit.id}`); } catch (err) { showToast(err.message, 'error'); }
    }));
  }
};


// =============================================================
// DOCTOR CHAT VIEW — team chat (realtime)
// =============================================================
const DoctorChatView = {
  async render(container) {
    const doctor = Auth.getDoctor();
    if (!doctor) return;

    container.innerHTML = `
      <div class="chat-view animate-in">
        <div class="chat-header">
          <a href="#doctor" class="btn-back-oval">← عودة</a>
          <h1>💬 چات الفريق</h1>
          <p>تواصل مباشر بين الأطباء</p>
        </div>
        <div id="chat-messages" class="chat-messages"></div>
        <form id="chat-form" class="chat-form">
          <input type="text" name="content" placeholder="اكتب رسالة..." autocomplete="off" required>
          <button type="submit" class="btn btn-primary">إرسال</button>
        </form>
      </div>
    `;

    const messagesBox = $('#chat-messages');

    const renderMsg = (m) => {
      const mine = m.sender?.id === doctor.id || m.sender_id === doctor.id;
      const senderName = m.sender?.display_name || '؟';
      const color = m.sender?.avatar_color || '#7c3aed';
      return `
        <div class="chat-msg ${mine ? 'chat-mine' : ''}">
          <span class="chat-avatar" style="background:${escHtml(color)}">${escHtml(senderName.slice(0, 1))}</span>
          <div class="chat-bubble">
            <div class="chat-sender">${escHtml(senderName)}</div>
            <div class="chat-content">${escHtml(m.content)}</div>
            <small class="chat-time">${formatRelativeAr(m.created_at)}</small>
          </div>
        </div>
      `;
    };

    const initial = await DB.getChatMessages('general', 100);
    messagesBox.innerHTML = initial.map(renderMsg).join('') || '<div class="empty-state">لا توجد رسائل بعد. ابدأ الحوار!</div>';
    messagesBox.scrollTop = messagesBox.scrollHeight;

    // realtime
    Realtime.subscribe('chat-general', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: 'channel=eq.general' }, async (payload) => {
      // fetch the sender info
      const { data } = await supabaseClient
        .from('chat_messages')
        .select('*, sender:doctors!chat_messages_sender_id_fkey(id, display_name, avatar_color)')
        .eq('id', payload.new.id).maybeSingle();
      if (!data) return;
      messagesBox.insertAdjacentHTML('beforeend', renderMsg(data));
      messagesBox.scrollTop = messagesBox.scrollHeight;
    });

    const form = $('#chat-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input[name="content"]');
      const content = input.value.trim();
      if (!content) return;
      input.value = '';
      try {
        await DB.sendChatMessage('general', content);
      } catch (err) {
        showToast(err.message, 'error');
        input.value = content;
      }
    });
  }
};


// =============================================================
// REPORTS VIEW — statistics + AI-generated reports
// =============================================================
// Shared helpers for reports views
const ReportsCommon = {
  getPeriodRange(period) {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    let start;
    if (period === 'day') start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    else if (period === 'week') { start = new Date(now); start.setDate(now.getDate() - 7); start.setHours(0, 0, 0, 0); }
    else if (period === 'year') { start = new Date(now); start.setFullYear(now.getFullYear() - 1); start.setHours(0, 0, 0, 0); }
    else { start = new Date(now); start.setMonth(now.getMonth() - 1); start.setHours(0, 0, 0, 0); }
    return { start, end };
  },
  bar(obj) {
    return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) =>
      `<div class="bar-row"><span class="bar-label">${escHtml(k)}</span><div class="bar"><div class="bar-fill" style="width:${Math.min(100, v * 10)}%"></div><span class="bar-val">${v}</span></div></div>`
    ).join('');
  }
};

// =============================================================
// MEDICAL REPORTS — per-doctor personal stats
// =============================================================
const MedicalReportsView = {
  _period: 'month',

  async render(container) {
    const doc = Auth.getDoctor();
    const docName = doc?.display_name || 'طبيب';
    container.innerHTML = `
      <div class="reports-view animate-in">
        <div class="reports-header">
          <a href="#doctor" class="btn-back-oval">← عودة</a>
          <h1>📊 تقاريري الطبية</h1>
        </div>
        <p class="muted" style="text-align:center; margin-bottom:8px;">إحصائيات الحالات التي تولّاها د. ${escHtml(docName)}</p>
        <div class="period-filter">
          <button class="period-btn ${this._period === 'day' ? 'active' : ''}" data-period="day">اليوم</button>
          <button class="period-btn ${this._period === 'week' ? 'active' : ''}" data-period="week">الأسبوع</button>
          <button class="period-btn ${this._period === 'month' ? 'active' : ''}" data-period="month">الشهر</button>
          <button class="period-btn ${this._period === 'year' ? 'active' : ''}" data-period="year">السنة</button>
        </div>
        <div id="stats-panel" class="stats-panel"></div>
        <div class="reports-actions">
          <button id="generate-ai-report" class="btn btn-primary">📊 ولّد تقرير بالذكاء الصناعي</button>
        </div>
        <div id="ai-report-output" class="ai-report-output" style="display:none;"></div>
        <div class="saved-reports">
          <h2>📁 تقاريري المحفوظة</h2>
          <div id="saved-list"></div>
        </div>
      </div>
    `;

    $$('.period-btn').forEach(b => b.addEventListener('click', async () => {
      this._period = b.dataset.period;
      $$('.period-btn').forEach(x => x.classList.toggle('active', x === b));
      await this._loadStats();
    }));

    $('#generate-ai-report').addEventListener('click', () => this._generateAIReport());

    await this._loadStats();
    await this._loadSavedReports();
  },

  async _loadStats() {
    const pane = $('#stats-panel');
    pane.innerHTML = '<div class="loading-spinner"></div>';
    const doc = Auth.getDoctor();
    if (!doc) { pane.innerHTML = '<p class="muted">تعذر تحميل ملف الطبيب</p>'; return; }
    const { start, end } = ReportsCommon.getPeriodRange(this._period);
    const stats = await DB.getDoctorReportStats(doc.id, start.toISOString(), end.toISOString());

    const byStatus = {}, bySeverity = {}, byAnimal = {}, bySymptom = {};
    for (const v of stats.visits) {
      byStatus[v.status] = (byStatus[v.status] || 0) + 1;
      if (v.severity) bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1;
      if (v.intake_animal_type) byAnimal[v.intake_animal_type] = (byAnimal[v.intake_animal_type] || 0) + 1;
    }
    for (const s of stats.syms) {
      const label = SYMPTOM_LABEL[s.symptom_key] || s.symptom_key;
      bySymptom[label] = (bySymptom[label] || 0) + 1;
    }
    const total = stats.visits.length;
    const completed = byStatus.completed || 0;
    const completionRate = total ? Math.round((completed / total) * 100) : 0;
    const topSymptom = Object.entries(bySymptom).sort((a, b) => b[1] - a[1])[0];

    pane.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-label">حالاتك الكلية</div></div>
        <div class="stat-card"><div class="stat-num">${completed}</div><div class="stat-label">مكتملة</div></div>
        <div class="stat-card"><div class="stat-num">${byStatus.in_progress || 0}</div><div class="stat-label">قيد المعالجة</div></div>
        <div class="stat-card"><div class="stat-num">${completionRate}%</div><div class="stat-label">نسبة الإنجاز</div></div>
      </div>
      <div class="stats-two-col">
        <div class="stat-panel">
          <h3>🔥 أكثر الأعراض في حالاتك</h3>
          <p>${topSymptom ? `${escHtml(topSymptom[0])} — ${topSymptom[1]} حالة` : '—'}</p>
          ${ReportsCommon.bar(bySymptom) || '<p class="muted">لا بيانات</p>'}
        </div>
        <div class="stat-panel">
          <h3>⚠️ درجة الخطورة</h3>
          ${ReportsCommon.bar(bySeverity) || '<p class="muted">لا بيانات</p>'}
        </div>
      </div>
      <div class="stats-two-col">
        <div class="stat-panel"><h3>🐾 نوع الحيوان</h3>${ReportsCommon.bar(byAnimal) || '<p class="muted">لا بيانات</p>'}</div>
        <div class="stat-panel"><h3>📋 حالة الزيارات</h3>${ReportsCommon.bar(byStatus) || '<p class="muted">لا بيانات</p>'}</div>
      </div>
    `;
  },

  async _generateAIReport() {
    const btn = $('#generate-ai-report');
    const out = $('#ai-report-output');
    const { start, end } = ReportsCommon.getPeriodRange(this._period);
    btn.disabled = true;
    btn.textContent = '⏳ جاري التوليد...';
    out.style.display = 'block';
    out.innerHTML = '<div class="loading-spinner"></div>';
    try {
      const r = await AI.generateReport({
        period_start: start.toISOString().slice(0, 10),
        period_end: end.toISOString().slice(0, 10),
        report_type: this._period,
        scope: 'doctor',
        doctor_id: Auth.getDoctor()?.id,
      });
      out.innerHTML = `<div class="report-box">
        <div class="report-meta">${escHtml(r.report?.period_start)} → ${escHtml(r.report?.period_end)}</div>
        <div class="report-content">${renderMarkdown(r.report?.content_md || '')}</div>
        <p class="ai-disclaimer">${escHtml(r.disclaimer || '')}</p>
      </div>`;
      await this._loadSavedReports();
    } catch (err) {
      out.innerHTML = `<div class="ai-error">❌ ${escHtml(err.message || 'فشل التوليد')}</div>`;
    }
    btn.disabled = false;
    btn.textContent = '📊 ولّد تقرير بالذكاء الصناعي';
  },

  async _loadSavedReports() {
    const list = $('#saved-list');
    if (!list) return;
    const doc = Auth.getDoctor();
    const reports = (await DB.getRecentAIReports(50))
      .filter(r => !doc || r.generated_by?.id === doc.id || r.generated_by_id === doc.id);
    if (!reports.length) { list.innerHTML = '<p class="muted">لا توجد تقارير محفوظة بعد.</p>'; return; }
    list.innerHTML = reports.map(r => `
      <div class="saved-item">
        <div class="saved-header">
          <strong>${escHtml(r.report_type || '—')}</strong>
          <span>${escHtml(r.period_start)} → ${escHtml(r.period_end)}</span>
          <small>${formatDateTimeAr(r.created_at)}</small>
        </div>
        <details><summary>عرض التقرير</summary><div class="report-content">${renderMarkdown(r.content_md || '')}</div></details>
      </div>
    `).join('');
  }
};

// =============================================================
// CLINIC REPORTS — full clinic-wide stats (admin only)
// =============================================================
const ClinicReportsView = {
  _period: 'month',

  async render(container) {
    container.innerHTML = `
      <div class="reports-view animate-in">
        <div class="reports-header">
          <a href="#home" class="btn-back-oval">← عودة</a>
          <h1>📊 تقارير العيادة</h1>
        </div>
        <p class="muted" style="text-align:center; margin-bottom:8px;">إحصائيات القسم الطبي</p>
        <div class="period-filter">
          <button class="period-btn ${this._period === 'day' ? 'active' : ''}" data-period="day">اليوم</button>
          <button class="period-btn ${this._period === 'week' ? 'active' : ''}" data-period="week">الأسبوع</button>
          <button class="period-btn ${this._period === 'month' ? 'active' : ''}" data-period="month">الشهر</button>
          <button class="period-btn ${this._period === 'year' ? 'active' : ''}" data-period="year">السنة</button>
        </div>
        <div id="stats-panel" class="stats-panel"></div>
        <div class="reports-actions">
          <button id="generate-ai-report" class="btn btn-primary">📊 ولّد تقرير بالذكاء الصناعي</button>
        </div>
        <div id="ai-report-output" class="ai-report-output" style="display:none;"></div>
        <div class="saved-reports">
          <h2>📁 التقارير المحفوظة</h2>
          <div id="saved-list"></div>
        </div>
      </div>
    `;

    $$('.period-btn').forEach(b => b.addEventListener('click', async () => {
      this._period = b.dataset.period;
      $$('.period-btn').forEach(x => x.classList.toggle('active', x === b));
      await this._loadStats();
    }));

    $('#generate-ai-report').addEventListener('click', () => this._generateAIReport());

    await this._loadStats();
    await this._loadSavedReports();
  },

  async _loadStats() {
    const pane = $('#stats-panel');
    pane.innerHTML = '<div class="loading-spinner"></div>';
    const { start, end } = ReportsCommon.getPeriodRange(this._period);
    const stats = await DB.getClinicReportStats(start.toISOString(), end.toISOString());

    const byStatus = {}, bySeverity = {}, byDoctor = {}, byAnimal = {}, bySymptom = {};
    const docMap = {};
    (stats.doctors || []).forEach(d => docMap[d.id] = d.display_name);
    for (const v of stats.visits) {
      byStatus[v.status] = (byStatus[v.status] || 0) + 1;
      if (v.severity) bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1;
      if (v.primary_doctor_id) {
        const n = docMap[v.primary_doctor_id] || '—';
        byDoctor[n] = (byDoctor[n] || 0) + 1;
      }
      if (v.intake_animal_type) byAnimal[v.intake_animal_type] = (byAnimal[v.intake_animal_type] || 0) + 1;
    }
    for (const s of stats.syms) {
      const label = SYMPTOM_LABEL[s.symptom_key] || s.symptom_key;
      bySymptom[label] = (bySymptom[label] || 0) + 1;
    }

    const topDoctor = Object.entries(byDoctor).sort((a, b) => b[1] - a[1])[0];
    const topSymptom = Object.entries(bySymptom).sort((a, b) => b[1] - a[1])[0];

    pane.innerHTML = `
      <h2 style="color:var(--white); margin:8px 0;">🩺 القسم الطبي</h2>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-num">${stats.visits.length}</div><div class="stat-label">إجمالي الحالات</div></div>
        <div class="stat-card"><div class="stat-num">${byStatus.completed || 0}</div><div class="stat-label">مكتملة</div></div>
        <div class="stat-card"><div class="stat-num">${byStatus.in_progress || 0}</div><div class="stat-label">قيد المعالجة</div></div>
        <div class="stat-card"><div class="stat-num">${(bySeverity.critical || 0) + (bySeverity.high || 0)}</div><div class="stat-label">حالات خطرة</div></div>
      </div>
      <div class="stats-two-col">
        <div class="stat-panel">
          <h3>🏆 الطبيب المميز</h3>
          <p>${topDoctor ? `د. ${escHtml(topDoctor[0])} — ${topDoctor[1]} حالة` : '—'}</p>
          <h4>حالات لكل طبيب</h4>
          ${ReportsCommon.bar(byDoctor) || '<p class="muted">لا بيانات</p>'}
        </div>
        <div class="stat-panel">
          <h3>🔥 أكثر الأعراض</h3>
          <p>${topSymptom ? `${escHtml(topSymptom[0])} — ${topSymptom[1]} حالة` : '—'}</p>
          ${ReportsCommon.bar(bySymptom) || '<p class="muted">لا بيانات</p>'}
        </div>
      </div>
      <div class="stats-two-col">
        <div class="stat-panel"><h3>🐾 نوع الحيوان</h3>${ReportsCommon.bar(byAnimal) || '<p class="muted">لا بيانات</p>'}</div>
        <div class="stat-panel"><h3>⚠️ درجة الخطورة</h3>${ReportsCommon.bar(bySeverity) || '<p class="muted">لا بيانات</p>'}</div>
      </div>
    `;
  },

  async _generateAIReport() {
    const btn = $('#generate-ai-report');
    const out = $('#ai-report-output');
    const { start, end } = ReportsCommon.getPeriodRange(this._period);
    btn.disabled = true;
    btn.textContent = '⏳ جاري التوليد...';
    out.style.display = 'block';
    out.innerHTML = '<div class="loading-spinner"></div>';
    try {
      const r = await AI.generateReport({
        period_start: start.toISOString().slice(0, 10),
        period_end: end.toISOString().slice(0, 10),
        report_type: this._period,
        scope: 'clinic',
      });
      out.innerHTML = `<div class="report-box">
        <div class="report-meta">${escHtml(r.report?.period_start)} → ${escHtml(r.report?.period_end)}</div>
        <div class="report-content">${renderMarkdown(r.report?.content_md || '')}</div>
        <p class="ai-disclaimer">${escHtml(r.disclaimer || '')}</p>
      </div>`;
      await this._loadSavedReports();
    } catch (err) {
      out.innerHTML = `<div class="ai-error">❌ ${escHtml(err.message || 'فشل التوليد')}</div>`;
    }
    btn.disabled = false;
    btn.textContent = '📊 ولّد تقرير بالذكاء الصناعي';
  },

  async _loadSavedReports() {
    const list = $('#saved-list');
    if (!list) return;
    const reports = await DB.getRecentAIReports(20);
    if (!reports.length) { list.innerHTML = '<p class="muted">لا توجد تقارير محفوظة بعد.</p>'; return; }
    list.innerHTML = reports.map(r => `
      <div class="saved-item">
        <div class="saved-header">
          <strong>${escHtml(r.report_type || '—')}</strong>
          <span>${escHtml(r.period_start)} → ${escHtml(r.period_end)}</span>
          <small>${formatDateTimeAr(r.created_at)}</small>
          ${r.generated_by?.display_name ? `<small>بواسطة د. ${escHtml(r.generated_by.display_name)}</small>` : ''}
        </div>
        <details><summary>عرض التقرير</summary><div class="report-content">${renderMarkdown(r.content_md || '')}</div></details>
      </div>
    `).join('');
  }
};


// =============================================================
// ADMIN DOCTORS VIEW — manage doctors (clinic-admin only)
// =============================================================
const AdminDoctorsView = {
  async render(container) {
    container.innerHTML = `
      <div class="admin-doctors animate-in">
        <div class="admin-header">
          <a href="#doctor" class="back-link">← عودة</a>
          <h1>👨‍⚕️ إدارة الأطباء</h1>
          <button id="new-doctor-btn" class="btn btn-primary">+ إضافة طبيب</button>
        </div>
        <div id="doctors-list"></div>

        <dialog id="new-doctor-dialog" class="dlg">
          <form id="new-doctor-form" method="dialog" class="dlg-form">
            <h2>إضافة طبيب جديد</h2>
            <label class="form-field"><span>الاسم الكامل *</span><input name="full_name" required></label>
            <label class="form-field"><span>الاسم المختصر *</span><input name="display_name" required></label>
            <label class="form-field"><span>البريد الإلكتروني *</span><input type="email" name="email" required></label>
            <label class="form-field"><span>كلمة المرور (6+ أحرف) *</span><input type="password" name="password" required minlength="6"></label>
            <label class="form-field"><span>التخصص</span><input name="specialization" placeholder="مثال: عام / جلدية / جراحة"></label>
            <label class="form-field"><span>الهاتف</span><input name="phone"></label>
            <label class="form-field"><span>لون البروفايل</span><input type="color" name="avatar_color" value="#7c3aed"></label>
            <label class="form-check"><input type="checkbox" name="is_admin"> مدير عيادة (صلاحيات كاملة)</label>
            <div class="dlg-actions">
              <button type="button" value="cancel" id="cancel-new-doctor" class="btn btn-ghost">إلغاء</button>
              <button type="submit" class="btn btn-primary">إنشاء الحساب</button>
            </div>
          </form>
        </dialog>
      </div>
    `;

    await this._load();

    $('#new-doctor-btn').addEventListener('click', () => $('#new-doctor-dialog').showModal());
    $('#cancel-new-doctor').addEventListener('click', () => $('#new-doctor-dialog').close());
    $('#new-doctor-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        full_name: fd.get('full_name'),
        display_name: fd.get('display_name'),
        email: fd.get('email'),
        password: fd.get('password'),
        specialization: fd.get('specialization') || null,
        phone: fd.get('phone') || null,
        avatar_color: fd.get('avatar_color') || '#7c3aed',
        is_admin: !!fd.get('is_admin'),
      };
      try {
        await DB.createDoctor(payload);
        showToast('✅ تم إنشاء حساب الطبيب', 'success');
        $('#new-doctor-dialog').close();
        e.target.reset();
        await this._load();
      } catch (err) {
        showToast(`❌ ${err.message || 'فشل الإنشاء'}`, 'error');
      }
    });
  },

  async _load() {
    const list = $('#doctors-list');
    list.innerHTML = '<div class="loading-spinner"></div>';
    const doctors = await DB.getAllDoctors();
    list.innerHTML = `
      <table class="doctors-table">
        <thead><tr><th>الاسم</th><th>التخصص</th><th>الهاتف</th><th>الدور</th><th>الحالة</th><th>إجراء</th></tr></thead>
        <tbody>
          ${doctors.map(d => `
            <tr>
              <td><span class="doctor-pill" style="background:${escHtml(d.avatar_color || '#7c3aed')}">${escHtml((d.display_name || '؟').slice(0, 1))}</span> د. ${escHtml(d.full_name)}</td>
              <td>${escHtml(d.specialization || '—')}</td>
              <td>${escHtml(d.phone || '—')}</td>
              <td>${d.is_admin ? '<span class="admin-badge">👑 مدير</span>' : 'طبيب'}</td>
              <td>${d.is_active ? '<span class="status-pill status-completed">فعّال</span>' : '<span class="status-pill status-cancelled">معطّل</span>'}</td>
              <td>
                <button class="btn btn-sm ${d.is_active ? 'btn-ghost' : 'btn-success'}" data-toggle="${d.id}" data-active="${d.is_active}">${d.is_active ? 'تعطيل' : 'تفعيل'}</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    list.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.toggle;
        const newState = btn.dataset.active !== 'true';
        try {
          await DB.toggleDoctorActive(id, newState);
          await this._load();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });
  }
};




// ==========================================
// INITIALIZATION
// ==========================================
// CASE HISTORY VIEW
// ==========================================
const CaseHistoryView = {
  _searchTimer: null,
  _filter: 'all',
  _query: '',

  async render(container) {
    container.innerHTML = `
      <div class="case-history-view animate-in" style="padding: 32px 24px; max-width: 1100px; margin: 0 auto;">
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;">
          <div style="font-size: 2.5rem;">📜</div>
          <div>
            <h1 style="color: var(--white); font-size: 1.8rem; margin: 0;">تاريخ الحالات</h1>
            <p style="color: var(--text-muted); margin: 4px 0 0;">ابحث في سجل الحالات الطبية</p>
          </div>
        </div>

        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(192,38,211,0.18); border-radius: 16px; padding: 16px; margin-bottom: 16px;">
          <input id="ch-search" type="search" placeholder="🔍 ابحث برقم الهاتف أو اسم الحيوان أو اسم صاحب الحيوان..." autocomplete="off"
            style="width:100%; padding:14px 16px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.3); color:var(--white); font-size:1rem; outline:none;">
        </div>

        <div id="ch-results"></div>
      </div>
    `;

    const input = $('#ch-search');
    input.addEventListener('input', (e) => {
      this._query = e.target.value;
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this._loadResults(), 300);
    });

    $$('.ch-filter-btn').forEach(b => b.addEventListener('click', () => {
      this._filter = b.dataset.filter;
      $$('.ch-filter-btn').forEach(x => {
        const active = x === b;
        x.classList.toggle('active', active);
        x.setAttribute('style', this._btnStyle(active));
      });
      this._loadResults();
    }));

    await this._loadResults();
  },

  _btnStyle(active) {
    return active
      ? 'padding:8px 16px; border-radius:999px; border:1px solid #c026d3; background:rgba(192,38,211,0.2); color:var(--white); cursor:pointer; font-size:0.9rem;'
      : 'padding:8px 16px; border-radius:999px; border:1px solid rgba(255,255,255,0.15); background:transparent; color:var(--text-muted); cursor:pointer; font-size:0.9rem;';
  },

  async _loadResults() {
    const out = $('#ch-results');
    out.innerHTML = '<div class="loading-spinner" style="margin:32px auto;"></div>';
    let items = [];
    try {
      items = await DB.searchCaseHistory(this._query);
    } catch (err) {
      console.error(err);
      out.innerHTML = '<div style="text-align:center; color:#fca5a5; padding:32px;">حدث خطأ أثناء البحث</div>';
      return;
    }

    if (this._filter !== 'all') {
      items = items.filter(it => it.kind === this._filter);
    }

    if (!items.length) {
      out.innerHTML = `
        <div style="background: rgba(255,255,255,0.03); border:1px dashed rgba(255,255,255,0.1); border-radius:14px; padding:48px 24px; text-align:center;">
          <div style="font-size:2.5rem; margin-bottom:8px;">🗂️</div>
          <p style="color: var(--text-muted); margin:0;">${this._query ? 'لا نتائج مطابقة لبحثك' : 'لا توجد حالات بعد'}</p>
        </div>`;
      return;
    }

    out.innerHTML = items.map(it => this._renderCard(it)).join('');
  },

  _renderCard(it) {
    const kindBadge = '<span style="background:rgba(192,38,211,0.18); color:#e879f9; padding:4px 10px; border-radius:999px; font-size:0.8rem;">🩺 طبية</span>';

    const statusMap = { waiting: 'قيد الانتظار', accepted: 'تم القبول', in_progress: 'قيد المعالجة', completed: 'مكتملة', cancelled: 'ملغاة' };
    const statusLabel = statusMap[it.status] || it.status || '—';

    const collabsLine = it.collaborators?.length
      ? `<div style="color:var(--text-muted); font-size:0.85rem; margin-top:4px;">👥 أطباء مشاركون: ${it.collaborators.map(n => `د. ${escHtml(n)}`).join('، ')}</div>`
      : '';

    const detailsHref = it.patient_id
      ? `<a href="#patient/${escHtml(it.patient_id)}" style="color:#c084fc; text-decoration:none; font-size:0.9rem;">عرض ملف الحيوان ←</a>`
      : '';

    const serviceLine = '';

    const phoneLine = it.owner_phone
      ? `<a href="tel:${escHtml(it.owner_phone)}" style="color:#a78bfa; text-decoration:none; font-size:0.85rem;">📞 ${escHtml(it.owner_phone)}</a>`
      : '<span style="color:var(--text-muted); font-size:0.85rem;">—</span>';

    return `
      <div style="background: rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:16px 18px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
          <div style="flex:1; min-width:240px;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:6px;">
              ${kindBadge}
              <span style="color:var(--text-muted); font-size:0.85rem;">${escHtml(formatDateTimeAr(it.created_at))}</span>
              <span style="background:rgba(255,255,255,0.08); color:var(--white); padding:2px 8px; border-radius:6px; font-size:0.75rem;">${escHtml(statusLabel)}</span>
            </div>
            <div style="color:var(--white); font-size:1.05rem; font-weight:600;">
              ${escHtml(it.owner_name)}${it.pet_name ? ` — 🐾 ${escHtml(it.pet_name)}` : ''}${it.pet_type ? ` (${escHtml(it.pet_type)})` : ''}
            </div>
            <div style="margin-top:4px;">${phoneLine}</div>
            ${serviceLine}
            <div style="color:#86efac; font-size:0.9rem; margin-top:6px;">
              👨‍⚕️ تولّى الحالة: <strong>${escHtml(it.handler)}</strong>
            </div>
            ${collabsLine}
          </div>
          <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-end;">
            ${detailsHref}
          </div>
        </div>
      </div>
    `;
  }
};

// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('🚀 Starting application initialization...');

    // Initialize auth first
    console.log('🔐 Initializing authentication...');
    await Auth.init();
    console.log('✅ Auth initialized');

    // Initialize router
    console.log('🗂️ Initializing router...');
    Router.init();
    console.log('✅ Router initialized');

    // Initialize animated background
    console.log('🎨 Initializing background...');
    initAnimatedBackground();
    console.log('✅ Background initialized');

    console.log('%c🐾 بيطار — نظام إدارة العيادات البيطرية', 'font-size:16px; font-weight:bold; color:#C026D3;');
    console.log('%c🔐 نظام المصادقة: Supabase Auth', 'font-size:12px; color:#10B981;');
    console.log('%c💾 قاعدة البيانات: Supabase PostgreSQL', 'font-size:12px; color:#3B82F6;');
    console.log('%c✅ تم تحميل التطبيق بنجاح', 'font-size:12px; color:#10B981; font-weight:bold;');
  } catch (err) {
    console.error('❌ Fatal initialization error:', err);
    document.body.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:center; height:100vh; background:#1a1a1a; color:white; font-family:sans-serif;">
        <div style="text-align:center;">
          <h1>⚠️ خطأ في تحميل التطبيق</h1>
          <p>يرجى التحقق من وحدة التحكم (F12) للمزيد من التفاصيل</p>
          <p style="color:#999; margin-top:20px;">${err.message}</p>
        </div>
      </div>
    `;
  }
});
