// Smart Secretary — REST API (permissions enforced on EVERY route)
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { db, MODULES, ACTIONS, DATA_DIR, DB_PATH } = require('./db');
const { auth, requirePerm, signToken, audit, can } = require('./auth');
const { loginLimiter } = require('./security');

const R = express.Router();
const P = requirePerm;
const esc = (s) => String(s ?? '').slice(0, 200);
const today = () => new Date().toISOString().slice(0, 10);

// ---------- helpers ----------
function pageParams(q, def = 'id', max = 200) {
  const page = Math.max(1, parseInt(q.page) || 1);
  const limit = Math.min(max, Math.max(1, parseInt(q.limit) || 20));
  return { page, limit, offset: (page - 1) * limit, sort: q.sort || def, dir: (q.dir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC' };
}
function nextCode(prefix, table) {
  const r = db.prepare(`SELECT COALESCE(MAX(id),0)+1 n FROM ${table}`).get();
  return `${prefix}-${String(r.n).padStart(4, '0')}`;
}
function notify(userId, type, title, body = '', link = '') {
  try { db.prepare('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?,?,?,?,?)').run(userId, type, title, body, link); } catch {}
}
function notifyRole(roleName, type, title, body, link) {
  try {
    const users = db.prepare(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name=? AND u.status='active' AND u.deleted_at IS NULL`).all(roleName);
    users.forEach(u => notify(u.id, type, title, body, link));
  } catch {}
}
function pushAudit(req, action, module, entity, id, details) { audit({ ...req.user, ip: req.ip }, action, module, entity, id, details); }

// generic CRUD factory
function resource({ table, module, fields, search = [], select = null, order = 'id', enrich = null, extraWhere = null, before = null, after = null, whereBase = null, orderBy = null, excludeKeys = [] }) {
  const r = express.Router();
  r.get('/', auth, P(module, 'view'), (req, res) => {
    try {
      const { page, limit, offset, sort, dir } = pageParams(req.query, order);
      const okSort = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
      const sortCol = okSort.test(sort) ? sort : order;
      let where = [whereBase ? whereBase(req) : `${table}.deleted_at IS NULL`];
      const params = [];
      if (req.query.q && search.length) {
        where.push(`(${search.map(s => `${s} LIKE ?`).join(' OR ')})`);
        search.forEach(() => params.push(`%${req.query.q}%`));
      }
      Object.keys(req.query).forEach(k => {
        if (['page', 'limit', 'q', 'sort', 'dir'].includes(k)) return;
        if (excludeKeys.includes(k)) return;   // مفاتيح يعالجها الفلتر المخصص
        if (/^[a-z_]+$/.test(k) && fields.includes(k) || ['status', 'priority', 'project_id', 'client_id', 'assignee_id', 'user_id', 'category', 'role_id'].includes(k)) {
          if (req.query[k] !== '' && req.query[k] !== undefined) { where.push(`${table}.${k}=?`); params.push(req.query[k]); }
        }
      });
      if (extraWhere) {
        const ex = extraWhere(req.query, req);
        const sql = ex && (ex.sql || ex.where);
        if (sql) { where.push(sql); params.push(...(ex.params || [])); }
      }
      const base = select || `SELECT ${table}.* FROM ${table}`;
      // عدد السجلات: تغليف الاستعلام الأصلي لتفادي تحليل FROM عند وجود استعلامات فرعية
      const total = (select
        ? db.prepare(`SELECT COUNT(*) c FROM (${base} WHERE ${where.join(' AND ')}) _cnt`).get(...params).c
        : db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${where.join(' AND ')}`).get(...params).c);
      const rows = db.prepare(`${base} WHERE ${where.join(' AND ')} ORDER BY ${orderBy || `${sortCol} ${dir}`} LIMIT ? OFFSET ?`).all(...params, limit, offset);
      res.json({ data: enrich ? rows.map(x => enrich(x)) : rows, total, page, pages: Math.ceil(total / limit) || 1 });
    } catch (e) { console.error(`[list ${table}]`, e.message); res.status(500).json({ error: 'خطأ في جلب البيانات' }); }
  });
  r.get('/:id', auth, P(module, 'view'), (req, res) => {
    const base = select || `SELECT * FROM ${table}`;
    const row = db.prepare(`${base} WHERE ${table}.id=? AND ${table}.deleted_at IS NULL`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'السجل غير موجود' });
    res.json(enrich ? enrich(row) : row);
  });
  r.post('/', auth, P(module, 'create'), (req, res) => {
    try {
      if (before) { const err = before(req.body, req, null); if (err) return res.status(400).json({ error: err }); }
      const cols = fields.filter(f => req.body[f] !== undefined);
      if (!cols.length) return res.status(400).json({ error: 'لا توجد بيانات' });
      const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      const info = db.prepare(sql).run(...cols.map(c => req.body[c]));
      const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(info.lastInsertRowid);
      pushAudit(req, 'create', module, table, info.lastInsertRowid, row.title || row.name || row.code || `#${info.lastInsertRowid}`);
      if (after) after(row, req, 'create', null);
      res.status(201).json(row);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'السجل مكرر — القيمة مستخدمة مسبقًا' });
      res.status(400).json({ error: 'تعذر الحفظ: ' + esc(e.message) });
    }
  });
  r.put('/:id', auth, P(module, 'edit'), (req, res) => {
    try {
      const cur = db.prepare(`SELECT * FROM ${table} WHERE id=? AND deleted_at IS NULL`).get(req.params.id);
      if (!cur) return res.status(404).json({ error: 'السجل غير موجود' });
      if (before) { const err = before(req.body, req, cur); if (err) return res.status(400).json({ error: err }); }
      const cols = fields.filter(f => req.body[f] !== undefined);
      if (!cols.length) return res.status(400).json({ error: 'لا توجد بيانات' });
      db.prepare(`UPDATE ${table} SET ${cols.map(c => `${c}=?`).join(',')}, updated_at=datetime('now','localtime') WHERE id=?`)
        .run(...cols.map(c => req.body[c]), req.params.id);
      pushAudit(req, 'update', module, table, req.params.id, cols.join(','));
      const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
      if (after) after(row, req, 'update', cur);
      res.json(row);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'السجل مكرر — القيمة مستخدمة مسبقًا' });
      res.status(400).json({ error: 'تعذر التعديل: ' + esc(e.message) });
    }
  });
  r.delete('/:id', auth, P(module, 'delete'), (req, res) => {
    const cur = db.prepare(`SELECT * FROM ${table} WHERE id=? AND deleted_at IS NULL`).get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'السجل غير موجود' });
    db.prepare(`UPDATE ${table} SET deleted_at=datetime('now','localtime') WHERE id=?`).run(req.params.id);
    pushAudit(req, 'delete', module, table, req.params.id, cur.title || cur.name || cur.code || '');
    res.json({ ok: true });
  });
  return r;
}

