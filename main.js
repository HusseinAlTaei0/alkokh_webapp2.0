/* =============================================
   ALKOKH VET CLINIC — MAIN APPLICATION
   Grooming & Bathing Management System
   with Supabase Authentication & Database
   ============================================= */

// Theme is now hardcoded to 'dark' in index.html, no switching logic needed.


// ==========================================
// AUTH MODULE
// ==========================================
const Auth = {
  _user: null,
  _doctor: null,
  _employee: null,

  async init() {
    if (!supabaseClient) {
      console.warn('Supabase client not ready at Auth.init — will rely on onAuthStateChange');
      return;
    }
    supabaseClient.auth.getSession().then(async ({ data: { session } }) => {
      this._user = session?.user || null;
      await this._loadProfiles();
      this._updateUI();
      if (Router.currentView && ['employees', 'operator', 'reports', 'doctor', 'admin', 'employee'].includes(Router.currentView)) {
        Router.route();
      }
    }).catch(err => console.warn('getSession failed:', err));

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
    this._employee = null;
    this._updateUI();
  },

  isAuthenticated() { return !!this._user; },
  getUser() { return this._user; },
  getDoctor() { return this._doctor; },
  getEmployee() { return this._employee; },

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

  isEmployee() {
    return !!this._employee && this._employee.is_active !== false;
  },

  async _loadProfiles() {
    if (!this._user) {
      this._doctor = null;
      this._employee = null;
      return;
    }
    console.log('🔍 Loading profiles for user:', this._user.id, this._user.email);

    // Add timeout protection (10 seconds max)
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Profile lookup timed out')), ms));

    try {
      const results = await Promise.race([
        Promise.allSettled([
          supabaseClient.from('doctors').select('*').eq('auth_user_id', this._user.id).maybeSingle(),
          supabaseClient.from('employees').select('*').eq('auth_user_id', this._user.id).maybeSingle(),
        ]),
        timeout(10000)
      ]);

      const docResult = results[0];
      const empResult = results[1];

      if (docResult.status === 'fulfilled' && !docResult.value.error) {
        this._doctor = docResult.value.data || null;
      } else {
        if (docResult.status === 'fulfilled' && docResult.value?.error) console.warn('Doctor profile lookup failed:', docResult.value.error);
        this._doctor = null;
      }

      if (empResult.status === 'fulfilled' && !empResult.value.error) {
        this._employee = empResult.value.data || null;
      } else {
        if (empResult.status === 'fulfilled' && empResult.value?.error) console.warn('Employee profile lookup failed:', empResult.value.error);
        this._employee = null;
      }

      console.log('👨‍⚕️ Doctor profile:', this._doctor ? this._doctor.display_name : 'not found');
      console.log('👷 Employee profile:', this._employee ? this._employee.name_ar : 'not found');
    } catch (err) {
      console.error('⏰ Profile loading error:', err.message);
      this._doctor = null;
      this._employee = null;
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
      } else if (role === 'employee') {
        // يظهر للموظفين فقط
        show = this.isEmployee();
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
  // Cache for services and employees (they rarely change)
  _servicesCache: null,
  _employeesCache: null,

  // --- Services ---
  async getServices() {
    if (this._servicesCache) return this._servicesCache;
    try {
      const { data, error } = await supabaseClient
        .from('services')
        .select('*')
        .eq('is_active', true)
        .order('id');
      if (error) throw error;
      this._servicesCache = data || [];
      return this._servicesCache;
    } catch (err) {
      console.error('Error fetching services:', err);
      // Fallback to hardcoded if DB not ready
      return this._fallbackServices();
    }
  },

  _fallbackServices() {
    return [
      { id: 's1', category: 'cat_grooming', type_ar: 'نمرة خفيفة', type_en: 'Light Grade', icon: 'assets/alkokh_icons/haircut.png', duration_minutes: 30 },
      { id: 's2', category: 'cat_grooming', type_ar: 'شورت هير', type_en: 'Short Hair', icon: 'assets/alkokh_icons/haircut.png', duration_minutes: 25 },
      { id: 's3', category: 'dog_grooming', type_ar: 'نمرة 1', type_en: 'Grade 1', icon: 'assets/alkokh_icons/haircut.png', duration_minutes: 40 },
      { id: 's4', category: 'dog_grooming', type_ar: 'شورت هير', type_en: 'Short Hair', icon: 'assets/alkokh_icons/haircut.png', duration_minutes: 35 },
      { id: 's5', category: 'dog_grooming', type_ar: 'قصة مميزة', type_en: 'Special Cut', icon: 'assets/alkokh_icons/special_haircut.png', duration_minutes: 50 },
      { id: 's6', category: 'bath', type_ar: 'تحميم اعتيادي', type_en: 'Regular Bath', icon: 'assets/alkokh_icons/bath.png', duration_minutes: 20 },
      { id: 's7', category: 'bath', type_ar: 'تحميم طبي', type_en: 'Medical Bath', icon: 'assets/alkokh_icons/medical_bath.png', duration_minutes: 30 },
    ];
  },

  // --- Employees ---
  async getEmployees() {
    if (this._employeesCache) return this._employeesCache;
    try {
      const { data, error } = await supabaseClient
        .from('employees')
        .select('*')
        .eq('is_active', true)
        .order('id');
      if (error) throw error;
      this._employeesCache = data || [];
      return this._employeesCache;
    } catch (err) {
      console.error('Error fetching employees:', err);
      return this._fallbackEmployees();
    }
  },

  _fallbackEmployees() {
    return [
      { id: 'e1', name_ar: 'عباس', name_en: 'Abbas', specialization: 'bather', avatar_color: '#3B82F6', is_active: true },
      { id: 'e2', name_ar: 'أنور', name_en: 'Anwar', specialization: 'bather', avatar_color: '#10B981', is_active: true },
      { id: 'e3', name_ar: 'سهيل', name_en: 'Suheil', specialization: 'groomer', avatar_color: '#F59E0B', is_active: true },
      { id: 'e4', name_ar: 'قاسم', name_en: 'Qasim', specialization: 'groomer', avatar_color: '#EF4444', is_active: true },
    ];
  },

  // --- Orders ---
  async getOrders() {
    try {
      const { data, error } = await supabaseClient
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error fetching orders:', err);
      return [];
    }
  },

  async addOrder(order) {
    try {
      const { data, error } = await supabaseClient
        .from('orders')
        .insert({
          customer_name: order.customer_name,
          customer_phone: order.customer_phone || null,
          pet_name: order.pet_name,
          pet_type: order.pet_type,
          service_id: order.service_id,
          notes: order.notes || '',
          status: 'waiting'
        })
        .select('id')
        .single();

      if (error) throw error;

      // Upsert customer record for history tracking
      try {
        await supabaseClient.rpc('upsert_customer', {
          p_name: order.customer_name,
          p_phone: order.customer_phone || null
        });
      } catch (e) {
        // Non-critical, don't block the order
        console.warn('Customer upsert failed:', e);
      }

      return data?.id || true;
    } catch (err) {
      console.error('Error adding order:', err);
      throw err;
    }
  },

  async updateOrder(id, updates) {
    try {
      const { data, error } = await supabaseClient
        .from('orders')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Error updating order:', err);
      return null;
    }
  },

  async assignOrder(orderId, employeeId) {
    const now = new Date().toISOString();
    return this.updateOrder(orderId, {
      employee_id: employeeId,
      status: 'assigned',
      assigned_at: now
    });
  },

  async completeOrder(orderId) {
    try {
      // Get the order first to calculate duration
      const { data: order } = await supabaseClient
        .from('orders')
        .select('started_at')
        .eq('id', orderId)
        .single();

      if (!order) return null;
      const startedAt = new Date(order.started_at);
      const now = new Date();
      const duration = Math.round((now - startedAt) / 60000);

      return this.updateOrder(orderId, {
        status: 'completed',
        completed_at: now.toISOString(),
        duration_actual: duration
      });
    } catch (err) {
      console.error('Error completing order:', err);
      return null;
    }
  },

  async cancelOrder(orderId) {
    return this.updateOrder(orderId, {
      status: 'cancelled',
      completed_at: new Date().toISOString()
    });
  },

  async deleteOrder(orderId) {
    try {
      const { data, error } = await supabaseClient
        .from('orders')
        .delete()
        .eq('id', orderId)
        .select();
      if (error) throw error;

      if (!data || data.length === 0) {
        console.warn('Delete operation returned 0 rows. RLS or missing ID issue.');
        return false;
      }
      return true;
    } catch (err) {
      console.error('Error deleting order:', err);
      return false;
    }
  },

  async deleteAllOrders() {
    try {
      // Deleting all orders. RLS policies allow this for authenticated admins.
      const { data, error } = await supabaseClient
        .from('orders')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000') // Dummy condition to delete all
        .select();
      if (error) throw error;

      console.log('Deleted rows:', data?.length);
      return true;
    } catch (err) {
      console.error('Error deleting all orders:', err);
      return false;
    }
  },

  // --- Notification Logs ---
  async getNotificationStats() {
    try {
      const { data, error } = await supabaseClient
        .from('notification_logs')
        .select('status');
      if (error) throw error;
      const stats = { success: 0, failed: 0, pending: 0 };
      (data || []).forEach(r => {
        if (stats[r.status] !== undefined) stats[r.status]++;
      });
      return stats;
    } catch (err) {
      console.error('getNotificationStats error:', err);
      return { success: 0, failed: 0, pending: 0 };
    }
  },

  async getRecentNotificationLogs(limit = 20, filter = 'all') {
    try {
      let q = supabaseClient
        .from('notification_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (filter && filter !== 'all') q = q.eq('status', filter);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('getRecentNotificationLogs error:', err);
      return [];
    }
  },

  async resendNotification(logId) {
    try {
      // Fetch original log
      const { data: log, error: fetchErr } = await supabaseClient
        .from('notification_logs')
        .select('*')
        .eq('id', logId)
        .single();
      if (fetchErr) throw fetchErr;
      if (!log) return false;

      // Invoke edge function with a fresh log row (not reusing old one)
      const { data, error } = await supabaseClient.functions.invoke('send-whatsapp', {
        body: {
          order_id: log.order_id,
          event_type: log.event_type,
          phone: log.phone,
          customer_name: log.customer_name,
          pet_name: log.pet_name,
          service_name: log.service_name
        }
      });
      if (error) throw error;
      return data?.success === true;
    } catch (err) {
      console.error('resendNotification error:', err);
      return false;
    }
  },

  // --- Employee System ---
  async getEmployeeByAuthId(userId) {
    try {
      const { data, error } = await supabaseClient
        .from('employees')
        .select('*')
        .eq('auth_user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    } catch (err) {
      console.error('Employee lookup error:', err);
      return null;
    }
  },

  async getEmployeeOrders(employeeId) {
    try {
      const { data, error } = await supabaseClient.rpc('get_employee_orders', { p_employee_id: employeeId });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error fetching employee orders:', err);
      return [];
    }
  },

  async getEmployeeCompleted(employeeId) {
    try {
      const { data, error } = await supabaseClient.rpc('get_employee_completed', { p_employee_id: employeeId });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error fetching employee completed:', err);
      return [];
    }
  },

  async acceptOrder(orderId, employeeId) {
    try {
      const { error } = await supabaseClient.rpc('accept_order', {
        p_order_id: orderId,
        p_employee_id: employeeId
      });
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Error accepting order:', err);
      return false;
    }
  },

  async completeOrderEmployee(orderId, employeeId) {
    try {
      const { data, error } = await supabaseClient.rpc('complete_order_employee', {
        p_order_id: orderId,
        p_employee_id: employeeId
      });
      if (error) throw error;
      return data; // returns duration in minutes
    } catch (err) {
      console.error('Error completing order:', err);
      return null;
    }
  },

  async reassignOrder(orderId, newEmployeeId) {
    return this.updateOrder(orderId, {
      employee_id: newEmployeeId,
      status: 'assigned',
      assigned_at: new Date().toISOString(),
      started_at: null
    });
  },

  // --- Waiting count (for anonymous booking confirmation) ---
  async getWaitingCount() {
    try {
      const { data, error } = await supabaseClient.rpc('get_waiting_count');
      if (error) throw error;
      return data || 0;
    } catch (err) {
      console.warn('Could not get waiting count:', err);
      return 0;
    }
  },

  // --- Stats (requires auth) ---
  async getStats(period = 'all') {
    let orders = await this.getOrders();
    orders = orders.filter(o => o.status === 'completed');
    const now = new Date();

    if (period === 'today') {
      orders = orders.filter(o => {
        const d = new Date(o.completed_at);
        return d.toDateString() === now.toDateString();
      });
    } else if (period === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      orders = orders.filter(o => new Date(o.completed_at) >= weekAgo);
    } else if (period === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      orders = orders.filter(o => new Date(o.completed_at) >= monthAgo);
    }

    const services = await this.getServices();
    const employees = await this.getEmployees();

    const groomingCount = orders.filter(o => {
      const svc = services.find(s => s.id === o.service_id);
      return svc && (svc.category === 'cat_grooming' || svc.category === 'dog_grooming');
    }).length;

    const bathCount = orders.filter(o => {
      const svc = services.find(s => s.id === o.service_id);
      return svc && svc.category === 'bath';
    }).length;

    const employeeStats = employees.map(emp => {
      const empOrders = orders.filter(o => o.employee_id === emp.id);
      const avgDuration = empOrders.length > 0
        ? Math.round(empOrders.reduce((sum, o) => sum + (o.duration_actual || 0), 0) / empOrders.length)
        : 0;
      return {
        ...emp,
        count: empOrders.length,
        avgDuration
      };
    }).sort((a, b) => b.count - a.count);

    const uniqueCustomers = new Set(orders.map(o => o.customer_name)).size;
    const avgDuration = orders.length > 0
      ? Math.round(orders.reduce((sum, o) => sum + (o.duration_actual || 0), 0) / orders.length)
      : 0;

    return {
      total: orders.length,
      grooming: groomingCount,
      bath: bathCount,
      uniqueCustomers,
      avgDuration,
      employeeStats,
      orders
    };
  },

  // --- Weekly data for charts ---
  async getWeeklyData() {
    const allOrders = await this.getOrders();
    const orders = allOrders.filter(o => o.status === 'completed');
    const services = await this.getServices();
    const now = new Date();
    const labels = [];
    const groomingData = [];
    const bathData = [];

    const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      labels.push(dayNames[d.getDay()]);

      const dayOrders = orders.filter(o => {
        const od = new Date(o.completed_at);
        return od.toDateString() === d.toDateString();
      });

      groomingData.push(dayOrders.filter(o => {
        const svc = services.find(s => s.id === o.service_id);
        return svc && (svc.category === 'cat_grooming' || svc.category === 'dog_grooming');
      }).length);

      bathData.push(dayOrders.filter(o => {
        const svc = services.find(s => s.id === o.service_id);
        return svc && svc.category === 'bath';
      }).length);
    }

    return { labels, groomingData, bathData };
  },

  // Clear cache
  clearCache() {
    this._servicesCache = null;
    this._employeesCache = null;
  },

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

  // --- Customers helper (reused from grooming) ---
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
        status: 'in_progress',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', visitId)
      .eq('status', 'waiting') // only if still waiting
      .select().maybeSingle();
    if (error) throw error;
    return data;
  },

  async updateVisit(id, fields) {
    const { error } = await supabaseClient.from('visits').update(fields).eq('id', id);
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
  async addAppointment({ visit_id, patient_id, scheduled_at, purpose, created_by }) {
    const { data, error } = await supabaseClient
      .from('visit_appointments')
      .insert({ visit_id, patient_id, scheduled_at, purpose, created_by })
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
    const base = await this.getReportStats(fromISO, toISO);
    const { data: orders } = await supabaseClient
      .from('orders')
      .select('id, status, employee_id, service_id, duration_actual, created_at, completed_at, services(category, type_ar)')
      .gte('created_at', fromISO).lte('created_at', toISO);
    const { data: emps } = await supabaseClient
      .from('employees')
      .select('id, name_ar, specialization, is_active');
    return { ...base, orders: orders || [], employees: emps || [] };
  },

  // --- Case History (search across visits + orders) ---
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

    let ordersQ = supabaseClient
      .from('orders')
      .select('id, status, customer_name, customer_phone, pet_name, pet_type, notes, created_at, started_at, completed_at, duration_actual, employee_id, employees(name_ar, specialization), services(type_ar, category)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (q) {
      const like = `%${q}%`;
      ordersQ = ordersQ.or(`customer_phone.ilike.${like},customer_name.ilike.${like},pet_name.ilike.${like}`);
    }

    const [visitsRes, ordersRes] = await Promise.all([visitsQ, ordersQ]);
    const visits = visitsRes.data || [];
    const orders = ordersRes.data || [];

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
    orders.forEach(o => {
      const cat = o.services?.category || '';
      const isBath = cat.includes('bath') || /حمام|تحميم/.test(o.services?.type_ar || '');
      items.push({
        kind: isBath ? 'bath' : 'grooming',
        id: o.id,
        created_at: o.created_at,
        status: o.status,
        severity: null,
        owner_name: o.customer_name || '—',
        owner_phone: o.customer_phone || '',
        pet_name: o.pet_name || '',
        pet_type: o.pet_type || '',
        handler: o.employees?.name_ar || '—',
        service_name: o.services?.type_ar || '',
        duration_actual: o.duration_actual,
        raw: o,
      });
    });

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

function showToast(message, type = 'info') {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'warning' ? '⚠️' : type === 'error' ? '❌' : '💜'}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
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
// WHATSAPP MESSAGING MODULE
// يستخدم Supabase Edge Function (send-whatsapp) التي:
//  - ترسل عبر JT-BOT webhook
//  - تسجل كل محاولة في notification_logs
//  - تعيد المحاولة حتى 3 مرات مع backoff
// ==========================================
const WhatsApp = {
  _enabled: true,

  // الإرسال عبر Edge Function (تسجيل + retry تلقائياً)
  async sendViaEdgeFunction({ phone, customerName, serviceName, petName, eventType, orderId = null }) {
    if (!this._enabled || !phone) return { success: false, error: 'disabled_or_no_phone' };

    try {
      const { data, error } = await supabaseClient.functions.invoke('send-whatsapp', {
        body: {
          order_id: orderId,
          event_type: eventType || 'booking_confirmation',
          phone: phone,
          customer_name: customerName || '',
          service_name: serviceName || '',
          pet_name: petName || ''
        }
      });

      if (error) {
        console.warn(`⚠️ Edge function invoke error [${eventType}]:`, error.message || error);
        // fire a UI toast for visibility (admin/operator only — harmless for customers)
        try { showToast && showToast(`⚠️ فشل إرسال واتساب: ${error.message || 'خطأ'}`, 'warning'); } catch { }
        return { success: false, error: error.message || String(error) };
      }

      if (data && data.success) {
        console.log(`✅ WhatsApp sent via edge function [${eventType}] log=${data.log_id}`);
        return { success: true, log_id: data.log_id };
      } else {
        console.warn(`⚠️ WhatsApp send failed [${eventType}]:`, data?.error);
        try { showToast && showToast(`⚠️ لم تُرسل رسالة الواتساب (${eventType})`, 'warning'); } catch { }
        return { success: false, error: data?.error, log_id: data?.log_id };
      }
    } catch (err) {
      console.warn(`WhatsApp edge function exception [${eventType}]:`, err.message);
      return { success: false, error: err.message };
    }
  },

  async sendBookingConfirmation(phone, customerName, petName, serviceNameAr, orderId = null) {
    console.log('📤 Sending booking confirmation to:', phone);
    return this.sendViaEdgeFunction({
      phone, customerName, serviceName: serviceNameAr, petName,
      eventType: 'booking_confirmation', orderId
    });
  },

  async sendTaskStarted(phone, customerName, petName, serviceNameAr, employeeName, orderId = null) {
    console.log('📤 Sending task started notification to:', phone);
    return this.sendViaEdgeFunction({
      phone, customerName, serviceName: serviceNameAr, petName,
      eventType: 'task_started', orderId
    });
  },

  async sendTaskCompleted(phone, customerName, petName, serviceNameAr, durationMinutes, orderId = null) {
    console.log('📤 Sending task completed notification to:', phone);
    return this.sendViaEdgeFunction({
      phone, customerName, serviceName: serviceNameAr, petName,
      eventType: 'task_completed', orderId
    });
  },

  // جدولة رسالة feedback بعد X دقيقة من الإكمال
  async scheduleFeedbackRequest({ phone, customerName, petName, serviceNameAr, orderId, delayMinutes = 60 }) {
    if (!phone) return false;
    try {
      const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
      const { error } = await supabaseClient.from('pending_notifications').insert({
        order_id: orderId || null,
        event_type: 'feedback_request',
        phone,
        customer_name: customerName || '',
        pet_name: petName || '',
        service_name: serviceNameAr || '',
        scheduled_at: scheduledAt
      });
      if (error) {
        console.warn('Failed to schedule feedback:', error.message);
        return false;
      }
      console.log(`⏰ Feedback scheduled for ${phone} at ${scheduledAt}`);
      return true;
    } catch (err) {
      console.warn('scheduleFeedbackRequest error:', err.message);
      return false;
    }
  }
};


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
    if (head === 'employee') {
      if (!Auth.isAuthenticated()) {
        this.currentView = 'login';
        LoginView.render($('#app'), 'employee');
        return;
      }
      if (!Auth.isEmployee()) {
        showToast('⛔ هذه الصفحة للموظفين فقط', 'warning');
        window.location.hash = '#home';
        return;
      }
    }
    if (head === 'employees') {
      if (!Auth.isAuthenticated()) {
        this.currentView = 'login';
        LoginView.render($('#app'), head);
        return;
      }
      if (!Auth.isClinicAdmin()) {
        showToast('⛔ هذه الصفحة للمدير فقط', 'warning');
        window.location.hash = '#home';
        return;
      }
    }
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
    if (head === 'operator' || head === 'dashboard') {
      if (!Auth.isAuthenticated()) {
        this.currentView = 'login';
        LoginView.render($('#app'), head);
        return;
      }
      if (!Auth.isClinicAdmin() && !Auth.isOperator()) {
        showToast('⛔ هذه الصفحة للمنظمين والمدراء فقط', 'warning');
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
          // default booking = grooming (backward-compat for #booking bookmarks)
          await BookingView.render(app);
        }
        break;
      case 'grooming':
        await BookingView.render(app);
        break;
      case 'employee':
        await EmployeeView.render(app);
        break;
      case 'employees':
        await EmployeesManagementView.render(app);
        break;
      case 'operator':
        await OperatorView.render(app);
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
      case 'dashboard':
        if (Auth.isClinicAdmin()) window.location.hash = '#reports/clinic';
        else if (Auth.isDoctor()) window.location.hash = '#reports/medical';
        else window.location.hash = '#home';
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
  _redirectTo: 'operator',
  _activeTab: 'staff', // 'staff' | 'employee'

  render(container, redirectTo = 'operator') {
    this._redirectTo = redirectTo;
    this._activeTab = 'staff';

    container.innerHTML = `
      <div class="login-container animate-in">
        <div class="login-card">
          <div class="login-header">
            <div class="login-logo">
              <img src="assets/logo.svg" alt="الكوخ">
            </div>
            <h1>عيادة الكوخ البيطرية</h1>
            <p>سجّل دخولك للوصول إلى لوحة التحكم</p>
          </div>

          <div class="login-body" id="tab-staff">
            <div class="login-alert" id="login-error" style="display:none;">
              <span>❌</span>
              <span id="login-error-msg">البريد الإلكتروني أو كلمة المرور غير صحيحة</span>
            </div>
            <div class="form-group">
              <label class="form-label">البريد الإلكتروني</label>
              <input type="email" class="form-input login-input" id="login-email" placeholder="user@alkokh.com" autocomplete="email" dir="ltr" value="${localStorage.getItem('alkokh_remember_email') || ''}">
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
                ${localStorage.getItem('alkokh_remember_email') ? 'checked' : ''}>
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
          localStorage.setItem('alkokh_remember_email', email);
        } else {
          localStorage.removeItem('alkokh_remember_email');
        }
        showToast('تم تسجيل الدخول بنجاح! مرحباً بك 👋', 'success');
        playNotificationSound();
        let dest = null;
        if (Auth.isClinicAdmin()) dest = this._redirectTo;
        else if (Auth.isDoctor()) dest = 'doctor';
        else if (Auth.isOperator()) dest = 'operator';
        else if (Auth.isEmployee()) dest = 'employee';
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
// BOOKING VIEW
// ==========================================
const BookingView = {
  step: 1,
  selectedCategory: null,
  selectedServiceId: null,
  petType: null,
  _services: [],

  async render(container) {
    this.step = 1;
    this.selectedCategory = null;
    this.selectedServiceId = null;
    this.petType = null;

    // Pre-fetch services
    showLoading(container);
    this._services = await DB.getServices();
    this._renderStep(container);
  },

  _renderStep(container) {
    container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'page-header animate-in';
    header.innerHTML = `
      <div class="brand-badge">🐾 عيادة الكوخ البيطرية</div>
      <h1>حجز خدمة الحلاقة والتحميم</h1>
      <p>اختر الخدمة المناسبة لرفيقك</p>
    `;
    container.appendChild(header);

    // Steps indicator
    const stepsHtml = `
      <div class="booking-steps animate-in-delay-1">
        <div class="step ${this.step >= 1 ? 'active' : ''} ${this.step > 1 ? 'completed' : ''}">
          <div class="step-number">${this.step > 1 ? '✓' : '1'}</div>
          <span class="step-label">نوع الخدمة</span>
        </div>
        <div class="step-connector ${this.step > 1 ? 'completed' : ''}"></div>
        <div class="step ${this.step >= 2 ? 'active' : ''} ${this.step > 2 ? 'completed' : ''}">
          <div class="step-number">${this.step > 2 ? '✓' : '2'}</div>
          <span class="step-label">تفاصيل الخدمة</span>
        </div>
        <div class="step-connector ${this.step > 2 ? 'completed' : ''}"></div>
        <div class="step ${this.step >= 3 ? 'active' : ''} ${this.step > 3 ? 'completed' : ''}">
          <div class="step-number">${this.step > 3 ? '✓' : '3'}</div>
          <span class="step-label">المعلومات</span>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', stepsHtml);

    // Content based on step
    const content = document.createElement('div');
    content.className = 'animate-in-delay-2';

    switch (this.step) {
      case 1:
        this._renderCategorySelection(content);
        break;
      case 2:
        this._renderTypeSelection(content);
        break;
      case 3:
        this._renderInfoForm(content);
        break;
      case 4:
        this._renderConfirmation(content);
        break;
    }

    container.appendChild(content);
  },

  _renderCategorySelection(el) {
    el.innerHTML = `
      <div class="service-grid">
        <div class="service-card" data-category="cat_grooming" id="svc-cat">
          <span class="emoji"><img src="assets/alkokh_icons/cat.png" alt="قطة"></span>
          <div class="title">حلاقة قطة</div>
          <div class="subtitle">قصات متنوعة للقطط</div>
        </div>
        <div class="service-card" data-category="dog_grooming" id="svc-dog">
          <span class="emoji"><img src="assets/alkokh_icons/dog.png" alt="كلب"></span>
          <div class="title">حلاقة الكلب</div>
          <div class="subtitle">قصات متنوعة للكلاب</div>
        </div>
        <div class="service-card" data-category="bath" id="svc-bath">
          <span class="emoji"><img src="assets/alkokh_icons/bath.png" alt="تحميم"></span>
          <div class="title">تحميم</div>
          <div class="subtitle">تحميم اعتيادي أو طبي</div>
        </div>
      </div>
    `;

    el.querySelectorAll('.service-card').forEach(card => {
      card.addEventListener('click', () => {
        this.selectedCategory = card.dataset.category;
        this.petType = card.dataset.category === 'cat_grooming' ? 'cat' :
          card.dataset.category === 'dog_grooming' ? 'dog' : null;
        this.step = 2;
        this._renderStep($('#app'));
      });
    });
  },

  _renderTypeSelection(el) {
    const services = this._services.filter(s => s.category === this.selectedCategory);
    const categoryNames = {
      'cat_grooming': '🐱 حلاقة قطة',
      'dog_grooming': '🐕 حلاقة الكلب',
      'bath': '🛁 تحميم'
    };

    let html = `
      <div style="text-align:center; margin-bottom: 20px;">
        <h2 style="font-size:1.3rem; font-weight:800; margin-bottom:4px;">${categoryNames[this.selectedCategory]}</h2>
        <p style="color:var(--text-secondary); font-size:0.9rem;">اختر نوع الخدمة</p>
      </div>
      <div class="type-grid">
    `;

    services.forEach(svc => {
      html += `
        <button class="type-btn" data-service-id="${svc.id}" id="type-${svc.id}">
          <span class="type-icon"><img src="${svc.icon}" alt="${svc.type_ar}"></span>
          <span>${svc.type_ar}</span>
        </button>
      `;
    });

    html += `</div>
      <div style="text-align:center; margin-top:20px;">
        <button class="btn btn-back-oval" id="back-to-step1">← رجوع</button>
      </div>`;

    el.innerHTML = html;

    // If bath, ask about pet type
    if (this.selectedCategory === 'bath') {
      const petSelector = document.createElement('div');
      petSelector.style.cssText = 'text-align:center; margin-bottom:20px;';
      petSelector.innerHTML = `
        <p style="font-weight:700; margin-bottom:12px;">نوع الحيوان:</p>
        <div style="display:flex;gap:20px;justify-content:center;">
          <button class="btn pet-btn ${this.petType === 'cat' ? 'pet-btn-active' : ''}" id="pet-cat">
            <img src="assets/alkokh_icons/cat.png" class="pet-icon">
            <span>قطة</span>
          </button>
          <button class="btn pet-btn ${this.petType === 'dog' ? 'pet-btn-active' : ''}" id="pet-dog">
            <img src="assets/alkokh_icons/dog.png" class="pet-icon">
            <span>كلب</span>
          </button>
        </div>
      `;
      el.querySelector('.type-grid').before(petSelector);

      el.querySelector('#pet-cat')?.addEventListener('click', () => {
        this.petType = 'cat';
        this._renderStep($('#app'));
      });
      el.querySelector('#pet-dog')?.addEventListener('click', () => {
        this.petType = 'dog';
        this._renderStep($('#app'));
      });
    }

    el.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedServiceId = btn.dataset.serviceId;
        if (this.selectedCategory === 'bath' && !this.petType) {
          showToast('الرجاء اختيار نوع الحيوان أولاً', 'warning');
          return;
        }
        this.step = 3;
        this._renderStep($('#app'));
      });
    });

    el.querySelector('#back-to-step1')?.addEventListener('click', () => {
      this.step = 1;
      this._renderStep($('#app'));
    });
  },

  _renderInfoForm(el) {
    const service = this._services.find(s => s.id === this.selectedServiceId);

    el.innerHTML = `
      <div class="card" style="max-width:500px; margin:0 auto;">
        <div class="card-body">
          <div style="text-align:center; margin-bottom:24px;">
            <div class="order-service" style="display:inline-flex; padding:8px 20px; font-size:0.95rem;">
              <img src="${service?.icon || ''}" class="icon-inline"> ${service?.type_ar || ''}
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">اسم صاحب الحيوان *</label>
            <input type="text" class="form-input" id="customer-name" placeholder="مثال: أحمد" autocomplete="off">
          </div>
          <div class="form-group">
            <label class="form-label">رقم الهاتف *</label>
            <input type="tel" class="form-input" id="customer-phone" placeholder="مثال: 07801234567" autocomplete="tel" dir="ltr" style="text-align:left;" required>
          </div>
          <div class="form-group">
            <label class="form-label">اسم الحيوان *</label>
            <input type="text" class="form-input" id="pet-name" placeholder="مثال: بادي" autocomplete="off">
          </div>
          <div class="form-group">
            <label class="form-label">ملاحظات (اختياري)</label>
            <input type="text" class="form-input" id="order-notes" placeholder="أي تفاصيل إضافية..." autocomplete="off">
          </div>
          <button class="btn btn-primary btn-lg btn-block" id="submit-booking" style="margin-top:8px;">
            <span id="booking-btn-text">📋 تأكيد الحجز</span>
            <span id="booking-btn-loading" style="display:none;">
              <span class="btn-spinner"></span> جاري التسجيل...
            </span>
          </button>
          <div style="text-align:center; margin-top:16px;">
            <button class="btn btn-back-oval" id="back-to-step2">← رجوع</button>
          </div>
        </div>
      </div>
    `;

    el.querySelector('#submit-booking')?.addEventListener('click', async () => {
      const customerName = el.querySelector('#customer-name')?.value.trim();
      const customerPhone = el.querySelector('#customer-phone')?.value.trim();
      const petName = el.querySelector('#pet-name')?.value.trim();
      const notes = el.querySelector('#order-notes')?.value.trim();
      const submitBtn = el.querySelector('#submit-booking');

      if (!customerName) { showToast('الرجاء إدخال اسم صاحب الحيوان', 'warning'); el.querySelector('#customer-name')?.focus(); return; }
      if (!customerPhone) { showToast('الرجاء إدخال رقم الهاتف', 'warning'); el.querySelector('#customer-phone')?.focus(); return; }
      if (!petName) { showToast('الرجاء إدخال اسم الحيوان', 'warning'); el.querySelector('#pet-name')?.focus(); return; }

      el.querySelector('#booking-btn-text').style.display = 'none';
      el.querySelector('#booking-btn-loading').style.display = 'inline-flex';
      submitBtn.disabled = true;

      try {
        const newOrderId = await DB.addOrder({
          customer_name: customerName,
          customer_phone: customerPhone || null,
          pet_name: petName,
          pet_type: this.petType,
          service_id: this.selectedServiceId,
          notes: notes || ''
        });

        if (customerPhone) {
          WhatsApp.sendBookingConfirmation(
            customerPhone, customerName, petName, service?.type_ar || '',
            typeof newOrderId === 'string' ? newOrderId : null
          ).catch(() => { });
        }

        playNotificationSound();
        this.lastOrderId = typeof newOrderId === 'string' ? newOrderId : null;
        this.step = 4;
        this._renderStep($('#app'));
      } catch (err) {
        console.error('Booking error:', err);
        showToast('حدث خطأ أثناء تسجيل الحجز. يرجى المحاولة مرة أخرى.', 'error');
        el.querySelector('#booking-btn-text').style.display = 'inline';
        el.querySelector('#booking-btn-loading').style.display = 'none';
        submitBtn.disabled = false;
      }
    });

    el.querySelector('#back-to-step2')?.addEventListener('click', () => {
      this.step = 2;
      this._renderStep($('#app'));
    });

    setTimeout(() => el.querySelector('#customer-name')?.focus(), 300);
  },

  async _renderConfirmation(el) {
    const waitingCount = await DB.getWaitingCount();
    const orderId = this.lastOrderId;
    const qrUrl = orderId
      ? `${window.location.origin}${window.location.pathname}#order/${orderId}`
      : null;

    el.innerHTML = `
      <div class="confirmation">
        <div class="checkmark">✅</div>
        <h2>تم تسجيل الحجز بنجاح!</h2>
        <p>تمت إضافة رفيقك إلى قائمة الانتظار</p>
        <div class="queue-number">${waitingCount}</div>
        <p style="font-size:0.85rem; margin-bottom:24px;">ترتيبك في قائمة الانتظار</p>

        ${qrUrl ? `
        <div class="qr-glass-card" style="margin-bottom:24px;">
          <div class="qr-glass-card-label">
            <span class="qr-label-dot"></span>
            رمز حجزك
          </div>
          <div class="qr-code-wrapper">
            <div id="booking-qr" class="qr-canvas"></div>
          </div>
          <p class="qr-glass-hint">📌 احتفظ بهذا الرمز — يمكن مسحه لمتابعة حالة حجزك</p>
          <div class="qr-glass-actions">
            <button type="button" id="bk-qr-download" class="qr-action-btn">⬇️ حفظ</button>
            <button type="button" id="bk-qr-print" class="qr-action-btn">🖨️ طباعة</button>
          </div>
        </div>
        ` : ''}

        <button class="btn btn-primary btn-lg" id="new-booking">
          ➕ حجز خدمة جديدة
        </button>
      </div>
    `;

    if (qrUrl) {
      const qrEl = document.getElementById('booking-qr');
      const renderQR = () => {
        if (!window.QRCode) return setTimeout(renderQR, 200);
        try {
          new window.QRCode(qrEl, {
            text: qrUrl, width: 240, height: 240,
            colorDark: '#1a1a1a', colorLight: '#ffffff',
            correctLevel: window.QRCode.CorrectLevel.H,
          });
        } catch (e) { qrEl.textContent = qrUrl; }
      };
      renderQR();
      document.getElementById('bk-qr-download')?.addEventListener('click', () => {
        const img = qrEl.querySelector('img') || qrEl.querySelector('canvas');
        if (!img) return;
        const src = img.tagName === 'IMG' ? img.src : img.toDataURL('image/png');
        const a = document.createElement('a');
        a.download = `alkokh-order-${orderId}.png`; a.href = src; a.click();
      });
      document.getElementById('bk-qr-print')?.addEventListener('click', () => window.print());
    }

    el.querySelector('#new-booking')?.addEventListener('click', () => {
      this.step = 1;
      this.lastOrderId = null;
      this._renderStep($('#app'));
    });
  }
};


