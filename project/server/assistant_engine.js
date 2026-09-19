// Smart Secretary — المحرك التنفيذي الذكي للمساعد
// يحلل اللغة الطبيعية، يدير سياق المحادثة وتدفقاتها متعددة الخطوات،
// يطبق نظام صلاحيات الذكاء الاصطناعي وصلاحيات المستخدم، ويستثني الإعدادات نهائياً.
const { db, canAI, AI_MODULES, AI_ACTIONS } = require('./db');
const { can } = require('./auth');
const { TOOLS, executeAssistantTool, formatMoney } = require('./assistant_tools');
const AI = require('./ai');

const ACTION_AR = {
  view: 'عرض',
  create: 'إضافة',
  edit: 'تعديل',
  delete: 'حذف',
  search: 'البحث في',
  execute: 'تنفيذ عمليات'
};

const MODULE_AR = {
  projects: 'المشاريع',
  units: 'الوحدات',
  clients: 'العملاء',
  suppliers: 'المزودين',
  reservations: 'الحجوزات',
  appointments: 'المواعيد',
  tasks: 'المهام',
  payments: 'الدفعات',
  finance: 'الدفعات',
  expenses: 'المصروفات',
  accounts: 'الحسابات',
  reports: 'التقارير',
  contracts: 'العقود',
  quotations: 'عروض الأسعار',
  calls: 'الاتصالات',
  notes: 'الملاحظات'
};

// فحص الصلاحية المزدوجة (صلاحية الذكاء الاصطناعي + صلاحية المستخدم)
function checkDualPermission(module, action, user) {
  // 1. الإعدادات والمستخدمين والأدوار مستثناة كلياً وبشكل قاطع
  if (!module || ['settings', 'users', 'roles', 'backup', 'ai_permissions'].includes(module)) {
    return {
      allowed: false,
      reply: '⚠️ غير مسموح للذكاء الاصطناعي بالوصول إلى الإعدادات أو الصلاحيات أو البيانات الأمنية للنظام نهائياً وفق السياسات الأمنية.'
    };
  }

  // 2. فحص صلاحية الذكاء الاصطناعي أولاً
  if (!canAI(module, action)) {
    const actStr = ACTION_AR[action] || action;
    const modStr = MODULE_AR[module] || module;
    return {
      allowed: false,
      reply: `لا أملك صلاحية ${actStr} ${modStr} حالياً.`
    };
  }

  // 3. فحص صلاحية المستخدم
  const isAdmin = user && (user.role === 'admin' || user.role_id === 1 || user.username === 'admin');
  if (user && !isAdmin) {
    let userMod = module;
    if (userMod === 'suppliers') userMod = 'ai';
    if (userMod === 'payments') userMod = 'finance';
    let userAct = action;
    if (userAct === 'search') userAct = 'view';
    if (userAct === 'execute') userAct = 'edit';

    if (user.perms && !user.perms['*:*'] && !can(user.perms, userMod, userAct)) {
      const actStr = ACTION_AR[action] || action;
      const modStr = MODULE_AR[module] || module;
      return {
        allowed: false,
        reply: `⚠️ ليس لديك صلاحية ${actStr} على ${modStr}.`
      };
    }
  }

  return { allowed: true };
}

// تحميل سياق المحادثة
function loadConversationContext(convId, userId) {
  const base = {
    client: null,
    project: null,
    unit: null,
    supplier: null,
    booking: null,
    appointment: null,
    task: null,
    last_search: null,
    last_filter: null,
    pending_flow: null,
    last_question: null
  };
  if (!convId) return base;

  try {
    const row = db.prepare('SELECT context_state FROM assistant_conversations WHERE id=? AND user_id=?').get(convId, userId);
    if (row && row.context_state) {
      return { ...base, ...JSON.parse(row.context_state) };
    }
  } catch (e) {}

  return base;
}

// حفظ سياق المحادثة
function saveConversationState(convId, userId, context, userMsg, assistantReply, cards, actions, pending) {
  if (!convId) return;
  try {
    const stateStr = JSON.stringify(context);
    const existing = db.prepare('SELECT id FROM assistant_conversations WHERE id=? AND user_id=?').get(convId, userId);
    if (existing) {
      db.prepare(`UPDATE assistant_conversations SET context_state=?, updated_at=datetime('now','localtime') WHERE id=? AND user_id=?`).run(stateStr, convId, userId);
    } else {
      const title = (userMsg || 'محادثة المساعد').slice(0, 35);
      db.prepare(`INSERT INTO assistant_conversations (id, user_id, title, context_state, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`).run(convId, userId, title, stateStr);
    }

    if (userMsg) {
      db.prepare(`INSERT INTO assistant_messages (conversation_id, role, content) VALUES (?, 'user', ?)`).run(convId, userMsg);
    }
    if (assistantReply) {
      db.prepare(`INSERT INTO assistant_messages (conversation_id, role, content, cards, actions, pending) VALUES (?, 'assistant', ?, ?, ?, ?)`).run(
        convId,
        assistantReply,
        cards ? JSON.stringify(cards) : null,
        actions ? JSON.stringify(actions) : null,
        pending ? JSON.stringify(pending) : null
      );
    }
  } catch (e) {
    console.error('[AssistantEngine] saveConversationState error:', e.message);
  }
}

// دالة لتنظيف النص
const clean = (s) => (s || '').trim();

// استخراج الأرقام من النص (يدعم الأرقام العربية والإنجليزية مثل 50 ألف أو 50000 أو 50,000)
function parseNumber(text) {
  if (!text) return null;
  const t = text.replace(/،/g, '').replace(/,/g, '');
  // فحص صيغ مثل: 50 ألف أو 50 الف
  const kMatch = /(\d+(?:\.\d+)?)\s*(?:ألف|الف|k)/i.exec(t);
  if (kMatch) {
    return Math.round(parseFloat(kMatch[1]) * 1000);
  }
  // فحص صيغ مثل: مليون
  const mMatch = /(\d+(?:\.\d+)?)\s*(?:مليون|m)/i.exec(t);
  if (mMatch) {
    return Math.round(parseFloat(mMatch[1]) * 1000000);
  }
  // فحص الأرقام العادية
  const numMatch = /\b\d+(?:\.\d+)?\b/.exec(t);
  return numMatch ? parseFloat(numMatch[0]) : null;
}

// استخراج رقم الجوال السعودي
function parsePhone(text) {
  const m = /(05\d{8}|(?:\+?9665\d{8}))/.exec(text.replace(/[-\s]/g, ''));
  return m ? m[0] : null;
}