// ---------- auth ----------
R.post('/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور' });
  const u = db.prepare(`SELECT u.*, r.name role, r.name_ar role_ar FROM users u JOIN roles r ON r.id=u.role_id WHERE u.username=? AND u.deleted_at IS NULL`).get(username);
  if (!u || u.status !== 'active' || !bcrypt.compareSync(password, u.password_hash)) {
    audit({ username }, 'login_failed', 'auth', 'user', null, `محاولة دخول فاشلة: ${esc(username)}`);
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }
  const token = signToken(u);
  db.prepare('UPDATE users SET last_login_at=datetime(\'now\',\'localtime\') WHERE id=?').run(u.id);
  audit({ id: u.id, username: u.username, ip: req.ip }, 'login', 'auth', 'user', u.id, 'تسجيل دخول ناجح');
  autoNotify(u.id);
  res.json({ token, user: { id: u.id, name: u.name, username: u.username, email: u.email, phone: u.phone, role: u.role, role_ar: u.role_ar, role_id: u.role_id } });
});
R.post('/auth/logout', auth, (req, res) => {
  const token = (req.headers.authorization || '').slice(7);
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex'));
  pushAudit(req, 'logout', 'auth', 'user', req.user.id, 'تسجيل خروج');
  res.json({ ok: true });
});
R.get('/auth/me', auth, (req, res) => {
  const { perms, ...u } = req.user;
  res.json({ user: u, perms });
});
R.post('/auth/change-password', auth, (req, res) => {
  const { current, next } = req.body || {};
  if (!current || !next || next.length < 6) return res.status(400).json({ error: 'كلمة المرور الجديدة 6 أحرف على الأقل' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(current, u.password_hash)) return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(next, 10), u.id);
  pushAudit(req, 'update', 'users', 'password', u.id, 'تغيير كلمة المرور');
  res.json({ ok: true });
});

