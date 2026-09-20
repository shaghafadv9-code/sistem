// Smart Secretary — API part 2: estate, finance, dashboard, search, reports, backup, assistant
const express = require('express');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { db, flush, DATA_DIR, DB_PATH } = require('./db');
const { auth, requirePerm: P, audit, can } = require('./auth');
const F = require('./finance_core');
const E = require('./estate_core');

const R = express.Router();
const T = require('./time');
const today = () => T.today();
function pageParams(q, def = 'id') {
  const page = Math.max(1, parseInt(q.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
}
function pushAudit(req, action, module, entity, id, details) { audit({ ...req.user, ip: req.ip }, action, module, entity, id, details); }
function notify(userId, type, title, body = '', link = '') {
  try { db.prepare('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?,?,?,?,?)').run(userId, type, title, body, link); } catch {}
}
function notifyRole(roleName, type, title, body, link) {
  try {
    db.prepare(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name=? AND u.status='active' AND u.deleted_at IS NULL`).all(roleName)
      .forEach(u => notify(u.id, type, title, body, link));
  } catch {}
}
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
function settingsObj() {
  const o = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(r => o[r.key] = r.value);
  return o;
}

// ---------- reservations ----------
R.get('/reservations', auth, P('reservations', 'view'), (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  let w = '1=1', ps = [];
  if (req.query.q) { w += ' AND (r.code LIKE ? OR c.name LIKE ? OR u.code LIKE ?)'; ps.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.status) { w += ' AND r.status=?'; ps.push(req.query.status); }
  if (req.query.project_id) { w += ' AND u.project_id=?'; ps.push(req.query.project_id); }
  const total = db.prepare(`SELECT COUNT(*) c FROM reservations r JOIN units u ON u.id=r.unit_id JOIN clients c ON c.id=r.client_id WHERE ${w}`).get(...ps).c;
  const rows = db.prepare(`SELECT r.*, c.name client_name, c.phone client_phone, u.code unit_code, u.price unit_price, p.code project_code, p.name project_name, e.name employee_name,
      (r.price - r.discount) net_price,
      COALESCE((SELECT SUM(pm.amount) FROM payments pm WHERE pm.reservation_id=r.id AND pm.status='confirmed' AND pm.deleted_at IS NULL),0) deposit_paid,
      (SELECT COUNT(*) FROM payments pm WHERE pm.reservation_id=r.id AND pm.deleted_at IS NULL) payments_count,
      (SELECT s2.code FROM sales s2 WHERE s2.reservation_id=r.id AND s2.status<>'cancelled' LIMIT 1) sale_code
    FROM reservations r JOIN units u ON u.id=r.unit_id JOIN clients c ON c.id=r.client_id JOIN projects p ON p.id=u.project_id LEFT JOIN users e ON e.id=r.employee_id
    WHERE ${w} ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...ps, limit, offset)
    .map(r0 => ({ ...r0, remaining: Math.max(0, Number(r0.net_price) - Number(r0.deposit_paid)) }));
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1 });
});
R.post('/reservations', auth, P('reservations', 'create'), (req, res) => {
  try {
    const out = E.createReservation(req, req.body || {});
    res.status(201).json(out);
  } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});