// ==========================================
// OPERATOR VIEW
// ==========================================
const OperatorView = {
  timerInterval: null,

  async render(container) {
    showLoading(container);
    await this._buildUI(container);
    this._startTimers();
  },

  async _buildUI(container) {
    const orders = await DB.getOrders();
    const services = await DB.getServices();
    const employees = await DB.getEmployees();

    const waiting = orders.filter(o => o.status === 'waiting');
    const assigned = orders.filter(o => o.status === 'assigned');
    const inProgress = orders.filter(o => o.status === 'in_progress');
    const completed = orders.filter(o => o.status === 'completed')
      .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
      .slice(0, 10);

    let html = `
      <div class="page-header animate-in">
        <h1>⚙️ لوحة تحكم المنظم</h1>
        <p>قم بتوزيع المهام وإدارة قائمة الانتظار</p>
      </div>
    `;

    // Quick stats
    html += `
      <div class="stats-grid animate-in-delay-1">
        <div class="stat-card gold">
          <span class="stat-icon">⏳</span>
          <div class="stat-value">${waiting.length}</div>
          <div class="stat-label">بالانتظار</div>
        </div>
        <div class="stat-card blue">
          <span class="stat-icon">📩</span>
          <div class="stat-value">${assigned.length}</div>
          <div class="stat-label">بانتظار القبول</div>
        </div>
        <div class="stat-card purple">
          <span class="stat-icon">🔄</span>
          <div class="stat-value">${inProgress.length}</div>
          <div class="stat-label">قيد التنفيذ</div>
        </div>
        <div class="stat-card green">
          <span class="stat-icon">✅</span>
          <div class="stat-value">${orders.filter(o => o.status === 'completed').length}</div>
          <div class="stat-label">مكتمل اليوم</div>
        </div>
      </div>
    `;

    // Waiting section
    html += `<div class="queue-section animate-in-delay-2">`;
    html += `
      <div class="queue-section-title">
        ⏳ قائمة الانتظار
        <span class="badge badge-waiting">${waiting.length}</span>
      </div>
    `;

    if (waiting.length === 0) {
      html += `<div class="empty-state"><span class="emoji">😊</span><p>لا توجد حالات بالانتظار حالياً</p></div>`;
    } else {
      waiting.forEach(order => {
        html += this._renderOrderCard(order, services, employees, 'waiting');
      });
    }
    html += `</div>`;

    // Assigned section (waiting for employee acceptance)
    if (assigned.length > 0) {
      html += `<div class="queue-section">`;
      html += `
        <div class="queue-section-title">
          📩 بانتظار قبول الموظف
          <span class="badge badge-assigned">${assigned.length}</span>
        </div>
      `;
      assigned.forEach(order => {
        html += this._renderOrderCard(order, services, employees, 'assigned');
      });
      html += `</div>`;
    }

    // In Progress section
    html += `<div class="queue-section">`;
    html += `
      <div class="queue-section-title">
        🔄 قيد التنفيذ
        <span class="badge badge-in-progress">${inProgress.length}</span>
      </div>
    `;

    if (inProgress.length === 0) {
      html += `<div class="empty-state"><span class="emoji">💤</span><p>لا توجد مهام قيد التنفيذ</p></div>`;
    } else {
      inProgress.forEach(order => {
        html += this._renderOrderCard(order, services, employees, 'in_progress');
      });
    }
    html += `</div>`;

    // Recent completed
    if (completed.length > 0) {
      html += `<div class="queue-section">`;
      html += `
        <div class="queue-section-title">
          ✅ المكتملة مؤخراً
          <span class="badge badge-completed">${completed.length}</span>
        </div>
      `;
      completed.forEach(order => {
        html += this._renderOrderCard(order, services, employees, 'completed');
      });
      html += `</div>`;
    }

    container.innerHTML = html;
    this._bindEvents(container);
  },

  _renderOrderCard(order, services, employees, statusSection) {
    const service = services.find(s => s.id === order.service_id);
    const employee = employees.find(e => e.id === order.employee_id);

    let actionsHtml = '';

    if (statusSection === 'waiting') {
      const isGrooming = service && (service.category === 'cat_grooming' || service.category === 'dog_grooming');
      const eligibleEmployees = employees.filter(e =>
        isGrooming ? e.specialization === 'groomer' : e.specialization === 'bather'
      );

      actionsHtml = `
        <div class="order-actions" style="display:flex; flex-wrap:wrap; gap:8px;">
          ${eligibleEmployees.map(emp => `
            <button class="employee-btn" data-order-id="${order.id}" data-employee-id="${emp.id}">
              <div class="employee-avatar" style="background:${emp.avatar_color}">${emp.name_ar.charAt(0)}</div>
              <span>${emp.name_ar}</span>
            </button>
          `).join('')}
          <button class="btn btn-danger btn-icon" data-cancel-id="${order.id}" title="إلغاء">✕</button>
        </div>
      `;
    } else if (statusSection === 'assigned') {
      // Admin can reassign to another employee or cancel
      const isGrooming = service && (service.category === 'cat_grooming' || service.category === 'dog_grooming');
      const eligibleEmployees = employees.filter(e =>
        (isGrooming ? e.specialization === 'groomer' : e.specialization === 'bather') && e.id !== order.employee_id
      );

      actionsHtml = `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; padding-top:12px; border-top:1px dashed rgba(255,255,255,0.1);">
          <div class="employee-avatar" style="background:${employee?.avatar_color || '#666'}; width:32px; height:32px; font-size:0.8rem;">${employee?.name_ar?.charAt(0) || '?'}</div>
          <span style="font-weight:700; font-size:0.95rem; color:var(--white);">موجهة لـ ${employee?.name_ar || 'غير معروف'}</span>
          <span class="badge badge-assigned" style="margin-right:auto;">بانتظار القبول</span>
        </div>
        ${eligibleEmployees.length > 0 ? `
          <div class="order-actions" style="display:flex; flex-wrap:wrap; gap:8px;">
            <span style="font-size:0.8rem; color:var(--purple-200); width:100%; margin-bottom:4px;">↔️ نقل المهمة إلى:</span>
            ${eligibleEmployees.map(emp => `
              <button class="employee-btn" style="font-size:0.85rem; padding:8px 12px;" data-reassign-order="${order.id}" data-reassign-employee="${emp.id}">
                <div class="employee-avatar" style="background:${emp.avatar_color}; width:24px; height:24px; font-size:0.65rem;">${emp.name_ar.charAt(0)}</div>
                <span>${emp.name_ar}</span>
              </button>
            `).join('')}
            <button class="btn btn-danger btn-icon" data-cancel-id="${order.id}" title="إلغاء" style="font-size:0.8rem;">✕</button>
          </div>
        ` : `
          <div class="order-actions" style="margin-top:8px;">
            <button class="btn btn-danger btn-icon" data-cancel-id="${order.id}" title="إلغاء">✕ إلغاء</button>
          </div>
        `}
      `;
    } else if (statusSection === 'in_progress') {
      // Admin can only see in-progress, employee completes it
      // Admin can still reassign or delete
      const isGrooming = service && (service.category === 'cat_grooming' || service.category === 'dog_grooming');
      const eligibleEmployees = employees.filter(e =>
        (isGrooming ? e.specialization === 'groomer' : e.specialization === 'bather') && e.id !== order.employee_id
      );

      actionsHtml = `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; padding-top:12px; border-top:1px dashed rgba(255,255,255,0.1);">
          <div class="employee-avatar" style="background:${employee?.avatar_color || '#666'}; width:32px; height:32px; font-size:0.8rem;">${employee?.name_ar?.charAt(0) || '?'}</div>
          <span style="font-weight:700; font-size:0.95rem; color:var(--white);">${employee?.name_ar || ''}</span>
          <span style="font-size:0.8rem; color:var(--purple-200); margin-right:auto;">يعمل عليها</span>
        </div>
        <div class="order-actions" style="display:flex; gap:8px; margin-top:8px;">
          ${eligibleEmployees.length > 0 ? `
            <select class="reassign-select" data-reassign-inprogress-order="${order.id}" style="flex:1; padding:10px; border-radius:var(--radius-md); background:rgba(255,255,255,0.08); color:var(--white); border:1px solid rgba(255,255,255,0.15); font-family:var(--font-ar); font-size:0.85rem; cursor:pointer;">
              <option value="">↔️ نقل المهمة...</option>
              ${eligibleEmployees.map(emp => `<option value="${emp.id}">${emp.name_ar}</option>`).join('')}
            </select>
          ` : ''}
          <button class="btn btn-danger" data-delete-id="${order.id}" title="حذف" style="border-radius:var(--radius-md); width:56px; padding:0; display:flex; justify-content:center; align-items:center;">
            🗑️
          </button>
        </div>
      `;
    } else {
      // Completed or cancelled
      actionsHtml = `
        <div class="order-actions" style="margin-top:16px;">
          <button class="btn btn-danger btn-block" data-delete-id="${order.id}" style="background:rgba(239, 68, 68, 0.15); color:#fca5a5; border:1px solid rgba(239, 68, 68, 0.3);">
            🗑️ حذف السجل نهائياً
          </button>
        </div>
      `;
    }

    const phoneDisplay = order.customer_phone
      ? `<span class="order-phone" style="opacity:0.8;">📱 ${order.customer_phone}</span>`
      : '';

    return `
      <div class="order-card status-${order.status}" data-order-id="${order.id}">
        <div class="order-header" style="margin-bottom:16px;">
            <div class="order-pet">
              <div class="order-pet-emoji"><img src="assets/alkokh_icons/${order.pet_type === 'cat' ? 'cat.png' : 'dog.png'}" alt="pet"></div>
              <div class="order-pet-info">
                <h3>${order.pet_name}</h3>
                <p>${order.customer_name} · ${timeAgo(order.created_at)} ${phoneDisplay}</p>
              </div>
            </div>
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div class="order-service"><img src="${service?.icon || ''}" class="icon-inline"> ${service?.type_ar || ''}</div>
            ${statusSection === 'in_progress' ? `
              <div class="order-timer" data-timer-start="${order.started_at}">
                ⏱ <span class="timer-display">${elapsedTimer(order.started_at)}</span>
              </div>
            ` : ''}
            ${statusSection === 'completed' && employee ? `
              <div style="font-size:0.8rem; color:var(--purple-200); text-align: left;">
                ${employee.name_ar} · ${order.duration_actual || 0} دقيقة
              </div>
            ` : ''}
        </div>
        
        ${order.notes ? `<p style="font-size:0.85rem; color:var(--purple-200); margin-bottom:16px; background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">📝 ${order.notes}</p>` : ''}
        
        ${actionsHtml}
      </div>
    `;
  },

  _bindEvents(container) {
    // Assign to employee (waiting → assigned)
    container.querySelectorAll('.employee-btn[data-order-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.dataset.orderId;
        const employeeId = btn.dataset.employeeId;
        const employees = await DB.getEmployees();
        const employee = employees.find(e => e.id === employeeId);

        try {
          btn.disabled = true;
          btn.style.opacity = '0.5';

          const res = await DB.assignOrder(orderId, employeeId);
          if (res) {
            showToast(`📩 تم توجيه المهمة إلى ${employee?.name_ar || ''} — بانتظار قبوله`, 'success');
            playNotificationSound();
            await this._buildUI($('#app'));
            this._startTimers();
          } else {
            throw new Error('فشل التوجيه');
          }
        } catch (error) {
          console.error(error);
          showToast('❌ حدث خطأ، حاول مرة أخرى', 'error');
          btn.disabled = false;
          btn.style.opacity = '1';
        }
      });
    });

    // Reassign order (assigned → assigned to different employee)
    container.querySelectorAll('[data-reassign-order]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.dataset.reassignOrder;
        const newEmployeeId = btn.dataset.reassignEmployee;
        const employees = await DB.getEmployees();
        const employee = employees.find(e => e.id === newEmployeeId);

        try {
          btn.disabled = true;
          btn.style.opacity = '0.5';

          const res = await DB.reassignOrder(orderId, newEmployeeId);
          if (res) {
            showToast(`↔️ تم نقل المهمة إلى ${employee?.name_ar || ''}`, 'success');
            await this._buildUI($('#app'));
            this._startTimers();
          } else {
            throw new Error('فشل نقل المهمة');
          }
        } catch (error) {
          console.error(error);
          showToast('❌ حدث خطأ، حاول مرة أخرى', 'error');
          btn.disabled = false;
          btn.style.opacity = '1';
        }
      });
    });

    // Reassign from in-progress (dropdown select)
    container.querySelectorAll('.reassign-select').forEach(select => {
      select.addEventListener('change', async () => {
        const orderId = select.dataset.reassignInprogressOrder;
        const newEmployeeId = select.value;
        const originalValue = select.dataset.originalValue || "";
        if (!newEmployeeId) return;

        if (!confirm('هل تريد نقل هذه المهمة؟ سيتم إعادة ضبط العداد.')) {
          select.value = originalValue;
          return;
        }

        try {
          select.disabled = true;
          const employees = await DB.getEmployees();
          const employee = employees.find(e => e.id === newEmployeeId);

          const res = await DB.reassignOrder(orderId, newEmployeeId);
          if (res) {
            showToast(`↔️ تم نقل المهمة إلى ${employee?.name_ar || ''}`, 'success');
            await this._buildUI($('#app'));
            this._startTimers();
          } else {
            throw new Error('فشل نقل المهمة');
          }
        } catch (error) {
          console.error(error);
          showToast('❌ حدث خطأ في نقل المهمة', 'error');
          select.value = originalValue;
          select.disabled = false;
        }
      });
    });

    // Cancel order (changes status to cancelled)
    container.querySelectorAll('[data-cancel-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('هل أنت متأكد من إلغاء هذا الطلب؟')) return;
        const orderId = btn.dataset.cancelId;
        const originalText = btn.innerHTML;

        try {
          btn.disabled = true;
          btn.innerHTML = '<span class="btn-spinner"></span>...';

          const res = await DB.cancelOrder(orderId);
          if (res) {
            showToast('تم إلغاء الطلب', 'warning');
            await this._buildUI($('#app'));
            this._startTimers();
          } else {
            throw new Error('فشل الإلغاء');
          }
        } catch (error) {
          console.error('Delete Event Error:', error);
          showToast(`❌ تعذر الحذف: ${error.message || 'تأكد من الصلاحيات والاتصال'}`, 'error');
          if (document.body.contains(btn)) {
            btn.disabled = false;
            btn.innerHTML = originalText;
          }
        }
      });
    });

    // Delete order (removes from database entirely)
    container.querySelectorAll('[data-delete-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('هل أنت متأكد من حذف هذا السجل نهائياً من قاعدة البيانات؟ لا يمكن التراجع عن هذا الإجراء.')) return;
        const orderId = btn.dataset.deleteId;
        const originalText = btn.innerHTML;

        try {
          btn.disabled = true;
          btn.innerHTML = '<span class="btn-spinner"></span>...';

          const success = await DB.deleteOrder(orderId);

          if (success) {
            showToast('تم حذف السجل بنجاح 🗑️', 'info');
            await this._buildUI($('#app'));
            this._startTimers();
          } else {
            throw new Error('فشلت عملية الحذف في قاعدة البيانات');
          }
        } catch (error) {
          console.error('Delete Event Error:', error);
          showToast(`❌ تعذر الحذف: ${error.message || 'تأكد من الصلاحيات والاتصال'}`, 'error');
          if (document.body.contains(btn)) {
            btn.disabled = false;
            btn.innerHTML = originalText;
          }
        }
      });
    });
  },

  _startTimers() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      $$('.order-timer').forEach(timer => {
        const start = timer.dataset.timerStart;
        if (start) {
          timer.querySelector('.timer-display').textContent = elapsedTimer(start);
        }
      });
    }, 1000);
  }
};