// تنبيهات تلقائية مرة يوميًا لكل مستخدم
function autoNotify(userId) {
  try {
    try { db.prepare(`DELETE FROM settings WHERE key LIKE 'autonotif\\_%' ESCAPE '\\' AND key NOT LIKE ?`).run(`autonotif\\_${today()}\\_%`); } catch {}
    const key = `autonotif_${today()}_${userId}`;
    if (db.prepare('SELECT key FROM settings WHERE key=?').get(key)) return;
    db.prepare('INSERT INTO settings (key, value) VALUES (?,?)').run(key, '1');
    const t = today();
    const overdue = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled') AND due_date IS NOT NULL AND due_date < ? AND (assignee_id=? OR assignee_id IS NULL)`).get(t, userId).c;
    if (overdue) notify(userId, 'warning', `لديك ${overdue} مهام متأخرة`, 'راجع قائمة المهام اليوم', '/tasks');
    const appts = db.prepare(`SELECT COUNT(*) c FROM appointments WHERE deleted_at IS NULL AND status='scheduled' AND date=?`).get(t).c;
    if (appts) notify(userId, 'appointment', `لديك ${appts} مواعيد اليوم`, 'اطلع على جدول اليوم', '/appointments');
    const exp = db.prepare(`SELECT COUNT(*) c FROM reservations WHERE status='active' AND expiry_date IS NOT NULL AND expiry_date <= date('now','+3 days')`).get().c;
    if (exp) notify(userId, 'reservation', `${exp} حجوزات تقترب من الانتهاء`, 'راجع الحجوزات النشطة', '/reservations');
  } catch {}
}