R.get('/reservations/:id', auth, P('reservations', 'view'), (req, res) => {
  const row = db.prepare(`SELECT r.*, c.name client_name, c.phone client_phone, u.code unit_code, p.code project_code, p.name project_name, e.name employee_name
    FROM reservations r JOIN units u ON u.id=r.unit_id JOIN clients c ON c.id=r.client_id JOIN projects p ON p.id=u.project_id LEFT JOIN users e ON e.id=r.employee_id WHERE r.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'الحجز غير موجود' });
  row.payments = db.prepare(`SELECT p.*, a.name account_name FROM payments p LEFT JOIN accounts a ON a.id=p.account_id WHERE p.reservation_id=? AND p.deleted_at IS NULL ORDER BY p.paid_at`).all(row.id);
  row.totals = F.reservationTotals(row.id);
  row.sale = db.prepare("SELECT id, code, net_price FROM sales WHERE reservation_id=? AND status<>'cancelled' ORDER BY id DESC LIMIT 1").get(row.id) || null;
  res.json(row);
});
R.post('/reservations/:id/cancel', auth, P('reservations', 'edit'), (req, res) => {
  const r = db.prepare('SELECT * FROM reservations WHERE id=?').get(req.params.id);
  if (!r || r.status !== 'active') return res.status(400).json({ error: 'الحجز غير نشط' });
  const b = req.body || {};
  if (!b.cancel_reason) return res.status(400).json({ error: 'سبب الإلغاء مطلوب' });
  const spec = { action_type: 'cancel_reservation', entity_type: 'reservation', entity_id: r.id, title: `إلغاء حجز ${r.code} بمبلغ مسترد ${F.num(b.refund_amount)}`, module: 'reservations', amount: F.num(b.refund_amount), payload: { reservation_id: r.id, reason: b.cancel_reason, refundAmount: F.num(b.refund_amount), deducted: F.num(b.deducted_amount), method: b.method || 'cash', account_id: b.account_id || null, reference_no: b.reference_no || '' } };
  if (!F.canApprove(req.user, 'reservations')) {
    const g = F.gate(req, spec, (approver) => F.cancelReservation(r.id, { reason: b.cancel_reason, refundAmount: F.num(b.refund_amount), deducted: F.num(b.deducted_amount), method: b.method || 'cash', account_id: b.account_id || null, reference_no: b.reference_no || '' }, approver));
    if (g.pending) return res.status(202).json({ pending_approval: g.approval_id, message: 'إلغاء الحجز والاسترداد يحتاج اعتماد المدير' });
    return res.json(g.result);
  }
  try {
    const out = F.cancelReservation(r.id, { reason: b.cancel_reason, refundAmount: F.num(b.refund_amount), deducted: F.num(b.deducted_amount), method: b.method || 'cash', account_id: b.account_id || null, reference_no: b.reference_no || '' }, req.user);
    res.json(out);
  } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});

// ---------- sales & finance ----------
function saleCalc(sale) {
  const t = F.saleTotals(sale.id) || {};
  return {
    ...sale, paid: t.paid, gross_paid: t.gross_paid, refunded: t.refunded, pending_checks: t.pending_checks,
    remaining: t.remaining, total_paid: t.paid, commission_paid: t.commission_paid, commission_remaining: t.commission_remaining,
    is_fully_paid: t.is_fully_paid, net_paid_cache: t.paid
  };
}
R.get('/sales', auth, P('sales', 'view'), (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  let w = '1=1', ps = [];
  if (req.query.q) { w += ' AND (s.code LIKE ? OR c.name LIKE ? OR u.code LIKE ?)'; ps.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.status) { w += ' AND s.status=?'; ps.push(req.query.status); }
  if (req.query.project_id) { w += ' AND p.id=?'; ps.push(req.query.project_id); }
  if (req.query.client_id) { w += ' AND s.client_id=?'; ps.push(req.query.client_id); }
  if (req.query.broker_id) { w += ' AND s.broker_id=?'; ps.push(req.query.broker_id); }
  if (req.query.from) { w += ' AND s.sale_date>=?'; ps.push(req.query.from); }
  if (req.query.to) { w += ' AND s.sale_date<=?'; ps.push(req.query.to); }
  if (req.query.unpaid === '1') w += " AND s.status='active'";
  const total = db.prepare(`SELECT COUNT(*) c FROM sales s JOIN units u ON u.id=s.unit_id JOIN clients c ON c.id=s.client_id JOIN projects p ON p.id=u.project_id WHERE ${w}`).get(...ps).c;
  const rows = db.prepare(`SELECT s.*, c.name client_name, u.code unit_code, p.code project_code, ct.code contract_code, b2.name broker_display,
      (SELECT COUNT(*) FROM payment_schedule sch WHERE sch.sale_id=s.id AND sch.deleted_at IS NULL) schedule_count
    FROM sales s JOIN units u ON u.id=s.unit_id JOIN clients c ON c.id=s.client_id JOIN projects p ON p.id=u.project_id
    LEFT JOIN contracts ct ON ct.id=s.contract_id LEFT JOIN brokers b2 ON b2.id=s.broker_id WHERE ${w} ORDER BY s.id DESC LIMIT ? OFFSET ?`).all(...ps, limit, offset).map(saleCalc);
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1 });
});
R.post('/sales', auth, P('sales', 'create'), (req, res) => {
  try {
    const out = E.createSale(req, req.body || {});
    if (out && out.pending_approval) return res.status(202).json(out);
    res.status(201).json(out);
  } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});
R.get('/sales/:id', auth, P('sales', 'view'), (req, res) => {
  const s = db.prepare(`SELECT s.*, c.name client_name, c.phone client_phone, u.code unit_code, u.area, u.rooms, p.code project_code, p.name project_name FROM sales s JOIN clients c ON c.id=s.client_id JOIN units u ON u.id=s.unit_id JOIN projects p ON p.id=u.project_id WHERE s.id=?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'العملية غير موجودة' });
  s.payments = db.prepare(`SELECT p.*, a.name account_name FROM payments p LEFT JOIN accounts a ON a.id=p.account_id WHERE p.sale_id=? AND p.deleted_at IS NULL ORDER BY p.paid_at, p.id`).all(s.id);
  s.invoice = db.prepare('SELECT * FROM invoices WHERE sale_id=?').get(s.id);
  s.contract = db.prepare('SELECT * FROM contracts WHERE sale_id=?').get(s.id) || null;
  s.schedule = db.prepare(`SELECT ps.*, (ps.amount - ps.paid_amount) remaining FROM payment_schedule ps WHERE ps.sale_id=? AND ps.deleted_at IS NULL ORDER BY ps.seq, ps.due_date`).all(s.id);
  s.refunds = db.prepare('SELECT * FROM refunds WHERE sale_id=? AND deleted_at IS NULL ORDER BY id').all(s.id);
  res.json(saleCalc(s));
});
R.post('/sales/:id/payments', auth, P('finance', 'create'), (req, res) => {
  const s = db.prepare('SELECT * FROM sales WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'العملية غير موجودة' });
  const b = req.body || {};
  try {
    const out = F.createPayment(req, {
      amount: b.amount, method: b.method || 'transfer', paid_at: b.paid_at, notes: b.notes || '', reference_no: b.reference_no || '',
      account_id: b.account_id || s.account_id || null, kind: b.kind || 'installment', sale_id: s.id, client_id: s.client_id, unit_id: s.unit_id,
      contract_id: s.contract_id || null, schedule_id: b.schedule_id || null, bank_name: b.bank_name || '', check_no: b.check_no || '',
      check_date: b.check_date || null, check_due_date: b.check_due_date || null, attachment_id: b.attachment_id || null, user: req.user
    });
    res.status(201).json(out);
  } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});
R.get('/finance/summary', auth, P('finance', 'view'), (req, res) => {
  F.refreshScheduleStatuses();
  const sales = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(net_price),0) total, COALESCE(SUM(sale_price),0) gross, COALESCE(SUM(discount),0) discounts, COALESCE(SUM(commission),0) comm FROM sales WHERE status<>'cancelled'`).get();
  const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE status='confirmed' AND deleted_at IS NULL`).get().v;
  const pending = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE status='pending' AND deleted_at IS NULL`).get().v;
  const refunded = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM refunds WHERE status IN ('approved','paid') AND deleted_at IS NULL`).get().v;
  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE status IN ('approved','paid') AND deleted_at IS NULL`).get().v;
  const commissionsPaid = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM commission_payments WHERE status='paid' AND deleted_at IS NULL`).get().v;
  const byMonth = db.prepare(`SELECT substr(sale_date,1,7) m, COUNT(*) n, SUM(net_price) total FROM sales WHERE status<>'cancelled' AND sale_date >= date('now','-12 months') GROUP BY m ORDER BY m`).all();
  const collectionsByMonth = db.prepare(`SELECT substr(paid_at,1,7) m, SUM(amount) total FROM payments WHERE status='confirmed' AND deleted_at IS NULL AND paid_at >= date('now','-12 months') GROUP BY m ORDER BY m`).all();
  const overdue = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount - paid_amount),0) v FROM payment_schedule WHERE deleted_at IS NULL AND status='overdue'`).get();
  const overdueRes = db.prepare(`SELECT COUNT(*) c FROM reservations WHERE status='active' AND expiry_date IS NOT NULL AND expiry_date < date('now')`).get().c;
  const liquidity = db.prepare(`SELECT COALESCE(SUM(current_balance),0) v FROM accounts WHERE deleted_at IS NULL AND status='active'`).get().v;
  res.json({
    sales, paid: F.r2(paid), pending_checks: F.r2(pending), refunded: F.r2(refunded), expenses: F.r2(expenses),
    commissions_paid: F.r2(commissionsPaid), commissions_due: F.r2(num(sales.comm) - num(commissionsPaid)),
    outstanding: F.r2(num(sales.total) - (num(paid) - num(refunded))), net_collected: F.r2(num(paid) - num(refunded)),
    byMonth, collectionsByMonth, overdue, overdueRes, liquidity: F.r2(liquidity)
  });
});

// ---------- notifications ----------
R.get('/notifications', auth, (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  let w = 'user_id=?', ps = [req.user.id];
  if (req.query.unread === '1') w += ' AND is_read=0';
  const total = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE ${w}`).get(...ps).c;
  const rows = db.prepare(`SELECT * FROM notifications WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...ps, limit, offset);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c;
  res.json({ data: rows, total, unread, page, pages: Math.ceil(total / limit) || 1 });
});
R.put('/notifications/read-all', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});
R.put('/notifications/:id/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});
R.delete('/notifications/:id', auth, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- audit ----------
R.get('/audit', auth, P('audit', 'view'), (req, res) => {
  const { page, limit, offset } = pageParams(req.query);
  let w = '1=1', ps = [];
  if (req.query.q) { w += ' AND (username LIKE ? OR details LIKE ? OR entity LIKE ?)'; ps.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.module) { w += ' AND module=?'; ps.push(req.query.module); }
  if (req.query.action) { w += ' AND action=?'; ps.push(req.query.action); }
  if (req.query.from) { w += ' AND date(created_at) >= ?'; ps.push(req.query.from); }
  if (req.query.to) { w += ' AND date(created_at) <= ?'; ps.push(req.query.to); }
  const total = db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE ${w}`).get(...ps).c;
  res.json({ data: db.prepare(`SELECT * FROM audit_logs WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...ps, limit, offset), total, page, pages: Math.ceil(total / limit) || 1 });
});

// ---------- settings ----------
const SET_KEYS = ['company_name', 'company_phone', 'company_mobile', 'company_email', 'company_address', 'company_logo', 'system_language', 'system_theme', 'system_font', 'currency', 'reports_footer'];
R.get('/settings', auth, P('settings', 'view'), (req, res) => res.json(settingsObj()));
R.get('/settings/public', auth, (req, res) => {
  const s = settingsObj();
  res.json({ company_name: s.company_name, company_logo: s.company_logo, currency: s.currency, system_theme: s.system_theme, demo_mode_enabled: s.demo_mode_enabled === '1' });
});
R.put('/settings', auth, P('settings', 'manage'), (req, res) => {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  Object.entries(req.body || {}).forEach(([k, v]) => { if (SET_KEYS.includes(k)) up.run(k, String(v ?? '')); });
  pushAudit(req, 'update', 'settings', 'settings', null, 'تعديل الإعدادات');
  res.json(settingsObj());
});

// ---------- dashboard ----------
R.get('/dashboard', auth, (req, res) => {
  const t = today(), uid = req.user.id, p = req.user.perms;
  const out = { stats: {}, focus: [], charts: {}, lists: {} };
  if (can(p, 'tasks', 'view')) {
    out.stats.tasksToday = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled') AND due_date=?`).get(t).c;
    out.stats.overdue = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled') AND due_date IS NOT NULL AND due_date<?`).get(t).c;
    out.stats.myTasks = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled') AND assignee_id=?`).get(uid).c;
    out.charts.tasksByStatus = db.prepare(`SELECT status, COUNT(*) n FROM tasks WHERE deleted_at IS NULL GROUP BY status`).all();
    out.lists.myTasks = db.prepare(`SELECT t.*, u.name assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.deleted_at IS NULL AND t.status NOT IN ('completed','cancelled') AND (t.assignee_id=? OR t.due_date<=?) ORDER BY t.due_date IS NULL, t.due_date LIMIT 8`).all(uid, t);
  }
  if (can(p, 'appointments', 'view')) {
    out.stats.todayAppts = db.prepare(`SELECT COUNT(*) c FROM appointments WHERE deleted_at IS NULL AND status='scheduled' AND date=?`).get(t).c;
    out.stats.weekAppts = db.prepare(`SELECT COUNT(*) c FROM appointments WHERE deleted_at IS NULL AND status='scheduled' AND date BETWEEN ? AND date(?,'+7 days')`).get(t, t).c;
    out.lists.upcoming = db.prepare(`SELECT a.*, c.name client_name FROM appointments a LEFT JOIN clients c ON c.id=a.client_id WHERE a.deleted_at IS NULL AND a.status='scheduled' AND a.date>=? ORDER BY a.date, a.start_time LIMIT 6`).all(t);
  }
  if (can(p, 'clients', 'view')) {
    out.stats.clients = db.prepare(`SELECT COUNT(*) c FROM clients WHERE deleted_at IS NULL`).get().c;
    out.stats.newClients = db.prepare(`SELECT COUNT(*) c FROM clients WHERE deleted_at IS NULL AND date(created_at) >= date('now','-30 days')`).get().c;
  }
  if (can(p, 'calls', 'view')) {
    out.stats.callsToday = db.prepare(`SELECT COUNT(*) c FROM calls WHERE deleted_at IS NULL AND date(started_at)=?`).get(t).c;
    out.stats.missed = db.prepare(`SELECT COUNT(*) c FROM calls WHERE deleted_at IS NULL AND result='missed' AND follow_up_done=0`).get().c;
    out.charts.callsByResult = db.prepare(`SELECT result, COUNT(*) n FROM calls WHERE deleted_at IS NULL AND started_at >= date('now','-30 days') GROUP BY result`).all();
  }
  if (can(p, 'files', 'view')) out.lists.recentFiles = db.prepare(`SELECT f.*, u.name uploader FROM files f LEFT JOIN users u ON u.id=f.uploaded_by WHERE f.deleted_at IS NULL ORDER BY f.id DESC LIMIT 6`).all();
  if (can(p, 'reservations', 'view')) {
    out.stats.activeRes = db.prepare(`SELECT COUNT(*) c FROM reservations WHERE status='active'`).get().c;
    out.stats.expiringRes = db.prepare(`SELECT COUNT(*) c FROM reservations WHERE status='active' AND expiry_date IS NOT NULL AND expiry_date <= date('now','+3 days')`).get().c;
  }
  if (can(p, 'sales', 'view')) {
    out.stats.monthSales = db.prepare(`SELECT COALESCE(SUM(net_price),0) s FROM sales WHERE substr(sale_date,1,7)=strftime('%Y-%m','now','localtime')`).get().s;
    out.charts.salesByMonth = db.prepare(`SELECT substr(sale_date,1,7) m, SUM(net_price) total FROM sales WHERE sale_date >= date('now','-6 months') GROUP BY m ORDER BY m`).all();
  }
  if (can(p, 'units', 'view')) out.stats.unitsAvail = db.prepare(`SELECT COUNT(*) c FROM units WHERE status IN ('available','resale')`).get().c;
  out.stats.unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(uid).c;
  // تركيز اليوم: أهم ما يحتاج الانتباه
  const f = [];
  (out.lists.myTasks || []).filter(x => x.due_date && x.due_date <= t).forEach(x => f.push({ kind: 'task', label: `مهمة مستحقة: ${x.title}`, link: '/tasks', level: x.due_date < t ? 'danger' : 'warn' }));
  (out.lists.upcoming || []).filter(a => a.date === t).forEach(a => f.push({ kind: 'appointment', label: `موعد اليوم ${a.start_time}: ${a.title}`, link: '/appointments', level: 'info' }));
  if (out.stats.expiringRes) f.push({ kind: 'reservation', label: `${out.stats.expiringRes} حجوزات تنتهي قريبًا`, link: '/reservations', level: 'warn' });
  if (out.stats.missed) f.push({ kind: 'call', label: `${out.stats.missed} اتصالات فائتة تحتاج متابعة`, link: '/calls', level: 'warn' });
  out.focus = f.slice(0, 8);
  res.json(out);
});

