// Smart Secretary — محرك الأدوات التنفيذية للمساعد الذكي
// كل أداة ترتبط بوظائف النظام الحقيقية، تفحص صلاحيات المستخدم في الـ Backend،
// تمنع العمليات الوهمية، تطلب التأكيد للعمليات الحساسة، وتسجل في assistant_logs.
const { db, nextUniqueCode, canAI, AI_MODULES, AI_ACTIONS } = require('./db');
const AIP = require('./ai_permissions');
const { can, audit } = require('./auth');
const F = require('./finance_core');

const MODULE_NAMES_AR = {
  clients: 'العملاء',
  projects: 'المشاريع',
  units: 'الوحدات',
  reservations: 'الحجوزات',
  sales: 'المبيعات',
  finance: 'الدفعات والمقبوضات',
  payments: 'الدفعات والمقبوضات',
  expenses: 'المصروفات',
  accounts: 'الحسابات',
  reports: 'التقارير',
  tasks: 'المهام',
  appointments: 'المواعيد',
  suppliers: 'المزودين',
  notes: 'الملاحظات',
  calls: 'الاتصالات'
};

const ACTION_NAMES_AR = {
  view: 'عرض / قراءة',
  create: 'إضافة',
  edit: 'تعديل',
  delete: 'حذف',
  search: 'البحث في',
  execute: 'تنفيذ عمليات'
};

function formatMoney(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('en') + ' ر.س';
}

