// Smart Secretary — موحِّد صلاحيات الذكاء الاصطناعي (Single Resolver)
// كان هناك فحصان مختلفان:
//   • checkDualPermission() في assistant_engine يترجم: suppliers→ai، payments→finance، search→view، execute→edit
//   • executeAssistantTool() في assistant_tools يفحص can(user.perms, tool.module, tool.action) مباشرة
// النتيجة: أدوات مثل searchProjects / searchSuppliers تُرفض لمستخدم يملك الصلاحية منطقيًا،
//          لأن أدوار النظام لا تحتوي action باسم search أو execute.
// الحل: دالة واحدة تُستخدم في كل الطبقات.

const { canAI } = require('./db');
const { can } = require('./auth');

// وحدات ممنوعة على الذكاء الاصطناعي منعًا باتًا (بيانات أمنية/إدارية)
const BLOCKED_MODULES = new Set(['settings', 'users', 'roles', 'backup', 'ai_permissions', 'audit', 'system']);

// أسماء وحدات جدول ai_permissions (AI_MODULES في db.js)
const AI_MODULE = {
  finance: 'payments', payments: 'payments',
  ai: 'suppliers', ai_providers: 'suppliers', suppliers: 'suppliers',
  properties: 'units', units: 'units',
  sales: 'sales', projects: 'projects', clients: 'clients', reservations: 'reservations',
  appointments: 'appointments', tasks: 'tasks', expenses: 'expenses', accounts: 'accounts',
  reports: 'reports', contracts: 'contracts', quotations: 'quotations', calls: 'calls', notes: 'notes',
  dashboard: 'dashboard', brokers: 'brokers', interests: 'interests', commissions: 'commissions',
  statements: 'statements', communications: 'communications', pipeline: 'pipeline', approvals: 'approvals',
  schedule: 'schedule', templates: 'templates', branding: 'branding', notifications: 'notifications', files: 'files'
};

// أسماء وحدات جدول role_permissions
const ROLE_MODULE = {
  payments: 'finance', finance: 'finance',
  suppliers: 'ai', ai_providers: 'ai', ai: 'ai',
  properties: 'units', units: 'units',
  dashboard: 'dashboard'
};

// ترجمة الإجراءات: أدوار النظام تعرف view/create/edit/delete/export/print/approve/manage/contact فقط
const ROLE_ACTION = { search: 'view', execute: 'edit', list: 'view', read: 'view', update: 'edit', remove: 'delete' };
const AI_ACTION_SET = new Set(['view', 'create', 'edit', 'delete', 'search', 'execute']);

const AR = {
  view: 'عرض', create: 'إضافة', edit: 'تعديل', delete: 'حذف', search: 'البحث في', execute: 'تنفيذ عمليات',
  export: 'تصدير', print: 'طباعة', approve: 'اعتماد', manage: 'إدارة', contact: 'تواصل'
};
const MOD_AR = {
  projects: 'المشاريع', units: 'الوحدات', clients: 'العملاء', suppliers: 'المزودين', reservations: 'الحجوزات',
  appointments: 'المواعيد', tasks: 'المهام', payments: 'الدفعات', finance: 'المالية', expenses: 'المصروفات',
  accounts: 'الحسابات', reports: 'التقارير', contracts: 'العقود', quotations: 'عروض الأسعار', calls: 'الاتصالات',
  notes: 'الملاحظات', dashboard: 'لوحة القيادة', sales: 'المبيعات', ai: 'الذكاء الاصطناعي', interests: 'الاهتمامات',
  commissions: 'العمولات', brokers: 'الوسطاء', schedule: 'الأقساط', statements: 'الكشوف', communications: 'التواصل',
  pipeline: 'مسار البيع', approvals: 'الموافقات', files: 'الملفات', templates: 'القوالب', branding: 'الهوية'
};

function isAdmin(user) {
  if (!user) return false;
  return user.role === 'admin' || Number(user.role_id) === 1 || user.username === 'admin' || !!user.perms?.['*:*'];
}

/**
 * القرار الموحَّد لصلاحية أي أداة ذكاء اصطناعي.
 * @returns {{allowed:boolean, reason?:string, scope?:string, reply:string, resolved:{module:string,action:string,role_module:string,role_action:string}}}
 */
function resolveAIPermission(module, action, user) {
  const mod = String(module || '').toLowerCase();
  const act = String(action || 'view').toLowerCase();
  const aiModule = AI_MODULE[mod] || mod;
  const aiAction = AI_ACTION_SET.has(act) ? act : 'execute';
  const roleModule = ROLE_MODULE[mod] || mod;
  const roleAction = ROLE_ACTION[act] || act;
  const modAr = MOD_AR[mod] || MOD_AR[aiModule] || mod;
  const actAr = AR[act] || act;
  const resolved = { module: mod, action: act, ai_module: aiModule, ai_action: aiAction, role_module: roleModule, role_action: roleAction };

  // 1) استثناء أمني مطلق
  if (!mod || BLOCKED_MODULES.has(mod) || BLOCKED_MODULES.has(roleModule)) {
    return {
      allowed: false, reason: 'blocked_module', scope: 'security', resolved,
      reply: '⚠️ غير مسموح للذكاء الاصطناعي بالوصول إلى الإعدادات أو المستخدمين أو الصلاحيات أو النسخ الاحتياطي نهائيًا وفق السياسات الأمنية.'
    };
  }

  // 2) صلاحية الذكاء الاصطناعي (جدول ai_permissions)
  let aiAllowed = true;
  try { aiAllowed = canAI(aiModule, aiAction); } catch { aiAllowed = true; }
  if (!aiAllowed) {
    return { allowed: false, reason: 'ai_disabled', scope: 'ai', resolved, reply: `لا أملك صلاحية ${actAr} ${modAr} حاليًا (عطّلها مدير النظام).` };
  }

  // 3) صلاحية المستخدم (جدول role_permissions)
  if (isAdmin(user)) return { allowed: true, scope: 'admin', resolved, reply: '' };
  const perms = user?.perms || {};
  const ok = can(perms, roleModule, roleAction) || can(perms, roleModule, 'manage');
  if (!ok) {
    return { allowed: false, reason: 'user_denied', scope: 'user', resolved, reply: `⚠️ ليس لديك صلاحية ${actAr} على ${modAr}.` };
  }
  return { allowed: true, scope: 'user', resolved, reply: '' };
}

module.exports = { resolveAIPermission, BLOCKED_MODULES, AI_MODULE, ROLE_MODULE, ROLE_ACTION, isAdmin, MOD_AR, AR };