// ---------- global search ----------
R.get('/search', auth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ groups: [] });
  const like = `%${q}%`, p = req.user.perms, groups = [];
  const g = (key, title, icon, link, rows) => { if (rows.length) groups.push({ key, title, icon, link, rows }); };
  if (can(p, 'clients', 'view')) g('clients', 'العملاء', 'users', '/clients', db.prepare('SELECT id, name title, phone sub FROM clients WHERE deleted_at IS NULL AND (name LIKE ? OR phone LIKE ? OR company LIKE ?) LIMIT 5').all(like, like, like));
  if (can(p, 'tasks', 'view')) g('tasks', 'المهام', 'check', '/tasks', db.prepare('SELECT id, title, status sub FROM tasks WHERE deleted_at IS NULL AND title LIKE ? LIMIT 5').all(like));
  if (can(p, 'appointments', 'view')) g('appointments', 'المواعيد', 'calendar', '/appointments', db.prepare('SELECT id, title, date sub FROM appointments WHERE deleted_at IS NULL AND title LIKE ? LIMIT 5').all(like));
  if (can(p, 'calls', 'view')) g('calls', 'الاتصالات', 'phone', '/calls', db.prepare('SELECT id, contact_name title, phone sub FROM calls WHERE deleted_at IS NULL AND (contact_name LIKE ? OR phone LIKE ?) LIMIT 5').all(like, like));
  if (can(p, 'notes', 'view')) g('notes', 'الملاحظات', 'note', '/notes', db.prepare('SELECT id, COALESCE(NULLIF(title,\'\'), substr(body,1,40)) title, type sub FROM notes WHERE deleted_at IS NULL AND (title LIKE ? OR body LIKE ?) LIMIT 5').all(like, like));
  if (can(p, 'files', 'view')) g('files', 'الملفات', 'file', '/files', db.prepare('SELECT id, original_name title, category sub FROM files WHERE deleted_at IS NULL AND original_name LIKE ? LIMIT 5').all(like));
  if (can(p, 'units', 'view')) g('units', 'الوحدات', 'home', '/projects', db.prepare('SELECT id, code title, status sub FROM units WHERE deleted_at IS NULL AND code LIKE ? LIMIT 5').all(like));
  if (can(p, 'projects', 'view')) g('projects', 'المشاريع', 'building', '/projects', db.prepare('SELECT id, name title, code sub FROM projects WHERE (name LIKE ? OR code LIKE ?) LIMIT 5').all(like, like));
  if (can(p, 'users', 'view')) g('users', 'المستخدمون', 'user', '/users', db.prepare('SELECT id, name title, username sub FROM users WHERE deleted_at IS NULL AND (name LIKE ? OR username LIKE ?) LIMIT 5').all(like, like));
  if (can(p, 'sales', 'view')) g('sales', 'المبيعات', 'money', '/sales', db.prepare('SELECT s.id, s.code title, c.name sub FROM sales s JOIN clients c ON c.id=s.client_id WHERE s.code LIKE ? OR c.name LIKE ? LIMIT 5').all(like, like));
  if (can(p, 'reservations', 'view')) g('reservations', 'الحجوزات', 'key', '/reservations', db.prepare('SELECT r.id, r.code title, c.name sub FROM reservations r JOIN clients c ON c.id=r.client_id WHERE r.code LIKE ? OR c.name LIKE ? LIMIT 5').all(like, like));
  if (can(p, 'finance', 'view') || can(p, 'sales', 'view')) {
    g('invoices', 'الفواتير', 'invoice', '/sales', db.prepare('SELECT id, code title, amount sub FROM invoices WHERE code LIKE ? LIMIT 5').all(like));
    g('payments', 'الدفعات', 'cash', '/sales', db.prepare('SELECT p.id, (\'دفعة #\' || p.id) title, p.reference_no sub FROM payments p WHERE p.reference_no LIKE ? LIMIT 5').all(like));
  }
  res.json({ groups });
});