// دالة تحليل التاريخ النسبي أو الصريح بالعربية
function parseArabicDate(text) {
  if (!text) return null;
  const now = new Date();
  const t = text.replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

  if (/اليوم|هذا اليوم/i.test(t)) {
    return now.toISOString().slice(0, 10);
  }
  if (/بعد\s*(?:بكرة|باكر|غد|غداً)/i.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  }
  if (/غدا|غداً|بكرة|باكر|الغد/i.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  const daysMatch = /بعد\s*(\d+)\s*(?:أيام|ايام|يوم)/i.exec(t);
  if (daysMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + parseInt(daysMatch[1], 10));
    return d.toISOString().slice(0, 10);
  }
  if (/(?:بعد\s*(?:أسبوع|اسبوع)|(?:الأسبوع|الاسبوع)\s*(?:القادم|الجاي))/i.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }

  const weekdays = {
    'أحد': 0, 'الاحد': 0, 'الأحد': 0,
    'اثنين': 1, 'الإثنين': 1, 'الاثنين': 1,
    'ثلاثاء': 2, 'الثلاثاء': 2,
    'أربعاء': 3, 'الاربعاء': 3, 'الأربعاء': 3,
    'خميس': 4, 'الخميس': 4,
    'جمعة': 5, 'الجمعة': 5,
    'سبت': 6, 'السبت': 6
  };
  for (const [dayName, dayIndex] of Object.entries(weekdays)) {
    const regex = new RegExp('(?:يوم\\s*)?' + dayName, 'i');
    if (regex.test(t)) {
      const currentDay = now.getDay();
      let diff = dayIndex - currentDay;
      if (diff <= 0) diff += 7;
      const d = new Date(now);
      d.setDate(d.getDate() + diff);
      return d.toISOString().slice(0, 10);
    }
  }

  const explicit = /(\d{4}[-/]\d{1,2}[-/]\d{1,2})|(\d{1,2}[-/]\d{1,2}[-/]\d{4})/.exec(t);
  if (explicit) {
    const raw = explicit[0].replace(/\//g, '-');
    const parts = raw.split('-');
    if (parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    } else {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }

  return null;
}

// دالة تحليل الوقت بالعربية
function parseArabicTime(text) {
  if (!text) return null;
  const t = text.replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

  const m = /(?:الساعة\s*|ساعة\s*)?(\d{1,2})(?::(\d{2}))?\s*(صباحا|صباحاً|ص|مساء|مساءً|عصرا|عصراً|م|الظهر|بالليل|ليلا|ليلاً)?/i.exec(t);
  if (m) {
    let hour = parseInt(m[1], 10);
    const minute = m[2] ? m[2].padStart(2, '0') : '00';
    const period = m[3] ? m[3].trim() : '';

    if (/مساء|مساءً|عصرا|عصراً|م|بالليل|ليلا|ليلاً/i.test(period)) {
      if (hour < 12) hour += 12;
    } else if (/صباحا|صباحاً|ص/i.test(period)) {
      if (hour === 12) hour = 0;
    } else {
      if (hour >= 1 && hour <= 7 && /(?:غير|أجل|قدم|موعد|الساعة\s*[1-7])/i.test(t)) {
        hour += 12;
      }
    }
    return `${String(hour).padStart(2, '0')}:${minute}`;
  }
  return null;
}

// دالة استخراج اسم العميل
function extractClientName(text) {
  if (!text) return null;
  const m1 = /(?:مع العميل|للعميل|العميل|مع)\s+([^\s,،.]+)/i.exec(text);
  if (m1) {
    let name = m1[1].replace(/^(?:الـ|لـ)/, '').trim();
    if (!/^(?:يوم|الساعة|ساعة|تاريخ|الوحدة|العقار|غدا|غداً|بكرة|هذا|هذه|كل|لي|جديد|جديدة|التقويم|الأسبوع|الاسبوع)$/.test(name)) {
      return name;
    }
  }

  const m2 = /(?:^|\s+)ل(?:ـ)?([^\s,،.]+)/i.exec(text);
  if (m2) {
    let name = m2[1].trim();
    if (!/^(?:ي|نا|هم|ها|كم|يوم|الساعة|ساعة|تاريخ|الوحدة|العقار|غدا|غداً|بكرة|هذا|هذه|كل|مناقشة|متابعة|معاينة|تسليم|زيارة)$/.test(name)) {
      return name;
    }
  }

  const m3 = /(?:موعد|مهمة)\s+([^\s,،.]+)/i.exec(text);
  if (m3) {
    let name = m3[1].replace(/^(?:الـ|لـ)/, '').trim();
    if (!/^(?:مع|لي|جديد|جديدة|اليوم|غدا|غداً|بكرة|الأسبوع|الاسبوع|القادم|القادمة|المتأخرة|مكتملة)$/.test(name)) {
      return name;
    }
  }

  return null;
}

// دالة استخراج تفاصيل المهمة
function extractTaskDetails(text) {
  let title = '';
  let unitCode = null;

  const uMatch = /(?:الوحدة|عقار|شقة|فيلا|وحدة)\s*(\d+|[A-Za-z0-9-]+)/i.exec(text);
  if (uMatch) {
    unitCode = uMatch[1];
  }

  const followMatch = /(?:مهمة\s+(?:لـ|ل)?)((?:متابعة|مناقشة|تسليم|تجهيز|اتصال|مراجعة|زيارة|معاينة)[^,،.]+)/i.exec(text);
  if (followMatch) {
    title = followMatch[1].trim();
    title = title.replace(/(?:وخلي|وخل|خل|على أن يكون|تاريخها|موعدها|استحقاقها|قبل|بعد)\s*.*$/i, '').trim();
    return { title, unitCode };
  }

  let cleanT = text
    .replace(/^(?:أضف|اضف|انشئ|أنشئ|سجل|سو|اعمل|حط)\s*(?:لي)?\s*(?:مهمة|task)\s*(?:جديدة)?\s*(?:لـ?[^\s,،]+)?\s*[,،]?\s*/i, '')
    .replace(/(?:وخلي|وخل|خل|على أن يكون|تاريخها|موعدها|استحقاقها|قبل|بعد)\s*.*$/i, '')
    .trim();

  cleanT = cleanT.replace(/^[،,\s-]+|[،,\s-]+$/g, '');
  title = cleanT.length > 3 ? cleanT : 'مهمة جديدة';

  return { title, unitCode };
}

// دالة استخراج تفاصيل الموعد
function extractAppointmentDetails(text) {
  let title = '';
  const client = extractClientName(text);
  const date = parseArabicDate(text);
  const time = parseArabicTime(text);

  const topicMatch = /(?:لمناقشة|لمعاينة|لتوقيع|لزيارة|بخصوص|عن|حول)\s+([^,،.]+)/i.exec(text);
  if (topicMatch) {
    title = topicMatch[0].trim();
  } else if (client) {
    title = `موعد مع ${client}`;
  } else {
    title = 'موعد جديد';
  }

  return { client, date, time, title };
}

// مطابقة الصفحات للتنقل
const PAGE_ROUTES = {
  'حجوزات': '/reservations',
  'حجز': '/reservations',
  'مبيعات': '/sales',
  'بيع': '/sales',
  'عملاء': '/clients',
  'عميل': '/clients',
  'عقارات': '/units',
  'وحدات': '/units',
  'عقار': '/units',
  'مالية': '/finance',
  'دفعات': '/finance',
  'حسابات': '/finance',
  'مصروفات': '/expenses',
  'مهام': '/tasks',
  'مواعيد': '/appointments',
  'تقارير': '/reports'
};

// دالة رئيسية لمعالجة طلب المستخدم
async function processAssistantRequest({ text, messages, confirmed = false, pending = null, user, conversation_id = null }) {
  const userText = clean(text || (messages && messages[messages.length - 1]?.content) || '');
  const convId = conversation_id || (user ? `conv_u${user.id}_default` : 'conv_default');
  let context = loadConversationContext(convId, user?.id);

  function respond(payload) {
    const p = {
      reply: payload.reply || '',
      cards: payload.cards || [],
      actions: payload.actions || [],
      navigate: payload.navigate || null,
      hasPending: !!payload.hasPending,
      pending: payload.pending || null,
      isError: !!payload.isError,
      conversation_id: convId,
      context: context
    };
    saveConversationState(convId, user?.id, context, userText, p.reply, p.cards, p.actions, p.pending);
    return p;
  }

  // ---------------- 0. استثناء الإعدادات والصلاحيات نهائياً ----------------
  if (/(?:إعدادات|اعدادات|صلاحيات|ضبط النظام|مستخدم|المستخدم|كلمة المرور|الباسورد|النسخ الاحتياطي|سجل التدقيق|النسخة الاحتياطية)/i.test(userText) && !/ما هي صلاحياتك|صلاحياتك/i.test(userText)) {
    return respond({
      reply: '⚠️ غير مسموح للذكاء الاصطناعي بالوصول إلى الإعدادات أو الصلاحيات أو إدارة المستخدمين أو البيانات الأمنية للنظام نهائياً وفق السياسات الأمنية الصارمة.',
      isError: true
    });
  }

  // ---------------- 1. معالجة التأكيد إذا وُجد طلب معلق ----------------
  if (confirmed && pending) {
    let checkMod = 'projects', checkAct = 'execute';
    if (pending.action === 'createBooking') { checkMod = 'reservations'; checkAct = 'create'; }
    else if (pending.action === 'createPayment') { checkMod = 'payments'; checkAct = 'create'; }
    else if (pending.action === 'createExpense') { checkMod = 'expenses'; checkAct = 'create'; }
    else if (pending.action === 'createCustomer') { checkMod = 'clients'; checkAct = 'create'; }
    else if (pending.action === 'createProperty') { checkMod = 'units'; checkAct = 'create'; }
    else if (pending.action.startsWith('createAppointment')) { checkMod = 'appointments'; checkAct = 'create'; }
    else if (pending.action.startsWith('updateAppointment') || pending.action.startsWith('changeAppointment')) { checkMod = 'appointments'; checkAct = 'edit'; }
    else if (pending.action.startsWith('deleteAppointment')) { checkMod = 'appointments'; checkAct = 'delete'; }
    else if (pending.action.startsWith('createTask')) { checkMod = 'tasks'; checkAct = 'create'; }
    else if (pending.action.startsWith('updateTask') || pending.action.startsWith('changeTask')) { checkMod = 'tasks'; checkAct = 'edit'; }
    else if (pending.action.startsWith('deleteTask')) { checkMod = 'tasks'; checkAct = 'delete'; }
    else if (pending.action === 'deleteClient') { checkMod = 'clients'; checkAct = 'delete'; }

    const permCheck = checkDualPermission(checkMod, checkAct, user);
    if (!permCheck.allowed) {
      return respond({ reply: permCheck.reply, isError: true });
    }

    const res = await executeAssistantTool(pending.action, pending.params, user, { confirmed: true });
    if (!res.ok) {
      return respond({
        reply: `⚠️ فشلت العملية: ${res.error || 'حدث خطأ أثناء التنفيذ'}`,
        isError: true,
        cards: []
      });
    }
    const r = res.result || {};
    let nav = null;
    if (pending.action === 'createBooking') {
      nav = '/reservations';
      context.booking = r;
      if (r.client_id) context.client = { id: r.client_id, name: r.client_name };
      if (r.unit_id) context.unit = { id: r.unit_id, code: r.unit_code };
    } else if (pending.action === 'createPayment') {
      nav = '/finance';
    } else if (pending.action === 'createExpense') {
      nav = '/expenses';
    } else if (pending.action === 'createCustomer') {
      nav = '/clients';
      context.client = r;
    } else if (pending.action === 'createProperty') {
      nav = '/units';
      context.unit = r;
    } else if (['createAppointment', 'updateAppointment', 'deleteAppointment', 'changeAppointmentStatus'].includes(pending.action)) {
      nav = '/appointments';
      if (pending.action === 'createAppointment') context.appointment = r.appointment || r;
      else if (pending.action === 'deleteAppointment') context.appointment = null;
    } else if (['createTask', 'updateTask', 'deleteTask', 'changeTaskStatus'].includes(pending.action)) {
      nav = '/tasks';
      if (pending.action === 'createTask') context.task = r.task || r;
      else if (pending.action === 'deleteTask') context.task = null;
    } else if (pending.action === 'deleteClient') {
      nav = '/clients';
      context.client = null;
    }

    context.pending_flow = null;
    return respond({
      reply: `✅ ${r.message || 'تم تنفيذ العملية بنجاح!'}`,
      cards: [{ title: r.code || r.receipt_no || 'تفاصيل العملية', sub: r.message, link: nav }],
      actions: nav ? [{ label: 'فتح في النظام', link: nav }] : []
    });
  }

  // إذا كتب المستخدم كلمة تأكيد مثل "نعم" أو "أكد" أو "نفذ" وكان هناك pending في الجلسة
  if (pending && /^(نعم|أكد|اكد|تأكيد|تاكيد|موافق|نفذ|تمام|اوكي|ok|yes)$/i.test(userText.trim())) {
    return processAssistantRequest({ text: '', confirmed: true, pending, user, conversation_id: convId });
  }

  // إذا كتب المستخدم كلمة إلغاء مثل "لا" أو "إلغاء" أو "تراجع" وكان هناك pending أو تدفق معلق
  if ((pending || context.pending_flow) && /^(لا|إلغاء|الغاء|تراجع|كنسل|cancel|no)$/i.test(userText.trim())) {
    context.pending_flow = null;
    return respond({
      reply: 'تم إلغاء الإجراء ولم يتم تنفيذ أي تغيير على النظام.',
      hasPending: false,
      pending: null
    });
  }

  // ---------------- 1.5 معالجة التدفقات المعلقة متعددة الخطوات (Pending Flows) ----------------

  // أ) تدفق إنشاء موعد ينتظر وقتاً: "الساعة 5"
  if (context.pending_flow?.type === 'createAppointment' && context.pending_flow?.waiting_for === 'time') {
    const timeMatch = parseArabicTime(userText) || (/\b(\d{1,2})\b/.test(userText) ? `${String(parseInt(userText.match(/\b\d{1,2}\b/)[0])).padStart(2, '0')}:00` : null);
    if (timeMatch) {
      const data = context.pending_flow.data || {};
      const perm = checkDualPermission('appointments', 'create', user);
      if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

      const toolRes = await executeAssistantTool('createAppointment', {
        title: data.title || `موعد مع ${data.client || 'العميل'}`,
        client_name: data.client,
        date: data.date || new Date().toISOString().slice(0, 10),
        start_time: timeMatch
      }, user);

      if (!toolRes.ok) return respond({ reply: toolRes.error, isError: true });
      const r = toolRes.result || {};
      context.appointment = r.appointment || r;
      context.pending_flow = null;

      return respond({
        reply: `✅ تم جدولة الموعد بنجاح!\n• العنوان: ${r.appointment?.title || r.title || 'موعد'}\n• العميل: ${r.appointment?.client_name || data.client || '—'}\n• التاريخ: ${r.appointment?.date || data.date}\n• الوقت: ${r.appointment?.start_time || timeMatch}`,
        cards: [{
          title: `${r.appointment?.title || r.title || 'موعد'} — ${r.appointment?.date || data.date} (${r.appointment?.start_time || timeMatch})`,
          sub: `العميل: ${r.appointment?.client_name || data.client || '—'} | الحالة: مجدول`,
          link: '/appointments'
        }],
        actions: [{ label: 'عرض التقويم والمواعيد', link: '/appointments' }]
      });
    }
  }

  // ب) تدفق إنشاء حجز ينتظر كود الوحدة: "101-A1" أو "UNIT-25" أو "25"
  if (context.pending_flow?.type === 'createBooking' && context.pending_flow?.waiting_for === 'unit') {
    const perm = checkDualPermission('units', 'view', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

    const cleanInput = userText.replace(/^(?:الوحدة|وحدة|عقار|العقار)\s*/i, '').trim();
    const unit = db.prepare('SELECT u.*, p.name project_name FROM units u LEFT JOIN projects p ON p.id=u.project_id WHERE (u.code = ? OR u.code LIKE ? OR u.id = ?) AND u.deleted_at IS NULL LIMIT 1').get(cleanInput, `%${cleanInput}%`, parseInt(cleanInput) || -1);
    if (unit) {
      context.unit = unit;
      context.pending_flow.data.unit = unit;
      context.pending_flow.waiting_for = 'price';
      return respond({
        reply: `تم تحديد العقار: **${unit.code}** في ${unit.project_name || 'المشروع'}.\nالسعر المعلن: ${formatMoney(unit.price)} ريال.\nما هو مبلغ الحجز أو العربون المطلوب؟ (مثال: 50,000 ريال)`
      });
    } else {
      return respond({
        reply: `لم يتم العثور على وحدة برمز "${cleanInput}". يرجى كتابة رمز الوحدة (مثال: 101-A1).`
      });
    }
  }

  // ج) تدفق إنشاء حجز ينتظر السعر: "50000" أو "50 ألف"
  if (context.pending_flow?.type === 'createBooking' && context.pending_flow?.waiting_for === 'price') {
    const price = parseNumber(userText);
    if (price) {
      const perm = checkDualPermission('reservations', 'create', user);
      if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

      const client = context.pending_flow.data.client || context.client;
      const unit = context.pending_flow.data.unit || context.unit;
      context.pending_flow = null;
      return respond({
        reply: `يرجى تأكيد تفاصيل الحجز:\n• العميل: ${client?.name || '—'}\n• العقار: ${unit?.code || '—'} (${unit?.project_name || 'مشروع'})\n• قيمة الحجز / العربون: ${formatMoney(price)} ريال\n\nهل تريد تأكيد الحجز الآن؟`,
        hasPending: true,
        pending: {
          action: 'createBooking',
          params: { client_id: client?.id, unit_id: unit?.id, deposit: price }
        },
        cards: [{
          title: `حجز للوحدة ${unit?.code || ''}`,
          sub: `العميل: ${client?.name || ''} | العربون: ${formatMoney(price)} ريال`,
          link: '/reservations'
        }]
      });
    } else {
      return respond({ reply: 'يرجى إدخال مبلغ الحجز بالأرقام (مثال: 50,000 أو 50 ألف).' });
    }
  }

  // ---------------- 1.6 متابعات وسياق المحادثة (Follow-ups) ----------------

  // أ) فلترة العملاء الذين لديهم حجوزات: "اللي عندهم حجوزات" أو "المحجوز لهم"
  if (/(?:اللي|الذين|معهم|لديهم|عندهم|اصحاب|أصحاب)\s*(?:حجوزات|حجز|الحجوزات)/i.test(userText) || /(?:المحجوز\s*لهم)/i.test(userText)) {
    const perm = checkDualPermission('clients', 'view', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

    const rows = db.prepare(`
      SELECT c.id, c.code, c.name, c.phone, COUNT(r.id) as booking_count
      FROM clients c
      JOIN reservations r ON r.client_id = c.id
      WHERE c.deleted_at IS NULL AND r.status != 'cancelled'
      GROUP BY c.id
      ORDER BY booking_count DESC
      LIMIT 10
    `).all();

    if (!rows.length) {
      return respond({ reply: 'لا يوجد عملاء لديهم حجوزات نشطة حالياً.' });
    }
    context.last_search = { type: 'clients', filter: 'with_reservations', items: rows };
    if (rows.length === 1) context.client = rows[0];

    return respond({
      reply: `قائمة العملاء الذين لديهم حجوزات نشطة (${rows.length} عميل):`,
      cards: rows.map(c => ({
        title: c.name,
        sub: `كود: ${c.code} | هاتف: ${c.phone || '—'} | عدد الحجوزات: ${c.booking_count}`,
        link: '/clients'
      })),
      actions: [{ label: 'عرض العملاء', link: '/clients' }, { label: 'عرض الحجوزات', link: '/reservations' }]
    });
  }

  // ب) عرض وحدات المشروع الحالي في السياق: "ورني الوحدات" أو "الوحدات اللي فيه"
  if (/(?:ورني|اعرض|عرض|وش|ما هي|وين)?\s*(?:الوحدات|وحدات|عقارات)\s*(?:اللي فيه|الخاصة به|بالمشروع|حقه|حقتها)?/i.test(userText) || /^(?:ورني الوحدات|عرض الوحدات|الوحدات)$/i.test(userText.trim())) {
    const perm = checkDualPermission('units', 'view', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

    let projId = context.project?.id;
    let pName = context.project?.name;

    const pMatch = /(?:في|بـ|بمشروع|في مشروع)\s+([^,،.]+)/i.exec(userText);
    if (pMatch) {
      const foundP = db.prepare('SELECT * FROM projects WHERE name LIKE ? AND deleted_at IS NULL LIMIT 1').get(`%${pMatch[1].trim()}%`);
      if (foundP) {
        projId = foundP.id;
        pName = foundP.name;
        context.project = foundP;
      }
    }

    let units = [];
    if (projId) {
      units = db.prepare('SELECT u.*, p.name project_name FROM units u LEFT JOIN projects p ON p.id=u.project_id WHERE u.project_id=? AND u.deleted_at IS NULL ORDER BY u.id DESC LIMIT 10').all(projId);
    } else {
      units = db.prepare('SELECT u.*, p.name project_name FROM units u LEFT JOIN projects p ON p.id=u.project_id WHERE u.deleted_at IS NULL ORDER BY u.id DESC LIMIT 10').all();
    }

    if (!units.length) {
      return respond({ reply: pName ? `لا توجد وحدات مسجلة في مشروع "${pName}".` : 'لا توجد وحدات متاحة حالياً.' });
    }

    context.last_search = { type: 'units', project_id: projId, items: units };
    return respond({
      reply: pName ? `الوحدات المسجلة في مشروع **${pName}** (${units.length} وحدة):` : `قائمة الوحدات (${units.length} وحدة):`,
      cards: units.map(u => ({
        title: `${u.code} - ${u.type || 'عقار'}`,
        sub: `السعر: ${formatMoney(u.price)} | الحالة: ${u.status || 'متاح'} | الغرف: ${u.rooms || '—'}`,
        link: '/units'
      })),
      actions: [{ label: 'عرض الوحدات', link: '/units' }]
    });
  }

  // ج) عرض أو البحث عن مشروع بالاسم: "اعرض لي مشروع 101" / "اعرض لي مشروع الرياض" / "مشروع الرياض"
  if (/(?:مشروع|المشروع)\s+([^,،.]+)/i.test(userText) && !/(?:وحدات|الوحدات)/i.test(userText)) {
    const pMatch = /(?:مشروع|المشروع)\s+([^,،.]+)/i.exec(userText);
    const pName = pMatch ? pMatch[1].trim() : '';
    const perm = checkDualPermission('projects', 'view', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

    let proj = db.prepare('SELECT * FROM projects WHERE (name LIKE ? OR code = ?) AND deleted_at IS NULL LIMIT 1').get(`%${pName}%`, pName);
    if (!proj) {
      // محاولة البحث عن أي مشروع
      proj = db.prepare('SELECT * FROM projects WHERE deleted_at IS NULL LIMIT 1').get();
    }
    if (proj) {
      context.project = proj;
      return respond({
        reply: `تم العثور على المشروع:\n• الاسم: **${proj.name}**\n• الكود: ${proj.code}\n• الموقع: ${proj.location || '—'}\n• الحالة: ${proj.status || 'نشط'}`,
        cards: [{
          title: proj.name,
          sub: `كود: ${proj.code} | الموقع: ${proj.location || '—'}`,
          link: '/projects'
        }],
        actions: [
          { label: 'عرض المشروع', link: '/projects' },
          { label: 'ورني الوحدات', link: '/units' }
        ]
      });
    } else {
      return respond({ reply: `لم يتم العثور على أي مشروع مسجل باسم "${pName}".` });
    }
  }

  // د) حذف بالسياق: "احذفها" أو "احذفه"
  if (/^(?:احذفها|احذفه|الغيها|الغها|امسحها|امسحه)$/i.test(userText.trim())) {
    if (context.task) {
      const perm = checkDualPermission('tasks', 'delete', user);
      if (!perm.allowed) return respond({ reply: perm.reply, isError: true });
      return respond({
        reply: `⚠️ هل أنت متأكد من حذف المهمة "${context.task.title}"؟`,
        hasPending: true,
        pending: { action: 'deleteTask', params: { id: context.task.id } }
      });
    } else if (context.appointment) {
      const perm = checkDualPermission('appointments', 'delete', user);
      if (!perm.allowed) return respond({ reply: perm.reply, isError: true });
      return respond({
        reply: `⚠️ هل أنت متأكد من حذف الموعد "${context.appointment.title}"؟`,
        hasPending: true,
        pending: { action: 'deleteAppointment', params: { id: context.appointment.id } }
      });
    } else if (context.client) {
      const perm = checkDualPermission('clients', 'delete', user);
      if (!perm.allowed) return respond({ reply: perm.reply, isError: true });
      return respond({
        reply: `⚠️ هل أنت متأكد من حذف العميل "${context.client.name}"؟`,
        hasPending: true,
        pending: { action: 'deleteClient', params: { id: context.client.id } }
      });
    } else {
      return respond({ reply: 'ما هو العنصر الذي ترغب في حذفه؟ (مهمة، موعد، أو عميل).' });
    }
  }

  // هـ) حجز بالسياق: "سوي له حجز" أو "احجز له"
  if (/(?:سوي|سو|اعمل|احجز)\s*(?:له|لها|لهم)\s*حجز/i.test(userText) || /(?:احجز له|احجز لها)/i.test(userText)) {
    if (!context.client) {
      return respond({ reply: 'يرجى تحديد العميل الذي ترغب بالحجز له أولاً.' });
    }
    const perm = checkDualPermission('reservations', 'create', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

    if (context.unit) {
      return respond({
        reply: `هل ترغب بحجز الوحدة **${context.unit.code}** للعميل **${context.client.name}** بمبلغ ${formatMoney(context.unit.price)} ريال؟`,
        hasPending: true,
        pending: {
          action: 'createBooking',
          params: { client_id: context.client.id, unit_id: context.unit.id, deposit: 5000 }
        }
      });
    }

    context.pending_flow = { type: 'createBooking', data: { client: context.client }, waiting_for: 'unit' };
    return respond({
      reply: `تم تحديد العميل **${context.client.name}**. ما هي الوحدة أو العقار المراد حجزه؟ (مثال: UNIT-25)`
    });
  }

  // و) حذف عميل بالاسم: "احذف العميل أحمد"
  if (/(?:احذف|حذف|مسح)\s*(?:لي)?\s*(?:العميل|عميل)\s+([^,،.]+)/i.test(userText)) {
    const cMatch = /(?:العميل|عميل)\s+([^,،.]+)/i.exec(userText);
    const cName = cMatch ? cMatch[1].trim() : '';
    const perm = checkDualPermission('clients', 'delete', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

    const client = db.prepare('SELECT * FROM clients WHERE name LIKE ? AND deleted_at IS NULL LIMIT 1').get(`%${cName}%`);
    if (!client) {
      return respond({ reply: `لم يتم العثور على العميل "${cName}" لحذفه.` });
    }
    context.client = client;
    return respond({
      reply: `⚠️ هل أنت متأكد من حذف العميل "${client.name}" (${client.code}) نهائياً؟`,
      hasPending: true,
      pending: { action: 'deleteClient', params: { id: client.id } },
      cards: [{ title: client.name, sub: `كود: ${client.code} | هاتف: ${client.phone || '—'}`, link: '/clients' }]
    });
  }

  // ز) عرض العملاء: "اعرض لي العملاء" / "ورني العملاء"
  if (/(?:اعرض|ورني|عرض|هات|قائمة)\s*(?:لي)?\s*(?:العملاء|عملاء)/i.test(userText) && !/(?:حجوزات|حجز)/i.test(userText)) {
    const perm = checkDualPermission('clients', 'view', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

    const clients = db.prepare('SELECT * FROM clients WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 10').all();
    context.last_search = { type: 'clients', items: clients };
    return respond({
      reply: `قائمة العملاء (${clients.length} عميل):`,
      cards: clients.map(c => ({
        title: c.name,
        sub: `كود: ${c.code} | هاتف: ${c.phone || '—'} | بريد: ${c.email || '—'}`,
        link: '/clients'
      })),
      actions: [{ label: 'عرض كل العملاء', link: '/clients' }]
    });
  }

  // ---------------- 1.7 حل الإحالات الترتيبية والضمائر والأوامر السياقية القصيرة ----------------

  // أ) اختيار عنصر من القائمة السابقة بالترتيب: "الأول"، "الثاني"، "رقم 1"، "2"
  const ordinalMatch = /^(?:الأول|الاول|الأولى|الاولى|رقم\s*1|واحد|1|خيار\s*1)$/i.test(userText.trim()) ? 0
    : /^(?:الثاني|الثانيه|الثانية|رقم\s*2|اثنين|2|خيار\s*2)$/i.test(userText.trim()) ? 1
    : /^(?:الثالث|الثالثه|الثالثة|رقم\s*3|ثلاثة|3|خيار\s*3)$/i.test(userText.trim()) ? 2
    : /^(?:الرابع|الرابعه|الرابعة|رقم\s*4|أربعة|اربعة|4|خيار\s*4)$/i.test(userText.trim()) ? 3
    : null;

  if (ordinalMatch !== null && context.last_search?.items && context.last_search.items[ordinalMatch]) {
    const selected = context.last_search.items[ordinalMatch];
    const searchType = context.last_search.type;

    if (searchType === 'clients') {
      context.client = selected;
      return respond({
        reply: `تم تحديد العميل: **${selected.name}** (${selected.code}).\n• رقم الجوال: ${selected.phone || '—'}\nما هو الإجراء المطلوب للعميل؟ (إنشاء حجز، موعد، مهمة، أو استعراض حسابه).`,
        cards: [{
          title: selected.name,
          sub: `كود: ${selected.code} | هاتف: ${selected.phone || '—'}`,
          link: '/clients'
        }],
        actions: [
          { label: 'سوي له حجز', link: '/reservations' },
          { label: 'جدولة موعد', link: '/appointments' },
          { label: 'إضافة مهمة', link: '/tasks' }
        ]
      });
    }

    if (searchType === 'units') {
      context.unit = selected;
      return respond({
        reply: `تم تحديد العقار: **${selected.code}** في ${selected.project_name || 'المشروع'}.\n• السعر: ${formatMoney(selected.price)} ريال | الغرف: ${selected.rooms || '—'} | الحالة: ${selected.status === 'available' ? 'متاح' : selected.status}.\nهل ترغب بإنشاء حجز لهذا العقار؟`,
        cards: [{
          title: `${selected.code} — ${selected.type || 'عقار'}`,
          sub: `السعر: ${formatMoney(selected.price)} | الحالة: ${selected.status || 'متاح'}`,
          link: '/units'
        }],
        actions: [
          { label: 'حجز هذه الوحدة', link: '/reservations' }
        ]
      });
    }

    if (searchType === 'projects') {
      context.project = selected;
      return respond({
        reply: `تم تحديد المشروع: **${selected.name}** (${selected.code}).\nيمكنك الآن استعراض وحداته بكتابة "ورني الوحدات".`,
        cards: [{
          title: selected.name,
          sub: `كود: ${selected.code} | الموقع: ${selected.location || '—'}`,
          link: '/projects'
        }],
        actions: [
          { label: 'ورني الوحدات', link: '/units' }
        ]
      });
    }

    if (searchType === 'suppliers') {
      context.supplier = selected;
      return respond({
        reply: `تم تحديد المزود: **${selected.name}** (${selected.code}).\n• النوع: ${selected.type || 'AI Provider'} | النماذج: ${selected.model_count || 0}.`,
        cards: [{
          title: `${selected.name} (${selected.code})`,
          sub: `النوع: ${selected.type || 'AI Provider'} | الحالة: نشط`,
          link: '/settings'
        }]
      });
    }
  }

  // ب) استدعاء الكيان السابق: "نفس السابق" / "نفسه" / "نفسها" / "نفس العميل" / "نفس الوحدة"
  if (/^(?:نفس\s*السابق|نفسه|نفسها|نفس\s*العميل|نفس\s*الوحدة|نفس\s*المشروع|السابق)$/i.test(userText.trim())) {
    if (userText.includes('مشروع') && context.project) {
      return respond({
        reply: `المشروع الحالي في السياق هو: **${context.project.name}** (${context.project.code}).\nهل تود استعراض وحداته؟`,
        actions: [{ label: 'ورني الوحدات', link: '/units' }]
      });
    }
    if (userText.includes('وحدة') && context.unit) {
      return respond({
        reply: `الوحدة الحالية في السياق هي: **${context.unit.code}** (السعر: ${formatMoney(context.unit.price)} ريال).\nهل ترغب بإنشاء حجز لها؟`,
        actions: [{ label: 'حجز الوحدة', link: '/reservations' }]
      });
    }
    if (context.client) {
      return respond({
        reply: `العميل الحالي في المحادثة هو: **${context.client.name}** (${context.client.code}).\nما الذي تود القيام به؟ (حجز، موعد، مهمة، أو استعراض رصيده).`,
        cards: [{ title: context.client.name, sub: `كود: ${context.client.code} | هاتف: ${context.client.phone || '—'}`, link: '/clients' }],
        actions: [
          { label: 'سوي له حجز', link: '/reservations' },
          { label: 'كم باقي عليه؟', link: '/finance' }
        ]
      });
    } else if (context.unit) {
      return respond({
        reply: `العقار الحالي في المحادثة هو: **${context.unit.code}**.\nما الإجراء المطلوب بشأنه؟`,
        actions: [{ label: 'حجز الوحدة', link: '/reservations' }]
      });
    } else if (context.project) {
      return respond({
        reply: `المشروع الحالي هو: **${context.project.name}**.\nهل تود استعراض وحداته؟`,
        actions: [{ label: 'ورني الوحدات', link: '/units' }]
      });
    } else {
      return respond({ reply: 'لا يوجد عنصر أو عميل محدد مسبقاً في هذه المحادثة.' });
    }
  }

  // ج) طلب تعديل الكيان بالسياق: "عدلها" / "عدله"
  if (/^(?:عدلها|عدله|تعديلها|تعديله|تعديل)$/i.test(userText.trim())) {
    if (context.task) {
      return respond({
        reply: `ترغب بتعديل المهمة: "${context.task.title}".\nما هو التعديل المطلوب؟ يمكنك القول: "حول حالتها إلى مكتملة" أو "غير الأولوية إلى عالية".`
      });
    } else if (context.appointment) {
      return respond({
        reply: `ترغب بتعديل الموعد: "${context.appointment.title}".\nما هو التعديل المطلوب؟ يمكنك القول: "أجل الموعد إلى الغد" أو "غير الموعد إلى الساعة 5".`
      });
    } else if (context.unit || context.project) {
      return respond({
        reply: '⚠️ تعديل المشاريع والوحدات محصور بالمدير العام فقط من لوحة التحكم، ولا يمكن تعديلها عبر الأوامر السريعة.'
      });
    } else {
      return respond({ reply: 'ما هو العنصر الذي ترغب في تعديله؟ (مهمة أو موعد).' });
    }
  }

  // ---------------- 2. فحص الأوامر المباشرة باللغة الطبيعية (Intent Matcher) ----------------

  // ==================== [أولاً: المواعيد — Appointments] ====================

  // 1) حذف أو إلغاء موعد: "احذف موعد أحمد", "الغي موعد أحمد"
  if (/(?:احذف|إحذف|حذف|الغي|ألغي|إلغاء|الغ|مسح)\s*(?:لي)?\s*موعد/i.test(userText)) {
    const perm = checkDualPermission('appointments', 'delete', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });
    const clientName = extractClientName(userText);
    const date = parseArabicDate(userText);

    const searchRes = await executeAssistantTool('searchAppointments', {
      client_name: clientName || undefined,
      date: date || undefined,
      status: 'scheduled',
      limit: 5
    }, user);

    const appts = searchRes.ok ? (searchRes.result.appointments || []) : [];
    if (!appts.length) {
      return {
        reply: clientName 
          ? `لم يتم العثور على أي موعد مجدول للعميل "${clientName}" لحذفه.`
          : 'يرجى تحديد اسم العميل أو تاريخ الموعد الذي ترغب في حذفه (مثال: احذف موعد أحمد).'
      };
    }

    const target = appts[0];
    return {
      reply: `⚠️ هل أنت متأكد من حذف الموعد "${target.title}" مع ${target.client_name || 'العميل'} بتاريخ ${target.date} الساعة ${target.start_time}؟`,
      hasPending: true,
      pending: {
        action: 'deleteAppointment',
        params: { id: target.id }
      },
      cards: [{
        title: target.title,
        sub: `التاريخ: ${target.date} ${target.start_time} | العميل: ${target.client_name || '—'}`,
        link: '/appointments'
      }]
    };
  }

  // 2) تعديل موعد: "غير موعد أحمد إلى الساعة 6", "أجل موعد أحمد إلى يوم الأحد"
  if (/(?:غير|عدل|أجل|اجل|قدم|تغيير|تعديل|تأجيل)\s*(?:لي)?\s*موعد/i.test(userText)) {
    const perm = checkDualPermission('appointments', 'edit', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });
    const clientName = extractClientName(userText);
    const newDate = parseArabicDate(userText);
    const newTime = parseArabicTime(userText);

    const searchRes = await executeAssistantTool('searchAppointments', {
      client_name: clientName || undefined,
      status: 'scheduled',
      limit: 5
    }, user);

    const appts = searchRes.ok ? (searchRes.result.appointments || []) : [];
    if (!appts.length) {
      return {
        reply: clientName 
          ? `لم يتم العثور على موعد مجدول للعميل "${clientName}" لتعديله.`
          : 'يرجى تحديد اسم العميل للموعد المراد تعديله والوقت أو التاريخ الجديد (مثال: غير موعد أحمد إلى الساعة 6).'
      };
    }

    const target = appts[0];
    if (!newDate && !newTime) {
      return {
        reply: `ما هو التعديل المطلوب على موعد "${target.title}"؟ (مثال: غير الموعد إلى الساعة 6 مساءً أو إلى يوم الأحد).`
      };
    }

    const updateParams = { id: target.id };
    let desc = '';
    if (newDate) {
      updateParams.date = newDate;
      desc += `تاريخ: ${newDate} `;
    }
    if (newTime) {
      updateParams.start_time = newTime;
      desc += `ساعة: ${newTime}`;
    }

    return {
      reply: `هل ترغب بتأكيد تعديل موعد "${target.title}" مع ${target.client_name || 'العميل'} إلى (${desc.trim()})؟`,
      hasPending: true,
      pending: {
        action: 'updateAppointment',
        params: updateParams
      },
      cards: [{
        title: target.title,
        sub: `الموعد الحالي: ${target.date} ${target.start_time} ⬅️ الجديد: ${desc}`,
        link: '/appointments'
      }]
    };
  }

  // 3) إضافة موعد جديد: "أضف لي موعد مع أحمد يوم الأحد الساعة 5 مساءً لمناقشة الوحدة"
  if (/(?:أضف|اضف|انشئ|أنشئ|سجل|جدول|احجز|سو|اعمل|حط)\s*(?:لي)?\s*موعد/i.test(userText)) {
    const perm = checkDualPermission('appointments', 'create', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

    const { client, date, time, title } = extractAppointmentDetails(userText);

    if (!date && !time) {
      return respond({
        reply: client
          ? `يرجى تحديد وقت وتاريخ الموعد مع العميل ${client} (مثال: يوم الأحد الساعة 5 مساءً).`
          : 'يرجى تزويدي بتفاصيل الموعد: اسم العميل، واليوم، والوقت (مثال: أضف لي موعد مع أحمد يوم الأحد الساعة 5 مساءً لمناقشة الوحدة).'
      });
    }
    if (!time) {
      context.pending_flow = {
        type: 'createAppointment',
        data: { client, date: date || new Date().toISOString().slice(0, 10), title },
        waiting_for: 'time'
      };
      return respond({
        reply: `في أي وقت ترغب بتحديد الموعد يوم ${date || 'المحدد'}؟ (مثال: الساعة 5 مساءً).`
      });
    }
    if (!date) {
      return respond({
        reply: `في أي يوم ترغب بتحديد الموعد الساعة ${time}؟ (مثال: غداً، أو يوم الأحد).`
      });
    }

    const toolRes = await executeAssistantTool('createAppointment', {
      title,
      client_name: client || undefined,
      date,
      start_time: time
    }, user);

    if (!toolRes.ok) {
      return respond({ reply: toolRes.error, isError: true });
    }

    const r = toolRes.result || {};
    context.appointment = r.appointment || r;
    return respond({
      reply: `✅ ${r.message}`,
      cards: [{
        title: `${r.appointment?.title || r.title || 'موعد'} — ${r.appointment?.date || r.date} (${r.appointment?.start_time || r.start_time || r.time})`,
        sub: `العميل: ${r.appointment?.client_name || r.client_name || r.client || '—'} | الحالة: مجدول`,
        link: '/appointments'
      }],
      actions: [{ label: 'عرض التقويم والمواعيد', link: '/appointments' }]
    });
  }

  // 4) تغيير حالة الموعد: "اجعل موعد أحمد مكتملا", "انجزت موعد أحمد"
  if (/(?:خل|اجعل|خلي|غير|انجزت|أنجزت|تم|تمت)\s*(?:لي)?\s*(?:موعد|الموعد).*(?:منجز|مكتمل|تم|انتهى|ملغي|مؤجل)/i.test(userText)) {
    const perm = checkDualPermission('appointments', 'edit', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });
    const clientName = extractClientName(userText);
    const searchRes = await executeAssistantTool('searchAppointments', {
      client_name: clientName || undefined,
      status: 'scheduled',
      limit: 1
    }, user);
    const appts = searchRes.ok ? (searchRes.result.appointments || []) : [];
    if (!appts.length) {
      return { reply: clientName ? `لم يتم العثور على موعد مجدول للعميل ${clientName}.` : 'لم يتم العثور على موعد لتغيير حالته.' };
    }
    const target = appts[0];
    let newStatus = 'done';
    if (/ملغي|الغاء|إلغاء/.test(userText)) newStatus = 'cancelled';
    else if (/مؤجل|تأجيل/.test(userText)) newStatus = 'postponed';

    const updRes = await executeAssistantTool('changeAppointmentStatus', { id: target.id, status: newStatus }, user);
    if (!updRes.ok) return { reply: updRes.error, isError: true };
    return {
      reply: `✅ ${updRes.result.message}`,
      cards: [{
        title: target.title,
        sub: `الحالة الجديدة: ${newStatus === 'done' ? 'منجز' : newStatus === 'cancelled' ? 'ملغي' : 'مؤجل'} | العميل: ${target.client_name || '—'}`,
        link: '/appointments'
      }],
      actions: [{ label: 'عرض التقويم', link: '/appointments' }]
    };
  }

  // 5) استعلام وعرض المواعيد: "وش مواعيدي اليوم؟", "مواعيد الغد", "مواعيد الأسبوع", "المواعيد القادمة"
  if (/(?:وش\s*|ايش\s*|ما\s*هي\s*|اعرض\s*|ورني\s*|ابحث\s*عن\s*)?(?:مواعيدي|مواعيد|المواعيد|جدولي|تقويم)/i.test(userText) && !/مهمة|مهام/i.test(userText)) {
    if (!can(user.perms, 'appointments', 'view')) {
      return { reply: '⚠️ ليس لديك صلاحية عرض المواعيد (appointments:view).', isError: true };
    }
    let date_filter = null;
    if (/(?:اليوم|هذا اليوم)/i.test(userText)) date_filter = 'today';
    else if (/(?:غدا|غداً|بكرة|باكر|الغد)/i.test(userText)) date_filter = 'tomorrow';
    else if (/(?:أسبوع|اسبوع|الأسبوع|الاسبوع)/i.test(userText)) date_filter = 'week';
    else if (/(?:قادمة|القادمة|مقبلة|المقبلة)/i.test(userText)) date_filter = 'upcoming';

    const clientName = extractClientName(userText);
    const toolRes = await executeAssistantTool('searchAppointments', {
      date_filter,
      client_name: clientName || undefined
    }, user);

    if (!toolRes.ok) return { reply: toolRes.error, isError: true };
    const r = toolRes.result;
    return {
      reply: r.message,
      cards: (r.appointments || []).map(a => ({
        title: `${a.title} — ${a.date} (${a.start_time || '—'})`,
        sub: `العميل: ${a.client_name || '—'} | الحالة: ${a.status === 'scheduled' ? 'مجدول' : a.status === 'done' ? 'منجز' : a.status === 'cancelled' ? 'ملغي' : 'مؤجل'}`,
        link: '/appointments'
      })),
      actions: [{ label: 'فتح صفحة المواعيد', link: '/appointments' }]
    };
  }

  // ==================== [ثانياً: المهام — Tasks] ====================

  // 6) تغيير حالة مهمة: "خل المهمة مكتملة", "أنهِ المهمة", "أنجزت المهمة"
  if (/(?:خل|اجعل|خلي|غير|انجزت|أنجزت|أنهيت|انهيت|تم|تمت)\s*(?:لي)?\s*(?:المهمة|مهمة).*(?:مكتملة|منجزة|انتهت)/i.test(userText) || /(?:أنهِ|انه|أنجز|انجز)\s*(?:المهمة|مهمة)/i.test(userText)) {
    const perm = checkDualPermission('tasks', 'edit', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

    const clientName = extractClientName(userText);
    const searchRes = await executeAssistantTool('searchTasks', {
      client_name: clientName || undefined,
      filter: 'active',
      limit: 1
    }, user);

    const tasks = searchRes.ok ? (searchRes.result.tasks || []) : [];
    if (!tasks.length) {
      return respond({
        reply: clientName
          ? `لم يتم العثور على مهمة نشطة مرتبطة بالعميل "${clientName}".`
          : 'لا توجد مهام نشطة حالياً لإكمالها.'
      });
    }

    const target = tasks[0];
    const updRes = await executeAssistantTool('changeTaskStatus', { id: target.id, status: 'completed' }, user);
    if (!updRes.ok) return respond({ reply: updRes.error, isError: true });

    context.task = target;
    return respond({
      reply: `✅ تم تحديث حالة المهمة "${target.title}" إلى مكتملة بنجاح!`,
      cards: [{
        title: target.title,
        sub: `الحالة: مكتملة ✅ | الاستحقاق: ${target.due_date || '—'}`,
        link: '/tasks'
      }],
      actions: [{ label: 'فتح قائمة المهام', link: '/tasks' }]
    });
  }

  // 7) حذف مهمة: "احذف مهمة متابعة أحمد", "احذف المهمة"
  if (/(?:احذف|إحذف|حذف|الغي|ألغي|الغ)\s*(?:لي)?\s*(?:مهمة|المهمة)/i.test(userText)) {
    const perm = checkDualPermission('tasks', 'delete', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

    const clientName = extractClientName(userText);
    const searchRes = await executeAssistantTool('searchTasks', {
      client_name: clientName || undefined,
      limit: 5
    }, user);

    const tasks = searchRes.ok ? (searchRes.result.tasks || []) : [];
    if (!tasks.length) {
      return respond({
        reply: clientName
          ? `لم يتم العثور على مهمة للعميل "${clientName}" لحذفها.`
          : 'يرجى تحديد المهمة المراد حذفها (مثال: احذف مهمة متابعة أحمد).'
      });
    }

    const target = tasks[0];
    context.task = target;
    return respond({
      reply: `⚠️ هل أنت متأكد من حذف المهمة "${target.title}"${target.client_name ? ` الخاصة بالعميل ${target.client_name}` : ''}؟`,
      hasPending: true,
      pending: {
        action: 'deleteTask',
        params: { id: target.id }
      },
      cards: [{
        title: target.title,
        sub: `تاريخ الاستحقاق: ${target.due_date || '—'} | الحالة: ${target.status}`,
        link: '/tasks'
      }]
    });
  }

  // 8) تعديل مهمة: "غير موعد مهمة أحمد إلى الأحد", "عدل مهمة أحمد"
  if (/(?:غير|عدل|أجل|اجل|قدم)\s*(?:لي)?\s*(?:مهمة|المهمة)/i.test(userText)) {
    const perm = checkDualPermission('tasks', 'edit', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

    const clientName = extractClientName(userText);
    const newDueDate = parseArabicDate(userText);

    const searchRes = await executeAssistantTool('searchTasks', {
      client_name: clientName || undefined,
      limit: 5
    }, user);

    const tasks = searchRes.ok ? (searchRes.result.tasks || []) : [];
    if (!tasks.length) {
      return respond({
        reply: clientName
          ? `لم يتم العثور على مهمة مرتبطة بـ "${clientName}" لتعديلها.`
          : 'يرجى تحديد اسم العميل أو عنوان المهمة المراد تعديلها.'
      });
    }

    const target = tasks[0];
    context.task = target;
    if (!newDueDate) {
      return respond({
        reply: `ما هو التعديل المطلوب على مهمة "${target.title}"؟ (مثال: غير موعد المهمة إلى الأحد).`
      });
    }

    return respond({
      reply: `هل ترغب بتأكيد تعديل موعد استحقاق المهمة "${target.title}" إلى ${newDueDate}؟`,
      hasPending: true,
      pending: {
        action: 'updateTask',
        params: { id: target.id, due_date: newDueDate }
      },
      cards: [{
        title: target.title,
        sub: `الموعد الحالي: ${target.due_date || 'بدون تاريخ'} ⬅️ الجديد: ${newDueDate}`,
        link: '/tasks'
      }]
    });
  }

  // 9) إضافة مهمة جديدة:
  // "أضف مهمة لأحمد، تابع معه بخصوص الوحدة 25، وخلي موعدها بكرة"
  // "أضف مهمة لمتابعة العميل أحمد بعد 3 أيام"
  if (/(?:أضف|اضف|انشئ|أنشئ|سجل|سو|اعمل|حط)\s*(?:لي)?\s*(?:مهمة|task)/i.test(userText)) {
    const perm = checkDualPermission('tasks', 'create', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

    const { title, unitCode } = extractTaskDetails(userText);
    const clientName = extractClientName(userText);
    const dueDate = parseArabicDate(userText);

    let priority = 'medium';
    if (/عاجل|طارئ|ضروري|urgent/i.test(userText)) priority = 'urgent';
    else if (/مهم|عالي|high/i.test(userText)) priority = 'high';
    else if (/منخفض|بسيط|low/i.test(userText)) priority = 'low';

    context.task = { title, client_name: clientName, unit_code: unitCode, due_date: dueDate, priority };

    return respond({
      reply: `سيتم إنشاء المهمة بالبيانات التالية:\n• عنوان المهمة: ${title}\n• موعد الاستحقاق: ${dueDate || 'بدون موعد'}${clientName ? '\n• العميل: ' + clientName : ''}${unitCode ? '\n• الوحدة: ' + unitCode : ''}\n• الأولوية: ${priority === 'urgent' ? 'عاجلة' : priority === 'high' ? 'عالية' : 'عادية'}\n\nهل ترغب بتأكيد إنشاء المهمة؟`,
      hasPending: true,
      pending: {
        action: 'createTask',
        params: {
          title,
          client_name: clientName || undefined,
          unit_code: unitCode || undefined,
          due_date: dueDate || undefined,
          priority
        }
      },
      cards: [{
        title: `${title} — ${dueDate || 'بدون موعد'}`,
        sub: `الأولوية: ${priority === 'urgent' ? 'عاجلة' : priority === 'high' ? 'عالية' : 'عادية'} ${clientName ? '| العميل: ' + clientName : ''}`,
        link: '/tasks'
      }]
    });
  }

  // 10) استعلام وبحث المهام: "ورني مهامي المتأخرة", "وش المهام اللي علي هذا الأسبوع؟", "مهام اليوم", "المهام القادمة"
  if (/(?:مهامي|مهام|المهام|المهمات|تاسكات)/i.test(userText)) {
    const perm = checkDualPermission('tasks', 'view', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

    let filter = null;
    if (/(?:متأخرة|المتأخرة|متاخرة|المتاخرة|فائتة)/i.test(userText)) filter = 'overdue';
    else if (/(?:أسبوع|اسبوع|الأسبوع|الاسبوع)/i.test(userText)) filter = 'week';
    else if (/(?:اليوم|هذا اليوم)/i.test(userText)) filter = 'today';
    else if (/(?:قادمة|القادمة|مقبلة)/i.test(userText)) filter = 'upcoming';

    const clientName = extractClientName(userText);
    const toolRes = await executeAssistantTool('searchTasks', {
      filter,
      client_name: clientName || undefined
    }, user);

    if (!toolRes.ok) return respond({ reply: toolRes.error, isError: true });
    const r = toolRes.result;
    if (r.tasks?.length) {
      context.task = r.tasks[0];
    }
    return respond({
      reply: r.message,
      cards: (r.tasks || []).map(t => ({
        title: `${t.title} — ${t.due_date || 'بدون تاريخ'}`,
        sub: `الحالة: ${t.status === 'completed' ? 'مكتملة' : t.status === 'in_progress' ? 'قيد التنفيذ' : 'جديدة'} | الأولوية: ${t.priority === 'urgent' ? 'عاجلة' : t.priority === 'high' ? 'عالية' : 'عادية'} ${t.client_name ? '| العميل: ' + t.client_name : ''}`,
        link: '/tasks'
      })),
      actions: [{ label: 'فتح صفحة المهام', link: '/tasks' }]
    });
  }

  // ==================== [ثالثاً: باقي عمليات النظام] ====================

  // أ) حساب الرصيد المتبقي لعميل: "كم باقي على أحمد؟"
  if (/كم\s+(باقي|متبقي|عليه|يطلب|حساب)/.test(userText)) {
    let nameMatch = userText
      .replace(/كم\s+(?:باقي|متبقي|عليه|يطلب|حساب|ريال)/g, '')
      .replace(/(?:^|\s+)(?:على|للعميل|لـ)\s*/g, ' ')
      .replace(/[\?؟]+/g, '')
      .trim();
    if (!nameMatch) {
      return { reply: 'أي عميل تريد معرفة الرصيد المتبقي عليه؟ يرجى كتابة اسم العميل.' };
    }
    const toolRes = await executeAssistantTool('getRemainingBalance', { customer_name: nameMatch }, user);
    if (!toolRes.ok) return { reply: toolRes.error };
    const r = toolRes.result;
    if (r.ambiguous) {
      return {
        reply: r.message,
        cards: r.matches.map(c => ({ title: c.name, sub: `جوال: ${c.phone || '—'} (كود ${c.code})`, link: '/clients' }))
      };
    }
    return {
      reply: r.message,
      cards: [{ title: `المتبقي: ${formatMoney(r.remaining_balance)}`, sub: `إجمالي المبيعات: ${formatMoney(r.total_sales)} | المسدد: ${formatMoney(r.total_paid)}`, link: '/finance' }]
    };
  }

  // ب) إجمالي دفعات عميل: "كم إجمالي دفعات أحمد؟"
  if (/كم\s+(إجمالي|اجمالي)?\s*(دفعات|مدفوعات|سدد|دفع)/.test(userText)) {
    const nameMatch = userText.replace(/كم|إجمالي|اجمالي|دفعات|مدفوعات|سدد|دفع|العميل|لـ|على|\?|؟/g, '').trim();
    if (nameMatch) {
      const toolRes = await executeAssistantTool('getRemainingBalance', { customer_name: nameMatch }, user);
      if (!toolRes.ok) return { reply: toolRes.error };
      const r = toolRes.result;
      return {
        reply: `إجمالي مدفوعات العميل ${r.client_name}: ${formatMoney(r.total_paid)}\nالمتبقي عليه: ${formatMoney(r.remaining_balance)}`,
        cards: [{ title: `المسدد: ${formatMoney(r.total_paid)}`, sub: `العميل: ${r.client_name}`, link: '/finance' }]
      };
    }
  }

  // ج) البحث عن العقارات بعدد الغرف: "ورني العقارات اللي فيها 3 غرف"
  if (/(\d+)\s*(غرف|غرفة)/.test(userText) || /عقارات.*غرف/.test(userText)) {
    const roomMatch = /(\d+)\s*(غرف|غرفة)/.exec(userText);
    const rooms = roomMatch ? Number(roomMatch[1]) : 3;
    const toolRes = await executeAssistantTool('searchProperties', { rooms, limit: 6 }, user);
    if (!toolRes.ok) return { reply: toolRes.error };
    const r = toolRes.result;
    return {
      reply: r.message,
      cards: (r.properties || []).map(u => ({
        title: `${u.code} — ${u.project_name || 'مشروع سكني'}`,
        sub: `${u.rooms} غرف — ${formatMoney(u.price)} (${u.status === 'available' ? 'متاح' : u.status})`,
        link: '/units'
      })),
      actions: [{ label: 'عرض كل العقارات', link: '/units' }]
    };
  }

  // د) حجوزات هذا الأسبوع: "طلع لي حجوزات هذا الأسبوع"
  if (/(حجوزات|حجز).*(أسبوع|اسبوع|الأسبوع|الاسبوع|اليوم)/.test(userText)) {
    const period = /(أسبوع|اسبوع)/.test(userText) ? 'this_week' : 'today';
    const toolRes = await executeAssistantTool('searchBookings', { period }, user);
    if (!toolRes.ok) return { reply: toolRes.error };
    const r = toolRes.result;
    return {
      reply: r.message,
      cards: (r.bookings || []).map(b => ({
        title: `${b.code} — وحدة ${b.unit_code}`,
        sub: `العميل: ${b.client_name} — تاريخ: ${b.reservation_date} (${b.status})`,
        link: '/reservations'
      })),
      actions: [{ label: 'فتح الحجوزات', link: '/reservations' }]
    };
  }

  // هـ) تسجيل دفعة: "سجل لأحمد دفعة 50 ألف حوالة ورقم المرجع 123456"
  if (/(سجل|اضف|أضف).*(دفعة|مبلغ|تحصيل)/.test(userText)) {
    const amount = parseNumber(userText);
    const refMatch = /(?:مرجع|حوالة|رقم)\s*([A-Za-z0-9_-]+)/.exec(userText);
    const refNo = refMatch ? refMatch[1] : '';
    const method = /(حوالة|تحويل)/.test(userText) ? 'transfer' : /(شيك)/.test(userText) ? 'check' : 'cash';

    // استخراج اسم العميل
    let clientName = '';
    const cMatch = /(?:للعميل|للأخ|لـ|ل)([\u0621-\u064A]+)(?:\s+(?:دفعة|مبلغ|بقيمة|\d))/i.exec(userText);
    if (cMatch) {
      clientName = cMatch[1].trim();
    } else {
      const parts = userText.split(/(?:دفعة|مبلغ)/);
      if (parts[0]) clientName = parts[0].replace(/سجل|أضف|اضف|للعميل|لـ/g, '').trim();
    }
    if (clientName) {
      clientName = clientName.replace(/^(?:للعميل|لـ|ل)/, '').trim();
    }

    if (!amount) {
      return { reply: 'يرجى تحديد مبلغ الدفعة المراد تسجيلها.' };
    }
    if (!clientName) {
      return { reply: 'أي عميل ترغب في تسجيل الدفعة له؟ يرجى تحديد اسم العميل.' };
    }

    // البحث عن العميل في النظام
    const custSearch = await executeAssistantTool('searchCustomers', { query: clientName, limit: 5 }, user);
    if (!custSearch.ok) return { reply: custSearch.error };
    const clients = custSearch.result.customers || [];
    if (!clients.length) {
      return { reply: `لم يتم العثور على عميل باسم "${clientName}". يرجى التحقق من الاسم أو إضافته كعميل أولاً.` };
    }
    if (clients.length > 1) {
      return {
        reply: `وجدت ${clients.length} عملاء باسم "${clientName}". يرجى اختيار العميل المطلوب:`,
        cards: clients.map(c => ({ title: c.name, sub: `جوال: ${c.phone || '—'} (كود ${c.code})` }))
      };
    }

    const client = clients[0];
    // إعداد ملخص التأكيد المالي للعملية الحساسة
    return {
      reply: `سيتم تسجيل الدفعة بالبيانات التالية:\n• العميل: ${client.name}\n• المبلغ: ${formatMoney(amount)}\n• طريقة الدفع: ${method === 'transfer' ? 'حوالة بنكية' : method === 'check' ? 'شيك' : 'نقداً'}${refNo ? `\n• رقم المرجع: ${refNo}` : ''}\n\nهل تريد تنفيذ العملية؟`,
      hasPending: true,
      pending: {
        action: 'createPayment',
        params: {
          client_id: client.id,
          amount,
          method,
          reference_no: refNo
        }
      }
    };
  }

  // و) إنشاء حجز: "سوي لي حجز للعميل أحمد على العقار رقم 25" / "احجز لي العقار 25 لأحمد"
  if (/(حجز|احجز|سوي.*حجز|أنشئ.*حجز|انشئ.*حجز)/.test(userText)) {
    // استخراج رقم/كود العقار
    let propCode = '';
    const propMatch = /(?:عقار|العقار|وحدة|الوحدة)\s*(?:رقم)?\s*([A-Za-z0-9_-]+)/.exec(userText) || /(?:على|في)\s+([0-9]+[A-Za-z0-9_-]*)/.exec(userText);
    if (propMatch) propCode = propMatch[1];

    // استخراج اسم العميل
    let clientName = '';
    // حالات مثل: لفيصل / لأحمد / للعميل أحمد / للعميل فيصل
    const cMatch = /(?:للعميل|للأخ|لـ|ل)([A-Za-z\u0621-\u064A]+(?:\s+[A-Za-z\u0621-\u064A]+)?)(?:\s+(?:على|في|بالعقار|للعقار|$))/i.exec(userText);
    if (cMatch) {
      clientName = cMatch[1].replace(/^(?:لـ|للعميل|ل)/, '').trim();
    }
    if (!clientName) {
      const altMatch = /(?:احجز|سوي حجز|حجز)\s+(?:لي\s+)?([\u0621-\u064A\s]+?)(?:\s+(?:على|للعقار|في|بالعقار))/i.exec(userText);
      if (altMatch) clientName = altMatch[1].trim();
    }
    if (!clientName) {
      const endMatch = /(?:لـ|للعميل|ل)([A-Za-z\u0621-\u064A]+)$/.exec(userText.trim());
      if (endMatch) clientName = endMatch[1].trim();
    }

    // تنظيف اسم العميل من حروف العطف الزائدة
    if (clientName) {
      clientName = clientName.replace(/^(?:لـ|للعميل|ل)/, '').trim();
    }

    // فحص النواقص
    if (!clientName && !propCode) {
      return respond({ reply: 'سأساعدك في إنشاء الحجز. يرجى تزويدي باسم العميل ورقم أو كود العقار المطلوب حجزه.' });
    }
    if (!clientName) {
      return respond({ reply: `تمام، تريد حجز العقار ${propCode}، ما هو اسم العميل المطلوب حجزه له؟` });
    }
    if (!propCode) {
      const custSearch = await executeAssistantTool('searchCustomers', { query: clientName, limit: 5 }, user);
      if (custSearch.ok && custSearch.result.customers?.length) {
        context.client = custSearch.result.customers[0];
      }
      context.pending_flow = { type: 'createBooking', data: { client: context.client || { name: clientName } }, waiting_for: 'unit' };
      return respond({ reply: `تمام، أي عقار أو وحدة تريد حجزها للعميل ${clientName}؟ (مثال: UNIT-25)` });
    }

    // البحث عن العميل
    const custSearch = await executeAssistantTool('searchCustomers', { query: clientName, limit: 5 }, user);
    if (!custSearch.ok) return respond({ reply: custSearch.error, isError: true });
    const clients = custSearch.result.customers || [];
    if (!clients.length) {
      return respond({ reply: `لم أجد عميلاً باسم "${clientName}". هل تريد إضافة عميل جديد بهذا الاسم أولاً؟` });
    }
    if (clients.length > 1) {
      return respond({
        reply: `وجدت ${clients.length} عملاء باسم "${clientName}". يرجى تحديد العميل المطلوب:`,
        cards: clients.map(c => ({ title: c.name, sub: `جوال: ${c.phone || '—'} (كود ${c.code})` }))
      });
    }
    const client = clients[0];
    context.client = client;

    // البحث عن العقار
    const propSearch = await executeAssistantTool('getProperty', { code: propCode }, user);
    if (!propSearch.ok) return respond({ reply: propSearch.error, isError: true });
    const propRes = propSearch.result;
    if (!propRes.found) {
      return respond({ reply: `لم يتم العثور على عقار برقم أو كود "${propCode}". يرجى التحقق من رقم الوحدة.` });
    }
    if (propRes.ambiguous) {
      return respond({
        reply: propRes.message,
        cards: propRes.matches.map(m => ({ title: `${m.code} (${m.project})`, sub: `السعر: ${formatMoney(m.price)} — الحالة: ${m.status}` }))
      });
    }
    const unit = propRes.property;
    context.unit = unit;

    // التحقق من حالة الوحدة
    if (unit.status !== 'available' && unit.status !== 'resale') {
      return respond({
        reply: `لم يتم إنشاء الحجز لأن العقار (${unit.code}) غير متاح حالياً، حالته: ${unit.status === 'reserved' ? 'محجوز مسبقاً' : unit.status === 'sold' ? 'مباع مسبقاً' : unit.status}.`
      });
    }

    const price = unit.price || 0;
    const deposit = Math.round(price * 0.05); // اقتراح عربون 5%

    // إعداد ملخص العملية للتأكيد
    return respond({
      reply: `سيتم إنشاء الحجز بالبيانات التالية:\n• العميل: ${client.name}\n• العقار: ${unit.code} (${unit.project_name})\n• قيمة الحجز: ${formatMoney(price)}\n• العربون المقترح: ${formatMoney(deposit)}\n\nهل تريد تنفيذ الحجز؟`,
      hasPending: true,
      pending: {
        action: 'createBooking',
        params: {
          client_id: client.id,
          unit_id: unit.id,
          deposit
        }
      }
    });
  }

  // ز) إضافة مصروف: "أضف مصروف 500 ريال بنزين"
  if (/(أضف|اضف|سجل).*(مصروف)/.test(userText)) {
    const amount = parseNumber(userText);
    const desc = userText.replace(/أضف|اضف|سجل|مصروف|ريال|\d+/g, '').trim() || 'مصروف عام';
    if (!amount) return { reply: 'كم مبلغ المصروف المراد تسجيله؟' };

    return {
      reply: `سيتم تسجيل المصروف بالبيانات التالية:\n• المبلغ: ${formatMoney(amount)}\n• البيان: ${desc}\n\nهل تريد تنفيذ إضافة المصروف؟`,
      hasPending: true,
      pending: {
        action: 'createExpense',
        params: {
          amount,
          description: desc
        }
      }
    };
  }

  // ح) إضافة عميل جديد: "أضف عميل جديد اسمه فيصل ورقم جواله 0512345678"
  if (/(أضف|اضف|سجل|انشئ|أنشئ).*(عميل|عملاء)/.test(userText)) {
    const phone = parsePhone(userText);
    let name = userText.replace(/أضف|اضف|سجل|انشئ|أنشئ|عميل|جديد|اسمه|رقم|جواله|هاتفه|\d+/g, '').replace(/[\sو]+$/, '').trim();
    if (!name) return { reply: 'ما هو اسم العميل الجديد؟' };

    return {
      reply: `سيتم إضافة العميل بالبيانات التالية:\n• الاسم: ${name}\n• الجوال: ${phone || 'بدون جوال'}\n\nهل تريد تأكيد إضافة العميل؟`,
      hasPending: true,
      pending: {
        action: 'createCustomer',
        params: { name, phone: phone || '' }
      }
    };
  }

  // ط) البحث عن عميل: "ابحث عن عميل أحمد" أو "بيانات عميل"
  if (/(ابحث عن|بيانات|ملف|معلومات).*(عميل)/.test(userText)) {
    const q = userText.replace(/ابحث عن|ابحث|بيانات|ملف|معلومات|العميل|عميل/g, '').trim();
    const toolRes = await executeAssistantTool('searchCustomers', { query: q, limit: 5 }, user);
    if (!toolRes.ok) return { reply: toolRes.error };
    const r = toolRes.result;
    return {
      reply: r.message,
      cards: (r.customers || []).map(c => ({
        title: c.name,
        sub: `جوال: ${c.phone || '—'} | الكود: ${c.code}`,
        link: '/clients'
      })),
      actions: [{ label: 'عرض صفحة العملاء', link: '/clients' }]
    };
  }

  // ي) الانتقال إلى صفحة: "افتح صفحة المبيعات"
  for (const [kw, route] of Object.entries(PAGE_ROUTES)) {
    if (userText.includes(kw) && /(افتح|انتقل|ودني|روح|عرض صفحة)/.test(userText)) {
      return {
        reply: `تم توجيهك إلى صفحة ${kw}.`,
        navigate: route,
        actions: [{ label: `الانتقال إلى ${kw}`, link: route }]
      };
    }
  }

  // ك) تقارير النظام العامة أو المبيعات
  if (/تقرير|إحصائيات|احصائيات|ملخص النظام|إجمالي المبيعات|المبيعات/.test(userText)) {
    const toolRes = await executeAssistantTool('getReports', {}, user);
    if (!toolRes.ok) return { reply: toolRes.error };
    return {
      reply: toolRes.result.message,
      actions: [{ label: 'فتح التقارير', link: '/reports' }]
    };
  }

  // ل) الحسابات المالية: "اعرض الحسابات"
  if (/حسابات|أرصدة|رصيد الصندوق|البنك/.test(userText)) {
    const toolRes = await executeAssistantTool('getAccounts', {}, user);
    if (!toolRes.ok) return { reply: toolRes.error };
    const r = toolRes.result;
    return {
      reply: r.message,
      cards: (r.accounts || []).map(a => ({
        title: a.name,
        sub: `الرصيد الحالي: ${formatMoney(a.current_balance)} (${a.type === 'bank' ? 'بنكي' : 'نقدي'})`,
        link: '/finance'
      }))
    };
  }

  // م) الموردون ومزودو الذكاء الاصطناعي: "ابحث عن المزودين" / "اعرض الموردين" / "مزودي الذكاء الاصطناعي"
  if (/(?:مزود|مزودي|مزودين|مورد|موردي|موردين|مزوّد|مزوّدين)\s*(?:الذكاء|ذكاء|ai)?/i.test(userText) || /(?:ابحث عن|عرض|اعرض|قائمة|هات)\s*(?:المزودين|الموردين|مزودي الذكاء|موردي الذكاء)/i.test(userText)) {
    const perm = checkDualPermission('suppliers', 'search', user);
    if (!perm.allowed) return respond({ reply: perm.reply, isError: true });

    let q = userText.replace(/ابحث عن|اعرض|عرض|قائمة|هات|المزودين|الموردين|مزودي|موردي|المزود|المورد|مزود|مورد/gi, '')
      .replace(/الذكاء\s*الاصطناعي|ذكاء\s*اصطناعي|الاصطناعي|اصطناعي|\bai\b/gi, '')
      .trim();
    const toolRes = await executeAssistantTool('searchSuppliers', { query: q }, user);
    if (!toolRes.ok) return respond({ reply: toolRes.error, isError: true });

    const r = toolRes.result;
    const items = r.suppliers || [];
    context.last_search = { type: 'suppliers', items };

    if (!items.length) {
      return respond({ reply: q ? `لم يتم العثور على أي مزود يطابق "${q}".` : 'لا يوجد مزودون مسجلون حالياً في النظام.' });
    }

    return respond({
      reply: r.message || `قائمة المزودين (${items.length} مزود):`,
      cards: items.map(s => ({
        title: `${s.name} (${s.code})`,
        sub: `النوع: ${s.type || 'AI Provider'} | النماذج: ${s.model_count || 0} نموذج | الحالة: ${s.status === 'active' ? 'نشط' : s.status}`,
        link: '/settings'
      })),
      actions: [{ label: 'عرض المزودين', link: '/settings' }]
    });
  }

  // ---------------- 3. دعم الذكاء الاصطناعي مع Function/Tool Calling إذا كان متاحاً ----------------
  const { model: defModel } = AI.getDefaultModel();
  if (defModel) {
    try {
      const toolsSummary = Object.values(TOOLS).map(t => `- ${t.name}: ${t.description}`).join('\n');
      const sys = `أنت المساعد التنفيذي الذكي لنظام Smart Secretary لإدارة العقارات والمبيعات.
المستخدم: ${user.name} (${user.role_ar || user.role}).
صلاحيات المستخدم: ${Object.keys(user.perms).join(', ')}.
أنت تملك صلاحيات تنفيذية حقيقية عبر أدوات النظام التالية:
${toolsSummary}

قواعد أساسية:
1. أنت مساعد تنفيذي يفهم طلب المستخدم وينفذه عبر النظام.
2. لا تختلق بيانات غير موجودة ولا تدّع نجاح أي عملية ما لم تنفذ فعلياً.
3. العمليات المالية والإنشاء والتعديل والإلغاء تتطلب تأكيد المستخدم دائماً.
4. أجب بالعربية بوضوح واختصار.`;

      const promptMsgs = [
        { role: 'system', content: sys },
        { role: 'user', content: userText }
      ];

      const r = await AI.chatWithFallback(promptMsgs, { preferredModelId: defModel.id, maxTokens: 600, purpose: 'assistant', userId: user.id });
      return {
        reply: r.text,
        ai: true,
        model: r.model,
        fallback: r.fallback
      };
    } catch (e) {
      console.warn('[AssistantEngine] AI call failed, fallback to local NLP:', e.message);
    }
  }

  // رد افتراضي في حال لم تتطابق أي نية
  return respond({
    reply: 'أهلًا بك! أنا مساعدك التنفيذي الذكي. يمكنني مساعدتك في:\n• إدارة المواعيد: إضافة، تعديل، حذف، واستعراض (مثل: "أضف لي موعد مع أحمد يوم الأحد الساعة 5 مساءً"، "مواعيدي اليوم")\n• إدارة المهام: إنشاء ومتابعة وإكمال المهام (مثل: "أضف مهمة لمتابعة العميل أحمد بعد 3 أيام"، "ورني مهامي المتأخرة")\n• إنشاء الحجوزات وإلغاؤها (مثل: "احجز العقار 25 لأحمد")\n• تسجيل الدفعات والمصروفات (مثل: "سجل لأحمد دفعة 50 ألف حوالة")\n• الاستعلام عن الرصيد المتبقي (مثل: "كم باقي على أحمد؟")\n• فلترة العقارات المتاحة والبحث في النظام.'
  });
}

module.exports = {
  processAssistantRequest,
  loadConversationContext,
  saveConversationState,
  checkDualPermission
};