function logAssistantAction({ userId, username, actionType, inputParams, resultStatus, errorMessage = '', entity = '', entityId = null }) {
  try {
    const cleanParams = { ...(inputParams || {}) };
    delete cleanParams.password;
    delete cleanParams.token;
    delete cleanParams.api_key;
    db.prepare(`
      INSERT INTO assistant_logs (user_id, username, action_type, input_params, result_status, error_message, entity, entity_id)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      userId || null,
      username || '',
      actionType,
      JSON.stringify(cleanParams),
      resultStatus,
      errorMessage ? String(errorMessage).slice(0, 500) : '',
      entity,
      entityId
    );
  } catch (e) {
    console.error('[AssistantLog] failed to log:', e.message);
  }
}

// ---------------- تعريف الأدوات التنفيذية ----------------
const TOOLS = {
  // 1) البحث عن العملاء
  searchCustomers: {
    name: 'searchCustomers',
    title: 'البحث عن العملاء',
    description: 'البحث عن العملاء في النظام بالاسم، رقم الجوال، التصنيف، أو المدينة',
    module: 'clients',
    action: 'view',
    isSensitive: false,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'اسم العميل أو جزء منه، أو رقم الجوال' },
        category: { type: 'string', description: 'تصنيف العميل: buyer, seller, partner, broker' },
        limit: { type: 'number', description: 'الحد الأقصى للنتائج (الافتراضي 5)' }
      }
    },
    execute: async (params, user) => {
      const q = String(params.query || '').trim();
      const limit = Math.min(20, Math.max(1, Number(params.limit) || 5));
      let sql = `SELECT id, code, name, phone, email, category, status, city FROM clients WHERE deleted_at IS NULL`;
      const ps = [];
      if (q) {
        sql += ` AND (name LIKE ? OR phone LIKE ? OR code LIKE ?)`;
        const like = `%${q}%`;
        ps.push(like, like, like);
      }
      if (params.category) {
        sql += ` AND category=?`;
        ps.push(params.category);
      }
      sql += ` ORDER BY id DESC LIMIT ?`;
      ps.push(limit);
      const rows = db.prepare(sql).all(...ps);
      return {
        found: rows.length > 0,
        count: rows.length,
        customers: rows,
        message: rows.length ? `تم العثور على ${rows.length} عميل:` : 'لم يتم العثور على أي عميل يطابق البحث.'
      };
    }
  },

  // 2) عرض تفاصيل عميل
  getCustomer: {
    name: 'getCustomer',
    title: 'عرض بيانات عميل',
    description: 'عرض تفاصيل ملف عميل محدد مع ملخص معاملاته والمتبقي عليه',
    module: 'clients',
    action: 'view',
    isSensitive: false,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'معرف العميل' },
        query: { type: 'string', description: 'اسم العميل أو رقم هاتفه إذا لم يتوفر المعرف' }
      }
    },
    execute: async (params, user) => {
      let client = null;
      if (params.id) {
        client = db.prepare('SELECT * FROM clients WHERE id=? AND deleted_at IS NULL').get(params.id);
      } else if (params.query) {
        const q = String(params.query).trim();
        const matches = db.prepare('SELECT * FROM clients WHERE (name LIKE ? OR phone LIKE ? OR code=?) AND deleted_at IS NULL LIMIT 5').all(`%${q}%`, `%${q}%`, q);
        if (matches.length === 1) client = matches[0];
        else if (matches.length > 1) {
          return {
            found: true,
            ambiguous: true,
            matches: matches.map(c => ({ id: c.id, code: c.code, name: c.name, phone: c.phone })),
            message: `وجدت ${matches.length} عملاء يطابقون "${q}". يرجى تحديد العميل المطلوب بالاسم أو المعرف.`
          };
        }
      }
      if (!client) return { found: false, message: 'لم يتم العثور على العميل المطلوب.' };

      // إحصائيات العميل (تراعي صلاحية المالية والمبيعات)
      let financeData = null;
      if (can(user.perms, 'finance', 'view') || can(user.perms, 'sales', 'view')) {
        const sales = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(net_price),0) total FROM sales WHERE client_id=? AND status<>'cancelled'`).get(client.id);
        const payments = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) total FROM payments WHERE client_id=? AND status='confirmed'`).get(client.id);
        const reservations = db.prepare(`SELECT COUNT(*) c FROM reservations WHERE client_id=? AND status='active'`).get(client.id);
        const remaining = Math.max(0, (sales.total || 0) - (payments.total || 0));
        financeData = {
          sales_count: sales.c,
          total_sales: sales.total,
          payments_count: payments.c,
          total_paid: payments.total,
          active_reservations: reservations.c,
          remaining_balance: remaining
        };
      }

      return {
        found: true,
        customer: client,
        finance: financeData,
        message: `بيانات العميل: ${client.name} (${client.code}) — جوال: ${client.phone || 'غير مسجل'}`
      };
    }
  },

  // 3) إضافة عميل جديد
  createCustomer: {
    name: 'createCustomer',
    title: 'إضافة عميل جديد',
    description: 'تسجيل عميل جديد في قاعدة بيانات النظام',
    module: 'clients',
    action: 'create',
    isSensitive: true,
    parameters: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'اسم العميل الكامل' },
        phone: { type: 'string', description: 'رقم جوال العميل' },
        email: { type: 'string', description: 'البريد الإلكتروني' },
        category: { type: 'string', description: 'التصنيف: buyer, seller, partner, broker' },
        city: { type: 'string', description: 'المدينة' },
        notes: { type: 'string', description: 'ملاحظات' }
      }
    },
    execute: async (params, user) => {
      const name = String(params.name || '').trim();
      if (!name) throw new Error('اسم العميل مطلوب');
      const phone = String(params.phone || '').trim();
      const code = nextUniqueCode('CUSTOMER', 'clients', 'code');
      const info = db.prepare(`
        INSERT INTO clients (code, name, phone, email, category, city, notes, created_by, is_demo)
        VALUES (?,?,?,?,?,?,?,?,0)
      `).run(code, name, phone, params.email || '', params.category || 'buyer', params.city || 'جدة', params.notes || '', user.id);
      
      const newId = info.lastInsertRowid;
      audit(user, 'create', 'clients', 'client', newId, `إضافة عميل عبر المساعد: ${name} (${code})`);
      return {
        ok: true,
        id: newId,
        code,
        name,
        phone,
        message: `تم إضافة العميل بنجاح: ${name} بالكود ${code}`
      };
    }
  },

  // 4) تعديل بيانات عميل
  updateCustomer: {
    name: 'updateCustomer',
    title: 'تعديل بيانات عميل',
    description: 'تعديل بيانات عميل موجود مثل الهاتف أو البريد أو الملاحظات',
    module: 'clients',
    action: 'edit',
    isSensitive: true,
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'number', description: 'معرف العميل' },
        name: { type: 'string', description: 'اسم العميل' },
        phone: { type: 'string', description: 'رقم الجوال' },
        email: { type: 'string', description: 'البريد الإلكتروني' },
        city: { type: 'string', description: 'المدينة' },
        notes: { type: 'string', description: 'ملاحظات' }
      }
    },
    execute: async (params, user) => {
      const client = db.prepare('SELECT * FROM clients WHERE id=? AND deleted_at IS NULL').get(params.id);
      if (!client) throw new Error('العميل غير موجود');
      const updates = [];
      const ps = [];
      if (params.name) { updates.push('name=?'); ps.push(params.name); }
      if (params.phone !== undefined) { updates.push('phone=?'); ps.push(params.phone); }
      if (params.email !== undefined) { updates.push('email=?'); ps.push(params.email); }
      if (params.city !== undefined) { updates.push('city=?'); ps.push(params.city); }
      if (params.notes !== undefined) { updates.push('notes=?'); ps.push(params.notes); }
      if (!updates.length) return { ok: true, message: 'لا توجد تعديلات لتطبيقها.' };

      updates.push("updated_at=datetime('now','localtime')");
      ps.push(client.id);
      db.prepare(`UPDATE clients SET ${updates.join(', ')} WHERE id=?`).run(...ps);
      audit(user, 'update', 'clients', 'client', client.id, `تعديل بيانات العميل عبر المساعد: ${client.name}`);
      return {
        ok: true,
        id: client.id,
        message: `تم تحديث بيانات العميل ${client.name} بنجاح.`
      };
    }
  },

  // 5) البحث عن العقارات والوحدات
  searchProperties: {
    name: 'searchProperties',
    title: 'البحث عن العقارات والوحدات',
    description: 'البحث عن العقارات أو الوحدات المتاحة، بالرمز، المشروع، عدد الغرف، السعر، أو الحالة',
    module: 'units',
    action: 'view',
    isSensitive: false,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'كود الوحدة أو اسم المشروع' },
        rooms: { type: 'number', description: 'عدد الغرف (مثلاً 3 أو 4)' },
        max_price: { type: 'number', description: 'أقصى سعر' },
        status: { type: 'string', description: 'حالة الوحدة: available, reserved, sold' },
        type: { type: 'string', description: 'نوع الوحدة: apartment, villa, duplex, office' },
        limit: { type: 'number', description: 'الحد الأقصى للنتائج' }
      }
    },
    execute: async (params, user) => {
      let sql = `
        SELECT u.id, u.code, u.type, u.rooms, u.area, u.price, u.status,
               p.name project_name, p.city
        FROM units u
        JOIN projects p ON p.id = u.project_id
        WHERE u.deleted_at IS NULL
      `;
      const ps = [];
      if (params.query) {
        sql += ` AND (u.code LIKE ? OR p.name LIKE ?)`;
        ps.push(`%${params.query}%`, `%${params.query}%`);
      }
      if (params.rooms) {
        sql += ` AND u.rooms = ?`;
        ps.push(Number(params.rooms));
      }
      if (params.max_price) {
        sql += ` AND u.price <= ?`;
        ps.push(Number(params.max_price));
      }
      if (params.status) {
        sql += ` AND u.status = ?`;
        ps.push(params.status);
      } else {
        // الافتراضي للبحث العام: المتاح أو إعادة البيع
        sql += ` AND u.status IN ('available', 'resale')`;
      }
      if (params.type) {
        sql += ` AND u.type = ?`;
        ps.push(params.type);
      }

      const limit = Math.min(20, Math.max(1, Number(params.limit) || 6));
      sql += ` ORDER BY u.price ASC LIMIT ?`;
      ps.push(limit);

      const rows = db.prepare(sql).all(...ps);
      return {
        found: rows.length > 0,
        count: rows.length,
        properties: rows,
        message: rows.length
          ? `وجدت ${rows.length} وحدة مناسبة:`
          : 'لم يتم العثور على عقارات تطابق هذه المواصفات.'
      };
    }
  },

  // البحث عن المشاريع
  searchProjects: {
    name: 'searchProjects',
    title: 'البحث عن المشاريع',
    description: 'البحث في قائمة المشاريع العقارية بالاسم أو الرمز أو المدينة',
    module: 'projects',
    action: 'search',
    isSensitive: false,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'اسم المشروع أو المدينة أو الرمز' },
        limit: { type: 'number', description: 'عدد النتائج' }
      }
    },
    execute: async (params, user) => {
      let sql = `SELECT id, code, name, city, status, total_units, available_units FROM projects WHERE deleted_at IS NULL`;
      const ps = [];
      if (params.query) {
        sql += ` AND (name LIKE ? OR code LIKE ? OR city LIKE ?)`;
        ps.push(`%${params.query}%`, `%${params.query}%`, `%${params.query}%`);
      }
      sql += ` ORDER BY id DESC LIMIT ${Number(params.limit) || 10}`;
      const rows = db.prepare(sql).all(...ps);
      return {
        count: rows.length,
        projects: rows,
        message: rows.length ? `تم العثور على ${rows.length} مشروع:` : 'لم يتم العثور على مشاريع مطابقة.'
      };
    }
  },

  // البحث عن المزودين
  searchSuppliers: {
    name: 'searchSuppliers',
    title: 'البحث عن المزودين',
    description: 'البحث في قائمة المزودين بالاسم أو الكود أو النوع',
    module: 'suppliers',
    action: 'search',
    isSensitive: false,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'اسم المزود أو الرمز' },
        limit: { type: 'number', description: 'عدد النتائج' }
      }
    },
    execute: async (params, user) => {
      let sql = `SELECT id, code, name, ptype, enabled FROM ai_providers WHERE 1=1`;
      const ps = [];
      if (params.query) {
        sql += ` AND (name LIKE ? OR code LIKE ? OR ptype LIKE ?)`;
        ps.push(`%${params.query}%`, `%${params.query}%`, `%${params.query}%`);
      }
      sql += ` ORDER BY id DESC LIMIT ${Number(params.limit) || 10}`;
      const rows = db.prepare(sql).all(...ps);
      return {
        count: rows.length,
        suppliers: rows,
        message: rows.length ? `تم العثور على ${rows.length} مزود:` : 'لم يتم العثور على مزودين مطابقين.'
      };
    }
  },

  // 6) تفاصيل عقار / وحدة
  getProperty: {
    name: 'getProperty',
    title: 'تفاصيل العقار',
    description: 'جلب التفاصيل الكاملة لعقار أو وحدة محددة برقمها أو كودها',
    module: 'units',
    action: 'view',
    isSensitive: false,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'معرف الوحدة' },
        code: { type: 'string', description: 'كود أو رقم الوحدة (مثل 101-A1 أو 25)' }
      }
    },
    execute: async (params, user) => {
      let unit = null;
      if (params.id) {
        unit = db.prepare(`
          SELECT u.*, p.name project_name, p.city, p.address
          FROM units u JOIN projects p ON p.id=u.project_id
          WHERE u.id=? AND u.deleted_at IS NULL
        `).get(params.id);
      } else if (params.code) {
        const c = String(params.code).trim();
        const matches = db.prepare(`
          SELECT u.*, p.name project_name, p.city, p.address
          FROM units u JOIN projects p ON p.id=u.project_id
          WHERE (u.code=? OR u.code LIKE ? OR u.id=?) AND u.deleted_at IS NULL
          LIMIT 5
        `).all(c, `%${c}%`, /^\d+$/.test(c) ? Number(c) : -1);
        if (matches.length === 1) unit = matches[0];
        else if (matches.length > 1) {
          return {
            found: true,
            ambiguous: true,
            matches: matches.map(m => ({ id: m.id, code: m.code, project: m.project_name, price: m.price, status: m.status })),
            message: `وجدت ${matches.length} عقارات تطابق "${c}". يرجى تحديد العقار المطلوب.`
          };
        }
      }

      if (!unit) return { found: false, message: 'لم يتم العثور على العقار المطلوب.' };
      return {
        found: true,
        property: unit,
        message: `الوحدة: ${unit.code} — المشروع: ${unit.project_name} — السعر: ${formatMoney(unit.price)} — الحالة: ${unit.status === 'available' ? 'متاحة' : unit.status === 'reserved' ? 'محجوزة' : unit.status === 'sold' ? 'مباعة' : unit.status}`
      };
    }
  },

  // 7) إضافة عقار / وحدة
  createProperty: {
    name: 'createProperty',
    title: 'إضافة وحدة عقارية',
    description: 'إضافة عقار أو وحدة جديدة ضمن مشروع موجود',
    module: 'units',
    action: 'create',
    isSensitive: true,
    parameters: {
      type: 'object',
      required: ['code', 'price', 'rooms'],
      properties: {
        code: { type: 'string', description: 'كود الوحدة (مثل 105-A1)' },
        project_id: { type: 'number', description: 'معرف المشروع' },
        price: { type: 'number', description: 'سعر الوحدة' },
        rooms: { type: 'number', description: 'عدد الغرف' },
        area: { type: 'number', description: 'المساحة بالمتر المربع' },
        type: { type: 'string', description: 'نوع الوحدة (apartment, villa...)' }
      }
    },
    execute: async (params, user) => {
      const code = String(params.code || '').trim() || nextUniqueCode('UNIT', 'units', 'code');
      const price = Number(params.price) || 0;
      const rooms = Number(params.rooms) || 1;
      let projectId = params.project_id;
      if (!projectId) {
        const p = db.prepare('SELECT id FROM projects WHERE deleted_at IS NULL ORDER BY id LIMIT 1').get();
        if (!p) throw new Error('لا يوجد أي مشروع في النظام — أنشئ مشروعًا أولًا.');
        projectId = p.id;
      }
      const exists = db.prepare('SELECT id FROM units WHERE code=? AND deleted_at IS NULL').get(code);
      if (exists) throw new Error(`الوحدة رقم "${code}" مسجلة مسبقًا.`);

      const info = db.prepare(`
        INSERT INTO units (code, project_id, price, rooms, area, type, status, is_demo)
        VALUES (?,?,?,?,?,?,'available',0)
      `).run(code, projectId, price, rooms, Number(params.area) || 100, params.type || 'apartment');

      const id = info.lastInsertRowid;
      audit(user, 'create', 'units', 'unit', id, `إضافة وحدة عبر المساعد: ${code}`);
      return {
        ok: true,
        id,
        code,
        price,
        message: `تم إضافة العقار ${code} بنجاح بسعر ${formatMoney(price)}`
      };
    }
  },

  // 8) تعديل عقار / وحدة
  updateProperty: {
    name: 'updateProperty',
    title: 'تعديل بيانات عقار',
    description: 'تعديل سعر أو تفاصيل عقار أو وحدة',
    module: 'units',
    action: 'edit',
    isSensitive: true,
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'number', description: 'معرف الوحدة' },
        price: { type: 'number', description: 'السعر الجديد' },
        status: { type: 'string', description: 'حالة الوحدة: available, reserved, sold, blocked' },
        rooms: { type: 'number', description: 'عدد الغرف' }
      }
    },
    execute: async (params, user) => {
      if (user.role !== 'admin') throw new Error('صلاحية مرفوضة: تعديل الوحدات والعقارات متاح لمدير النظام (Admin) فقط.');
      const u = db.prepare('SELECT * FROM units WHERE id=? AND deleted_at IS NULL').get(params.id);
      if (!u) throw new Error('الوحدة غير موجودة.');
      const updates = [];
      const ps = [];
      if (params.price !== undefined) { updates.push('price=?'); ps.push(Number(params.price)); }
      if (params.status) { updates.push('status=?'); ps.push(params.status); }
      if (params.rooms !== undefined) { updates.push('rooms=?'); ps.push(Number(params.rooms)); }
      if (!updates.length) return { ok: true, message: 'لا توجد تعديلات لتطبيقها.' };

      updates.push("updated_at=datetime('now','localtime')");
      ps.push(u.id);
      db.prepare(`UPDATE units SET ${updates.join(', ')} WHERE id=?`).run(...ps);
      audit(user, 'update', 'units', 'unit', u.id, `تعديل وحدة عقارية عبر المساعد: ${u.code}`);
      return {
        ok: true,
        id: u.id,
        message: `تم تعديل بيانات العقار ${u.code} بنجاح.`
      };
    }
  },

  // 9) عرض الحجوزات والبحث والتصفية
  searchBookings: {
    name: 'searchBookings',
    title: 'عرض والبحث في الحجوزات',
    description: 'عرض الحجوزات مع إمكانية التصفية بالحالة أو التاريخ أو اسم العميل',
    module: 'reservations',
    action: 'view',
    isSensitive: false,
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'حالة الحجز: active, confirmed, cancelled, expired' },
        period: { type: 'string', description: 'الفترة: today, this_week, this_month, all' },
        client_name: { type: 'string', description: 'اسم العميل' },
        limit: { type: 'number', description: 'الحد الأقصى للنتائج' }
      }
    },
    execute: async (params, user) => {
      let sql = `
        SELECT r.id, r.code, r.price, r.deposit, r.reservation_date, r.expiry_date, r.status,
               c.name client_name, c.phone client_phone,
               u.code unit_code, p.name project_name
        FROM reservations r
        JOIN clients c ON c.id = r.client_id
        JOIN units u ON u.id = r.unit_id
        JOIN projects p ON p.id = u.project_id
        WHERE 1=1
      `;
      const ps = [];
      if (params.status) {
        sql += ` AND r.status=?`;
        ps.push(params.status);
      }
      if (params.client_name) {
        sql += ` AND c.name LIKE ?`;
        ps.push(`%${params.client_name}%`);
      }
      if (params.period === 'this_week') {
        sql += ` AND date(r.reservation_date) >= date('now', 'localtime', '-7 days')`;
      } else if (params.period === 'today') {
        sql += ` AND date(r.reservation_date) = date('now', 'localtime')`;
      } else if (params.period === 'this_month') {
        sql += ` AND substr(r.reservation_date, 1, 7) = substr(date('now', 'localtime'), 1, 7)`;
      }

      const limit = Math.min(20, Math.max(1, Number(params.limit) || 8));
      sql += ` ORDER BY r.id DESC LIMIT ?`;
      ps.push(limit);

      const rows = db.prepare(sql).all(...ps);
      return {
        found: rows.length > 0,
        count: rows.length,
        bookings: rows,
        message: rows.length
          ? `تم العثور على ${rows.length} حجز:`
          : 'لا توجد حجوزات تطابق المعايير المحددة.'
      };
    }
  },

  // 10) إنشاء حجز جديد (عملية حساسة تتطلب تأكيداً)
  createBooking: {
    name: 'createBooking',
    title: 'إنشاء حجز جديد',
    description: 'إنشاء حجز جديد لوحدة عقارية باسم عميل محدد مع التحقق من توفر الوحدة',
    module: 'reservations',
    action: 'create',
    isSensitive: true,
    parameters: {
      type: 'object',
      required: ['unit_id', 'client_id'],
      properties: {
        unit_id: { type: 'number', description: 'معرف الوحدة العقارية' },
        client_id: { type: 'number', description: 'معرف العميل' },
        deposit: { type: 'number', description: 'مبلغ العربون / الدفعة المقدمة' },
        deposit_method: { type: 'string', description: 'طريقة دفع العربون: cash, transfer, check' },
        deposit_ref: { type: 'string', description: 'رقم المرجع أو الحوالة' },
        notes: { type: 'string', description: 'ملاحظات الحجز' }
      }
    },
    execute: async (params, user) => {
      const unit = db.prepare('SELECT * FROM units WHERE id=? AND deleted_at IS NULL').get(params.unit_id);
      if (!unit) throw new Error('العقار المطلوب غير موجود.');
      if (unit.status !== 'available' && unit.status !== 'resale') {
        throw new Error(`لم يتم إنشاء الحجز لأن العقار (${unit.code}) غير متاح حاليًا (حالته: ${unit.status === 'reserved' ? 'محجوز مسبقًا' : unit.status === 'sold' ? 'مباع مسبقًا' : unit.status}).`);
      }

      const client = db.prepare('SELECT * FROM clients WHERE id=? AND deleted_at IS NULL').get(params.client_id);
      if (!client) throw new Error('العميل المحدد غير موجود.');

      const price = Number(unit.price) || 0;
      const deposit = Math.max(0, Number(params.deposit) || 0);
      const todayStr = require('./time').today();
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 7);
      const expiryStr = require('./time').dateOnly(expiry);

      const code = nextUniqueCode('RESERVATION', 'reservations', 'code');

      // إدراج الحجز
      const info = db.prepare(`
        INSERT INTO reservations (code, unit_id, client_id, price, discount, deposit, deposit_method, deposit_ref, reservation_date, expiry_date, status, employee_id, notes, created_by, is_demo)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
      `).run(
        code,
        unit.id,
        client.id,
        price,
        0,
        deposit,
        params.deposit_method || 'transfer',
        params.deposit_ref || '',
        todayStr,
        expiryStr,
        'active',
        user.id,
        params.notes || 'تم الإنشاء عبر المساعد التنفيذي',
        user.id
      );

      const reservationId = info.lastInsertRowid;

      // تحديث حالة الوحدة إلى محجوزة
      db.prepare("UPDATE units SET status='reserved', updated_at=datetime('now','localtime') WHERE id=?").run(unit.id);

      audit(user, 'create', 'reservations', 'reservation', reservationId, `إنشاء حجز عبر المساعد: ${code} للعميل ${client.name} على الوحدة ${unit.code}`);

      return {
        ok: true,
        id: reservationId,
        code,
        unit_code: unit.code,
        client_name: client.name,
        price,
        deposit,
        message: `تم إنشاء الحجز بنجاح! رقم الحجز: ${code} — العميل: ${client.name} — العقار: ${unit.code}`
      };
    }
  },

  // 11) تعديل حجز (عملية حساسة)
  updateBooking: {
    name: 'updateBooking',
    title: 'تعديل حجز',
    description: 'تعديل بيانات حجز موجود مثل تاريخ الانتهاء أو الملاحظات أو الخصم',
    module: 'reservations',
    action: 'edit',
    isSensitive: true,
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'number', description: 'معرف الحجز' },
        expiry_date: { type: 'string', description: 'تاريخ انتهاء الحجز الجديد (YYYY-MM-DD)' },
        notes: { type: 'string', description: 'الملاحظات' },
        discount: { type: 'number', description: 'قيمة الخصم' }
      }
    },
    execute: async (params, user) => {
      const resv = db.prepare('SELECT * FROM reservations WHERE id=?').get(params.id);
      if (!resv) throw new Error('الحجز غير موجود.');
      const updates = [];
      const ps = [];
      if (params.expiry_date) { updates.push('expiry_date=?'); ps.push(params.expiry_date); }
      if (params.notes !== undefined) { updates.push('notes=?'); ps.push(params.notes); }
      if (params.discount !== undefined) { updates.push('discount=?'); ps.push(Number(params.discount)); }
      if (!updates.length) return { ok: true, message: 'لا توجد بيانات لتعديلها.' };

      updates.push("updated_at=datetime('now','localtime')");
      ps.push(resv.id);
      db.prepare(`UPDATE reservations SET ${updates.join(', ')} WHERE id=?`).run(...ps);
      audit(user, 'update', 'reservations', 'reservation', resv.id, `تعديل حجز عبر المساعد: ${resv.code}`);
      return {
        ok: true,
        id: resv.id,
        code: resv.code,
        message: `تم تعديل الحجز ${resv.code} بنجاح.`
      };
    }
  },

  // 12) إلغاء حجز (عملية حساسة)
  cancelBooking: {
    name: 'cancelBooking',
    title: 'إلغاء حجز',
    description: 'إلغاء حجز نشط وإعادة الوحدة العقارية كعقار متاح للبيع',
    module: 'reservations',
    action: 'delete',
    isSensitive: true,
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'number', description: 'معرف الحجز' },
        reason: { type: 'string', description: 'سبب الإلغاء' }
      }
    },
    execute: async (params, user) => {
      const resv = db.prepare('SELECT * FROM reservations WHERE id=?').get(params.id);
      if (!resv) throw new Error('الحجز غير موجود.');
      if (resv.status === 'cancelled') throw new Error('الحجز ملغى مسبقًا.');

      // تحديث حالة الحجز
      db.prepare(`
        UPDATE reservations
        SET status='cancelled', cancel_reason=?, updated_at=datetime('now','localtime')
        WHERE id=?
      `).run(params.reason || 'إلغاء عبر المساعد الذكي', resv.id);

      // إعادة حالة الوحدة إلى متاحة
      if (resv.unit_id) {
        db.prepare("UPDATE units SET status='available', updated_at=datetime('now','localtime') WHERE id=?").run(resv.unit_id);
      }

      audit(user, 'delete', 'reservations', 'reservation', resv.id, `إلغاء الحجز ${resv.code} عبر المساعد: ${params.reason || ''}`);
      return {
        ok: true,
        id: resv.id,
        code: resv.code,
        message: `تم إلغاء الحجز رقم ${resv.code} بنجاح، وأصبحت الوحدة متاحة مجددًا.`
      };
    }
  },

  // 13) عرض الدفعات والبحث برقم المرجع
  searchPayments: {
    name: 'searchPayments',
    title: 'عرض والبحث في الدفعات',
    description: 'عرض الدفعات والبحث برقم المرجع أو العميل أو رقم الإيصال',
    module: 'finance',
    action: 'view',
    isSensitive: false,
    parameters: {
      type: 'object',
      properties: {
        reference_no: { type: 'string', description: 'رقم المرجع أو الحوالة' },
        client_name: { type: 'string', description: 'اسم العميل' },
        limit: { type: 'number', description: 'الحد الأقصى للنتائج' }
      }
    },
    execute: async (params, user) => {
      let sql = `
        SELECT p.id, p.receipt_no, p.amount, p.method, p.reference_no, p.paid_at, p.status,
               c.name client_name, u.code unit_code
        FROM payments p
        LEFT JOIN clients c ON c.id = p.client_id
        LEFT JOIN units u ON u.id = p.unit_id
        WHERE p.deleted_at IS NULL
      `;
      const ps = [];
      if (params.reference_no) {
        sql += ` AND (p.reference_no LIKE ? OR p.receipt_no LIKE ?)`;
        ps.push(`%${params.reference_no}%`, `%${params.reference_no}%`);
      }
      if (params.client_name) {
        sql += ` AND c.name LIKE ?`;
        ps.push(`%${params.client_name}%`);
      }
      const limit = Math.min(20, Math.max(1, Number(params.limit) || 8));
      sql += ` ORDER BY p.id DESC LIMIT ?`;
      ps.push(limit);

      const rows = db.prepare(sql).all(...ps);
      return {
        found: rows.length > 0,
        count: rows.length,
        payments: rows,
        message: rows.length
          ? `تم العثور على ${rows.length} دفعة:`
          : 'لم يتم العثور على أي دفعة تطابق البحث.'
      };
    }
  },

  // 14) تسجيل دفعة مالية (عملية مالية حساسة تتطلب تأكيداً)
  createPayment: {
    name: 'createPayment',
    title: 'تسجيل دفعة مالية',
    description: 'تسجيل دفعة مالية لحساب بيع أو حجز وتحديث رصيد الحساب المالي',
    module: 'finance',
    action: 'create',
    isSensitive: true,
    parameters: {
      type: 'object',
      required: ['amount', 'client_id'],
      properties: {
        amount: { type: 'number', description: 'مبلغ الدفعة' },
        client_id: { type: 'number', description: 'معرف العميل' },
        sale_id: { type: 'number', description: 'معرف البيع إن وجد' },
        reservation_id: { type: 'number', description: 'معرف الحجز إن وجد' },
        method: { type: 'string', description: 'طريقة الدفع: cash, transfer, check' },
        reference_no: { type: 'string', description: 'رقم المرجع أو الحوالة' },
        notes: { type: 'string', description: 'ملاحظات الدفعة' }
      }
    },
    execute: async (params, user) => {
      const amount = Number(params.amount);
      if (!(amount > 0)) throw new Error('مبلغ الدفعة غير صالح.');

      const client = db.prepare('SELECT id, name FROM clients WHERE id=? AND deleted_at IS NULL').get(params.client_id);
      if (!client) throw new Error('العميل المحدد غير موجود.');

      let saleId = params.sale_id;
      let reservationId = params.reservation_id;
      let unitId = null;
      let projectId = null;

      if (!saleId && !reservationId) {
        // البحث التلقائي عن بيع أو حجز نشط للعميل
        const s = db.prepare("SELECT id, unit_id, (SELECT project_id FROM units WHERE id=sales.unit_id) pid FROM sales WHERE client_id=? AND status='active' ORDER BY id DESC LIMIT 1").get(client.id);
        if (s) {
          saleId = s.id;
          unitId = s.unit_id;
          projectId = s.pid;
        } else {
          const r = db.prepare("SELECT id, unit_id, (SELECT project_id FROM units WHERE id=reservations.unit_id) pid FROM reservations WHERE client_id=? AND status='active' ORDER BY id DESC LIMIT 1").get(client.id);
          if (r) {
            reservationId = r.id;
            unitId = r.unit_id;
            projectId = r.pid;
          }
        }
      }

      if (!saleId && !reservationId) {
        throw new Error(`لا يوجد بيع أو حجز نشط للعميل ${client.name} لربط الدفعة به.`);
      }

      // البحث عن حساب مالي
      let acc = db.prepare("SELECT id, name FROM accounts WHERE is_default=1 AND status='active' AND deleted_at IS NULL").get();
      if (!acc) acc = db.prepare("SELECT id, name FROM accounts WHERE status='active' AND deleted_at IS NULL LIMIT 1").get();
      
      const receiptNo = nextUniqueCode('RCPT', 'payments', 'receipt_no');
      const todayStr = require('./time').today();

      const info = db.prepare(`
        INSERT INTO payments (receipt_no, kind, sale_id, reservation_id, client_id, unit_id, project_id, amount, method, account_id, reference_no, status, paid_at, notes, created_by, is_demo)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
      `).run(
        receiptNo,
        'installment',
        saleId || null,
        reservationId || null,
        client.id,
        unitId,
        projectId,
        amount,
        params.method || 'transfer',
        acc?.id || null,
        params.reference_no || '',
        'confirmed',
        todayStr,
        params.notes || 'تسجيل دفعة عبر المساعد التنفيذي',
        user.id
      );

      // تحديث رصيد الحساب المالي إن وجد
      if (acc) {
        try { F.recomputeAccount(acc.id); } catch {}
      }

      audit(user, 'create', 'finance', 'payment', info.lastInsertRowid, `تسجيل دفعة عبر المساعد بمبلغ ${amount} للعميل ${client.name}`);

      return {
        ok: true,
        id: info.lastInsertRowid,
        receipt_no: receiptNo,
        amount,
        client_name: client.name,
        account: acc?.name || 'بدون حساب',
        message: `تم تسجيل الدفعة بنجاح! رقم الإيصال: ${receiptNo} بمبلغ ${formatMoney(amount)} للعميل ${client.name}`
      };
    }
  },

  // 15) عرض المصروفات
  searchExpenses: {
    name: 'searchExpenses',
    title: 'عرض المصروفات',
    description: 'عرض والبحث في سجل المصروفات',
    module: 'expenses',
    action: 'view',
    isSensitive: false,
    parameters: {
      type: 'object',
      properties: {
        vendor: { type: 'string', description: 'المورد أو المستفيد' },
        limit: { type: 'number', description: 'الحد الأقصى للنتائج' }
      }
    },
    execute: async (params, user) => {
      let sql = `
        SELECT e.id, e.code, e.amount, e.expense_date, e.vendor, e.method, e.description, e.status,
               c.name category_name
        FROM expenses e
        LEFT JOIN expense_categories c ON c.id = e.category_id
        WHERE e.deleted_at IS NULL
      `;
      const ps = [];
      if (params.vendor) {
        sql += ` AND (e.vendor LIKE ? OR e.description LIKE ?)`;
        ps.push(`%${params.vendor}%`, `%${params.vendor}%`);
      }
      const limit = Math.min(20, Math.max(1, Number(params.limit) || 8));
      sql += ` ORDER BY e.id DESC LIMIT ?`;
      ps.push(limit);

      const rows = db.prepare(sql).all(...ps);
      const sum = rows.reduce((a, b) => a + (Number(b.amount) || 0), 0);
      return {
        found: rows.length > 0,
        count: rows.length,
        total_amount: sum,
        expenses: rows,
        message: rows.length
          ? `وجدت ${rows.length} مصروف بإجمالي ${formatMoney(sum)}:`
          : 'لا توجد مصروفات مسجلة.'
      };
    }
  },

  // 16) إضافة مصروف (عملية مالية حساسة)
  createExpense: {
    name: 'createExpense',
    title: 'إضافة مصروف',
    description: 'تسجيل مصروف مالي جديد في النظام',
    module: 'expenses',
    action: 'create',
    isSensitive: true,
    parameters: {
      type: 'object',
      required: ['amount', 'description'],
      properties: {
        amount: { type: 'number', description: 'مبلغ المصروف' },
        description: { type: 'string', description: 'بيان / وصف المصروف' },
        vendor: { type: 'string', description: 'المورد أو الجهة المستفيدة' },
        method: { type: 'string', description: 'طريقة الدفع: cash, transfer, check' },
        reference_no: { type: 'string', description: 'رقم المرجع أو الفاتورة' }
      }
    },
    execute: async (params, user) => {
      const amount = Number(params.amount);
      if (!(amount > 0)) throw new Error('مبلغ المصروف غير صالح.');

      let acc = db.prepare("SELECT id, name FROM accounts WHERE is_default=1 AND status='active' AND deleted_at IS NULL").get();
      if (!acc) acc = db.prepare("SELECT id, name FROM accounts WHERE status='active' AND deleted_at IS NULL LIMIT 1").get();

      const cat = db.prepare('SELECT id, name FROM expense_categories LIMIT 1').get();
      const code = nextUniqueCode('EXP', 'expenses', 'code');
      const todayStr = require('./time').today();

      const info = db.prepare(`
        INSERT INTO expenses (code, expense_date, category_id, amount, account_id, vendor, method, reference_no, description, status, created_by, is_demo)
        VALUES (?,?,?,?,?,?,?,?,?,'paid',?,0)
      `).run(
        code,
        todayStr,
        cat?.id || null,
        amount,
        acc?.id || null,
        params.vendor || '',
        params.method || 'cash',
        params.reference_no || '',
        params.description || 'مصروف عبر المساعد التنفيذي',
        user.id
      );

      if (acc) {
        try { F.recomputeAccount(acc.id); } catch {}
      }

      audit(user, 'create', 'expenses', 'expense', info.lastInsertRowid, `تسجيل مصروف عبر المساعد: ${code} بمبلغ ${amount}`);
      return {
        ok: true,
        id: info.lastInsertRowid,
        code,
        amount,
        description: params.description,
        message: `تم تسجيل المصروف بنجاح! كود المصروف: ${code} بمبلغ ${formatMoney(amount)}.`
      };
    }
  },

  // 17) عرض الحسابات المالية
  getAccounts: {
    name: 'getAccounts',
    title: 'عرض الحسابات المالية',
    description: 'عرض الحسابات المالية والبنوك والصناديق وأرصدتها الحالية',
    module: 'accounts',
    action: 'view',
    isSensitive: false,
    parameters: {
      type: 'object',
      properties: {}
    },
    execute: async (params, user) => {
      const rows = db.prepare(`
        SELECT id, code, name, type, bank_name, current_balance, is_default, status
        FROM accounts
        WHERE deleted_at IS NULL
        ORDER BY is_default DESC, id
      `).all();
      const totalBalance = rows.reduce((a, b) => a + (Number(b.current_balance) || 0), 0);
      return {
        found: rows.length > 0,
        count: rows.length,
        total_balance: totalBalance,
        accounts: rows,
        message: rows.length
          ? `يوجد ${rows.length} حسابات بإجمالي أرصدة ${formatMoney(totalBalance)}:`
          : 'لا توجد حسابات مالية مضافة في النظام.'
      };
    }
  },

  // 18) الرصيد المتبقي على عميل
  getRemainingBalance: {
    name: 'getRemainingBalance',
    title: 'حساب الرصيد المتبقي على عميل',
    description: 'حساب إجمالي المبيعات والمدفوعات والمتبقي المالي على عميل محدد بدقة',
    module: 'finance',
    action: 'view',
    isSensitive: false,
    parameters: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'اسم العميل' },
        client_id: { type: 'number', description: 'معرف العميل' }
      }
    },
    execute: async (params, user) => {
      let client = null;
      if (params.client_id) {
        client = db.prepare('SELECT id, name, phone, code FROM clients WHERE id=? AND deleted_at IS NULL').get(params.client_id);
      } else if (params.customer_name) {
        const q = String(params.customer_name).trim();
        const matches = db.prepare('SELECT id, name, phone, code FROM clients WHERE name LIKE ? AND deleted_at IS NULL LIMIT 5').all(`%${q}%`);
        if (matches.length === 1) client = matches[0];
        else if (matches.length > 1) {
          return {
            found: true,
            ambiguous: true,
            matches,
            message: `وجدت أكثر من عميل باسم "${q}": ${matches.map(c => c.name).join('، ')}. يرجى التحديد بدقة.`
          };
        }
      }

      if (!client) return { found: false, message: 'لم يتم العثور على العميل.' };

      const sales = db.prepare("SELECT COALESCE(SUM(net_price), 0) total FROM sales WHERE client_id=? AND status<>'cancelled'").get(client.id).total;
      const paid = db.prepare("SELECT COALESCE(SUM(amount), 0) total FROM payments WHERE client_id=? AND status='confirmed'").get(client.id).total;
      const remaining = Math.max(0, sales - paid);

      return {
        found: true,
        client_id: client.id,
        client_name: client.name,
        total_sales: sales,
        total_paid: paid,
        remaining_balance: remaining,
        message: `العميل: ${client.name}\n• إجمالي المبيعات: ${formatMoney(sales)}\n• إجمالي المسدد: ${formatMoney(paid)}\n• الرصيد المتبقي: ${formatMoney(remaining)}`
      };
    }
  },

  // 19) التقارير الشاملة
  getReports: {
    name: 'getReports',
    title: 'عرض التقارير والملخصات',
    description: 'جلب تقرير ملخص عن المبيعات أو الحجوزات أو التدفقات المالية',
    module: 'reports',
    action: 'view',
    isSensitive: false,
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'نوع التقرير: sales, finance, units, general' }
      }
    },
    execute: async (params, user) => {
      const type = params.type || 'general';
      const stats = {};

      if (can(user.perms, 'sales', 'view')) {
        const s = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(net_price),0) total FROM sales WHERE status<>'cancelled'").get();
        stats.sales_count = s.c;
        stats.sales_total = s.total;
      }
      if (can(user.perms, 'reservations', 'view')) {
        const r = db.prepare("SELECT COUNT(*) c FROM reservations WHERE status='active'").get();
        stats.active_reservations = r.c;
      }
      if (can(user.perms, 'units', 'view')) {
        const u = db.prepare("SELECT COUNT(*) c FROM units WHERE status='available' AND deleted_at IS NULL").get();
        stats.available_units = u.c;
      }
      if (can(user.perms, 'finance', 'view')) {
        const p = db.prepare("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE status='confirmed'").get();
        stats.total_collected = p.total;
      }
      if (can(user.perms, 'expenses', 'view')) {
        const e = db.prepare("SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE deleted_at IS NULL").get();
        stats.total_expenses = e.total;
      }

      return {
        type,
        stats,
        message: `ملخص النظام:\n` +
          (stats.sales_total !== undefined ? `• إجمالي المبيعات: ${formatMoney(stats.sales_total)} (${stats.sales_count} عملية)\n` : '') +
          (stats.total_collected !== undefined ? `• إجمالي التحصيلات: ${formatMoney(stats.total_collected)}\n` : '') +
          (stats.total_expenses !== undefined ? `• إجمالي المصروفات: ${formatMoney(stats.total_expenses)}\n` : '') +
          (stats.active_reservations !== undefined ? `• الحجوزات النشطة: ${stats.active_reservations}\n` : '') +
          (stats.available_units !== undefined ? `• الوحدات المتاحة: ${stats.available_units}` : '')
      };
    }
  },

  // 21) البحث في المواعيد
  searchAppointments: {
    name: 'searchAppointments',
    title: 'عرض والبحث في المواعيد',
    description: 'عرض المواعيد حسب النطاق (اليوم، الغد، الأسبوع، القادمة) أو حسب العميل أو التاريخ',
    module: 'appointments',
    action: 'view',
    isSensitive: false,
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'النطاق: today, tomorrow, week, upcoming, all' },
        date: { type: 'string', description: 'تاريخ محدد بصيغة YYYY-MM-DD' },
        client_name: { type: 'string', description: 'اسم العميل' },
        q: { type: 'string', description: 'نص البحث' }
      }
    },
    execute: async (params, user) => {
      let sql = `
        SELECT a.*, c.name client_name, c.phone client_phone
        FROM appointments a
        LEFT JOIN clients c ON c.id=a.client_id
        WHERE a.deleted_at IS NULL
      `;
      const ps = [];
      const today = require('./time').today();

      if (params.date) {
        sql += ' AND a.date=?';
        ps.push(params.date);
      } else if (params.scope === 'today') {
        sql += ' AND a.date=?';
        ps.push(today);
      } else if (params.scope === 'tomorrow') {
        const d = new Date(); d.setDate(d.getDate() + 1);
        sql += ' AND a.date=?';
        ps.push(d.toISOString().slice(0, 10));
      } else if (params.scope === 'week') {
        sql += ` AND a.date >= ? AND a.date <= date(?, '+7 days')`;
        ps.push(today, today);
      } else if (params.scope === 'upcoming') {
        sql += ' AND a.date >= ? AND a.status = "scheduled"';
        ps.push(today);
      }

      if (params.client_name) {
        sql += ' AND c.name LIKE ?';
        ps.push(`%${params.client_name}%`);
      }
      if (params.q) {
        sql += ' AND (a.title LIKE ? OR a.location LIKE ? OR a.notes LIKE ?)';
        ps.push(`%${params.q}%`, `%${params.q}%`, `%${params.q}%`);
      }

      sql += ' ORDER BY a.date ASC, a.start_time ASC LIMIT 20';
      const rows = db.prepare(sql).all(...ps);

      let msg = '';
      if (!rows.length) {
        msg = params.client_name ? `لا توجد مواعيد مسجلة للعميل "${params.client_name}".` : 'لا توجد أي مواعيد مجدولة في هذه الفترة.';
      } else {
        msg = `تم العثور على ${rows.length} موعد:`;
      }

      return {
        count: rows.length,
        message: msg,
        appointments: rows.map(r => ({
          id: r.id,
          title: r.title,
          date: r.date,
          start_time: r.start_time,
          end_time: r.end_time,
          time: `${r.start_time} - ${r.end_time}`,
          client: r.client_name,
          client_name: r.client_name,
          location: r.location,
          status: r.status
        }))
      };
    }
  },

  // 22) إضافة موعد جديد
  createAppointment: {
    name: 'createAppointment',
    title: 'إضافة موعد جديد',
    description: 'تسجيل وحجز موعد فعلي في التقويم مع تحديد التاريخ والوقت والعميل',
    module: 'appointments',
    action: 'create',
    isSensitive: false,
    parameters: {
      type: 'object',
      required: ['title', 'date', 'start_time'],
      properties: {
        title: { type: 'string', description: 'عنوان أو موضوع الموعد' },
        date: { type: 'string', description: 'تاريخ الموعد YYYY-MM-DD' },
        start_time: { type: 'string', description: 'وقت البدء HH:MM' },
        end_time: { type: 'string', description: 'وقت الانتهاء HH:MM' },
        client_id: { type: 'number', description: 'معرف العميل' },
        client_name: { type: 'string', description: 'اسم العميل' },
        location: { type: 'string', description: 'مكان الموعد' },
        notes: { type: 'string', description: 'ملاحظات' }
      }
    },
    execute: async (params, user) => {
      let clientId = params.client_id || null;
      let clientName = '';
      if (!clientId && params.client_name) {
        const c = db.prepare('SELECT id, name FROM clients WHERE (name LIKE ? OR phone LIKE ?) AND deleted_at IS NULL LIMIT 1').get(`%${params.client_name}%`, `%${params.client_name}%`);
        if (c) { clientId = c.id; clientName = c.name; }
      } else if (clientId) {
        const c = db.prepare('SELECT name FROM clients WHERE id=?').get(clientId);
        if (c) clientName = c.name;
      }

      const startTime = params.start_time || '10:00';
      let endTime = params.end_time;
      if (!endTime) {
        const parts = startTime.split(':').map(Number);
        const endH = (parts[1] + 30 >= 60) ? (parts[0] + 1) % 24 : parts[0];
        const endM = (parts[1] + 30) % 60;
        endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
      }

      // منع المواعيد المكررة لنفس التوقيت
      const dup = db.prepare(`
        SELECT id FROM appointments
        WHERE date=? AND start_time=? AND (client_id=? OR title=?) AND deleted_at IS NULL
      `).get(params.date, startTime, clientId || -1, params.title);
      if (dup) {
        return {
          ok: false,
          alreadyExists: true,
          id: dup.id,
          message: `يوجد موعد مسجل مسبقاً في نفس الوقت (${params.date} الساعة ${startTime}).`
        };
      }

      const info = db.prepare(`
        INSERT INTO appointments (title, client_id, date, start_time, end_time, duration_min, location, notes, status, created_by, is_demo)
        VALUES (?,?,?,?,?,30,?,?,'scheduled',?,0)
      `).run(params.title, clientId, params.date, startTime, endTime, params.location || 'المكتب الرئيسي', params.notes || '', user.id);

      const id = info.lastInsertRowid;
      audit(user, 'create', 'appointments', 'appointment', id, `إضافة موعد: ${params.title} في ${params.date} ${startTime}`);

      return {
        ok: true,
        id,
        appointment: { id, title: params.title, date: params.date, start_time: startTime, end_time: endTime, client_name: clientName },
        title: params.title,
        date: params.date,
        time: startTime,
        start_time: startTime,
        client: clientName,
        client_name: clientName,
        message: `تم إضافة الموعد بنجاح: "${params.title}" يوم ${params.date} الساعة ${startTime}${clientName ? ' مع ' + clientName : ''}.`
      };
    }
  },

  // 23) تعديل موعد
  updateAppointment: {
    name: 'updateAppointment',
    title: 'تعديل موعد',
    description: 'تعديل وقت أو تاريخ أو تفاصيل موعد محدد',
    module: 'appointments',
    action: 'edit',
    isSensitive: true,
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'number', description: 'معرف الموعد' },
        date: { type: 'string', description: 'التاريخ الجديد YYYY-MM-DD' },
        start_time: { type: 'string', description: 'الوقت الجديد HH:MM' },
        end_time: { type: 'string', description: 'وقت الانتهاء الجديد HH:MM' },
        title: { type: 'string', description: 'العنوان الجديد' },
        location: { type: 'string', description: 'المكان الجديد' },
        notes: { type: 'string', description: 'الملاحظات' }
      }
    },
    execute: async (params, user) => {
      const appt = db.prepare('SELECT a.*, c.name client_name FROM appointments a LEFT JOIN clients c ON c.id=a.client_id WHERE a.id=? AND a.deleted_at IS NULL').get(params.id);
      if (!appt) throw new Error('الموعد غير موجود أو تم حذفه مسبقاً.');

      const sets = [];
      const ps = [];
      if (params.date) { sets.push('date=?'); ps.push(params.date); }
      if (params.start_time) {
        sets.push('start_time=?'); ps.push(params.start_time);
        if (!params.end_time) {
          const parts = params.start_time.split(':').map(Number);
          const endH = (parts[1] + 30 >= 60) ? (parts[0] + 1) % 24 : parts[0];
          const endM = (parts[1] + 30) % 60;
          sets.push('end_time=?'); ps.push(`${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`);
        }
      }
      if (params.end_time) { sets.push('end_time=?'); ps.push(params.end_time); }
      if (params.title) { sets.push('title=?'); ps.push(params.title); }
      if (params.location !== undefined) { sets.push('location=?'); ps.push(params.location); }
      if (params.notes !== undefined) { sets.push('notes=?'); ps.push(params.notes); }

      if (!sets.length) return { ok: true, message: 'لا توجد بيانات جديدة لتعديلها.' };

      sets.push("updated_at=datetime('now','localtime')");
      ps.push(appt.id);
      db.prepare(`UPDATE appointments SET ${sets.join(', ')} WHERE id=?`).run(...ps);

      audit(user, 'update', 'appointments', 'appointment', appt.id, `تعديل موعد: ${appt.title}`);
      return {
        ok: true,
        id: appt.id,
        title: params.title || appt.title,
        message: `تم تعديل الموعد بنجاح${params.start_time ? ' إلى الساعة ' + params.start_time : ''}${params.date ? ' يوم ' + params.date : ''}.`
      };
    }
  },

  // 24) تغيير حالة الموعد
  changeAppointmentStatus: {
    name: 'changeAppointmentStatus',
    title: 'تغيير حالة الموعد',
    description: 'تغيير حالة الموعد إلى مكتمل أو ملغي أو مؤجل',
    module: 'appointments',
    action: 'edit',
    isSensitive: false,
    parameters: {
      type: 'object',
      required: ['id', 'status'],
      properties: {
        id: { type: 'number', description: 'معرف الموعد' },
        status: { type: 'string', description: 'الحالة: done, cancelled, postponed, scheduled' }
      }
    },
    execute: async (params, user) => {
      const appt = db.prepare('SELECT * FROM appointments WHERE id=? AND deleted_at IS NULL').get(params.id);
      if (!appt) throw new Error('الموعد غير موجود.');

      db.prepare("UPDATE appointments SET status=?, updated_at=datetime('now','localtime') WHERE id=?")
        .run(params.status, appt.id);

      const stMap = { done: 'مكتمل (تم الحضور)', cancelled: 'ملغي', postponed: 'مؤجل', scheduled: 'مجدول' };
      audit(user, 'update', 'appointments', 'appointment', appt.id, `تغيير حالة الموعد إلى ${params.status}`);
      return {
        ok: true,
        id: appt.id,
        message: `تم تغيير حالة الموعد "${appt.title}" إلى: ${stMap[params.status] || params.status}.`
      };
    }
  },

  // 25) حذف موعد
  deleteAppointment: {
    name: 'deleteAppointment',
    title: 'حذف موعد',
    description: 'إلغاء وحذف موعد من التقويم',
    module: 'appointments',
    action: 'delete',
    isSensitive: true,
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'number', description: 'معرف الموعد' }
      }
    },
    execute: async (params, user) => {
      const appt = db.prepare('SELECT a.*, c.name client_name FROM appointments a LEFT JOIN clients c ON c.id=a.client_id WHERE a.id=? AND a.deleted_at IS NULL').get(params.id);
      if (!appt) throw new Error('الموعد غير موجود أو تم حذفه مسبقاً.');

      db.prepare("UPDATE appointments SET deleted_at=datetime('now','localtime') WHERE id=?").run(appt.id);
      audit(user, 'delete', 'appointments', 'appointment', appt.id, `حذف موعد: ${appt.title}`);

      return {
        ok: true,
        id: appt.id,
        message: `تم حذف الموعد "${appt.title}" بنجاح.`
      };
    }
  },

  // 26) البحث في المهام
  searchTasks: {
    name: 'searchTasks',
    title: 'عرض والبحث في المهام',
    description: 'عرض المهام حسب النطاق (اليوم، المتأخرة، هذا الأسبوع، القادمة) أو حسب الأولوية والحالة',
    module: 'tasks',
    action: 'view',
    isSensitive: false,
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'النطاق: today, overdue, upcoming, week, all' },
        priority: { type: 'string', description: 'الأولوية: urgent, high, medium, low' },
        status: { type: 'string', description: 'الحالة: new, in_progress, completed, cancelled' },
        client_name: { type: 'string', description: 'اسم العميل' },
        q: { type: 'string', description: 'كلمة بحث' }
      }
    },
    execute: async (params, user) => {
      let sql = `
        SELECT t.*, c.name client_name, p.name project_name, u.name assignee_name
        FROM tasks t
        LEFT JOIN clients c ON c.id=t.client_id
        LEFT JOIN projects p ON p.id=t.project_id
        LEFT JOIN users u ON u.id=t.assignee_id
        WHERE t.deleted_at IS NULL
      `;
      const ps = [];
      const today = require('./time').today();

      if (params.scope === 'overdue') {
        sql += ` AND t.status NOT IN ('completed', 'cancelled') AND t.due_date IS NOT NULL AND t.due_date < ?`;
        ps.push(today);
      } else if (params.scope === 'today') {
        sql += ` AND t.due_date = ?`;
        ps.push(today);
      } else if (params.scope === 'week') {
        sql += ` AND t.due_date >= ? AND t.due_date <= date(?, '+7 days')`;
        ps.push(today, today);
      } else if (params.scope === 'upcoming') {
        sql += ` AND t.due_date >= ? AND t.status NOT IN ('completed', 'cancelled')`;
        ps.push(today);
      }

      if (params.status) {
        sql += ' AND t.status = ?';
        ps.push(params.status);
      }
      if (params.priority) {
        sql += ' AND t.priority = ?';
        ps.push(params.priority);
      }
      if (params.client_name) {
        sql += ' AND c.name LIKE ?';
        ps.push(`%${params.client_name}%`);
      }
      if (params.q) {
        sql += ' AND (t.title LIKE ? OR t.description LIKE ?)';
        ps.push(`%${params.q}%`, `%${params.q}%`);
      }

      sql += ` ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, t.due_date ASC LIMIT 20`;
      const rows = db.prepare(sql).all(...ps);

      let msg = '';
      if (!rows.length) {
        if (params.filter === 'overdue') msg = 'ممتاز! لا توجد لديك أي مهام متأخرة حالياً.';
        else if (params.filter === 'today') msg = 'لا توجد مهام مستحقة اليوم.';
        else if (params.filter === 'week') msg = 'لا توجد مهام مستحقة هذا الأسبوع.';
        else msg = 'لا توجد مهام مطابقة للبحث.';
      } else {
        if (params.filter === 'overdue') msg = `لديك ${rows.length} مهام متأخرة تتطلب انتباهك:`;
        else if (params.filter === 'week') msg = `مهامك المستحقة هذا الأسبوع (${rows.length} مهام):`;
        else msg = `تم العثور على ${rows.length} مهام:`;
      }

      return {
        count: rows.length,
        message: msg,
        tasks: rows.map(r => ({
          id: r.id,
          title: r.title,
          status: r.status,
          priority: r.priority,
          due_date: r.due_date,
          assignee: r.assignee_name,
          client: r.client_name,
          client_name: r.client_name,
          project: r.project_name
        }))
      };
    }
  },

  // 27) إضافة مهمة جديدة
  createTask: {
    name: 'createTask',
    title: 'إضافة مهمة جديدة',
    description: 'تسجيل مهمة جديدة في النظام مع تحديد الأولوية وتاريخ الاستحقاق والمسند إليه',
    module: 'tasks',
    action: 'create',
    isSensitive: false,
    parameters: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: 'عنوان المهمة' },
        description: { type: 'string', description: 'وصف المهمة وتفاصيلها' },
        due_date: { type: 'string', description: 'تاريخ الاستحقاق YYYY-MM-DD' },
        priority: { type: 'string', description: 'الأولوية: urgent, high, medium, low' },
        assignee_id: { type: 'number', description: 'معرف المستخدم المسندة إليه' },
        assignee_name: { type: 'string', description: 'اسم الموظف المسند إليه' },
        client_id: { type: 'number', description: 'معرف العميل' },
        client_name: { type: 'string', description: 'اسم العميل' },
        project_id: { type: 'number', description: 'معرف المشروع' },
        project_name: { type: 'string', description: 'اسم المشروع' }
      }
    },
    execute: async (params, user) => {
      let clientId = params.client_id || null;
      let clientName = '';
      if (!clientId && params.client_name) {
        const c = db.prepare('SELECT id, name FROM clients WHERE (name LIKE ? OR phone LIKE ?) AND deleted_at IS NULL LIMIT 1').get(`%${params.client_name}%`, `%${params.client_name}%`);
        if (c) { clientId = c.id; clientName = c.name; }
      }

      let projectId = params.project_id || null;
      if (!projectId && params.project_name) {
        const p = db.prepare('SELECT id, name FROM projects WHERE (name LIKE ? OR code LIKE ?) AND deleted_at IS NULL LIMIT 1').get(`%${params.project_name}%`, `%${params.project_name}%`);
        if (p) projectId = p.id;
      }

      let assigneeId = params.assignee_id || user.id;
      let assigneeName = user.name;
      if (params.assignee_name) {
        const u = db.prepare('SELECT id, name FROM users WHERE (name LIKE ? OR username LIKE ?) AND deleted_at IS NULL LIMIT 1').get(`%${params.assignee_name}%`, `%${params.assignee_name}%`);
        if (u) { assigneeId = u.id; assigneeName = u.name; }
      }

      const today = require('./time').today();
      const dueDate = params.due_date || today;
      const priority = ['urgent', 'high', 'medium', 'low'].includes(params.priority) ? params.priority : 'medium';

      // منع المهام المكررة بنفس العنوان لنفس الموظف واليوم
      const dup = db.prepare(`
        SELECT id FROM tasks WHERE title=? AND assignee_id=? AND due_date=? AND deleted_at IS NULL
      `).get(params.title, assigneeId, dueDate);
      if (dup) {
        return {
          ok: false,
          alreadyExists: true,
          id: dup.id,
          message: `يوجد مهمة مسجلة مسبقاً بنفس العنوان لهذا الموظف في نفس التاريخ.`
        };
      }

      const info = db.prepare(`
        INSERT INTO tasks (title, description, assignee_id, priority, status, start_date, due_date, client_id, project_id, created_by, is_demo)
        VALUES (?,?,?,?,'new',?,?,?,?,?,0)
      `).run(params.title, params.description || '', assigneeId, priority, today, dueDate, clientId, projectId, user.id);

      const id = info.lastInsertRowid;
      audit(user, 'create', 'tasks', 'task', id, `إضافة مهمة: ${params.title}`);

      return {
        ok: true,
        id,
        task: { id, title: params.title, due_date: dueDate, priority, assignee: assigneeName, client: clientName, client_name: clientName },
        title: params.title,
        due_date: dueDate,
        priority,
        assignee: assigneeName,
        client: clientName,
        client_name: clientName,
        message: `تم إنشاء المهمة بنجاح: "${params.title}" تستحق في ${dueDate}${assigneeName ? ' ومسندة إلى ' + assigneeName : ''}.`
      };
    }
  },

  // 28) تعديل مهمة
  updateTask: {
    name: 'updateTask',
    title: 'تعديل مهمة',
    description: 'تعديل بيانات مهمة مثل تاريخ الاستحقاق أو الأولوية أو الوصف',
    module: 'tasks',
    action: 'edit',
    isSensitive: true,
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'number', description: 'معرف المهمة' },
        title: { type: 'string', description: 'العنوان الجديد' },
        description: { type: 'string', description: 'الوصف الجديد' },
        due_date: { type: 'string', description: 'تاريخ الاستحقاق الجديد YYYY-MM-DD' },
        priority: { type: 'string', description: 'الأولوية: urgent, high, medium, low' },
        assignee_id: { type: 'number', description: 'الموظف المسند إليه' }
      }
    },
    execute: async (params, user) => {
      const task = db.prepare('SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL').get(params.id);
      if (!task) throw new Error('المهمة غير موجودة أو تم حذفها مسبقاً.');

      const sets = [];
      const ps = [];
      if (params.title) { sets.push('title=?'); ps.push(params.title); }
      if (params.description !== undefined) { sets.push('description=?'); ps.push(params.description); }
      if (params.due_date) { sets.push('due_date=?'); ps.push(params.due_date); }
      if (params.priority) { sets.push('priority=?'); ps.push(params.priority); }
      if (params.assignee_id) { sets.push('assignee_id=?'); ps.push(params.assignee_id); }

      if (!sets.length) return { ok: true, message: 'لا توجد بيانات جديدة لتعديلها.' };

      sets.push("updated_at=datetime('now','localtime')");
      ps.push(task.id);
      db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id=?`).run(...ps);

      audit(user, 'update', 'tasks', 'task', task.id, `تعديل مهمة: ${task.title}`);
      return {
        ok: true,
        id: task.id,
        title: params.title || task.title,
        message: `تم تعديل المهمة بنجاح: "${params.title || task.title}".`
      };
    }
  },

  // 29) تغيير حالة المهمة
  changeTaskStatus: {
    name: 'changeTaskStatus',
    title: 'تغيير حالة المهمة',
    description: 'تغيير حالة المهمة إلى مكتملة أو قيد التنفيذ أو ملغية',
    module: 'tasks',
    action: 'edit',
    isSensitive: false,
    parameters: {
      type: 'object',
      required: ['id', 'status'],
      properties: {
        id: { type: 'number', description: 'معرف المهمة' },
        status: { type: 'string', description: 'الحالة: completed, in_progress, new, cancelled' }
      }
    },
    execute: async (params, user) => {
      const task = db.prepare('SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL').get(params.id);
      if (!task) throw new Error('المهمة غير موجودة.');

      let compAt = null;
      if (params.status === 'completed') {
        compAt = require('./time').nowStr();
      }

      db.prepare("UPDATE tasks SET status=?, completed_at=?, updated_at=datetime('now','localtime') WHERE id=?")
        .run(params.status, compAt, task.id);

      const stMap = { completed: 'مكتملة ✅', in_progress: 'قيد التنفيذ ⏳', new: 'جديدة', cancelled: 'ملغية' };
      audit(user, 'update', 'tasks', 'task', task.id, `تغيير حالة المهمة إلى ${params.status}`);
      return {
        ok: true,
        id: task.id,
        status: params.status,
        message: `تم تحديث حالة المهمة "${task.title}" إلى: ${stMap[params.status] || params.status}.`
      };
    }
  },

  // 30) حذف مهمة
  deleteTask: {
    name: 'deleteTask',
    title: 'حذف مهمة',
    description: 'إلغاء وحذف مهمة من النظام',
    module: 'tasks',
    action: 'delete',
    isSensitive: true,
    parameters: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'number', description: 'معرف المهمة' }
      }
    },
    execute: async (params, user) => {
      const task = db.prepare('SELECT * FROM tasks WHERE id=? AND deleted_at IS NULL').get(params.id);
      if (!task) throw new Error('المهمة غير موجودة أو تم حذفها مسبقاً.');

      db.prepare("UPDATE tasks SET deleted_at=datetime('now','localtime') WHERE id=?").run(task.id);
      audit(user, 'delete', 'tasks', 'task', task.id, `حذف مهمة: ${task.title}`);

      return {
        ok: true,
        id: task.id,
        message: `تم حذف المهمة "${task.title}" بنجاح.`
      };
    }
  },

  // 20) الانتقال إلى صفحات النظام
  navigateToPage: {
    name: 'navigateToPage',
    title: 'الانتقال إلى صفحة',
    description: 'توجيه المستخدم إلى صفحة معينة في النظام',
    module: 'dashboard',
    action: 'view',
    isSensitive: false,
    parameters: {
      type: 'object',
      required: ['page'],
      properties: {
        page: { type: 'string', description: 'الصفحة المطلوبة: /clients, /units, /reservations, /sales, /finance, /expenses, /tasks, /appointments, /settings, /reports' }
      }
    },
    execute: async (params, user) => {
      let page = params.page || '/dashboard';
      if (!page.startsWith('/')) page = '/' + page;
      if (['/settings', '/roles', '/backup', '/users', '/ai_permissions'].includes(page)) {
        return {
          ok: false,
          error: 'لا أملك صلاحية الوصول إلى الإعدادات أو الصلاحيات أو إدارة النظام.'
        };
      }
      return {
        navigate: page,
        message: `تم الانتقال إلى صفحة ${page}`
      };
    }
  }
};