// ---------- reports ----------
// مركز تقارير موحّد: تعريف + فلاتر + صفوف + تصدير Excel احترافي (بدون تكرار للبيانات)
const REPORTS = {
  tasks: { title: 'تقرير المهام', module: 'tasks', cols: ['id', 'title', 'assignee', 'priority', 'status', 'due_date', 'category'], filters: [{ k: 'status', t: 'الحالة', type: 'text' }] },
  clients: { title: 'تقرير العملاء', module: 'clients', cols: ['id', 'code', 'name', 'phone', 'status', 'category'], filters: [{ k: 'status', t: 'الحالة', type: 'text' }] },
  appointments: { title: 'تقرير المواعيد', module: 'appointments', cols: ['id', 'title', 'client', 'date', 'time', 'status'], filters: [{ k: 'status', t: 'الحالة', type: 'text' }] },
  calls: { title: 'تقرير الاتصالات', module: 'calls', cols: ['id', 'contact', 'phone', 'direction', 'result', 'date'], filters: [{ k: 'result', t: 'النتيجة', type: 'text' }] },
  activity: { title: 'تقرير النشاط', module: 'audit', cols: ['id', 'user', 'action', 'module', 'details', 'date'], filters: [{ k: 'module', t: 'الوحدة', type: 'text' }] },
  users: { title: 'تقرير المستخدمين', module: 'users', cols: ['id', 'name', 'username', 'role', 'status', 'last_login'], filters: [] },
  reservations: { title: 'تقرير الحجوزات', module: 'reservations', cols: ['id', 'code', 'unit', 'client', 'price', 'deposit', 'status', 'date'], filters: [{ k: 'status', t: 'الحالة', type: 'text' }, { k: 'project_id', t: 'المشروع', type: 'project' }] },
  sales: { title: 'تقرير المبيعات', module: 'sales', cols: ['id', 'code', 'unit', 'client', 'net', 'paid', 'remaining', 'date'], filters: [{ k: 'from', t: 'من تاريخ', type: 'date' }, { k: 'to', t: 'إلى تاريخ', type: 'date' }, { k: 'project_id', t: 'المشروع', type: 'project' }] },
  finance: { title: 'التقرير المالي', module: 'finance', cols: ['id', 'code', 'client', 'net', 'commission', 'settlement', 'date'], filters: [{ k: 'from', t: 'من تاريخ', type: 'date' }, { k: 'to', t: 'إلى تاريخ', type: 'date' }] },
  units: { title: 'تقرير الوحدات', module: 'units', cols: ['id', 'code', 'project', 'rooms', 'area', 'price', 'status'], filters: [{ k: 'project_id', t: 'المشروع', type: 'project' }, { k: 'status', t: 'الحالة', type: 'text' }] },

  // ——— تقارير النظام المالي الجديد ———
  collections: {
    title: 'تقرير التحصيلات (المقبوضات)', module: 'finance', prefix: 'COL',
    cols: ['receipt_no', 'paid_at', 'client', 'sale', 'unit', 'project', 'amount', 'method', 'account', 'reference_no', 'check_no', 'status', 'user'],
    filters: [{ k: 'from', t: 'من تاريخ', type: 'date' }, { k: 'to', t: 'إلى تاريخ', type: 'date' }, { k: 'project_id', t: 'المشروع', type: 'project' }, { k: 'account_id', t: 'الحساب', type: 'account' }, { k: 'method', t: 'طريقة الدفع', type: 'method' }, { k: 'status', t: 'الحالة', type: 'paymentStatus' }, { k: 'client_id', t: 'العميل', type: 'client' }]
  },
  overdue_installments: {
    title: 'تقرير المبالغ المتأخرة (الأقساط المتأخرة)', module: 'schedule', prefix: 'OVD',
    cols: ['client', 'phone', 'project', 'unit', 'sale', 'contract', 'due_date', 'amount', 'paid', 'remaining', 'days_late', 'last_payment', 'last_contact', 'employee'],
    filters: [{ k: 'days', t: 'أدنى أيام تأخير', type: 'number' }, { k: 'project_id', t: 'المشروع', type: 'project' }, { k: 'employee_id', t: 'الموظف', type: 'employee' }]
  },
  schedule: {
    title: 'جدول الأقساط والاستحقاقات', module: 'schedule', prefix: 'SCH',
    cols: ['code', 'client', 'phone', 'project', 'unit', 'sale', 'seq', 'label', 'due_date', 'amount', 'paid', 'remaining', 'status'],
    filters: [{ k: 'from', t: 'استحقاق من', type: 'date' }, { k: 'to', t: 'استحقاق إلى', type: 'date' }, { k: 'status', t: 'الحالة', type: 'text' }, { k: 'project_id', t: 'المشروع', type: 'project' }, { k: 'client_id', t: 'العميل', type: 'client' }]
  },
  expenses_report: {
    title: 'تقرير المصروفات', module: 'expenses', prefix: 'EXP',
    cols: ['code', 'date', 'category', 'amount', 'account', 'project', 'unit', 'vendor', 'beneficiary', 'method', 'reference_no', 'description', 'employee', 'status', 'approver'],
    filters: [{ k: 'from', t: 'من تاريخ', type: 'date' }, { k: 'to', t: 'إلى تاريخ', type: 'date' }, { k: 'category_id', t: 'التصنيف', type: 'expenseCategory' }, { k: 'project_id', t: 'المشروع', type: 'project' }, { k: 'account_id', t: 'الحساب', type: 'account' }, { k: 'status', t: 'الحالة', type: 'text' }]
  },
  commissions_report: {
    title: 'تقرير عمولات المسوقين', module: 'commissions', prefix: 'COM',
    cols: ['sale', 'date', 'broker', 'rate', 'client', 'unit', 'project', 'net', 'commission', 'paid', 'remaining', 'due_date', 'status'],
    filters: [{ k: 'broker_id', t: 'المسوق', type: 'broker' }, { k: 'from', t: 'من تاريخ', type: 'date' }, { k: 'to', t: 'إلى تاريخ', type: 'date' }, { k: 'project_id', t: 'المشروع', type: 'project' }]
  },
  accounts_report: {
    title: 'تقرير الحسابات والأرصدة', module: 'accounts', prefix: 'ACC',
    cols: ['code', 'name', 'type', 'bank', 'account_no', 'iban', 'opening', 'current', 'month_in', 'month_out', 'status', 'project'],
    filters: [{ k: 'type', t: 'نوع الحساب', type: 'accountType' }, { k: 'status', t: 'الحالة', type: 'text' }]
  },
  refunds_report: {
    title: 'تقرير الاستردادات', module: 'finance', prefix: 'REF',
    cols: ['code', 'date', 'client', 'sale', 'reservation', 'amount', 'deducted', 'method', 'account', 'reference_no', 'reason', 'status', 'requested_by', 'approved_by'],
    filters: [{ k: 'from', t: 'من تاريخ', type: 'date' }, { k: 'to', t: 'إلى تاريخ', type: 'date' }, { k: 'status', t: 'الحالة', type: 'text' }, { k: 'client_id', t: 'العميل', type: 'client' }]
  },
  contracts_report: {
    title: 'تقرير العقود', module: 'contracts', prefix: 'CON',
    cols: ['code', 'client', 'project', 'unit', 'sale', 'contract_date', 'start_date', 'end_date', 'amount', 'discount', 'net', 'paid', 'remaining', 'signed_at', 'status'],
    filters: [{ k: 'status', t: 'الحالة', type: 'text' }, { k: 'from', t: 'من تاريخ', type: 'date' }, { k: 'to', t: 'إلى تاريخ', type: 'date' }, { k: 'project_id', t: 'المشروع', type: 'project' }]
  },
  quotations_report: {
    title: 'تقرير عروض الأسعار', module: 'quotations', prefix: 'QTN',
    cols: ['code', 'quote_date', 'valid_until', 'client', 'phone', 'project', 'unit', 'price', 'discount', 'net', 'broker', 'status'],
    filters: [{ k: 'status', t: 'الحالة', type: 'text' }, { k: 'from', t: 'من تاريخ', type: 'date' }, { k: 'to', t: 'إلى تاريخ', type: 'date' }, { k: 'project_id', t: 'المشروع', type: 'project' }]
  },
  project_financials: {
    title: 'التقرير المالي للمشاريع', module: 'statements', prefix: 'PST',
    cols: ['code', 'name', 'units', 'sold', 'gross_sales', 'discounts', 'net_sales', 'collected', 'remaining', 'expenses', 'commissions', 'commissions_paid', 'net_cash_flow'],
    filters: [{ k: 'project_id', t: 'المشروع', type: 'project' }]
  },
  units_inventory: {
    title: 'تقرير الوحدات والمخزون العقاري', module: 'units', prefix: 'INV',
    cols: ['code', 'project', 'building', 'floor', 'floor_type', 'type', 'rooms', 'bathrooms', 'area', 'price', 'status', 'delivery_status'],
    filters: [{ k: 'project_id', t: 'المشروع', type: 'project' }, { k: 'building_id', t: 'المبنى', type: 'building' }, { k: 'floor_id', t: 'الدور', type: 'floor' }, { k: 'floor_type', t: 'نوع الدور', type: 'floorType' }, { k: 'rooms', t: 'عدد الغرف', type: 'number' }, { k: 'status', t: 'الحالة', type: 'text' }, { k: 'unit_type', t: 'نوع الوحدة', type: 'propertyType' }]
  },
  interested_clients: {
    title: 'تقرير العملاء المهتمين', module: 'interests', prefix: 'INT',
    cols: ['client', 'phone', 'email', 'type', 'project', 'area', 'budget', 'rooms', 'bathrooms', 'floor_pref', 'roof', 'size', 'purpose', 'stage', 'last_contact', 'employee', 'open_units'],
    filters: [{ k: 'project_id', t: 'المشروع', type: 'project' }, { k: 'rooms', t: 'عدد الغرف', type: 'number' }, { k: 'budget_min', t: 'أقل ميزانية', type: 'number' }, { k: 'budget_max', t: 'أعلى ميزانية', type: 'number' }, { k: 'property_type', t: 'نوع العقار', type: 'propertyType' }, { k: 'floor_pref', t: 'الدور', type: 'floorType' }, { k: 'wants_roof', t: 'روف', type: 'bool' }, { k: 'area', t: 'المنطقة', type: 'text' }, { k: 'stage', t: 'مرحلة العميل', type: 'stage' }, { k: 'employee_id', t: 'الموظف', type: 'employee' }]
  },
  not_followed_up: {
    title: 'تقرير العملاء غير المتابعين', module: 'interests', prefix: 'NFP',
    cols: ['client', 'phone', 'stage', 'last_contact', 'days_since', 'employee', 'interests', 'open_units'],
    filters: [{ k: 'days', t: 'أيام بدون تواصل', type: 'number' }, { k: 'employee_id', t: 'الموظف', type: 'employee' }, { k: 'stage', t: 'المرحلة', type: 'stage' }]
  },
  top_demands: {
    title: 'تقرير الطلبات الأكثر تكرارًا', module: 'interests', prefix: 'TOP',
    cols: ['kind', 'item', 'count'],
    filters: [{ k: 'from', t: 'من تاريخ', type: 'date' }, { k: 'to', t: 'إلى تاريخ', type: 'date' }, { k: 'property_type', t: 'نوع العقار', type: 'propertyType' }]
  }
};