// ==========================================
// EMPLOYEE VIEW
// ==========================================
const EmployeeView = {
  _employee: null,
  _refreshInterval: null,
  timerInterval: null,
  _lastOrderCount: 0,

  async render(container) {
    if (!Auth.isAuthenticated() || !Auth.isEmployee()) {
      window.location.hash = '#login';
      LoginView.render(container, 'employee');
      return;
    }
    try {
      this._employee = Auth.getEmployee();
      showLoading(container);
      await this._buildTasksUI(container);
      this._startTimers();
      this._startAutoRefresh(container);
    } catch (err) {
      console.error('EmployeeView render error:', err);
      container.innerHTML = `
        <div class="empty-state">
          <span class="emoji">❌</span>
          <p>عذراً، حدث خطأ أثناء تحميل البيانات</p>
          <button class="btn btn-primary" onclick="location.reload()">إعادة تحميل</button>
        </div>
      `;
    }
  },


  async _buildTasksUI(container) {
    if (!this._employee) return;

    const orders = await DB.getEmployeeOrders(this._employee.id);
    const completedOrders = await DB.getEmployeeCompleted(this._employee.id);
    const services = await DB.getServices();

    const assigned = orders.filter(o => o.status === 'assigned');
    const inProgress = orders.filter(o => o.status === 'in_progress');

    let html = `
      <div class="page-header animate-in" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div>
          <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
            <div class="employee-avatar" style="background:${this._employee.avatar_color}; width:48px; height:48px; font-size:1.2rem;">${this._employee.name_ar.charAt(0)}</div>
            <div>
              <h1 style="font-size:1.4rem; margin:0;">مرحباً ${this._employee.name_ar}</h1>
              <p style="margin:0; font-size:0.85rem; color:var(--purple-200);">${this._employee.specialization === 'groomer' ? '✂️ حلاّق' : '🛁 مُحمِّم'}</p>
            </div>
          </div>
        </div>
        <button class="btn btn-ghost" id="employee-logout" style="font-size:0.85rem;">🚪 تسجيل خروج</button>
      </div>
    `;

    // Stats
    html += `
      <div class="stats-grid animate-in-delay-1" style="grid-template-columns: repeat(3, 1fr);">
        <div class="stat-card blue">
          <span class="stat-icon">📩</span>
          <div class="stat-value">${assigned.length}</div>
          <div class="stat-label">مهام جديدة</div>
        </div>
        <div class="stat-card purple">
          <span class="stat-icon">🔄</span>
          <div class="stat-value">${inProgress.length}</div>
          <div class="stat-label">قيد التنفيذ</div>
        </div>
        <div class="stat-card green">
          <span class="stat-icon">✅</span>
          <div class="stat-value">${completedOrders.length}</div>
          <div class="stat-label">مكتملة اليوم</div>
        </div>
      </div>
    `;

    // Assigned (new tasks to accept)
    if (assigned.length > 0) {
      html += `<div class="queue-section animate-in-delay-2">`;
      html += `
        <div class="queue-section-title">
          📩 مهام جديدة
          <span class="badge badge-assigned">${assigned.length}</span>
        </div>
      `;
      assigned.forEach(order => {
        const service = services.find(s => s.id === order.service_id);
        html += `
          <div class="order-card status-assigned employee-task-card" data-order-id="${order.id}">
            <div class="order-header" style="margin-bottom:16px;">
              <div class="order-pet">
                <div class="order-pet-emoji"><img src="assets/alkokh_icons/${order.pet_type === 'cat' ? 'cat.png' : 'dog.png'}" alt="pet"></div>
                <div class="order-pet-info">
                  <h3>${order.pet_name}</h3>
                  <p>${order.customer_name} · ${timeAgo(order.created_at)}</p>
                </div>
              </div>
            </div>
            <div style="margin-bottom:16px;">
              <div class="order-service"><img src="${service?.icon || ''}" class="icon-inline"> ${service?.type_ar || ''}</div>
            </div>
            ${order.notes ? `<p style="font-size:0.85rem; color:var(--purple-200); margin-bottom:16px; background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">📝 ${order.notes}</p>` : ''}
            <button class="btn btn-accept btn-lg btn-block" data-accept-id="${order.id}">
              ✅ قبول ومباشرة العمل
            </button>
          </div>
        `;
      });
      html += `</div>`;
    }

    // In Progress (with timer)
    if (inProgress.length > 0) {
      html += `<div class="queue-section">`;
      html += `
        <div class="queue-section-title">
          🔄 قيد التنفيذ
          <span class="badge badge-in-progress">${inProgress.length}</span>
        </div>
      `;
      inProgress.forEach(order => {
        const service = services.find(s => s.id === order.service_id);
        html += `
          <div class="order-card status-in_progress employee-task-card" data-order-id="${order.id}">
            <div class="order-header" style="margin-bottom:16px;">
              <div class="order-pet">
                <div class="order-pet-emoji"><img src="assets/alkokh_icons/${order.pet_type === 'cat' ? 'cat.png' : 'dog.png'}" alt="pet"></div>
                <div class="order-pet-info">
                  <h3>${order.pet_name}</h3>
                  <p>${order.customer_name}</p>
                </div>
              </div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
              <div class="order-service"><img src="${service?.icon || ''}" class="icon-inline"> ${service?.type_ar || ''}</div>
              <div class="employee-timer order-timer" data-timer-start="${order.started_at}">
                ⏱ <span class="timer-display">${elapsedTimer(order.started_at)}</span>
              </div>
            </div>
            ${order.notes ? `<p style="font-size:0.85rem; color:var(--purple-200); margin-bottom:16px; background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">📝 ${order.notes}</p>` : ''}
            <button class="btn btn-complete-emp btn-lg btn-block" data-emp-complete-id="${order.id}">
              🏁 تم الإنجاز
            </button>
          </div>
        `;
      });
      html += `</div>`;
    }

    // Empty state
    if (assigned.length === 0 && inProgress.length === 0) {
      html += `
        <div class="empty-state animate-in-delay-2" style="padding:60px 20px;">
          <span class="emoji" style="font-size:3rem;">😊</span>
          <p style="font-size:1.1rem; margin-top:16px;">لا توجد مهام حالياً</p>
          <p style="font-size:0.85rem; color:var(--purple-200);">سيتم تنبيهك عند وصول مهمة جديدة</p>
        </div>
      `;
    }

    // Completed today
    if (completedOrders.length > 0) {
      html += `<div class="queue-section" style="margin-top:24px;">`;
      html += `
        <div class="queue-section-title">
          ✅ مكتملة اليوم
          <span class="badge badge-completed">${completedOrders.length}</span>
        </div>
      `;
      completedOrders.forEach(order => {
        const service = services.find(s => s.id === order.service_id);
        html += `
          <div class="order-card status-completed" style="opacity:0.7;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="display:flex; align-items:center; gap:10px;">
                <div class="order-pet-emoji"><img src="assets/alkokh_icons/${order.pet_type === 'cat' ? 'cat.png' : 'dog.png'}" alt="pet" style="width:28px; height:28px;"></div>
                <div>
                  <strong>${order.pet_name}</strong>
                  <span style="font-size:0.8rem; color:var(--purple-200);"> · ${order.customer_name}</span>
                </div>
              </div>
              <div style="text-align:left; font-size:0.8rem; color:var(--purple-200);">
                ${order.duration_actual || 0} دقيقة
              </div>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }

    container.innerHTML = html;
    this._bindTaskEvents(container);
  },

  _bindTaskEvents(container) {
    // Logout
    container.querySelector('#employee-logout')?.addEventListener('click', async () => {
      await Auth.logout();
      this._employee = null;
      this._stopAutoRefresh();
      if (this.timerInterval) clearInterval(this.timerInterval);
      showToast('تم تسجيل الخروج', 'info');
      window.location.hash = '#booking';
    });

    // Accept order
    container.querySelectorAll('[data-accept-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.dataset.acceptId;
        btn.disabled = true;
        btn.textContent = '⏳ جاري القبول...';

        const success = await DB.acceptOrder(orderId, this._employee.id);
        if (success) {
          showToast('✅ تم قبول المهمة — ابدأ العمل الآن!', 'success');
          playNotificationSound();

          // Send WhatsApp "task started" notification (non-blocking, logged via edge function)
          try {
            const orders = await DB.getEmployeeOrders(this._employee.id);
            const order = orders.find(o => o.id === orderId);
            if (order?.customer_phone) {
              const services = await DB.getServices();
              const service = services.find(s => s.id === order.service_id);
              WhatsApp.sendTaskStarted(
                order.customer_phone,
                order.customer_name,
                order.pet_name,
                service?.type_ar || '',
                this._employee.name_ar,
                orderId
              ).catch(() => { });
            }
          } catch (e) { /* non-blocking */ }
        } else {
          showToast('❌ حدث خطأ، حاول مرة أخرى', 'error');
        }
        await this._buildTasksUI($('#app'));
        this._startTimers();
      });
    });

    // Complete order
    container.querySelectorAll('[data-emp-complete-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.dataset.empCompleteId;

        // Get order details BEFORE completing (so we have phone & service info)
        let orderPhone = null, orderCustomer = '', orderPet = '', orderServiceAr = '';
        try {
          const orders = await DB.getEmployeeOrders(this._employee.id);
          const order = orders.find(o => o.id === orderId);
          if (order) {
            orderPhone = order.customer_phone;
            orderCustomer = order.customer_name;
            orderPet = order.pet_name;
            const services = await DB.getServices();
            const service = services.find(s => s.id === order.service_id);
            orderServiceAr = service?.type_ar || '';
          }
        } catch (e) { /* non-blocking */ }

        btn.disabled = true;
        btn.textContent = '⏳ جاري الحفظ...';

        const duration = await DB.completeOrderEmployee(orderId, this._employee.id);
        if (duration !== null) {
          showToast(`🏁 أحسنت! تم الإنجاز بنجاح (${duration} دقيقة)`, 'success');
          playNotificationSound();

          // Send WhatsApp "task completed" notification (non-blocking, logged)
          if (orderPhone) {
            WhatsApp.sendTaskCompleted(orderPhone, orderCustomer, orderPet, orderServiceAr, duration, orderId).catch(() => { });
            // Schedule feedback request 1 hour later (handled by pg_cron + edge function)
            WhatsApp.scheduleFeedbackRequest({
              phone: orderPhone,
              customerName: orderCustomer,
              petName: orderPet,
              serviceNameAr: orderServiceAr,
              orderId,
              delayMinutes: 60
            }).catch(() => { });
          }
        } else {
          showToast('❌ حدث خطأ، حاول مرة أخرى', 'error');
        }
        await this._buildTasksUI($('#app'));
        this._startTimers();
      });
    });
  },

  _startTimers() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      $$('.order-timer').forEach(timer => {
        const start = timer.dataset.timerStart;
        if (start) {
          timer.querySelector('.timer-display').textContent = elapsedTimer(start);
        }
      });
    }, 1000);
  },

  _startAutoRefresh(container) {
    this._stopAutoRefresh();
    this._refreshInterval = setInterval(async () => {
      if (Router.currentView !== 'employee' || !this._employee) return;
      try {
        const orders = await DB.getEmployeeOrders(this._employee.id);
        const currentCount = orders.filter(o => o.status === 'assigned').length;

        if (currentCount > this._lastOrderCount && this._lastOrderCount >= 0) {
          playNotificationSound();
          showToast('📩 مهمة جديدة وصلت!', 'info');
          await this._buildTasksUI($('#app'));
          this._startTimers();
        }
        this._lastOrderCount = currentCount;
      } catch (err) {
        console.warn('Employee auto-refresh error:', err);
      }
    }, 8000);
  },

  _stopAutoRefresh() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
  }
};


// ==========================================
// DASHBOARD VIEW
// ==========================================
const DashboardView = {
  period: 'all',
  charts: {},

  async render(container) {
    this.period = 'all';
    showLoading(container);
    await this._buildUI(container);
  },

  async _buildUI(container) {
    const stats = await DB.getStats(this.period);
    const weeklyData = await DB.getWeeklyData();

    let html = `
      <div class="page-header animate-in" style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h1>📊 التقارير والإحصائيات</h1>
          <p>تحليل أداء قسم الحلاقة والتحميم</p>
        </div>
        <button class="btn btn-danger" id="delete-all-data-btn" title="حذف جميع السجلات من قاعدة البيانات">
          🗑️ تصفير كل البيانات
        </button>
      </div>
    `;

    // Period filter
    html += `
      <div class="tab-filter animate-in-delay-1">
        <button class="tab-filter-btn ${this.period === 'today' ? 'active' : ''}" data-period="today">اليوم</button>
        <button class="tab-filter-btn ${this.period === 'week' ? 'active' : ''}" data-period="week">الأسبوع</button>
        <button class="tab-filter-btn ${this.period === 'month' ? 'active' : ''}" data-period="month">الشهر</button>
        <button class="tab-filter-btn ${this.period === 'all' ? 'active' : ''}" data-period="all">الكل</button>
      </div>
    `;

    // Stats cards
    html += `
      <div class="stats-grid animate-in-delay-1">
        <div class="stat-card purple">
          <span class="stat-icon"><img src="assets/alkokh_icons/customers.png" alt="services"></span>
          <div class="stat-value">${stats.total}</div>
          <div class="stat-label">إجمالي الخدمات</div>
        </div>
        <div class="stat-card blue">
          <span class="stat-icon"><img src="assets/alkokh_icons/haircut.png" alt="grooming"></span>
          <div class="stat-value">${stats.grooming}</div>
          <div class="stat-label">حلاقة</div>
        </div>
        <div class="stat-card green">
          <span class="stat-icon"><img src="assets/alkokh_icons/bath.png" alt="bath"></span>
          <div class="stat-value">${stats.bath}</div>
          <div class="stat-label">تحميم</div>
        </div>
        <div class="stat-card gold">
          <span class="stat-icon"><img src="assets/alkokh_icons/customers.png" alt="customers"></span>
          <div class="stat-value">${stats.uniqueCustomers}</div>
          <div class="stat-label">زبائن فريدين</div>
        </div>
      </div>
    `;

    // Charts
    html += `
      <div class="grid-2 animate-in-delay-2">
        <div class="chart-card">
          <div class="chart-title">📈 الأداء الأسبوعي</div>
          <div class="chart-container">
            <canvas id="weekly-chart"></canvas>
          </div>
        </div>
        <div class="chart-card">
          <div class="chart-title">🍩 نسبة الحلاقة مقابل التحميم</div>
          <div class="chart-container">
            <canvas id="ratio-chart"></canvas>
          </div>
        </div>
      </div>
    `;

    // Employee workload chart
    html += `
      <div class="chart-card animate-in-delay-3">
        <div class="chart-title">👤 عدد الحالات لكل موظف</div>
        <div class="chart-container">
          <canvas id="employee-chart"></canvas>
        </div>
      </div>
    `;

    // Employee leaderboard
    html += `
      <div class="chart-card animate-in-delay-3">
        <div class="chart-title">🏆 ترتيب الموظفين</div>
        <div class="leaderboard">
    `;

    const rankClasses = ['gold', 'silver', 'bronze', 'default'];
    stats.employeeStats.forEach((emp, idx) => {
      const maxCount = stats.employeeStats[0]?.count || 1;
      const pct = maxCount > 0 ? Math.round((emp.count / maxCount) * 100) : 0;
      html += `
        <div class="leaderboard-item">
          <div class="leaderboard-rank ${rankClasses[idx] || 'default'}">${idx + 1}</div>
          <div class="employee-avatar" style="background:${emp.avatar_color}">${emp.name_ar.charAt(0)}</div>
          <div class="leaderboard-info">
            <div class="leaderboard-name">${emp.name_ar}</div>
            <div class="leaderboard-spec">${emp.specialization === 'groomer' ? 'حلاّق' : 'مُحمِّم'} · ${emp.avgDuration || 0} دقيقة متوسط</div>
            <div class="progress-bar-container">
              <div class="progress-bar-fill" style="width:${pct}%"></div>
            </div>
          </div>
          <div style="text-align:center;">
            <div class="leaderboard-count">${emp.count}</div>
            <div class="leaderboard-label">خدمة</div>
          </div>
        </div>
      `;
    });

    html += `</div></div>`;

    // WhatsApp notification logs section
    const notifStats = await DB.getNotificationStats();
    const recentLogs = await DB.getRecentNotificationLogs(20, this._logsFilter || 'all');
    html += `
      <div class="section-divider"></div>
      <div class="chart-card animate-in-delay-3">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div class="chart-title" style="margin:0;">📱 سجل رسائل الواتساب</div>
          <div style="display:flex; gap:8px;">
            <span class="badge badge-success">نجح: ${notifStats.success}</span>
            <span class="badge badge-danger">فشل: ${notifStats.failed}</span>
            <span class="badge badge-warning">قيد الإرسال: ${notifStats.pending}</span>
          </div>
        </div>

        <div class="tab-filter" style="margin-bottom:14px;">
          <button class="tab-filter-btn ${(this._logsFilter || 'all') === 'all' ? 'active' : ''}" data-logs-filter="all">الكل</button>
          <button class="tab-filter-btn ${this._logsFilter === 'success' ? 'active' : ''}" data-logs-filter="success">ناجحة</button>
          <button class="tab-filter-btn ${this._logsFilter === 'failed' ? 'active' : ''}" data-logs-filter="failed">فاشلة</button>
          <button class="tab-filter-btn ${this._logsFilter === 'pending' ? 'active' : ''}" data-logs-filter="pending">قيد الإرسال</button>
        </div>

        <div style="overflow-x:auto;">
          <table class="notif-logs-table" style="width:100%; border-collapse:collapse; font-size:0.88rem;">
            <thead>
              <tr style="background:rgba(0,0,0,0.04);">
                <th style="padding:8px; text-align:right;">الوقت</th>
                <th style="padding:8px; text-align:right;">الزبون</th>
                <th style="padding:8px; text-align:right;">الرقم</th>
                <th style="padding:8px; text-align:right;">النوع</th>
                <th style="padding:8px; text-align:right;">الحالة</th>
                <th style="padding:8px; text-align:right;">المحاولات</th>
                <th style="padding:8px; text-align:right;">الخطأ</th>
                <th style="padding:8px; text-align:right;">إجراء</th>
              </tr>
            </thead>
            <tbody>
    `;

    if (recentLogs.length === 0) {
      html += `<tr><td colspan="8" style="padding:16px; text-align:center; opacity:0.6;">لا توجد سجلات حالياً</td></tr>`;
    } else {
      const eventLabels = {
        booking_confirmation: '✅ حجز',
        task_started: '🚀 بدء العمل',
        task_completed: '🏁 إكمال',
        feedback_request: '⭐ تقييم'
      };
      const statusLabels = {
        success: '<span style="color:#10b981;">✅ نجح</span>',
        failed: '<span style="color:#ef4444;">❌ فشل</span>',
        pending: '<span style="color:#f59e0b;">⏳ قيد الإرسال</span>'
      };
      recentLogs.forEach(log => {
        const dt = new Date(log.created_at).toLocaleString('ar-IQ', { hour12: false });
        const errShort = (log.error_message || '').substring(0, 60);
        html += `
          <tr style="border-bottom:1px solid rgba(0,0,0,0.06);">
            <td style="padding:8px; white-space:nowrap;">${dt}</td>
            <td style="padding:8px;">${log.customer_name || '-'}</td>
            <td style="padding:8px; direction:ltr; text-align:right;">${log.phone}</td>
            <td style="padding:8px;">${eventLabels[log.event_type] || log.event_type}</td>
            <td style="padding:8px;">${statusLabels[log.status] || log.status}</td>
            <td style="padding:8px; text-align:center;">${log.attempt_count || 0}</td>
            <td style="padding:8px; font-size:0.78rem; color:#666; max-width:200px;">${errShort}${errShort.length >= 60 ? '…' : ''}</td>
            <td style="padding:8px;">
              ${log.status === 'failed' ? `<button class="btn btn-sm" data-resend-log="${log.id}">↻ إعادة</button>` : ''}
            </td>
          </tr>
        `;
      });
    }

    html += `
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Reminder templates section
    html += `
      <div class="section-divider"></div>
      <div class="animate-in-delay-3">
        <div class="chart-title" style="font-size:1.1rem; margin-bottom:20px;">💬 قوالب الرسائل الذكية</div>
        
        <div class="reminder-card">
          <h4>✨ رسالة بعد الخدمة</h4>
          <div class="reminder-text">نعيماً لـ [اسم الحيوان]! 🐾✨
صار يلمع وريحته حلوة!
تذكّر دكتور الكوخ ينصح بتمشيط شعره يومياً للحفاظ على نعومته.
مع تحيات عيادة الكوخ البيطرية 🏠💜</div>
        </div>

        <div class="reminder-card">
          <h4>📅 تذكير ذكي (بعد 4 أسابيع)</h4>
          <div class="reminder-text">أهلاً أستاذ [اسم الزبون] 👋
مرّ شهر على آخر حلاقة لـ [اسم الحيوان].
الشعر بدأ يطول وممكن يتشربك!
تحب نحجز لك موعد تحديث؟ 🐾
عيادة الكوخ البيطرية 🏠💜</div>
        </div>

        <div class="reminder-card">
          <h4>🌡️ تنبيه صحي ذكي (Pet Grooming Health Score)</h4>
          <div class="reminder-text">🌡️ تنبيه صحي ذكي:
بناءً على نوع شعر كلبك ([نوع الشعر]) والجو الحار حالياً في بغداد (٤٥°),
ننصح بتحميم طبي الأسبوع القادم للحفاظ على برودة جسمه وصحة جلده.
تحب نثبت الموعد؟ 💊🛁
عيادة الكوخ البيطرية — نهتم بصحة رفيقك 🏠💜</div>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Bind period filter (only top filter, not logs filter)
    container.querySelectorAll('.tab-filter-btn[data-period]').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.period = btn.dataset.period;
        showLoading($('#app'));
        await this._buildUI($('#app'));
      });
    });

    // Bind logs filter
    container.querySelectorAll('[data-logs-filter]').forEach(btn => {
      btn.addEventListener('click', async () => {
        this._logsFilter = btn.dataset.logsFilter;
        showLoading($('#app'));
        await this._buildUI($('#app'));
      });
    });

    // Bind resend buttons
    container.querySelectorAll('[data-resend-log]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const logId = btn.dataset.resendLog;
        btn.disabled = true;
        btn.textContent = '⏳';
        const ok = await DB.resendNotification(logId);
        if (ok) {
          showToast('✅ تم إعادة الإرسال', 'success');
        } else {
          showToast('❌ فشل إعادة الإرسال', 'error');
        }
        showLoading($('#app'));
        await this._buildUI($('#app'));
      });
    });

    // Bind delete all data
    const deleteAllBtn = container.querySelector('#delete-all-data-btn');
    if (deleteAllBtn) {
      deleteAllBtn.addEventListener('click', async () => {
        if (!confirm('⚠️ تحذير خطير: هل أنت متأكد من حذف *جميع* السجلات والطلبات السابقة من قاعدة البيانات بشكل نهائي؟ هذا الإجراء لا يمكن التراجع عنه.')) return;
        if (!confirm('تأكيد أخير: حذف كل البيانات؟')) return;

        deleteAllBtn.disabled = true;
        deleteAllBtn.textContent = 'جاري الحذف...';

        await DB.deleteAllOrders();
        showToast('تم تصفير جميع السجلات بنجاح 🗑️', 'success');

        showLoading($('#app'));
        await this._buildUI($('#app'));
      });
    }

    // Lazy-load Chart.js then render
    loadChartJs().then(() => {
      requestAnimationFrame(() => this._renderCharts(stats, weeklyData));
    }).catch(err => console.warn('Chart.js load failed:', err));
  },

  _renderCharts(stats, weeklyData) {
    if (typeof Chart === 'undefined') { console.warn('Chart.js not loaded yet'); return; }
    // Destroy existing charts
    Object.values(this.charts).forEach(c => c.destroy?.());
    this.charts = {};

    const chartFont = { family: "'Tajawal', sans-serif" };

    // Weekly performance chart
    const weeklyCtx = document.getElementById('weekly-chart');
    if (weeklyCtx) {
      this.charts.weekly = new Chart(weeklyCtx, {
        type: 'bar',
        data: {
          labels: weeklyData.labels,
          datasets: [
            {
              label: 'حلاقة',
              data: weeklyData.groomingData,
              backgroundColor: 'rgba(192, 38, 211, 0.7)',
              borderColor: 'rgba(192, 38, 211, 1)',
              borderWidth: 1,
              borderRadius: 6,
            },
            {
              label: 'تحميم',
              data: weeklyData.bathData,
              backgroundColor: 'rgba(16, 185, 129, 0.7)',
              borderColor: 'rgba(16, 185, 129, 1)',
              borderWidth: 1,
              borderRadius: 6,
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              labels: { font: { ...chartFont, weight: '600' }, padding: 16 }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { stepSize: 1, font: chartFont },
              grid: { color: 'rgba(0,0,0,0.05)' }
            },
            x: {
              ticks: { font: chartFont },
              grid: { display: false }
            }
          }
        }
      });
    }

    // Ratio donut chart
    const ratioCtx = document.getElementById('ratio-chart');
    if (ratioCtx) {
      const hasData = stats.grooming > 0 || stats.bath > 0;
      this.charts.ratio = new Chart(ratioCtx, {
        type: 'doughnut',
        data: {
          labels: ['حلاقة', 'تحميم'],
          datasets: [{
            data: hasData ? [stats.grooming, stats.bath] : [1, 1],
            backgroundColor: [
              'rgba(192, 38, 211, 0.8)',
              'rgba(16, 185, 129, 0.8)'
            ],
            borderColor: ['#fff', '#fff'],
            borderWidth: 3,
            hoverOffset: 10,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '65%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { font: { ...chartFont, weight: '600' }, padding: 20 }
            }
          }
        }
      });
    }

    // Employee workload bar chart
    const empCtx = document.getElementById('employee-chart');
    if (empCtx) {
      this.charts.employee = new Chart(empCtx, {
        type: 'bar',
        data: {
          labels: stats.employeeStats.map(e => e.name_ar),
          datasets: [{
            label: 'عدد الخدمات',
            data: stats.employeeStats.map(e => e.count),
            backgroundColor: stats.employeeStats.map(e => e.avatar_color + 'CC'),
            borderColor: stats.employeeStats.map(e => e.avatar_color),
            borderWidth: 2,
            borderRadius: 8,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: {
              beginAtZero: true,
              ticks: { stepSize: 1, font: chartFont },
              grid: { color: 'rgba(0,0,0,0.05)' }
            },
            y: {
              ticks: { font: { ...chartFont, weight: '700', size: 14 } },
              grid: { display: false }
            }
          }
        }
      });
    }
  }
};


// ==========================================
// AUTO-REFRESH (Operator view auto-updates)
// ==========================================
let autoRefreshInterval = null;
let _lastWaitingCount = 0;

function startAutoRefresh() {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  autoRefreshInterval = setInterval(async () => {
    if (Router.currentView === 'operator' && Auth.isAuthenticated()) {
      try {
        const orders = await DB.getOrders();
        const actualWaiting = orders.filter(o => o.status === 'waiting').length;

        if (actualWaiting > _lastWaitingCount && _lastWaitingCount > 0) {
          playNotificationSound();
          showToast('🆕 طلب جديد في قائمة الانتظار!', 'info');
          await OperatorView._buildUI($('#app'));
          OperatorView._startTimers();
        }
        _lastWaitingCount = actualWaiting;
      } catch (err) {
        console.warn('Auto-refresh error:', err);
      }
    }
  }, 5000);
}


// ==========================================
// LAZY LOADERS
// ==========================================
let _chartJsPromise = null;
function loadChartJs() {
  if (typeof Chart !== 'undefined') return Promise.resolve();
  if (_chartJsPromise) return _chartJsPromise;
  _chartJsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Chart.js load failed'));
    document.head.appendChild(s);
  });
  return _chartJsPromise;
}

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
  return ({ waiting: 'بانتظار القبول', in_progress: 'قيد المعالجة', completed: 'مكتملة', cancelled: 'ملغاة' }[status] || status);
}
function playNotifSound() {
  try { const a = document.getElementById('notification-sound'); if (a) { a.currentTime = 0; a.play().catch(() => { }); } } catch { }
}


// =============================================================
// LANDING VIEW — two entry points (medical / grooming)
// =============================================================
const LandingView = {
  async render(container) {
    container.innerHTML = `
      <div class="home-view animate-in">

        <div class="home-hero">
          <div class="home-hero-inner">
            <img src="assets/logo.svg" alt="الكوخ" class="home-logo">
            <div class="home-hero-text">
              <h1 class="home-clinic-name">عيادة الكوخ البيطرية</h1>
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
          <a href="#grooming" class="home-service-card service-grooming">
            <div class="service-glow"></div>
            <div class="service-icon">✂️</div>
            <h2 class="service-title">الحلاقة والتحميم</h2>
            <p class="service-desc">خدمات تجميل وتحميم احترافية تحافظ على صحة ونظافة حيوانك الأليف</p>
            <span class="service-cta">احجز موعد ←</span>
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
        // 4. send whatsapp confirmation
        WhatsApp.sendViaEdgeFunction({
          phone,
          customerName: customer_name,
          serviceName: 'استشارة طبية',
          petName: pet_name || animal_type,
          eventType: 'intake_received',
          orderId: null,
        }).catch(err => console.warn('intake whatsapp failed:', err));

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
            link.download = `alkokh-${qrTarget.replace('/', '-')}.png`;
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
          // notify customer
          const visit = await DB.getVisitById(visitId);
          WhatsApp.sendViaEdgeFunction({
            phone: visit.intake_phone,
            customerName: visit.intake_customer_name,
            serviceName: `استلم حالتك د. ${Auth.getDoctor().display_name}`,
            petName: visit.patients?.name || visit.intake_animal_type,
            eventType: 'doctor_patient_accepted',
            orderId: null,
          }).catch(() => { });
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
            ${visit.status === 'in_progress' && canEdit ? `<button class="btn btn-success" id="complete-visit-btn">✅ إنهاء الحالة</button>` : ''}
            ${visit.status === 'waiting' ? `<button class="btn btn-primary" id="accept-visit-btn">قبول الحالة</button>` : ''}
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
                  <button type="submit" class="btn btn-primary">💾 حفظ</button>
                </div>
              ` : '<p class="muted">عرض فقط (لست من الأطباء المسموح لهم بتعديل هذه الحالة).</p>'}
            </form>
            <div id="ai-result" class="ai-result" style="display:none;"></div>
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
                    <input type="time" class="doctor-custom-input doctor-time-input" name="scheduled_time" style="padding: 10px; font-size: 0.9rem;" required>
                  </div>
                </div>

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
                    <span class="appt-status-pill">${({ pending: 'معلق', reminded: 'تم التذكير', attended: 'حضر', missed: 'فوّت', cancelled: 'ملغى' }[a.status] || a.status)}</span>
                  </div>
                  ${canEdit && a.status !== 'attended' && a.status !== 'cancelled' ? `
                    <div class="appt-actions">
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
          showToast('✅ تم قبول الحالة', 'success');
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

    // add appointment
    const apptForm = document.getElementById('add-appt-form');
    if (apptForm) {
      apptForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(apptForm);
        const rawDate = fd.get('scheduled_date');
        const rawTime = fd.get('scheduled_time');
        if (!rawDate || !rawTime) return;
        const scheduled_at = new Date(`${rawDate}T${rawTime}`).toISOString();
        try {
          await DB.addAppointment({
            visit_id: visit.id,
            patient_id: visit.patient_id,
            scheduled_at,
            purpose: fd.get('purpose') || null,
            created_by: doctor.id,
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
        <p class="muted" style="text-align:center; margin-bottom:8px;">إحصائيات شاملة لكل أقسام العيادة</p>
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

    // Orders / employees breakdown
    const orders = stats.orders || [];
    const empMap = {};
    (stats.employees || []).forEach(e => empMap[e.id] = e.name_ar || '—');
    const ordersByStatus = {}, ordersByService = {}, ordersByEmployee = {};
    let totalDuration = 0, durationCount = 0;
    for (const o of orders) {
      ordersByStatus[o.status] = (ordersByStatus[o.status] || 0) + 1;
      const svc = o.services?.type_ar || '—';
      ordersByService[svc] = (ordersByService[svc] || 0) + 1;
      if (o.employee_id) {
        const n = empMap[o.employee_id] || '—';
        ordersByEmployee[n] = (ordersByEmployee[n] || 0) + 1;
      }
      if (o.duration_actual) { totalDuration += o.duration_actual; durationCount++; }
    }
    const avgDuration = durationCount ? Math.round(totalDuration / durationCount) : 0;

    const topDoctor = Object.entries(byDoctor).sort((a, b) => b[1] - a[1])[0];
    const topSymptom = Object.entries(bySymptom).sort((a, b) => b[1] - a[1])[0];
    const topEmployee = Object.entries(ordersByEmployee).sort((a, b) => b[1] - a[1])[0];

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

      <h2 style="color:var(--white); margin:24px 0 8px;">✂️ قسم التنظيف والتحميم</h2>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-num">${orders.length}</div><div class="stat-label">إجمالي الطلبات</div></div>
        <div class="stat-card"><div class="stat-num">${ordersByStatus.completed || 0}</div><div class="stat-label">مكتملة</div></div>
        <div class="stat-card"><div class="stat-num">${(ordersByStatus.in_progress || 0) + (ordersByStatus.assigned || 0)}</div><div class="stat-label">قيد التنفيذ</div></div>
        <div class="stat-card"><div class="stat-num">${avgDuration}<span style="font-size:0.6em;"> د</span></div><div class="stat-label">متوسط المدة</div></div>
      </div>
      <div class="stats-two-col">
        <div class="stat-panel">
          <h3>🏆 الموظف المميز</h3>
          <p>${topEmployee ? `${escHtml(topEmployee[0])} — ${topEmployee[1]} طلب` : '—'}</p>
          <h4>طلبات لكل موظف</h4>
          ${ReportsCommon.bar(ordersByEmployee) || '<p class="muted">لا بيانات</p>'}
        </div>
        <div class="stat-panel">
          <h3>📋 توزيع الخدمات</h3>
          ${ReportsCommon.bar(ordersByService) || '<p class="muted">لا بيانات</p>'}
        </div>
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
// EMPLOYEES MANAGEMENT VIEW (Unified)
// ==========================================
const EmployeesManagementView = {
  async render(container) {
    // Role dispatch: doctors land on their dashboard, admins on the management list,
    // otherwise show a friendly "no permissions" message.
    if (Auth.isDoctor() && !Auth.isClinicAdmin()) {
      window.location.hash = '#doctor';
      return;
    }
    if (!Auth.isClinicAdmin()) {
      // Redirect to login panel to allow proper authentication
      LoginView.render(container, 'employees');
      return;
    }

    showLoading(container);

    // Run both queries in parallel to halve load time
    const [doctors, employees] = await Promise.all([DB.getAllDoctors(), DB.getEmployees()]);

    // Group employees by specialization
    const groomers = employees.filter(e => e.specialization === 'groomer');
    const bathers = employees.filter(e => e.specialization === 'bather');

    let html = `
      <div class="page-header animate-in" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
        <div>
          <h1>👥 إدارة الموظفين</h1>
          <p>الأطباء والمسؤولين عن الحلاقة والتحميم</p>
        </div>
        <button class="btn btn-primary" id="add-employee-btn">➕ إضافة موظف</button>
      </div>
    `;

    // === DOCTORS SECTION ===
    html += `
      <div class="employees-section animate-in-delay-1">
        <h2 class="section-title">🩺 الأطباء</h2>
        <div class="employees-grid">
    `;

    if (doctors.length === 0) {
      html += `<div style="grid-column:1/-1; text-align:center; padding:32px; opacity:0.6;">لا يوجد أطباء حالياً</div>`;
    } else {
      doctors.forEach(doc => {
        html += this._renderEmployeeCard(doc, 'doctor');
      });
    }

    html += `</div></div>`;

    // === GROOMERS SECTION ===
    html += `
      <div class="employees-section animate-in-delay-2">
        <h2 class="section-title">✂️ الحلاقين</h2>
        <div class="employees-grid">
    `;

    if (groomers.length === 0) {
      html += `<div style="grid-column:1/-1; text-align:center; padding:32px; opacity:0.6;">لا يوجد حلاقين حالياً</div>`;
    } else {
      groomers.forEach(emp => {
        html += this._renderEmployeeCard(emp, 'groomer');
      });
    }

    html += `</div></div>`;

    // === BATHERS SECTION ===
    html += `
      <div class="employees-section animate-in-delay-3">
        <h2 class="section-title">🛁 المحممين</h2>
        <div class="employees-grid">
    `;

    if (bathers.length === 0) {
      html += `<div style="grid-column:1/-1; text-align:center; padding:32px; opacity:0.6;">لا يوجد محممين حالياً</div>`;
    } else {
      bathers.forEach(emp => {
        html += this._renderEmployeeCard(emp, 'bather');
      });
    }

    html += `</div></div>`;

    container.innerHTML = html;
    this._bindEvents(container);
  },

  _renderEmployeeCard(emp, type) {
    const initials = emp.name_ar?.substring(0, 2) || emp.display_name?.substring(0, 2) || '??';
    const isActive = emp.is_active !== false;
    const isDoctor = type === 'doctor';
    const isAdmin = isDoctor && emp.is_admin;

    const statusText = isActive ? 'نشط ✅' : 'معطل ⚠️';
    const statusColor = isActive ? '#10b981' : '#ef4444';

    let typeLabel = '👤 موظف';
    if (isDoctor) typeLabel = '🩺 طبيب';
    else if (type === 'groomer') typeLabel = '✂️ حلاق';
    else if (type === 'bather') typeLabel = '🛁 المحمم';

    return `
      <div class="employee-card" data-id="${emp.id}" data-type="${type}">
        <div class="employee-card-header">
          <div class="employee-avatar" style="background:${emp.avatar_color || '#9333ea'};">
            ${initials}
          </div>
          <div class="employee-info">
            <h3 class="employee-name">${emp.name_ar || emp.display_name || 'غير معروف'}</h3>
            <p class="employee-type">${typeLabel}</p>
            ${isAdmin ? '<span class="badge badge-admin">👑 مدير</span>' : ''}
            <span class="badge" style="background:${statusColor}30; color:${statusColor}; border:1px solid ${statusColor};">${statusText}</span>
          </div>
        </div>
        
        <div class="employee-card-body">
          ${isDoctor ? `
            <div class="employee-field">
              <label>التخصص الطبي</label>
              <p>${emp.specialization || 'عام'}</p>
            </div>
            <div class="employee-field">
              <label>البريد الإلكتروني</label>
              <p dir="ltr">${emp.email || '-'}</p>
            </div>
            ${emp.phone ? `
              <div class="employee-field">
                <label>الهاتف</label>
                <p dir="ltr">${emp.phone}</p>
              </div>
            ` : ''}
          ` : `
            <div class="employee-field">
              <label>البريد الإلكتروني</label>
              <p dir="ltr">${emp.email || '-'}</p>
            </div>
            <div class="employee-field">
              <label>كلمة المرور</label>
              <p>••••••••</p>
            </div>
          `}
        </div>
        
        <div class="employee-card-actions">
          <button class="btn btn-sm btn-secondary edit-btn" data-id="${emp.id}" data-type="${type}">
            ✏️ تعديل
          </button>
          <button class="btn btn-sm ${isActive ? 'btn-warning' : 'btn-success'} toggle-status-btn" data-id="${emp.id}" data-type="${type}" data-active="${isActive}">
            ${isActive ? '🔴 تعطيل' : '🟢 تفعيل'}
          </button>
          <button class="btn btn-sm btn-danger delete-btn" data-id="${emp.id}" data-type="${type}">
            🗑️ حذف
          </button>
        </div>
      </div>
    `;
  },

  _bindEvents(container) {
    // Add Employee button
    container.querySelector('#add-employee-btn')?.addEventListener('click', () => {
      this._showAddEmployeeModal(container);
    });

    // Edit button
    container.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        showToast('📝 خاصية التعديل ستُضاف قريباً', 'info');
      });
    });

    // Toggle status button
    container.querySelectorAll('.toggle-status-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const type = btn.dataset.type;
        const isCurrentlyActive = btn.dataset.active === 'true';
        const newStatus = !isCurrentlyActive;
        if (!confirm(`هل تريد ${newStatus ? 'تفعيل' : 'تعطيل'} هذا الموظف؟`)) return;
        try {
          btn.disabled = true;
          if (type === 'doctor') {
            await DB.toggleDoctorActive(id, newStatus);
          } else {
            await supabaseClient.from('employees').update({ is_active: newStatus }).eq('id', id);
            DB._employeesCache = null;
          }
          showToast(`✅ تم ${newStatus ? 'تفعيل' : 'تعطيل'} الموظف`, 'success');
          await this.render(container);
        } catch (err) {
          console.error(err);
          showToast('❌ حدث خطأ', 'error');
          btn.disabled = false;
        }
      });
    });

    // Delete button
    container.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('⚠️ هل أنت متأكد من حذف هذا الموظف؟')) return;
        showToast('🔒 حذف الحسابات يتم من لوحة Supabase مباشرة.', 'warning');
      });
    });
  },

  _showAddEmployeeModal(container) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card animate-in" style="max-width:420px; width:90%;">
        <h2 style="margin-bottom:20px;">➕ إضافة موظف جديد</h2>
        <div id="emp-modal-error" class="login-alert" style="display:none; margin-bottom:12px;">
          <span>❌</span><span id="emp-modal-error-msg"></span>
        </div>
        <div class="form-group">
          <label class="form-label">الاسم بالعربي *</label>
          <input type="text" class="form-input" id="emp-name-ar" placeholder="مثال: أحمد علي">
        </div>
        <div class="form-group">
          <label class="form-label">الاسم بالإنجليزي</label>
          <input type="text" class="form-input" id="emp-name-en" placeholder="Ahmed Ali" dir="ltr">
        </div>
        <div class="form-group">
          <label class="form-label">التخصص *</label>
          <select class="form-input" id="emp-spec">
            <option value="groomer">✂️ حلاق</option>
            <option value="bather">🛁 محمم</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">البريد الإلكتروني *</label>
          <input type="email" class="form-input" id="emp-email" placeholder="ahmed@alkokh.com" dir="ltr">
        </div>
        <div class="form-group">
          <label class="form-label">كلمة المرور *</label>
          <input type="password" class="form-input" id="emp-password" placeholder="8 أحرف على الأقل" dir="ltr">
        </div>
        <div style="display:flex; gap:12px; margin-top:24px;">
          <button class="btn btn-primary btn-lg" id="emp-save-btn" style="flex:1;">
            <span id="emp-save-text">💾 حفظ</span>
            <span id="emp-save-loading" style="display:none;"><span class="btn-spinner"></span></span>
          </button>
          <button class="btn btn-ghost btn-lg" id="emp-cancel-btn" style="flex:1;">إلغاء</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#emp-cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#emp-save-btn').addEventListener('click', async () => {
      const nameAr = overlay.querySelector('#emp-name-ar').value.trim();
      const nameEn = overlay.querySelector('#emp-name-en').value.trim();
      const spec = overlay.querySelector('#emp-spec').value;
      const email = overlay.querySelector('#emp-email').value.trim();
      const password = overlay.querySelector('#emp-password').value;
      const errDiv = overlay.querySelector('#emp-modal-error');
      const errMsg = overlay.querySelector('#emp-modal-error-msg');

      if (!nameAr || !email || !password) {
        errDiv.style.display = 'flex';
        errMsg.textContent = 'الرجاء تعبئة جميع الحقول المطلوبة (*)';
        return;
      }
      if (password.length < 6) {
        errDiv.style.display = 'flex';
        errMsg.textContent = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
        return;
      }

      overlay.querySelector('#emp-save-text').style.display = 'none';
      overlay.querySelector('#emp-save-loading').style.display = 'inline';
      overlay.querySelector('#emp-save-btn').disabled = true;
      errDiv.style.display = 'none';

      try {
        const session = await supabaseClient.auth.getSession();
        const token = session.data.session?.access_token;
        const { data, error } = await supabaseClient.functions.invoke('create-employee', {
          body: { email, password, name_ar: nameAr, name_en: nameEn || nameAr, specialization: spec },
          headers: { Authorization: `Bearer ${token}` }
        });
        if (error || !data?.success) throw new Error(data?.error || error?.message || 'فشل الإنشاء');
        showToast(`✅ تم إنشاء حساب ${nameAr} بنجاح`, 'success');
        DB._employeesCache = null;
        overlay.remove();
        await this.render(container);
      } catch (err) {
        errDiv.style.display = 'flex';
        errMsg.textContent = err.message;
        overlay.querySelector('#emp-save-text').style.display = 'inline';
        overlay.querySelector('#emp-save-loading').style.display = 'none';
        overlay.querySelector('#emp-save-btn').disabled = false;
      }
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
  _filter: 'all', // all | medical | grooming | bath
  _query: '',

  async render(container) {
    container.innerHTML = `
      <div class="case-history-view animate-in" style="padding: 32px 24px; max-width: 1100px; margin: 0 auto;">
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;">
          <div style="font-size: 2.5rem;">📜</div>
          <div>
            <h1 style="color: var(--white); font-size: 1.8rem; margin: 0;">تاريخ الحالات</h1>
            <p style="color: var(--text-muted); margin: 4px 0 0;">ابحث في سجل الحالات الطبية ومهام التنظيف/التحميم</p>
          </div>
        </div>

        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(192,38,211,0.18); border-radius: 16px; padding: 16px; margin-bottom: 16px;">
          <input id="ch-search" type="search" placeholder="🔍 ابحث برقم الهاتف أو اسم الحيوان أو اسم صاحب الحيوان..." autocomplete="off"
            style="width:100%; padding:14px 16px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); background:rgba(0,0,0,0.3); color:var(--white); font-size:1rem; outline:none;">
          <div id="ch-filters" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;">
            <button class="ch-filter-btn active" data-filter="all" style="${this._btnStyle(true)}">الكل</button>
            <button class="ch-filter-btn" data-filter="medical" style="${this._btnStyle(false)}">🩺 طبية</button>
            <button class="ch-filter-btn" data-filter="grooming" style="${this._btnStyle(false)}">✂️ حلاقة</button>
            <button class="ch-filter-btn" data-filter="bath" style="${this._btnStyle(false)}">🛁 تحميم</button>
          </div>
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
    const kindBadge = it.kind === 'medical'
      ? '<span style="background:rgba(192,38,211,0.18); color:#e879f9; padding:4px 10px; border-radius:999px; font-size:0.8rem;">🩺 طبية</span>'
      : it.kind === 'bath'
      ? '<span style="background:rgba(56,189,248,0.18); color:#7dd3fc; padding:4px 10px; border-radius:999px; font-size:0.8rem;">🛁 تحميم</span>'
      : '<span style="background:rgba(245,158,11,0.18); color:#fcd34d; padding:4px 10px; border-radius:999px; font-size:0.8rem;">✂️ حلاقة</span>';

    const statusMap = { waiting: 'قيد الانتظار', assigned: 'مُسندة', in_progress: 'قيد المعالجة', completed: 'مكتملة', cancelled: 'ملغاة' };
    const statusLabel = statusMap[it.status] || it.status || '—';

    const collabsLine = it.collaborators?.length
      ? `<div style="color:var(--text-muted); font-size:0.85rem; margin-top:4px;">👥 أطباء مشاركون: ${it.collaborators.map(n => `د. ${escHtml(n)}`).join('، ')}</div>`
      : '';

    const detailsHref = it.kind === 'medical' && it.patient_id
      ? `<a href="#patient/${escHtml(it.patient_id)}" style="color:#c084fc; text-decoration:none; font-size:0.9rem;">عرض ملف الحيوان ←</a>`
      : '';

    const serviceLine = it.kind !== 'medical' && it.service_name
      ? `<div style="color:var(--text-muted); font-size:0.85rem;">الخدمة: ${escHtml(it.service_name)}${it.duration_actual ? ` • ${it.duration_actual} دقيقة` : ''}</div>`
      : '';

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

    // Start auto-refresh
    console.log('🔄 Starting auto-refresh...');
    startAutoRefresh();
    console.log('✅ Auto-refresh started');

    console.log('%c🐾 عيادة الكوخ البيطرية — نظام الحلاقة والتحميم', 'font-size:16px; font-weight:bold; color:#C026D3;');
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