// ---------- users ----------
R.get('/users', auth, P('users', 'view'), (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  let where = 'u.deleted_at IS NULL', params = [];
  if (req.query.q) { where += ' AND (u.name LIKE ? OR u.username LIKE ? OR u.email LIKE ?)'; params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.role_id) { where += ' AND u.role_id=?'; params.push(req.query.role_id); }
  if (req.query.status) { where += ' AND u.status=?'; params.push(req.query.status); }
  const total = db.prepare(`SELECT COUNT(*) c FROM users u WHERE ${where}`).get(...params).c;
  const rows = db.prepare(`SELECT u.id, u.name, u.username, u.email, u.phone, u.role_id, r.name role, r.name_ar role_ar, u.status, u.last_login_at, u.created_at FROM users u JOIN roles r ON r.id=u.role_id WHERE ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1 });
});
R.get('/users/list', auth, (req, res) => {
  // قائمة أسماء خفيفة للاختيار (إسناد المهام...) — بلا بيانات حساسة
  res.json({ data: db.prepare(`SELECT u.id, u.name, r.name_ar role_ar FROM users u JOIN roles r ON r.id=u.role_id WHERE u.status='active' AND u.deleted_at IS NULL ORDER BY u.name`).all() });
});
R.post('/users', auth, P('users', 'create'), (req, res) => {
  const { name, username, email, phone, password, role_id, status } = req.body || {};
  if (!name || !username || !password || !role_id) return res.status(400).json({ error: 'الاسم واسم المستخدم وكلمة المرور والدور حقول مطلوبة' });
  if (password.length < 6) return res.status(400).json({ error: 'كلمة المرور 6 أحرف على الأقل' });
  try {
    const info = db.prepare('INSERT INTO users (name, username, email, phone, password_hash, role_id, status) VALUES (?,?,?,?,?,?,?)')
      .run(name, username, email || null, phone || '', bcrypt.hashSync(password, 10), role_id, status || 'active');
    pushAudit(req, 'create', 'users', 'user', info.lastInsertRowid, name);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) { res.status(409).json({ error: String(e.message).includes('UNIQUE') ? 'اسم المستخدم أو البريد مستخدم مسبقًا' : 'تعذر إنشاء المستخدم' }); }
});
R.put('/users/:id', auth, P('users', 'edit'), (req, res) => {
  const id = req.params.id;
  const cur = db.prepare('SELECT * FROM users WHERE id=? AND deleted_at IS NULL').get(id);
  if (!cur) return res.status(404).json({ error: 'المستخدم غير موجود' });
  const { name, email, phone, role_id, status, password } = req.body || {};
  const sets = [], params = [];
  if (name !== undefined) { sets.push('name=?'); params.push(name); }
  if (email !== undefined) { sets.push('email=?'); params.push(email || null); }
  if (phone !== undefined) { sets.push('phone=?'); params.push(phone); }
  if (role_id !== undefined) { sets.push('role_id=?'); params.push(role_id); }
  if (status !== undefined) {
    if (Number(id) === req.user.id && status !== 'active') return res.status(400).json({ error: 'لا يمكنك تعطيل حسابك' });
    sets.push('status=?'); params.push(status);
  }
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'كلمة المرور 6 أحرف على الأقل' });
    sets.push('password_hash=?'); params.push(bcrypt.hashSync(password, 10));
  }
  if (!sets.length) return res.status(400).json({ error: 'لا توجد بيانات' });
  try {
    db.prepare(`UPDATE users SET ${sets.join(',')}, updated_at=datetime('now','localtime') WHERE id=?`).run(...params, id);
    pushAudit(req, 'update', 'users', 'user', id, sets.join(','));
    res.json({ ok: true });
  } catch (e) { res.status(409).json({ error: 'البريد مستخدم مسبقًا' }); }
});
R.delete('/users/:id', auth, P('users', 'delete'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'لا يمكنك حذف حسابك' });
  const admins = db.prepare(`SELECT COUNT(*) c FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='admin' AND u.deleted_at IS NULL AND u.status='active'`).get().c;
  const target = db.prepare(`SELECT u.*, r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?`).get(id);
  if (target?.role === 'admin' && admins <= 1) return res.status(400).json({ error: 'لا يمكن حذف آخر مدير في النظام' });
  db.prepare('UPDATE users SET deleted_at=datetime(\'now\',\'localtime\') WHERE id=?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  pushAudit(req, 'delete', 'users', 'user', id, target?.name || '');
  res.json({ ok: true });
});

// ---------- roles ----------
R.get('/roles', auth, P('roles', 'view'), (req, res) => {
  const roles = db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id=r.id AND u.deleted_at IS NULL) users_count FROM roles r ORDER BY r.id`).all();
  res.json({ data: roles });
});
R.get('/roles/meta', auth, P('roles', 'view'), (req, res) => res.json({ modules: MODULES, actions: ACTIONS }));
R.get('/roles/:id/permissions', auth, P('roles', 'view'), (req, res) => {
  res.json({ data: db.prepare('SELECT module, action FROM role_permissions WHERE role_id=?').all(req.params.id) });
});
R.post('/roles', auth, P('roles', 'create'), (req, res) => {
  const { name, name_ar, description, permissions } = req.body || {};
  if (!name || !name_ar) return res.status(400).json({ error: 'اسم الدور مطلوب' });
  try {
    const info = db.prepare('INSERT INTO roles (name, name_ar, description) VALUES (?,?,?)').run(name, name_ar, description || '');
    const g = db.prepare('INSERT INTO role_permissions (role_id, module, action) VALUES (?,?,?)');
    (permissions || []).forEach(p => { if (MODULES.includes(p.module) && ACTIONS.includes(p.action)) g.run(info.lastInsertRowid, p.module, p.action); });
    pushAudit(req, 'create', 'roles', 'role', info.lastInsertRowid, name_ar);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) { res.status(409).json({ error: 'اسم الدور مستخدم مسبقًا' }); }
});
R.put('/roles/:id', auth, P('roles', 'edit'), (req, res) => {
  const cur = db.prepare('SELECT * FROM roles WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'الدور غير موجود' });
  const { name_ar, description, permissions } = req.body || {};
  db.prepare('UPDATE roles SET name_ar=?, description=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run(name_ar || cur.name_ar, description ?? cur.description, cur.id);
  if (permissions) {
    db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(cur.id);
    const g = db.prepare('INSERT INTO role_permissions (role_id, module, action) VALUES (?,?,?)');
    permissions.forEach(p => { if (MODULES.includes(p.module) && ACTIONS.includes(p.action)) g.run(cur.id, p.module, p.action); });
  }
  pushAudit(req, 'update', 'roles', 'role', cur.id, 'تعديل الدور والصلاحيات');
  res.json({ ok: true });
});
R.delete('/roles/:id', auth, P('roles', 'delete'), (req, res) => {
  const cur = db.prepare('SELECT * FROM roles WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'الدور غير موجود' });
  if (cur.is_system) return res.status(400).json({ error: 'لا يمكن حذف دور نظام أساسي' });
  const n = db.prepare('SELECT COUNT(*) c FROM users WHERE role_id=?').get(cur.id).c;
  if (n) return res.status(400).json({ error: `الدور مستخدم من ${n} مستخدمين — انقلهم أولًا` });
  db.prepare('DELETE FROM roles WHERE id=?').run(cur.id);
  pushAudit(req, 'delete', 'roles', 'role', cur.id, cur.name_ar);
  res.json({ ok: true });
});

// ---------- generic resources ----------
R.use('/clients', resource({
  table: 'clients', module: 'clients',
  fields: ['code', 'name', 'company', 'job_title', 'phone', 'phone2', 'email', 'address', 'city', 'category', 'status', 'source', 'notes', 'assigned_to', 'created_by', 'nationality', 'pipeline_stage'],
  search: ['clients.name', 'clients.phone', 'clients.email', 'clients.company', 'clients.code', 'clients.phone2'],
  select: `SELECT clients.*, u1.name assigned_name, u2.name creator_name,
      (SELECT COUNT(*) FROM client_interests i WHERE i.client_id=clients.id AND i.deleted_at IS NULL) interests_count,
      (SELECT COALESCE(SUM(s.net_price),0) FROM sales s WHERE s.client_id=clients.id AND s.status<>'cancelled') total_sales,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.client_id=clients.id AND p.status='confirmed' AND p.deleted_at IS NULL) total_paid
    FROM clients LEFT JOIN users u1 ON u1.id=clients.assigned_to LEFT JOIN users u2 ON u2.id=clients.created_by`,
  before: (body, req, cur) => {
    if (!cur) {
      if (!body.name) return 'اسم العميل مطلوب';
      if (!body.code) {
        const n = db.prepare("SELECT COALESCE(MAX(CAST(REPLACE(code,'C-','') AS INTEGER)),1000) n FROM clients WHERE code LIKE 'C-%'").get().n;
        body.code = 'C-' + String(Number(n) + 1).padStart(4, '0');
      }
      if (!body.created_by) body.created_by = req.user.id;
      if (!body.pipeline_stage) body.pipeline_stage = 'lead';
      if (!body.status) body.status = 'active';
    }
    return null;
  },
  after: (row, req, mode, prev) => {
    try {
      const E = require('./estate_core');
      if (mode === 'update' && prev && prev.pipeline_stage !== row.pipeline_stage) E.setClientStage(row.id, row.pipeline_stage, 'تحديث يدوي من ملف العميل', req.user);
      else if (mode === 'create') require('./estate_core').setClientStage(row.id, row.pipeline_stage || 'lead', 'إنشاء عميل', req.user);
    } catch {}
  }
}));
R.use('/tasks', resource({
  table: 'tasks', module: 'tasks',
  fields: ['title', 'description', 'assignee_id', 'priority', 'status', 'start_date', 'due_date', 'completed_at', 'category', 'client_id', 'project_id', 'created_by'],
  search: ['tasks.title', 'tasks.description'],
  select: `SELECT tasks.*, u.name assignee_name, c.name client_name, p.code project_code FROM tasks LEFT JOIN users u ON u.id=tasks.assignee_id LEFT JOIN clients c ON c.id=tasks.client_id LEFT JOIN projects p ON p.id=tasks.project_id`,
  enrich: (t) => ({ ...t, is_overdue: t.status !== 'completed' && t.status !== 'cancelled' && t.due_date && t.due_date < today() })
}));
R.use('/appointments', resource({
  table: 'appointments', module: 'appointments',
  fields: ['title', 'client_id', 'date', 'start_time', 'end_time', 'duration_min', 'location', 'attendees', 'notes', 'reminder_min', 'status', 'created_by'],
  search: ['appointments.title', 'appointments.location'],
  select: `SELECT appointments.*, c.name client_name, c.phone client_phone FROM appointments LEFT JOIN clients c ON c.id=appointments.client_id`
}));
R.use('/calls', resource({
  table: 'calls', module: 'calls',
  fields: ['contact_name', 'phone', 'client_id', 'direction', 'started_at', 'duration_sec', 'result', 'notes', 'follow_up_at', 'follow_up_done', 'user_id'],
  search: ['calls.contact_name', 'calls.phone', 'calls.notes'],
  select: `SELECT calls.*, c.name client_name, u.name user_name FROM calls LEFT JOIN clients c ON c.id=calls.client_id LEFT JOIN users u ON u.id=calls.user_id`,
  order: 'started_at'
}));
R.use('/notes', resource({
  table: 'notes', module: 'notes',
  fields: ['title', 'body', 'type', 'tags', 'is_pinned', 'color', 'client_id', 'task_id', 'appointment_id', 'user_id'],
  search: ['notes.title', 'notes.body'],
  select: `SELECT notes.*, c.name client_name FROM notes LEFT JOIN clients c ON c.id=notes.client_id`
}));
R.use('/projects', resource({
  table: 'projects', module: 'projects',
  fields: ['code', 'name', 'city', 'address', 'description', 'status'],
  search: ['projects.code', 'projects.name'],
  select: `SELECT projects.*, (SELECT COUNT(*) FROM units WHERE units.project_id=projects.id) units_count,
    (SELECT COUNT(*) FROM units WHERE units.project_id=projects.id AND units.status='available') available_count,
    (SELECT COUNT(*) FROM units WHERE units.project_id=projects.id AND units.status='sold') sold_count FROM projects`
}));
R.use('/units', resource({
  table: 'units', module: 'units',
  fields: ['code', 'project_id', 'building_id', 'floor_id', 'type', 'rooms', 'bathrooms', 'parking', 'area', 'price', 'status', 'description', 'has_roof', 'roof_area', 'delivery_status', 'facing', 'notes', 'handover_date'],
  search: ['units.code', 'units.description', 'units.notes'],
  select: `SELECT units.*, p.code project_code, p.name project_name, p.require_building, p.require_floor, b.name building_name, f.number floor_no, f.name floor_name, f.type floor_type,
      (SELECT COUNT(*) FROM unit_status_history h WHERE h.unit_id=units.id) status_changes
    FROM units JOIN projects p ON p.id=units.project_id LEFT JOIN buildings b ON b.id=units.building_id LEFT JOIN floors f ON f.id=units.floor_id`,
  extraWhere: (q) => require('./estate_core').unitFilterWhere(q, 'units'),
  excludeKeys: ['project_id', 'building_id', 'floor_id', 'project', 'building', 'floor', 'type', 'unit_type', 'status',
    'delivery_status', 'floor_type', 'roof', 'has_roof', 'rooms', 'rooms_op', 'rooms_max', 'area', 'area_min', 'area_max',
    'price', 'price_min', 'price_max', 'min_price', 'max_price', 'bathrooms', 'bathrooms_op', 'parking', 'ready'],
  orderBy: null,
  before: (body, req, cur) => {
    const E = require('./estate_core');
    const project_id = body.project_id !== undefined ? body.project_id : cur?.project_id;
    const building_id = body.building_id !== undefined ? body.building_id : cur?.building_id;
    const floor_id = body.floor_id !== undefined ? body.floor_id : cur?.floor_id;
    const p = project_id ? db.prepare('SELECT * FROM projects WHERE id=?').get(project_id) : null;
    if (!p) return 'المشروع مطلوب وغير موجود';
    if (Number(p.require_building) === 1 && !building_id) return 'هذا المشروع يتطلب تحديد المبنى قبل إضافة الوحدة';
    if (Number(p.require_floor) === 1 && !floor_id) return 'هذا المشروع يتطلب تحديد الدور قبل إضافة الوحدة';
    if (floor_id) {
      const f = db.prepare('SELECT * FROM floors WHERE id=?').get(floor_id);
      if (!f) return 'الدور غير موجود';
      if (building_id && Number(f.building_id) !== Number(building_id)) return 'الدور المحدد لا يتبع المبنى المحدد';
    }
    if (body.price !== undefined && Number(body.price) < 0) return 'السعر غير صالح';
    if (body.rooms !== undefined && Number(body.rooms) < 0) return 'عدد الغرف غير صالح';
    return null;
  },
  after: (row, req, mode, prev) => {
    try {
      const F = require('./finance_core');
      if (mode === 'create') {
        db.prepare('INSERT INTO unit_status_history (unit_id, from_status, to_status, reason, user_id) VALUES (?,?,?,?,?)').run(row.id, '', row.status, 'إنشاء الوحدة', req.user.id);
      } else if (prev && prev.status !== row.status) {
        db.prepare('INSERT INTO unit_status_history (unit_id, from_status, to_status, reason, user_id) VALUES (?,?,?,?,?)').run(row.id, prev.status, row.status, (req.body && req.body.status_reason) || 'تعديل من شاشة الوحدات', req.user.id);
      }
      // مزامنة حالة الروف مع نوع الدور
      if (row.floor_id) {
        const f = db.prepare('SELECT type FROM floors WHERE id=?').get(row.floor_id);
        if (f && f.type === 'roof' && !Number(row.has_roof)) db.prepare('UPDATE units SET has_roof=1 WHERE id=?').run(row.id);
      }
    } catch {}
  }
}));

// task comments
R.get('/tasks/:id/comments', auth, P('tasks', 'view'), (req, res) => {
  res.json({ data: db.prepare(`SELECT tc.*, u.name user_name FROM task_comments tc LEFT JOIN users u ON u.id=tc.user_id WHERE tc.task_id=? ORDER BY tc.id`).all(req.params.id) });
});
R.post('/tasks/:id/comments', auth, P('tasks', 'edit'), (req, res) => {
  if (!req.body.body) return res.status(400).json({ error: 'نص التعليق مطلوب' });
  const info = db.prepare('INSERT INTO task_comments (task_id, user_id, body) VALUES (?,?,?)').run(req.params.id, req.user.id, req.body.body);
  pushAudit(req, 'update', 'tasks', 'comment', info.lastInsertRowid, `تعليق على مهمة ${req.params.id}`);
  res.status(201).json({ id: info.lastInsertRowid });
});
// task quick status
R.put('/tasks/:id/status', auth, P('tasks', 'edit'), (req, res) => {
  const st = req.body.status;
  if (!['new', 'in_progress', 'paused', 'completed', 'cancelled'].includes(st)) return res.status(400).json({ error: 'حالة غير صالحة' });
  db.prepare(`UPDATE tasks SET status=?, completed_at=CASE WHEN ?= 'completed' THEN datetime('now','localtime') ELSE NULL END, updated_at=datetime('now','localtime') WHERE id=?`).run(st, st, req.params.id);
  pushAudit(req, 'update', 'tasks', 'task', req.params.id, `تغيير الحالة إلى ${st}`);
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (t?.assignee_id && t.assignee_id !== req.user.id) notify(t.assignee_id, 'task', 'تحديث على مهمة مسندة إليك', `${t.title} → ${st}`, '/tasks');
  res.json(t);
});
// convert call → task/appointment
R.post('/calls/:id/convert', auth, P('calls', 'edit'), (req, res) => {
  const call = db.prepare('SELECT * FROM calls WHERE id=?').get(req.params.id);
  if (!call) return res.status(404).json({ error: 'الاتصال غير موجود' });
  const { to, title, due_date, date, start_time } = req.body || {};
  if (to === 'task' && can(req.user.perms, 'tasks', 'create')) {
    const info = db.prepare('INSERT INTO tasks (title, description, client_id, assignee_id, due_date, status, created_by) VALUES (?,?,?,?,?,?,?)')
      .run(title || `متابعة اتصال: ${call.contact_name}`, `من الاتصال بتاريخ ${call.started_at}\n${call.notes || ''}`, call.client_id, req.user.id, due_date || today(), 'new', req.user.id);
    pushAudit(req, 'create', 'tasks', 'task', info.lastInsertRowid, 'تحويل من اتصال');
    return res.json({ ok: true, task_id: info.lastInsertRowid });
  }
  if (to === 'appointment' && can(req.user.perms, 'appointments', 'create')) {
    const info = db.prepare('INSERT INTO appointments (title, client_id, date, start_time, end_time, notes, created_by) VALUES (?,?,?,?,?,?,?)')
      .run(title || `موعد: ${call.contact_name}`, call.client_id, date || today(), start_time || '10:00', '10:30', `من الاتصال: ${call.notes || ''}`, req.user.id);
    pushAudit(req, 'create', 'appointments', 'appointment', info.lastInsertRowid, 'تحويل من اتصال');
    return res.json({ ok: true, appointment_id: info.lastInsertRowid });
  }
  res.status(400).json({ error: 'نوع تحويل غير صالح أو صلاحية ناقصة' });
});

// client timeline
R.get('/clients/:id/timeline', auth, P('clients', 'view'), (req, res) => {
  const id = req.params.id;
  const items = [];
  db.prepare('SELECT id, title, status, due_date, created_at FROM tasks WHERE client_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 50').all(id)
    .forEach(t => items.push({ kind: 'task', date: t.created_at, title: t.title, ref: t.id, status: t.status, due: t.due_date }));
  db.prepare('SELECT id, title, date, status FROM appointments WHERE client_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 50').all(id)
    .forEach(a => items.push({ kind: 'appointment', date: a.date, title: a.title, ref: a.id, status: a.status }));
  db.prepare('SELECT id, direction, started_at, result, notes FROM calls WHERE client_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 50').all(id)
    .forEach(c => items.push({ kind: 'call', date: c.started_at, title: `${c.direction === 'in' ? 'وارد' : 'صادر'} — ${c.result}`, ref: c.id, notes: c.notes }));
  db.prepare('SELECT id, code, price, status, reservation_date FROM reservations WHERE client_id=? ORDER BY id DESC LIMIT 50').all(id)
    .forEach(r => items.push({ kind: 'reservation', date: r.reservation_date, title: `حجز ${r.code}`, ref: r.id, status: r.status }));
  db.prepare('SELECT id, code, net_price, sale_date FROM sales WHERE client_id=? ORDER BY id DESC LIMIT 50').all(id)
    .forEach(s => items.push({ kind: 'sale', date: s.sale_date, title: `بيع ${s.code} — ${Number(s.net_price).toLocaleString('en')} `, ref: s.id }));
  db.prepare('SELECT id, title, created_at FROM notes WHERE client_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 50').all(id)
    .forEach(n => items.push({ kind: 'note', date: n.created_at, title: n.title || 'ملاحظة', ref: n.id }));
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  res.json({ data: items });
});

// project structure
R.get('/projects/:id/tree', auth, P('projects', 'view'), (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'المشروع غير موجود' });
  const buildings = db.prepare('SELECT * FROM buildings WHERE project_id=?').all(p.id);
  buildings.forEach(b => {
    b.floors = db.prepare('SELECT * FROM floors WHERE building_id=? ORDER BY number').all(b.id);
    b.floors.forEach(f => { f.units = db.prepare('SELECT * FROM units WHERE floor_id=? ORDER BY code').all(f.id); });
    b.direct_units = db.prepare('SELECT * FROM units WHERE building_id=? AND floor_id IS NULL ORDER BY code').all(b.id);
  });
  res.json({ project: p, buildings });
});
R.post('/projects/:id/buildings', auth, P('projects', 'create'), (req, res) => {
  const { name, floors_count } = req.body || {};
  if (!name) return res.status(400).json({ error: 'اسم المبنى مطلوب' });
  const b = db.prepare('INSERT INTO buildings (project_id, name, floors_count) VALUES (?,?,?)').run(req.params.id, name, floors_count || 1);
  const af = db.prepare('INSERT INTO floors (building_id, number, name) VALUES (?,?,?)');
  for (let i = 1; i <= (floors_count || 1); i++) af.run(b.lastInsertRowid, i, `الدور ${i}`);
  pushAudit(req, 'create', 'projects', 'building', b.lastInsertRowid, name);
  res.status(201).json({ id: b.lastInsertRowid });
});

module.exports = R;