const inRange = (col, f) => { const w = []; const p = []; if (f.from) { w.push(`${col}>=?`); p.push(f.from); } if (f.to) { w.push(`${col}<=?`); p.push(f.to); } return { sql: w.length ? ' AND ' + w.join(' AND ') : '', p }; };
const eqIf = (col, v) => (v !== undefined && v !== null && v !== '') ? { sql: ` AND ${col}=?`, p: [v] } : { sql: '', p: [] };

function reportRows(name, f = {}) {
  const and = (...os) => os.map(o => o.sql).join('') + '\u0000';
  switch (name) {
    case 'tasks': return db.prepare(`SELECT t.id, t.title, u.name assignee, t.priority, t.status, t.due_date, t.category FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.deleted_at IS NULL ${f.status ? 'AND t.status=?' : ''} ORDER BY t.id DESC LIMIT 1000`).all(...(f.status ? [f.status] : []));
    case 'clients': { const e = eqIf('c.status', f.status); return db.prepare(`SELECT c.id, c.code, c.name, c.phone, c.status, c.category FROM clients c WHERE c.deleted_at IS NULL${e.sql} ORDER BY c.id DESC LIMIT 1000`).all(...e.p); }
    case 'appointments': { const e = eqIf('a.status', f.status); return db.prepare(`SELECT a.id, a.title, c.name client, a.date, a.start_time time, a.status FROM appointments a LEFT JOIN clients c ON c.id=a.client_id WHERE a.deleted_at IS NULL${e.sql} ORDER BY a.date DESC LIMIT 1000`).all(...e.p); }
    case 'calls': { const e = eqIf('result', f.result); const r = inRange('started_at', {}); return db.prepare(`SELECT id, contact_name contact, phone, direction, result, substr(started_at,1,10) date FROM calls WHERE deleted_at IS NULL${e.sql} ORDER BY id DESC LIMIT 1000`).all(...e.p); }
    case 'activity': { const e = eqIf('module', f.module); return db.prepare(`SELECT id, username user, action, module, details, substr(created_at,1,16) date FROM audit_logs WHERE 1=1${e.sql} ORDER BY id DESC LIMIT 1000`).all(...e.p); }
    case 'users': return db.prepare(`SELECT u.id, u.name, u.username, r.name_ar role, u.status, u.last_login_at last_login FROM users u JOIN roles r ON r.id=u.role_id WHERE u.deleted_at IS NULL`).all();
    case 'reservations': { const e = eqIf('r.status', f.status); const pr = eqIf('u.project_id', f.project_id); return db.prepare(`SELECT r.id, r.code, u.code unit, c.name client, r.price, COALESCE((SELECT SUM(pm.amount) FROM payments pm WHERE pm.reservation_id=r.id AND pm.status='confirmed' AND pm.deleted_at IS NULL),0) deposit, r.status, r.reservation_date date FROM reservations r JOIN units u ON u.id=r.unit_id JOIN clients c ON c.id=r.client_id WHERE 1=1${e.sql}${pr.sql} ORDER BY r.id DESC LIMIT 1000`).all(...e.p, ...pr.p); }
    case 'sales': { const e = eqIf('s.status', f.status); const pr = eqIf('u.project_id', f.project_id); const rg = inRange('s.sale_date', f); return db.prepare(`SELECT s.id, s.code, u.code unit, c.name client, s.sale_price - s.discount net, COALESCE((SELECT SUM(pm.amount) FROM payments pm WHERE pm.sale_id=s.id AND pm.status='confirmed' AND pm.deleted_at IS NULL),0) - COALESCE((SELECT SUM(rf.amount) FROM refunds rf WHERE rf.sale_id=s.id AND rf.status IN ('approved','paid')),0) paid, (s.sale_price - s.discount) - COALESCE((SELECT SUM(pm.amount) FROM payments pm WHERE pm.sale_id=s.id AND pm.status='confirmed' AND pm.deleted_at IS NULL),0) + COALESCE((SELECT SUM(rf.amount) FROM refunds rf WHERE rf.sale_id=s.id AND rf.status IN ('approved','paid')),0) remaining, s.sale_date date FROM sales s JOIN units u ON u.id=s.unit_id JOIN clients c ON c.id=s.client_id WHERE s.status<>'cancelled'${e.sql}${pr.sql}${rg.sql} ORDER BY s.id DESC LIMIT 1000`).all(...e.p, ...pr.p, ...rg.p); }
    case 'finance': { const rg = inRange('s.sale_date', f); return db.prepare(`SELECT s.id, s.code, c.name client, s.net_price net, s.commission, s.settlement, s.sale_date date FROM sales s JOIN clients c ON c.id=s.client_id WHERE s.status<>'cancelled'${rg.sql} ORDER BY s.id DESC LIMIT 1000`).all(...rg.p); }
    case 'units': { const e = eqIf('u.status', f.status); const pr = eqIf('u.project_id', f.project_id); return db.prepare(`SELECT u.id, u.code, p.code project, u.rooms, u.area, u.price, u.status FROM units u JOIN projects p ON p.id=u.project_id WHERE u.deleted_at IS NULL${e.sql}${pr.sql} ORDER BY u.code LIMIT 1000`).all(...e.p, ...pr.p); }

    case 'collections': {
      const E1 = require('./estate_core');
      const { where, params } = (() => {
        const w = ["p.deleted_at IS NULL"], ps = [];
        const add = (sql, ...v) => { w.push(sql); ps.push(...v); };
        if (f.from) add('p.paid_at>=?', f.from);
        if (f.to) add('p.paid_at<=?', f.to);
        if (f.project_id) add('p.project_id=?', f.project_id);
        if (f.account_id) add('p.account_id=?', f.account_id);
        if (f.method) add('p.method=?', f.method);
        if (f.status) add('p.status=?', f.status);
        if (f.client_id) add('p.client_id=?', f.client_id);
        return { where: w.join(' AND '), params: ps };
      })();
      return db.prepare(`SELECT p.receipt_no, p.paid_at, c.name client, s.code sale, u.code unit, pr.code project, p.amount, p.method,
          a.name account, p.reference_no, p.check_no, p.status, us.name user
        FROM payments p LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN sales s ON s.id=p.sale_id LEFT JOIN units u ON u.id=p.unit_id
        LEFT JOIN projects pr ON pr.id=p.project_id LEFT JOIN accounts a ON a.id=p.account_id LEFT JOIN users us ON us.id=p.created_by
        WHERE ${where} ORDER BY p.paid_at DESC, p.id DESC LIMIT 2000`).all(...params);
    }
    case 'overdue_installments': {
      F_mod.refreshScheduleStatuses();
      const w = ["ps.deleted_at IS NULL", "ps.status NOT IN ('paid','cancelled')", "ps.due_date < date('now','localtime')"], ps = [];
      if (f.days) { w.push('CAST(julianday(date(\'now\',\'localtime\')) - julianday(ps.due_date) AS INTEGER) >= ?'); ps.push(Number(f.days)); }
      if (f.project_id) { w.push('ps.project_id=?'); ps.push(f.project_id); }
      if (f.employee_id) { w.push('c.assigned_to=?'); ps.push(f.employee_id); }
      return db.prepare(`SELECT c.name client, c.phone, p.name project, u.code unit, s.code sale, ct.code contract, ps.due_date,
          ps.amount, ps.paid_amount paid, (ps.amount - ps.paid_amount) remaining,
          CAST(julianday(date('now','localtime')) - julianday(ps.due_date) AS INTEGER) days_late,
          (SELECT MAX(p2.paid_at) FROM payments p2 WHERE p2.sale_id=ps.sale_id AND p2.status='confirmed') last_payment,
          (SELECT MAX(cm.occurred_at) FROM communications cm WHERE cm.client_id=ps.client_id) last_contact, us.name employee
        FROM payment_schedule ps LEFT JOIN clients c ON c.id=ps.client_id LEFT JOIN users us ON us.id=c.assigned_to LEFT JOIN units u ON u.id=ps.unit_id
        LEFT JOIN projects p ON p.id=ps.project_id LEFT JOIN sales s ON s.id=ps.sale_id LEFT JOIN contracts ct ON ct.id=ps.contract_id
        WHERE ${w.join(' AND ')} ORDER BY days_late DESC LIMIT 2000`).all(...ps);
    }
    case 'schedule': {
      F_mod.refreshScheduleStatuses();
      const w = ['ps.deleted_at IS NULL'], ps = [];
      if (f.from) { w.push('ps.due_date>=?'); ps.push(f.from); }
      if (f.to) { w.push('ps.due_date<=?'); ps.push(f.to); }
      if (f.status) { w.push('ps.status=?'); ps.push(f.status); }
      if (f.project_id) { w.push('ps.project_id=?'); ps.push(f.project_id); }
      if (f.client_id) { w.push('ps.client_id=?'); ps.push(f.client_id); }
      return db.prepare(`SELECT ps.code, c.name client, c.phone, p.name project, u.code unit, s.code sale, ps.seq, ps.label, ps.due_date,
          ps.amount, ps.paid_amount paid, (ps.amount - ps.paid_amount) remaining, ps.status
        FROM payment_schedule ps LEFT JOIN clients c ON c.id=ps.client_id LEFT JOIN units u ON u.id=ps.unit_id LEFT JOIN projects p ON p.id=ps.project_id
        LEFT JOIN sales s ON s.id=ps.sale_id WHERE ${w.join(' AND ')} ORDER BY ps.due_date, ps.seq LIMIT 3000`).all(...ps);
    }
    case 'expenses_report': {
      const w = ['e.deleted_at IS NULL'], ps = [];
      if (f.from) { w.push('e.expense_date>=?'); ps.push(f.from); }
      if (f.to) { w.push('e.expense_date<=?'); ps.push(f.to); }
      if (f.category_id) { w.push('e.category_id=?'); ps.push(f.category_id); }
      if (f.project_id) { w.push('e.project_id=?'); ps.push(f.project_id); }
      if (f.account_id) { w.push('e.account_id=?'); ps.push(f.account_id); }
      if (f.status) { w.push('e.status=?'); ps.push(f.status); }
      return db.prepare(`SELECT e.code, e.expense_date date, ec.name category, e.amount, a.name account, p.name project, u.code unit, e.vendor, e.beneficiary,
          e.method, e.reference_no, e.description, us.name employee, e.status, ap.name approver
        FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id LEFT JOIN accounts a ON a.id=e.account_id LEFT JOIN projects p ON p.id=e.project_id
        LEFT JOIN units u ON u.id=e.unit_id LEFT JOIN users us ON us.id=e.employee_id LEFT JOIN users ap ON ap.id=e.approved_by
        WHERE ${w.join(' AND ')} ORDER BY e.expense_date DESC LIMIT 3000`).all(...ps);
    }
    case 'commissions_report': {
      const w = ["s.status<>'cancelled'", 's.broker_id IS NOT NULL'], ps = [];
      if (f.broker_id) { w.push('s.broker_id=?'); ps.push(f.broker_id); }
      if (f.project_id) { w.push('u.project_id=?'); ps.push(f.project_id); }
      if (f.from) { w.push('s.sale_date>=?'); ps.push(f.from); }
      if (f.to) { w.push('s.sale_date<=?'); ps.push(f.to); }
      return db.prepare(`SELECT s.code sale, s.sale_date date, b.name broker, b.commission_rate rate, c.name client, u.code unit, p.name project, s.net_price net,
          s.commission, COALESCE((SELECT SUM(cp.amount) FROM commission_payments cp WHERE cp.sale_id=s.id AND cp.status='paid' AND cp.deleted_at IS NULL),0) paid,
          (s.commission - COALESCE((SELECT SUM(cp.amount) FROM commission_payments cp WHERE cp.sale_id=s.id AND cp.status='paid' AND cp.deleted_at IS NULL),0)) remaining,
          date(s.sale_date, '+' || COALESCE(b.due_days,0) || ' days') due_date,
          CASE WHEN s.commission - COALESCE((SELECT SUM(cp.amount) FROM commission_payments cp WHERE cp.sale_id=s.id),0) <= 0.01 THEN 'مدفوعة'
               WHEN date(s.sale_date, '+' || COALESCE(b.due_days,0) || ' days') < date('now','localtime') THEN 'متأخرة' ELSE 'مستحقة' END status
        FROM sales s JOIN brokers b ON b.id=s.broker_id JOIN units u ON u.id=s.unit_id JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=u.project_id
        WHERE ${w.join(' AND ')} ORDER BY s.sale_date DESC LIMIT 2000`).all(...ps);
    }
    case 'accounts_report': {
      const w = ['a.deleted_at IS NULL'], ps = [];
      if (f.type) { w.push('a.type=?'); ps.push(f.type); }
      if (f.status) { w.push('a.status=?'); ps.push(f.status); }
      return db.prepare(`SELECT a.code, a.name, a.type, a.bank_name bank, a.account_no, a.iban, a.opening_balance opening, a.current_balance current,
          COALESCE((SELECT SUM(CASE WHEN t.direction='in' THEN t.amount ELSE 0 END) FROM transactions t WHERE t.account_id=a.id AND t.status IN ('confirmed','cleared') AND substr(t.txn_date,1,7)=substr(date('now','localtime'),1,7)),0) month_in,
          COALESCE((SELECT SUM(CASE WHEN t.direction='out' THEN t.amount ELSE 0 END) FROM transactions t WHERE t.account_id=a.id AND t.status IN ('confirmed','cleared') AND substr(t.txn_date,1,7)=substr(date('now','localtime'),1,7)),0) month_out,
          a.status, p.name project
        FROM accounts a LEFT JOIN projects p ON p.id=a.project_id WHERE ${w.join(' AND ')} ORDER BY a.id`).all(...ps);
    }
    case 'refunds_report': {
      const w = ['r.deleted_at IS NULL'], ps = [];
      if (f.from) { w.push('r.refund_date>=?'); ps.push(f.from); }
      if (f.to) { w.push('r.refund_date<=?'); ps.push(f.to); }
      if (f.status) { w.push('r.status=?'); ps.push(f.status); }
      if (f.client_id) { w.push('r.client_id=?'); ps.push(f.client_id); }
      return db.prepare(`SELECT r.code, r.refund_date date, c.name client, s.code sale, rv.code reservation, r.amount, r.deducted_amount deducted, r.method,
          a.name account, r.reference_no, r.reason, r.status, u1.name requested_by, u2.name approved_by
        FROM refunds r LEFT JOIN clients c ON c.id=r.client_id LEFT JOIN sales s ON s.id=r.sale_id LEFT JOIN reservations rv ON rv.id=r.reservation_id
        LEFT JOIN accounts a ON a.id=r.account_id LEFT JOIN users u1 ON u1.id=r.requested_by LEFT JOIN users u2 ON u2.id=r.approved_by
        WHERE ${w.join(' AND ')} ORDER BY r.id DESC LIMIT 2000`).all(...ps);
    }
    case 'contracts_report': {
      const w = ['ct.deleted_at IS NULL'], ps = [];
      if (f.status) { w.push('ct.status=?'); ps.push(f.status); }
      if (f.from) { w.push('ct.contract_date>=?'); ps.push(f.from); }
      if (f.to) { w.push('ct.contract_date<=?'); ps.push(f.to); }
      if (f.project_id) { w.push('ct.project_id=?'); ps.push(f.project_id); }
      return db.prepare(`SELECT ct.code, c.name client, p.name project, u.code unit, s.code sale, ct.contract_date, ct.start_date, ct.end_date, ct.amount, ct.discount, ct.net_amount net,
          COALESCE((SELECT SUM(pm.amount) FROM payments pm WHERE pm.contract_id=ct.id AND pm.status='confirmed' AND pm.deleted_at IS NULL),0) paid,
          ct.net_amount - COALESCE((SELECT SUM(pm.amount) FROM payments pm WHERE pm.contract_id=ct.id AND pm.status='confirmed' AND pm.deleted_at IS NULL),0) remaining,
          ct.signed_at, ct.status
        FROM contracts ct JOIN clients c ON c.id=ct.client_id LEFT JOIN projects p ON p.id=ct.project_id LEFT JOIN units u ON u.id=ct.unit_id LEFT JOIN sales s ON s.id=ct.sale_id
        WHERE ${w.join(' AND ')} ORDER BY ct.id DESC LIMIT 2000`).all(...ps);
    }
    case 'quotations_report': {
      const w = ['q.deleted_at IS NULL'], ps = [];
      if (f.status) { w.push('q.status=?'); ps.push(f.status); }
      if (f.from) { w.push('q.quote_date>=?'); ps.push(f.from); }
      if (f.to) { w.push('q.quote_date<=?'); ps.push(f.to); }
      if (f.project_id) { w.push('q.project_id=?'); ps.push(f.project_id); }
      return db.prepare(`SELECT q.code, q.quote_date, q.valid_until, c.name client, c.phone, p.name project, u.code unit, q.price, q.discount, q.net_price net, b.name broker, q.status
        FROM quotations q JOIN clients c ON c.id=q.client_id LEFT JOIN projects p ON p.id=q.project_id LEFT JOIN units u ON u.id=q.unit_id LEFT JOIN brokers b ON b.id=q.broker_id
        WHERE ${w.join(' AND ')} ORDER BY q.id DESC LIMIT 2000`).all(...ps);
    }
    case 'project_financials': {
      const w = ['p.deleted_at IS NULL'], ps = [];
      if (f.project_id) { w.push('p.id=?'); ps.push(f.project_id); }
      return db.prepare(`SELECT p.id, p.code, p.name FROM projects p WHERE ${w.join(' AND ')} ORDER BY p.id`).all(...ps).map(p => {
        const t = F_mod.projectTotals(p.id);
        return { code: p.code, name: p.name, units: t.units_count, sold: t.sold_count, gross_sales: t.gross_sales, discounts: t.discounts, net_sales: t.net_sales,
          collected: t.collected, remaining: t.remaining, expenses: t.expenses, commissions: t.commissions, commissions_paid: t.commissions_paid, net_cash_flow: t.net_cash_flow };
      });
    }
    case 'units_inventory': {
      const E1 = require('./estate_core');
      const { where, params } = E1.unitFilterWhere(f, 'u');
      return db.prepare(`SELECT u.code, p.name project, b.name building, f.name floor, f.type floor_type, u.type, u.rooms, u.bathrooms, u.area, u.price, u.status, u.delivery_status
        FROM units u JOIN projects p ON p.id=u.project_id LEFT JOIN buildings b ON b.id=u.building_id LEFT JOIN floors f ON f.id=u.floor_id
        WHERE ${where} ORDER BY u.code LIMIT 3000`).all(...params);
    }
    case 'interested_clients': {
      const E1 = require('./estate_core');
      const { where, params } = E1.interestFilterWhere(f);
      const T = { apartment: 'شقة', villa: 'فيلا', duplex: 'دوبلكس', roof: 'روف', studio: 'استوديو', land: 'أرض', office: 'مكتب', shop: 'معرض/محل', other: 'أخرى' };
      const P = { residence: 'سكن', investment: 'استثمار', resale: 'إعادة بيع', other: 'أخرى' };
      const ST = Object.fromEntries((E1.pipelineStages() || []).map(s => [s.k, s.name]));
      return db.prepare(`SELECT c.name client, c.phone, c.email, i.property_type type, p.name project, COALESCE(NULLIF(i.preferred_area,''), c.city) area,
          (i.budget_min || ' - ' || i.budget_max) budget, i.rooms, i.bathrooms, i.floor_pref, i.wants_roof roof,
          CASE WHEN i.area_min=0 AND i.area_max=0 THEN 'غير محدد' ELSE (i.area_min || ' - ' || i.area_max) END size,
          i.purpose, c.pipeline_stage stage, c.last_contact_at last_contact, us.name employee,
          (SELECT COUNT(*) FROM units u2 LEFT JOIN floors f2 ON f2.id=u2.floor_id WHERE u2.deleted_at IS NULL AND u2.status IN ('available','resale')
             AND (i.preferred_project_id IS NULL OR u2.project_id=i.preferred_project_id) AND (i.rooms=0 OR u2.rooms=i.rooms)
             AND (i.budget_min=0 OR u2.price>=i.budget_min) AND (i.budget_max=0 OR u2.price<=i.budget_max)) open_units,
          i.budget_min budget_min, i.budget_max budget_max
        FROM client_interests i JOIN clients c ON c.id=i.client_id LEFT JOIN projects p ON p.id=i.preferred_project_id LEFT JOIN users us ON us.id=c.assigned_to
        WHERE ${where} ORDER BY i.id DESC LIMIT 2000`).all(...params)
        .map(r => ({ ...r, type: T[r.type] || r.type, purpose: P[r.purpose] || r.purpose, roof: r.roof ? 'نعم' : 'لا', stage: ST[r.stage] || r.stage || '', budget: `${Number(r.budget_min || 0).toLocaleString('en')} - ${Number(r.budget_max || 0).toLocaleString('en')}` }));
    }
    case 'not_followed_up': {
      const days = Number(f.days || 30);
      const w = ["c.deleted_at IS NULL", "COALESCE((SELECT MAX(cm.occurred_at) FROM communications cm WHERE cm.client_id=c.id), c.last_contact_at) IS NULL OR julianday(date('now','localtime')) - julianday(COALESCE((SELECT MAX(cm.occurred_at) FROM communications cm WHERE cm.client_id=c.id), c.last_contact_at)) >= ?"], ps = [days];
      if (f.employee_id) { w.push('c.assigned_to=?'); ps.push(f.employee_id); }
      if (f.stage) { w.push('c.pipeline_stage=?'); ps.push(f.stage); }
      const ST = Object.fromEntries((E.pipelineStages() || []).map(s => [s.k, s.name]));
      return db.prepare(`SELECT c.name client, c.phone, c.pipeline_stage stage, COALESCE((SELECT MAX(cm.occurred_at) FROM communications cm WHERE cm.client_id=c.id), c.last_contact_at) last_contact,
          CAST(COALESCE(julianday(date('now','localtime')) - julianday(COALESCE((SELECT MAX(cm.occurred_at) FROM communications cm WHERE cm.client_id=c.id), c.last_contact_at)), 9999) AS INTEGER) days_since,
          us.name employee, (SELECT COUNT(*) FROM client_interests i WHERE i.client_id=c.id AND i.deleted_at IS NULL) interests,
          (SELECT COUNT(*) FROM units u2 WHERE u2.deleted_at IS NULL AND u2.status IN ('available','resale')) open_units
        FROM clients c LEFT JOIN users us ON us.id=c.assigned_to WHERE ${w.join(' AND ')} ORDER BY days_since DESC LIMIT 2000`).all(...ps)
        .map(r => ({ ...r, stage: ST[r.stage] || r.stage || '' }));
    }
    case 'top_demands': {
      const rg = inRange('i.created_at', f);
      const e = eqIf('i.property_type', f.property_type);
      const rooms = db.prepare(`SELECT 'عدد الغرف المطلوب' kind, CASE WHEN i.rooms=0 THEN 'غير محدد' ELSE CAST(i.rooms AS TEXT) || ' غرف' END item, COUNT(*) count
        FROM client_interests i WHERE i.deleted_at IS NULL${rg.sql}${e.sql} GROUP BY i.rooms ORDER BY count DESC LIMIT 10`).all(...rg.p, ...e.p);
      const budgets = db.prepare(`SELECT 'أكثر ميزانية مطلوبة' kind, CASE
          WHEN i.budget_max=0 THEN 'غير محددة'
          WHEN i.budget_max<500000 THEN 'أقل من 500 ألف'
          WHEN i.budget_max<800000 THEN '500 - 800 ألف'
          WHEN i.budget_max<1200000 THEN '800 ألف - 1.2 مليون'
          WHEN i.budget_max<2000000 THEN '1.2 - 2 مليون'
          ELSE 'أكثر من 2 مليون' END item, COUNT(*) count
        FROM client_interests i WHERE i.deleted_at IS NULL${rg.sql}${e.sql} GROUP BY item ORDER BY count DESC LIMIT 10`).all(...rg.p, ...e.p);
      const projects = db.prepare(`SELECT 'أكثر المشاريع طلبًا' kind, p.name item, COUNT(*) count FROM client_interests i JOIN projects p ON p.id=i.preferred_project_id
        WHERE i.deleted_at IS NULL${rg.sql}${e.sql} GROUP BY p.id ORDER BY count DESC LIMIT 10`).all(...rg.p, ...e.p);
      const types = db.prepare(`SELECT 'أكثر أنواع العقارات طلبًا' kind, i.property_type item, COUNT(*) count FROM client_interests i
        WHERE i.deleted_at IS NULL${rg.sql}${e.sql} GROUP BY i.property_type ORDER BY count DESC LIMIT 10`).all(...rg.p, ...e.p);
      const T = { apartment: 'شقة', villa: 'فيلا', duplex: 'دوبلكس', roof: 'روف', studio: 'استوديو', land: 'أرض', office: 'مكتب', shop: 'معرض/محل', other: 'أخرى' };
      return [...rooms, ...budgets, ...projects, ...types].map(r => ({ ...r, item: r.kind.includes('أنواع') ? (T[r.item] || r.item) : r.item }));
    }
    default: return null;
  }
}
const F_mod = F;

