// Smart Secretary — API العمليات: وسطاء، قوالب، هوية، ديمو، متابعات، خط زمني، ودجت، نسخ، صيانة
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db, flush, DATA_DIR, DB_PATH, seedDemo, nextUniqueCode } = require('./db');
const { auth, requirePerm: P, audit, can } = require('./auth');
const { idParam, need, money, escLike, LIKE_ESC, getSetting, setSetting } = require('./security');

const R = express.Router();
const pushAudit = (req, action, module, entity, id, details) => audit({ ...req.user, ip: req.ip }, action, module, entity, id, details);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const reqAdmin = (req, res, next) => req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'هذه العملية للمدير فقط' });

// ================= الوسطاء =================
const brokerCalc = (b) => {
  const s = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(commission),0) comm, COALESCE(SUM(commission_due),0) due FROM sales WHERE broker_id=? AND status<>'cancelled'`).get(b.id);
  return { ...b, sales_count: s.n, total_commission: s.comm, total_due: s.due, balance: Math.round((s.due - num(b.total_paid)) * 100) / 100 };
};
R.get('/brokers', auth, P('brokers', 'view'), (req, res) => {
  let w = 'deleted_at IS NULL', ps = [];
  if (req.query.q) { w += ' AND (name LIKE ? OR phone LIKE ? OR code LIKE ?)'; ps.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  res.json({ data: db.prepare(`SELECT * FROM brokers WHERE ${w} ORDER BY id DESC`).all(...ps).map(brokerCalc) });
});
R.post('/brokers', auth, P('brokers', 'create'), need('name'), (req, res) => {
  const { name, phone = '', email = '', commission_rate = 0, notes = '' } = req.body;
  const rate = num(commission_rate);
  if (rate < 0 || rate > 100) return res.status(400).json({ error: 'نسبة العمولة بين 0 و 100' });
  const code = nextUniqueCode('BROKER', 'brokers', 'code');
  const info = db.prepare('INSERT INTO brokers (code, name, phone, email, commission_rate, notes) VALUES (?,?,?,?,?,?)')
    .run(code, String(name).slice(0, 120), String(phone).slice(0, 30), String(email).slice(0, 120), rate, String(notes).slice(0, 1000));
  pushAudit(req, 'create', 'brokers', 'broker', info.lastInsertRowid, `${code} — ${name}`);
  res.status(201).json({ id: info.lastInsertRowid, code });
});
R.get('/brokers/:id', auth, P('brokers', 'view'), idParam, (req, res) => {
  const b = db.prepare('SELECT * FROM brokers WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'الوسيط غير موجود' });
  const sales = db.prepare(`SELECT s.id, s.code, s.sale_date, s.net_price, s.commission, s.commission_due, s.status, c.name client_name, u.code unit_code
    FROM sales s JOIN clients c ON c.id=s.client_id JOIN units u ON u.id=s.unit_id WHERE s.broker_id=? ORDER BY s.id DESC`).all(b.id);
  res.json({ ...brokerCalc(b), sales });
});
R.put('/brokers/:id', auth, P('brokers', 'edit'), idParam, (req, res) => {
  const b = db.prepare('SELECT * FROM brokers WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'الوسيط غير موجود' });
  const { name, phone, email, commission_rate, notes } = req.body || {};
  const rate = commission_rate === undefined ? b.commission_rate : num(commission_rate);
  if (rate < 0 || rate > 100) return res.status(400).json({ error: 'نسبة العمولة بين 0 و 100' });
  db.prepare(`UPDATE brokers SET name=?, phone=?, email=?, commission_rate=?, notes=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(name ? String(name).slice(0, 120) : b.name, phone ?? b.phone, email ?? b.email, rate, notes ?? b.notes, b.id);
  pushAudit(req, 'update', 'brokers', 'broker', b.id, b.name);
  res.json({ ok: true });
});
R.delete('/brokers/:id', auth, P('brokers', 'delete'), idParam, (req, res) => {
  const b = db.prepare('SELECT * FROM brokers WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'الوسيط غير موجود' });
  const linked = db.prepare(`SELECT COUNT(*) c FROM sales WHERE broker_id=? AND status<>'cancelled'`).get(b.id).c;
  if (linked) return res.status(400).json({ error: `لا يمكن حذف الوسيط — مرتبط بـ ${linked} عمليات بيع` });
  db.prepare(`UPDATE brokers SET deleted_at=datetime('now','localtime') WHERE id=?`).run(b.id);
  pushAudit(req, 'delete', 'brokers', 'broker', b.id, b.name);
  res.json({ ok: true });
});
R.post('/brokers/:id/payout', auth, P('finance', 'create'), idParam, (req, res) => {
  const b = db.prepare('SELECT * FROM brokers WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'الوسيط غير موجود' });
  let amount;
  try { amount = money(req.body?.amount, 'المبلغ'); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (amount <= 0) return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
  const calc = brokerCalc(b);
  if (amount - calc.balance > 0.01) return res.status(400).json({ error: `المبلغ يتجاوز المستحق (${calc.balance})` });
  db.prepare(`UPDATE brokers SET total_paid=total_paid+?, updated_at=datetime('now','localtime') WHERE id=?`).run(amount, b.id);
  pushAudit(req, 'create', 'finance', 'broker_payout', b.id, `صرف عمولة ${amount} للوسيط ${b.name} — ${req.body?.notes || ''}`);
  res.status(201).json({ ok: true, balance: Math.round((calc.balance - amount) * 100) / 100 });
});

// ================= القوالب =================
const TEMPLATE_VARS = ['company_name', 'currency', 'client_name', 'client_code', 'client_phone', 'unit_code', 'project_name', 'reservation_code', 'amount', 'remaining', 'reference_no', 'date', 'time', 'appointment_title', 'employee_name'];
function renderTpl(body, vars = {}, company = {}) {
  const all = { ...company, ...vars };
  const missing = [];
  const text = String(body || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k) => {
    if (all[k] === undefined || all[k] === null || all[k] === '') { if (!missing.includes(k)) missing.push(k); return m; }
    return String(all[k]);
  });
  return { text, missing };
}
R.get('/templates/variables', auth, P('templates', 'view'), (req, res) => res.json({ vars: TEMPLATE_VARS }));
R.get('/templates', auth, P('templates', 'view'), (req, res) => {
  res.json({ data: db.prepare('SELECT * FROM message_templates ORDER BY is_default DESC, name').all() });
});
R.post('/templates', auth, P('templates', 'create'), need('name', 'body'), (req, res) => {
  const { name, kind = 'whatsapp', subject = '', body, is_default = 0 } = req.body;
  if (!['whatsapp', 'sms', 'email', 'print', 'other'].includes(kind)) return res.status(400).json({ error: 'نوع قالب غير صالح' });
  const vars = [...new Set([...String(body).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(m => m[1]))].slice(0, 30);
  const info = db.prepare('INSERT INTO message_templates (name, kind, subject, body, vars_json, is_default) VALUES (?,?,?,?,?,?)')
    .run(String(name).slice(0, 120), kind, String(subject).slice(0, 200), String(body).slice(0, 5000), JSON.stringify(vars), is_default ? 1 : 0);
  pushAudit(req, 'create', 'templates', 'template', info.lastInsertRowid, name);
  res.status(201).json({ id: info.lastInsertRowid, vars });
});
R.put('/templates/:id', auth, P('templates', 'edit'), idParam, (req, res) => {
  const t = db.prepare('SELECT * FROM message_templates WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'القالب غير موجود' });
  const { name, kind, subject, body, is_default } = req.body || {};
  if (kind && !['whatsapp', 'sms', 'email', 'print', 'other'].includes(kind)) return res.status(400).json({ error: 'نوع قالب غير صالح' });
  const nb = body !== undefined ? String(body).slice(0, 5000) : t.body;
  const vars = [...new Set([...nb.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(m => m[1]))].slice(0, 30);
  db.prepare(`UPDATE message_templates SET name=?, kind=?, subject=?, body=?, vars_json=?, is_default=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(name ? String(name).slice(0, 120) : t.name, kind || t.kind, subject !== undefined ? String(subject).slice(0, 200) : t.subject, nb, JSON.stringify(vars), is_default === undefined ? t.is_default : (is_default ? 1 : 0), t.id);
  pushAudit(req, 'update', 'templates', 'template', t.id, t.name);
  res.json({ ok: true, vars });
});
R.delete('/templates/:id', auth, P('templates', 'delete'), idParam, (req, res) => {
  const t = db.prepare('SELECT * FROM message_templates WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'القالب غير موجود' });
  db.prepare('DELETE FROM message_templates WHERE id=?').run(t.id);
  pushAudit(req, 'delete', 'templates', 'template', t.id, t.name);
  res.json({ ok: true });
});
R.post('/templates/:id/render', auth, P('templates', 'view'), idParam, (req, res) => {
  const t = db.prepare('SELECT * FROM message_templates WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'القالب غير موجود' });
  const s = {};
  try { db.prepare('SELECT key, value FROM settings').all().forEach(r => { s[r.key] = r.value; }); } catch {}
  const company = { company_name: s.company_name || '', currency: s.currency || '' };
  res.json({ subject: renderTpl(t.subject, req.body?.vars || {}, company).text, ...renderTpl(t.body, req.body?.vars || {}, company) });
});

// ================= الهوية البصرية =================
const BRAND_DIR = path.join(DATA_DIR, 'brand');
if (!fs.existsSync(BRAND_DIR)) fs.mkdirSync(BRAND_DIR, { recursive: true });
const BRAND_KEYS = ['brand_primary', 'brand_secondary', 'brand_font', 'brand_footer', 'brand_tagline', 'brand_logo'];
const brandObj = () => {
  const o = {};
  try { db.prepare('SELECT key, value FROM settings').all().forEach(r => { if (BRAND_KEYS.includes(r.key) || r.key.startsWith('company_') || r.key === 'currency') o[r.key] = r.value; }); } catch {}
  return o;
};
R.get('/brand/public', (req, res) => {
  const s = brandObj();
  res.json({ company_name: s.company_name || 'Smart Secretary', tagline: s.brand_tagline || '', primary: s.brand_primary || '#7c3aed', logo: s.brand_logo ? `/api/public/brand-file/${s.brand_logo}` : '', footer: s.brand_footer || s.company_name || '', currency: s.currency || '' });
});
R.get('/public/brand-file/:name', (req, res) => {
  const n = path.basename(req.params.name || '');
  if (!/^[\w\-]+\.(png|jpg|jpeg|svg|webp)$/i.test(n)) return res.status(400).send('bad');
  const fp = path.join(BRAND_DIR, n);
  if (!fp.startsWith(BRAND_DIR) || !fs.existsSync(fp)) return res.status(404).send('nf');
  res.sendFile(fp);
});
R.get('/brand', auth, P('branding', 'view'), (req, res) => res.json(brandObj()));
R.put('/brand', auth, P('branding', 'manage'), (req, res) => {
  const b = req.body || {};
  if (b.brand_primary && !/^#[0-9a-fA-F]{6}$/.test(b.brand_primary)) return res.status(400).json({ error: 'اللون الأساسي يجب بصيغة #RRGGBB' });
  if (b.brand_secondary && !/^#[0-9a-fA-F]{6}$/.test(b.brand_secondary)) return res.status(400).json({ error: 'اللون الثانوي يجب بصيغة #RRGGBB' });
  if (b.brand_font && !['plex', 'cairo', 'tajawal', 'ibm', 'system'].includes(b.brand_font)) return res.status(400).json({ error: 'خط غير مدعوم' });
  for (const k of BRAND_KEYS) if (b[k] !== undefined) setSetting(k, String(b[k]).slice(0, 500));
  for (const k of ['company_name', 'company_phone', 'company_email', 'company_address', 'currency']) if (b[k] !== undefined) setSetting(k, String(b[k]).slice(0, 500));
  pushAudit(req, 'update', 'branding', 'brand', null, 'تعديل الهوية البصرية');
  res.json(brandObj());
});
const brandUpload = multer({ storage: multer.diskStorage({ destination: (r, f, cb) => cb(null, BRAND_DIR), filename: (r, f, cb) => cb(null, 'logo-' + Date.now() + path.extname(f.originalname || '').toLowerCase()) }), limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (r, f, cb) => /^(image\/(png|jpeg|svg\+xml|webp))$/.test(f.mimetype) ? cb(null, true) : cb(new Error('يسمح فقط بصور PNG/JPG/SVG/WEBP')) });
R.post('/brand/logo', auth, P('branding', 'manage'), (req, res) => {
  brandUpload.single('logo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'فشل الرفع' });
    if (!req.file) return res.status(400).json({ error: 'اختر ملف الشعار' });
    try {
      const old = getSetting('brand_logo', '');
      if (old && fs.existsSync(path.join(BRAND_DIR, path.basename(old)))) fs.unlinkSync(path.join(BRAND_DIR, path.basename(old)));
    } catch {}
    setSetting('brand_logo', req.file.filename);
    pushAudit(req, 'update', 'branding', 'logo', null, req.file.filename);
    res.json({ logo: req.file.filename, url: `/api/public/brand-file/${req.file.filename}` });
  });
});

// ================= إدارة البيانات التجريبية (مدير فقط) =================
const DEMO_TABLES = [
  'files', 'task_comments', 'tasks', 'appointments', 'calls', 'notes',
  'communications', 'client_interests', 'unit_status_history', 'client_stage_history',
  'approvals', 'refunds', 'commission_payments', 'quotations', 'payment_schedule',
  'contracts', 'transactions', 'payments', 'invoices', 'sales', 'reservations',
  'expenses', 'units', 'floors', 'buildings', 'accounts', 'projects',
  'clients', 'brokers', 'users'
];

const TBL_NAMES_AR = {
  clients: 'العملاء',
  projects: 'المشاريع',
  buildings: 'المباني',
  floors: 'الأدوار',
  units: 'الوحدات / العقارات',
  reservations: 'الحجوزات',
  sales: 'المبيعات',
  payments: 'الدفعات',
  invoices: 'الفواتير',
  tasks: 'المهام',
  appointments: 'المواعيد',
  calls: 'الاتصالات',
  notes: 'الملاحظات',
  files: 'الملفات',
  brokers: 'الوسطاء',
  expenses: 'المصروفات',
  accounts: 'الحسابات',
  transactions: 'الحركات المالية',
  contracts: 'العقود',
  payment_schedule: 'الأقساط',
  refunds: 'الاستردادات',
  quotations: 'عروض الأسعار',
  client_interests: 'اهتمامات العملاء',
  communications: 'سجل التواصل',
  users: 'المستخدمون التجريبيون'
};

R.get('/admin/demo-stats', auth, reqAdmin, (req, res) => {
  const tables = DEMO_TABLES.filter(t => {
    try { db.prepare(`SELECT is_demo FROM ${t} LIMIT 1`).get(); return true; } catch { return false; }
  }).map(t => {
    let demo = 0, total = 0;
    try {
      if (t === 'users') {
        demo = db.prepare(`SELECT COUNT(*) c FROM users WHERE is_demo=1 AND username != 'admin'`).get().c;
        total = db.prepare(`SELECT COUNT(*) c FROM users WHERE username != 'admin'`).get().c;
      } else {
        demo = db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE is_demo=1`).get().c;
        total = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
      }
    } catch {}
    return {
      table: t,
      title: TBL_NAMES_AR[t] || t,
      demo,
      total,
      production: Math.max(0, total - demo)
    };
  });
  const totalDemo = tables.reduce((a, t) => a + t.demo, 0);
  const totalProd = tables.reduce((a, t) => a + t.production, 0);
  const demoEnabled = getSetting('demo_mode_enabled', '0') === '1';
  res.json({
    seeded_at: getSetting('demo_seeded_at', ''),
    demo_mode_enabled: demoEnabled,
    tables,
    has_demo: totalDemo > 0,
    total_demo: totalDemo,
    total_production: totalProd
  });
});

// فحص السجلات الإنتاجية المرتبطة بالديمو — الحذف يُرفض بوجودها لحماية بيانات المستخدم
function demoBlockers() {
  const out = [];
  const c = (sql) => { try { return db.prepare(sql).get().c; } catch { return 0; } };
  const chk = (table, ar, sql) => { const n = c(sql); if (n > 0) out.push({ table, ar, count: n }); };
  chk('sales', 'مبيعات حقيقية مرتبطة بوحدات أو عملاء تجريبيين', `SELECT COUNT(*) c FROM sales s WHERE COALESCE(s.is_demo,0)=0 AND (s.unit_id IN (SELECT id FROM units WHERE is_demo=1) OR s.client_id IN (SELECT id FROM clients WHERE is_demo=1) OR s.reservation_id IN (SELECT id FROM reservations WHERE is_demo=1) OR s.broker_id IN (SELECT id FROM brokers WHERE is_demo=1))`);
  chk('reservations', 'حجوزات حقيقية مرتبطة بوحدات تجريبية', `SELECT COUNT(*) c FROM reservations r WHERE COALESCE(r.is_demo,0)=0 AND (r.unit_id IN (SELECT id FROM units WHERE is_demo=1) OR r.client_id IN (SELECT id FROM clients WHERE is_demo=1))`);
  chk('payments', 'دفعات حقيقية مرتبطة بمبيعات تجريبية', `SELECT COUNT(*) c FROM payments p WHERE COALESCE(p.is_demo,0)=0 AND p.sale_id IN (SELECT id FROM sales WHERE is_demo=1)`);
  chk('invoices', 'فواتير حقيقية مرتبطة بمبيعات تجريبية', `SELECT COUNT(*) c FROM invoices i WHERE COALESCE(i.is_demo,0)=0 AND (i.sale_id IN (SELECT id FROM sales WHERE is_demo=1) OR i.client_id IN (SELECT id FROM clients WHERE is_demo=1))`);
  return out;
}

function deleteDemoRows() {
  const counts = {};
  // 1. حذف الملفات التجريبية من القرص
  try {
    for (const f of db.prepare('SELECT id, stored_name FROM files WHERE is_demo=1').all()) {
      try { const fp = path.join(DATA_DIR, 'files', f.stored_name); if (fp.startsWith(path.join(DATA_DIR, 'files')) && fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
    }
  } catch {}

  // 2. فك القيود الدائرية في السجلات التجريبية قبل الحذف لتجنب خرق FOREIGN KEY
  try {
    db.prepare("UPDATE reservations SET contract_id=NULL, quotation_id=NULL WHERE is_demo=1").run();
    db.prepare("UPDATE sales SET contract_id=NULL, quotation_id=NULL, reservation_id=NULL WHERE is_demo=1").run();
    db.prepare("UPDATE contracts SET sale_id=NULL, reservation_id=NULL WHERE is_demo=1").run();
  } catch {}

  // 3. حذف السجلات التجريبية بالترتيب الصحيح
  for (const t of DEMO_TABLES) {
    try {
      if (t === 'users') {
        counts[t] = db.prepare("DELETE FROM users WHERE is_demo=1 AND username != 'admin'").run().changes;
      } else {
        counts[t] = db.prepare(`DELETE FROM ${t} WHERE is_demo=1`).run().changes;
      }
    } catch {
      counts[t] = 0;
    }
  }

  // 4. إزالة الإشارات
  try { db.prepare(`DELETE FROM settings WHERE key='demo_seeded_at'`).run(); } catch {}
  try { setSetting('demo_mode_enabled', '0'); } catch {}
  return counts;
}

// توليد البيانات التجريبية اختيارياً عند الطلب
R.post('/admin/demo-generate', auth, reqAdmin, (req, res) => {
  try {
    seedDemo();
    setSetting('demo_mode_enabled', '1');
    pushAudit(req, 'create', 'settings', 'demo_data', null, 'توليد البيانات التجريبية اختياريًا');
    res.json({ ok: true, message: 'تم توليد البيانات التجريبية بنجاح بنظام is_demo=true' });
  } catch (e) {
    res.status(500).json({ error: 'فشل توليد البيانات التجريبية: ' + e.message });
  }
});

// تفعيل / تعطيل وضع البيانات التجريبية
R.post('/admin/demo-toggle', auth, reqAdmin, (req, res) => {
  const enabled = req.body?.enabled ? '1' : '0';
  if (enabled === '1' && process.env.NODE_ENV === 'production') {
    return res.status(400).json({ error: 'لا يمكن تفعيل وضع البيانات التجريبية في بيئة الإنتاج' });
  }
  setSetting('demo_mode_enabled', enabled);
  pushAudit(req, 'update', 'settings', 'demo_mode', null, enabled === '1' ? 'تفعيل وضع البيانات التجريبية' : 'تعطيل وضع البيانات التجريبية');
  res.json({ ok: true, demo_mode_enabled: enabled === '1' });
});

// حذف جميع البيانات التجريبية بشكل آمن مع تأكيد قوي
R.post('/admin/demo-delete', auth, reqAdmin, (req, res) => {
  if (req.body?.confirm !== 'DELETE') {
    return res.status(400).json({ error: 'التأكيد مطلوب — اكتب كلمة DELETE لتأكيد حذف البيانات التجريبية' });
  }
  const blockers = demoBlockers();
  if (blockers.length) {
    return res.status(400).json({
      error: 'تعذر الحذف — توجد سجلات إنتاجية حقيقية مرتبطة بالبيانات التجريبية: ' + blockers.map(b => `${b.ar}: ${b.count}`).join('، ') + ' — يرجى فك ارتباطها أو حذفها أولًا لحماية بياناتك الحقيقية.',
      blockers
    });
  }
  const counts = deleteDemoRows();
  const n = Object.values(counts).reduce((a, b) => a + b, 0);
  pushAudit(req, 'delete', 'settings', 'demo_data', null, `حذف جميع البيانات التجريبية (${n} سجل)`);
  res.json({ ok: true, deleted: n, counts, message: `تم حذف ${n} سجل تجريبي بنجاح وأمان` });
});

// إعادة ضبط البيانات التجريبية
R.post('/admin/demo-reset', auth, reqAdmin, (req, res) => {
  if (req.body?.confirm !== 'RESET') {
    return res.status(400).json({ error: 'التأكيد مطلوب — اكتب كلمة RESET لتأكيد إعادة التعيين' });
  }
  const blockers = demoBlockers();
  if (blockers.length) {
    return res.status(400).json({
      error: 'تعذر التصفير — توجد سجلات إنتاجية حقيقية مرتبطة بالديمو: ' + blockers.map(b => `${b.ar}: ${b.count}`).join('، '),
      blockers
    });
  }
  deleteDemoRows();
  try {
    seedDemo();
    setSetting('demo_mode_enabled', '1');
  } catch (e) {
    return res.status(500).json({ error: 'فشلت إعادة البذر التجريبي: ' + e.message });
  }
  pushAudit(req, 'create', 'settings', 'demo_data', null, 'إعادة تعيين البيانات التجريبية بالكامل');
  res.json({ ok: true, message: 'تمت إعادة ضبط البيانات التجريبية بنجاح' });
});

// ================= الصيانة =================
R.put('/admin/maintenance', auth, reqAdmin, (req, res) => {
  const on = req.body?.enabled ? '1' : '0';
  setSetting('maintenance', on);
  if (req.body?.message !== undefined) setSetting('maintenance_msg', String(req.body.message).slice(0, 500));
  pushAudit(req, 'update', 'settings', 'maintenance', null, on === '1' ? 'تفعيل وضع الصيانة' : 'إيقاف وضع الصيانة');
  res.json({ maintenance: on === '1' });
});

// ================= المتابعات (buckets) =================
R.get('/followups', auth, (req, res) => {
  const p = req.user.perms, t = require('./time').today();
  const out = { overdue: [], today: [], upcoming: [], calls: [], expiring: [] };
  if (can(p, 'tasks', 'view')) {
    out.overdue = db.prepare(`SELECT id, title, due_date d, priority FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled') AND due_date IS NOT NULL AND due_date<? ORDER BY due_date LIMIT 20`).all(t).map(r => ({ kind: 'task', ...r, sub: `متأخرة منذ ${r.d}`, link: '/tasks' }));
    out.today = db.prepare(`SELECT id, title, due_date d, priority FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled') AND due_date=? ORDER BY priority LIMIT 20`).all(t).map(r => ({ kind: 'task', ...r, sub: 'مستحقة اليوم', link: '/tasks' }));
    out.upcoming = db.prepare(`SELECT id, title, due_date d, priority FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled') AND due_date>? AND due_date<=date(?,'+7 days') ORDER BY due_date LIMIT 20`).all(t, t).map(r => ({ kind: 'task', ...r, sub: `استحقاق ${r.d}`, link: '/tasks' }));
  }
  if (can(p, 'calls', 'view')) {
    out.calls = db.prepare(`SELECT id, contact_name title, phone, follow_up_at d FROM calls WHERE deleted_at IS NULL AND ((follow_up_at IS NOT NULL AND follow_up_at<=datetime('now','localtime') AND follow_up_done=0) OR result='missed') ORDER BY started_at DESC LIMIT 20`).all().map(r => ({ kind: 'call', ...r, sub: r.phone || 'اتصال فائت', link: '/calls' }));
  }
  if (can(p, 'reservations', 'view')) {
    out.expiring = db.prepare(`SELECT r.id, r.code title, r.expiry_date d, c.name client FROM reservations r JOIN clients c ON c.id=r.client_id WHERE r.status='active' AND r.expiry_date IS NOT NULL AND r.expiry_date<=date('now','+7 days') ORDER BY r.expiry_date LIMIT 20`).all().map(r => ({ kind: 'reservation', ...r, sub: `${r.client} — انتهاء ${r.d}`, link: '/reservations' }));
  }
  res.json(out);
});

// ================= الخط الزمني =================
R.get('/timeline/client/:id', auth, P('clients', 'view'), idParam, (req, res) => {
  const id = req.params.id;
  const c = db.prepare('SELECT id, name FROM clients WHERE id=?').get(id);
  if (!c) return res.status(404).json({ error: 'العميل غير موجود' });
  const ev = [];
  const push = (date, kind, title, sub = '', link = '') => { if (date) ev.push({ date: String(date).slice(0, 16), kind, title, sub, link }); };
  db.prepare('SELECT id, code, sale_price net_price, sale_date FROM sales WHERE client_id=?').all(id).forEach(s => push(s.sale_date, 'sale', `بيع ${s.code}`, Number(s.net_price).toLocaleString('en'), '/sales'));
  db.prepare('SELECT id, code, deposit, reservation_date FROM reservations WHERE client_id=?').all(id).forEach(r => push(r.reservation_date, 'reservation', `حجز ${r.code}`, `عربون ${Number(r.deposit).toLocaleString('en')}`, '/reservations'));
  db.prepare('SELECT p.amount, p.paid_at, s.code FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.client_id=?').all(id).forEach(pmt => push(pmt.paid_at, 'payment', `دفعة ${Number(pmt.amount).toLocaleString('en')}`, pmt.code, '/sales'));
  if (can(req.user.perms, 'calls', 'view')) db.prepare('SELECT id, direction, result, started_at FROM calls WHERE client_id=? AND deleted_at IS NULL').all(id).forEach(x => push(x.started_at, 'call', `اتصال ${x.direction === 'in' ? 'وارد' : 'صادر'}`, x.result, '/calls'));
  if (can(req.user.perms, 'appointments', 'view')) db.prepare('SELECT id, title, date, start_time FROM appointments WHERE client_id=? AND deleted_at IS NULL').all(id).forEach(a => push(a.date + ' ' + a.start_time, 'appointment', a.title, '', '/appointments'));
  if (can(req.user.perms, 'notes', 'view')) db.prepare('SELECT id, title, created_at FROM notes WHERE client_id=? AND deleted_at IS NULL').all(id).forEach(n => push(n.created_at, 'note', n.title || 'ملاحظة', '', '/notes'));
  if (can(req.user.perms, 'files', 'view')) db.prepare('SELECT id, original_name, created_at FROM files WHERE client_id=? AND deleted_at IS NULL').all(id).forEach(f => push(f.created_at, 'file', f.original_name, '', '/files'));
  ev.sort((a, b) => (a.date < b.date ? 1 : -1));
  res.json({ client: c, events: ev.slice(0, 200) });
});
R.get('/timeline/unit/:id', auth, P('units', 'view'), idParam, (req, res) => {
  const u = db.prepare('SELECT u.*, p.name project_name FROM units u LEFT JOIN projects p ON p.id=u.project_id WHERE u.id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'الوحدة غير موجودة' });
  const ev = [];
  const push = (date, kind, title, sub = '') => { if (date) ev.push({ date: String(date).slice(0, 16), kind, title, sub }); };
  push(u.created_at, 'info', 'إضافة الوحدة', `${u.code} — ${Number(u.price).toLocaleString('en')}`);
  if (can(req.user.perms, 'reservations', 'view')) db.prepare('SELECT r.code, r.status, r.reservation_date, c.name FROM reservations r JOIN clients c ON c.id=r.client_id WHERE r.unit_id=?').all(u.id).forEach(r => push(r.reservation_date, 'reservation', `حجز ${r.code} — ${r.name}`, r.status));
  if (can(req.user.perms, 'sales', 'view')) db.prepare('SELECT s.code, s.net_price, s.sale_date, c.name FROM sales s JOIN clients c ON c.id=s.client_id WHERE s.unit_id=?').all(u.id).forEach(s => push(s.sale_date, 'sale', `بيع ${s.code} — ${s.name}`, Number(s.net_price).toLocaleString('en')));
  if (can(req.user.perms, 'files', 'view')) db.prepare('SELECT original_name, created_at FROM files WHERE unit_id=? AND deleted_at IS NULL').all(u.id).forEach(f => push(f.created_at, 'file', f.original_name));
  ev.sort((a, b) => (a.date < b.date ? 1 : -1));
  res.json({ unit: u, events: ev });
});
R.get('/timeline/sale/:id', auth, P('sales', 'view'), idParam, (req, res) => {
  const s = db.prepare('SELECT s.*, c.name client_name, u.code unit_code FROM sales s JOIN clients c ON c.id=s.client_id JOIN units u ON u.id=s.unit_id WHERE s.id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'العملية غير موجودة' });
  const ev = [{ date: String(s.sale_date).slice(0, 10), kind: 'sale', title: `إنشاء البيع ${s.code}`, sub: `صافي ${Number(s.net_price).toLocaleString('en')}` }];
  db.prepare('SELECT amount, paid_at, reference_no FROM payments WHERE sale_id=? ORDER BY paid_at').all(s.id).forEach(p => ev.push({ date: String(p.paid_at).slice(0, 10), kind: 'payment', title: `دفعة ${Number(p.amount).toLocaleString('en')}`, sub: p.reference_no || '' }));
  const inv = db.prepare('SELECT code, issued_at FROM invoices WHERE sale_id=?').get(s.id);
  if (inv) ev.push({ date: String(inv.issued_at).slice(0, 10), kind: 'invoice', title: `فاتورة ${inv.code}`, sub: '' });
  if (can(req.user.perms, 'files', 'view')) db.prepare('SELECT original_name, created_at FROM files WHERE sale_id=? AND deleted_at IS NULL').all(s.id).forEach(f => ev.push({ date: String(f.created_at).slice(0, 16), kind: 'file', title: f.original_name, sub: '' }));
  res.json({ sale: s, events: ev });
});

// ================= ودجت اللوحة =================
const WIDGETS = ['stats', 'focus', 'sales_chart', 'tasks_chart', 'my_tasks', 'upcoming', 'recent_files', 'calls_chart', 'followups'];
R.get('/widgets', auth, (req, res) => {
  const rows = db.prepare('SELECT widget, enabled, position FROM dashboard_widgets WHERE user_id=?').all(req.user.id);
  const map = {};
  rows.forEach(r => { map[r.widget] = r; });
  res.json({
    widgets: WIDGETS.map((w, i) => ({ widget: w, enabled: map[w] ? !!map[w].enabled : true, position: map[w] ? map[w].position : i }))
      .sort((a, b) => a.position - b.position)
  });
});
R.put('/widgets', auth, (req, res) => {
  const list = Array.isArray(req.body?.widgets) ? req.body.widgets : [];
  const clean = list.filter(w => WIDGETS.includes(w.widget)).slice(0, WIDGETS.length);
  if (!clean.length) return res.status(400).json({ error: 'قائمة فارغة' });
  db.prepare('DELETE FROM dashboard_widgets WHERE user_id=?').run(req.user.id);
  const ins = db.prepare('INSERT INTO dashboard_widgets (user_id, widget, enabled, position) VALUES (?,?,?,?)');
  clean.forEach((w, i) => ins.run(req.user.id, w.widget, w.enabled === false ? 0 : 1, i));
  res.json({ ok: true });
});

// ================= مركز النسخ =================
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
function backupList() {
  return fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db'))
    .map(f => { const st = fs.statSync(path.join(BACKUP_DIR, f)); return { name: f, size: st.size, at: st.mtime }; })
    .sort((a, b) => b.at - a.at);
}
function pruneBackups() {
  const keep = Math.min(30, Math.max(1, parseInt(getSetting('backup_keep', '7')) || 7));
  backupList().slice(keep).forEach(b => { try { fs.unlinkSync(path.join(BACKUP_DIR, b.name)); } catch {} });
}
function makeBackup() {
  const name = `backup-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.db`;
  try { flush(); } catch {}
  fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, name));
  pruneBackups();
  return name;
}
R.get('/backups', auth, P('backup', 'view'), (req, res) => {
  if (getSetting('backup_auto', '0') === '1') {
    const list = backupList();
    if (!list.length || (Date.now() - new Date(list[0].at).getTime()) > 24 * 3600 * 1000) {
      try { makeBackup(); pushAudit(req, 'create', 'backup', 'backup', null, 'نسخة تلقائية مجدولة'); } catch {}
    }
  }
  res.json({ data: backupList(), auto: getSetting('backup_auto', '0') === '1', keep: parseInt(getSetting('backup_keep', '7')) || 7 });
});
R.post('/backups', auth, P('backup', 'create'), (req, res) => {
  const name = makeBackup();
  pushAudit(req, 'create', 'backup', 'backup', null, name);
  res.status(201).json({ name });
});
R.put('/backups/settings', auth, P('backup', 'manage'), (req, res) => {
  setSetting('backup_auto', req.body?.auto ? '1' : '0');
  const keep = Math.min(30, Math.max(1, parseInt(req.body?.keep) || 7));
  setSetting('backup_keep', String(keep));
  pruneBackups();
  pushAudit(req, 'update', 'backup', 'backup_settings', null, `تلقائي: ${req.body?.auto ? 'نعم' : 'لا'} — الاحتفاظ: ${keep}`);
  res.json({ auto: !!req.body?.auto, keep });
});

// ================= بحث شامل موسّع (مبيعات/حجوزات/فواتير/دفعات) =================
R.get('/ops-search', auth, (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (q.length < 2) return res.json({ groups: [] });
  const like = `%${escLike(q)}%`, p = req.user.perms, groups = [];
  const g = (key, title, icon, link, rows) => { if (rows.length) groups.push({ key, title, icon, link, rows }); };
  if (can(p, 'sales', 'view')) g('sales', 'المبيعات', 'money', '/sales', db.prepare(`SELECT s.id, s.code title, (c.name || ' — ' || s.net_price) sub FROM sales s JOIN clients c ON c.id=s.client_id WHERE s.code LIKE ? ${LIKE_ESC} OR c.name LIKE ? ${LIKE_ESC} LIMIT 5`).all(like, like));
  if (can(p, 'reservations', 'view')) g('reservations', 'الحجوزات', 'key', '/reservations', db.prepare(`SELECT r.id, r.code title, (c.name || ' — ' || u.code) sub FROM reservations r JOIN clients c ON c.id=r.client_id JOIN units u ON u.id=r.unit_id WHERE r.code LIKE ? ${LIKE_ESC} OR c.name LIKE ? ${LIKE_ESC} LIMIT 5`).all(like, like));
  if (can(p, 'finance', 'view') || can(p, 'sales', 'view')) {
    g('invoices', 'الفواتير', 'invoice', '/sales', db.prepare(`SELECT i.id, i.code title, (COALESCE(c.name,'') || ' — ' || i.amount) sub FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.code LIKE ? ${LIKE_ESC} LIMIT 5`).all(like));
    g('payments', 'الدفعات', 'cash', '/sales', db.prepare(`SELECT p.id, ('دفعة #' || p.id) title, ((SELECT code FROM sales WHERE id=p.sale_id) || ' — ' || p.amount) sub FROM payments p WHERE p.reference_no LIKE ? ${LIKE_ESC} LIMIT 5`).all(like));
  }
  if (can(p, 'brokers', 'view')) g('brokers', 'الوسطاء', 'briefcase', '/brokers', db.prepare(`SELECT id, name title, phone sub FROM brokers WHERE deleted_at IS NULL AND (name LIKE ? ${LIKE_ESC} OR phone LIKE ? ${LIKE_ESC}) LIMIT 5`).all(like, like));
  res.json({ groups });
});

module.exports = R;