// ---------------- فحص الصلاحيات والتنفيذ الآمن ----------------
async function executeAssistantTool(toolName, params, user, { confirmed = false } = {}) {
  const tool = TOOLS[toolName];
  if (!tool) {
    logAssistantAction({
      userId: user.id,
      username: user.username,
      actionType: toolName,
      inputParams: params,
      resultStatus: 'failed',
      errorMessage: 'الأداة غير معروفة'
    });
    return { ok: false, error: `الأداة "${toolName}" غير معروفة في النظام.` };
  }

  // 1+2+3) فحص موحَّد: الاستثناء الأمني + صلاحية الذكاء الاصطناعي + صلاحية المستخدم
  if (tool.module || tool.action) {
    const perm = AIP.resolveAIPermission(tool.module, tool.action, user);
    if (!perm.allowed) {
      logAssistantAction({
        userId: user.id,
        username: user.username,
        actionType: toolName,
        inputParams: params,
        resultStatus: perm.scope === 'security' ? 'ai_security_denied' : perm.scope === 'ai' ? 'ai_permission_denied' : 'user_permission_denied',
        errorMessage: perm.reply
      });
      return { ok: false, denied: true, aiDenied: perm.scope !== 'user', error: perm.reply };
    }
  }

  // 2. فحص التأكيد للعمليات الحساسة
  if (tool.isSensitive && !confirmed) {
    logAssistantAction({
      userId: user.id,
      username: user.username,
      actionType: toolName,
      inputParams: params,
      resultStatus: 'pending_confirmation'
    });
    return {
      ok: true,
      needsConfirmation: true,
      toolName,
      title: tool.title,
      params
    };
  }

  // 3. التنفيذ الفعلي في قاعدة البيانات
  try {
    const result = await tool.execute(params, user);
    if (result && result.ok === false) {
      logAssistantAction({
        userId: user.id,
        username: user.username,
        actionType: toolName,
        inputParams: params,
        resultStatus: 'failed',
        errorMessage: result.message
      });
      return { ok: false, error: result.message, ...result };
    }
    logAssistantAction({
      userId: user.id,
      username: user.username,
      actionType: toolName,
      inputParams: params,
      resultStatus: 'success',
      entity: tool.module,
      entityId: result.id || null
    });
    return { ok: true, result };
  } catch (err) {
    logAssistantAction({
      userId: user.id,
      username: user.username,
      actionType: toolName,
      inputParams: params,
      resultStatus: 'failed',
      errorMessage: err.message,
      entity: tool.module
    });
    return { ok: false, error: err.message };
  }
}

module.exports = {
  TOOLS,
  executeAssistantTool,
  logAssistantAction,
  formatMoney
};