R.get('/reports', auth, P('reports', 'view'), (req, res) => {
  res.json({ reports: Object.entries(REPORTS).map(([k, v]) => ({ key: k, ...v })) });
});
R.get('/reports/:name', auth, P('reports', 'view'), (req, res) => {
  const def = REPORTS[req.params.name];
  if (!def) return res.status(404).json({ error: 'التقرير غير موجود' });
  if (!can(req.user.perms, def.module, 'view')) return res.status(403).json({ error: 'صلاحية مرفوضة لهذا التقرير' });
  const rows = reportRows(req.params.name, req.query);
  res.json({
    def, rows,
    meta: {
      no: `REP-${Date.now().toString(36).toUpperCase()}`, date: new Date().toLocaleString('en-GB'), user: req.user.name,
      company: settingsObj(), filters: req.query, filters_used: require('./xlsx_util').humanFilters(req.query), count: (rows || []).length
    }
  });
});
R.get('/reports/:name/excel', auth, P('reports', 'export'), async (req, res) => {
  const def = REPORTS[req.params.name];
  if (!def) return res.status(404).json({ error: 'التقرير غير موجود' });
  const rows = reportRows(req.params.name, req.query) || [];
  const COLS_AR = {
    id: 'م', title: 'العنوان', assignee: 'المسؤول', priority: 'الأولوية', status: 'الحالة', due_date: 'الاستحقاق', category: 'التصنيف', code: 'الكود', name: 'الاسم',
    phone: 'الهاتف', client: 'العميل', date: 'التاريخ', time: 'الوقت', contact: 'جهة الاتصال', direction: 'الاتجاه', result: 'النتيجة', user: 'المستخدم', action: 'الإجراء',
    module: 'الوحدة', details: 'التفاصيل', username: 'المستخدم', role: 'الدور', last_login: 'آخر دخول', unit: 'الوحدة', price: 'السعر', deposit: 'العربون', net: 'الصافي',
    paid: 'المدفوع', remaining: 'المتبقي', commission: 'العمولة', settlement: 'التسوية', project: 'المشروع', rooms: 'الغرف', area: 'المساحة',
    receipt_no: 'رقم الإيصال', paid_at: 'تاريخ الدفع', sale: 'عملية البيع', amount: 'المبلغ', method: 'طريقة الدفع', account: 'الحساب', reference_no: 'رقم المرجع',
    check_no: 'رقم الشيك', contract: 'رقم العقد', days_late: 'أيام التأخير', last_payment: 'آخر دفعة', last_contact: 'آخر تواصل', employee: 'الموظف',
    seq: 'التسلسل', label: 'البيان', date2: 'التاريخ', category: 'التصنيف', vendor: 'المورد', beneficiary: 'المستفيد', description: 'الوصف', approver: 'المعتمد',
    broker: 'المسوق', rate: 'النسبة %', due_date2: 'تاريخ الاستحقاق', type: 'النوع', bank: 'البنك', account_no: 'رقم الحساب', iban: 'IBAN',
    opening: 'الرصيد الافتتاحي', current: 'الرصيد الحالي', month_in: 'مقبوضات الشهر', month_out: 'مدفوعات الشهر', deducted: 'المخصوم', reservation: 'الحجز',
    requested_by: 'مقدم الطلب', approved_by: 'المعتمد', contract_date: 'تاريخ العقد', start_date: 'تاريخ البداية', end_date: 'تاريخ الانتهاء',
    discount: 'الخصم', signed_at: 'تاريخ التوقيع', quote_date: 'تاريخ العرض', valid_until: 'تاريخ الانتهاء', email: 'البريد الإلكتروني', budget: 'الميزانية',
    bathrooms: 'الحمامات', floor_pref: 'الدور المطلوب', roof: 'روف', size: 'المساحة المطلوبة', purpose: 'الغرض', stage: 'المرحلة', open_units: 'وحدات متاحة',
    days_since: 'أيام بدون تواصل', interests: 'عدد الاهتمامات', kind: 'البند', item: 'القيمة', count: 'العدد', units: 'عدد الوحدات', sold: 'المباع',
    gross_sales: 'إجمالي المبيعات', discounts: 'إجمالي الخصومات', net_sales: 'صافي المبيعات', collected: 'إجمالي المقبوضات', expenses: 'إجمالي المصروفات',
    commissions: 'إجمالي العمولات', commissions_paid: 'العمولات المدفوعة', net_cash_flow: 'صافي التدفق المالي', building: 'المبنى', floor: 'الدور',
    floor_type: 'نوع الدور', delivery_status: 'حالة التسليم', project: 'المشروع', unit_type: 'نوع الوحدة', rooms2: 'عدد الغرف'
  };
  const cols = def.cols.map(c => ({ k: c, t: COLS_AR[c] || c, money: /(amount|price|paid|remaining|net|commission|discount|budget|balance|opening|current|collected|expenses|total|month_in|month_out|deducted|salary|settlement)$/.test(c) || COLS_AR[c]?.includes('إجمالي') || ['paid','remaining','amount','price','net','commission','discount','budget','opening','current','collected','expenses','month_in','month_out','deducted','net_sales','gross_sales','discounts','net_cash_flow','commissions','commissions_paid'].includes(c) }));
  await require('./xlsx_util').sendSheet(res, { sheet: def.title, title: def.title, prefix: def.prefix || 'REP', cols, rows, filters: req.query, user: req.user, req });
});

// ---------- backup ----------
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
R.get('/backup', auth, P('backup', 'view'), (req, res) => {
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db'))
    .map(f => ({ name: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size, at: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
    .sort((a, b) => b.at - a.at);
  res.json({ data: files });
});
R.post('/backup', auth, P('backup', 'create'), (req, res) => {
  const name = `backup-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.db`;
  try { flush(); } catch {}
  fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, name));
  pushAudit(req, 'create', 'backup', 'backup', null, name);
  res.status(201).json({ name });
});
R.get('/backup/:name/download', auth, P('backup', 'export'), (req, res) => {
  const fp = path.join(BACKUP_DIR, path.basename(req.params.name));
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'النسخة غير موجودة' });
  pushAudit(req, 'export', 'backup', 'backup', null, req.params.name);
  res.download(fp);
});
R.post('/backup/:name/restore', auth, P('backup', 'manage'), (req, res) => {
  const fp = path.join(BACKUP_DIR, path.basename(req.params.name));
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'النسخة غير موجودة' });
  fs.copyFileSync(fp, DB_PATH + '.restore');
  pushAudit(req, 'update', 'backup', 'restore', null, req.params.name);
  res.json({ ok: true, needRestart: true, message: 'تم تجهيز الاستعادة — أعد تشغيل التطبيق لإتمامها' });
});

// ---------- smart assistant (مساعد تنفيذي حقيقي، يحترم الصلاحيات وينفذ الأدوات) ----------
const { processAssistantRequest } = require('./assistant_engine');

R.post('/assistant', auth, P('assistant', 'view'), async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const confirmed = !!req.body?.confirmed;
  const pending = req.body?.pending;
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const conversation_id = req.body?.conversation_id || null;
  
  try {
    const result = await processAssistantRequest({
      text,
      messages,
      confirmed,
      pending,
      user: req.user,
      conversation_id
    });
    res.json(result);
  } catch (err) {
    console.error('[Assistant API error]:', err);
    res.status(500).json({
      reply: '⚠️ حدث خطأ في معالجة طلب المساعد: ' + err.message,
      isError: true
    });
  }
});

module.exports = R;
