// Smart Secretary — API المالية: الحسابات، الحركات، الدفعات، المصروفات، الأقساط،
// الاستردادات، العمولات، الموافقات، وكشوف الحساب (عميل/مشروع) + Excel.
const express = require('express');
const { db, nextUniqueCode } = require('./db');
const { auth, requirePerm: P, can } = require('./auth');
const { idParam, need } = require('./security');
const F = require('./finance_core');
const E = require('./estate_core');
const X = require('./xlsx_util');
const T = require('./time');

const R = express.Router();
const num = F.num, r2 = F.r2, today = F.today;
const pageOf = (q, max = 200) => ({ page: Math.max(1, parseInt(q.page) || 1), limit: Math.min(max, Math.max(1, parseInt(q.limit) || 20)) });
const push = (req, action, module, entity, id, details) => F.pushAudit(req.user, action, module, entity, id, details);
const nz = (v) => (v === undefined || v === null || v === '' ? null : v);

// =====================================================================
// الحسابات المالية
// =====================================================================
function accountCalc(a) {
  const last = db.prepare('SELECT txn_date, amount, direction, kind FROM transactions WHERE account_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(a.id);
  const month = db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) v FROM transactions
    WHERE account_id=? AND deleted_at IS NULL AND status IN ('confirmed','cleared') AND substr(txn_date,1,7)=substr(date('now','localtime'),1,7)`).get(a.id).v;
  return { ...a, computed_balance: r2(a.current_balance), month_net: r2(month), last_txn: last || null };
}
R.get('/accounts', auth, P('accounts', 'view'), (req, res) => {
  const { page, limit } = pageOf(req.query, 500);
  const w = ['a.deleted_at IS NULL'], ps = [];
  if (req.query.q) { w.push('(a.name LIKE ? OR a.code LIKE ? OR a.bank_name LIKE ? OR a.account_no LIKE ? OR a.iban LIKE ?)'); ps.push(...Array(5).fill(`%${req.query.q}%`)); }
  if (req.query.type) { w.push('a.type=?'); ps.push(req.query.type); }
  if (req.query.status) { w.push('a.status=?'); ps.push(req.query.status); }
  if (req.query.project_id) { w.push('(a.project_id=? OR a.project_id IS NULL)'); ps.push(req.query.project_id); }
  const total = db.prepare(`SELECT COUNT(*) c FROM accounts a WHERE ${w.join(' AND ')}`).get(...ps).c;
  const rows = db.prepare(`SELECT a.*, p.name project_name, u.name created_by_name FROM accounts a LEFT JOIN projects p ON p.id=a.project_id LEFT JOIN users u ON u.id=a.created_by
    WHERE ${w.join(' AND ')} ORDER BY a.is_default DESC, a.id DESC LIMIT ? OFFSET ?`).all(...ps, limit, (page - 1) * limit).map(accountCalc);
  const totals = db.prepare(`SELECT COALESCE(SUM(current_balance),0) all_balance, COALESCE(SUM(CASE WHEN type='cash' THEN current_balance ELSE 0 END),0) cash,
    COALESCE(SUM(CASE WHEN type='bank' THEN current_balance ELSE 0 END),0) bank FROM accounts WHERE deleted_at IS NULL AND status<>'closed'`).get();
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1, totals });
});
R.get('/accounts/summary', auth, P('accounts', 'view'), (req, res) => {
  const byType = db.prepare(`SELECT type, COUNT(*) n, COALESCE(SUM(current_balance),0) balance FROM accounts WHERE deleted_at IS NULL GROUP BY type`).all();
  const inflows = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE direction='in' AND status IN ('confirmed','cleared') AND deleted_at IS NULL AND substr(txn_date,1,7)=substr(date('now','localtime'),1,7)`).get().v;
  const outflows = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM transactions WHERE direction='out' AND status IN ('confirmed','cleared') AND deleted_at IS NULL AND substr(txn_date,1,7)=substr(date('now','localtime'),1,7)`).get().v;
  const total = r2(byType.reduce((s, t) => s + num(t.balance), 0));
  res.json({ byType, total, month_in: r2(inflows), month_out: r2(outflows), month_net: r2(inflows - outflows) });
});
// قائمة التحويلات (على مستوى المجموعة)
R.get('/accounts/transfers', auth, P('accounts', 'view'), (req, res) => {
  if (!F.tableHasCol('transactions', 'transfer_group')) return res.json({ data: [], total: 0, note: 'لم يُطبَّق ترحيل القيد المزدوج بعد' });
  const rows = db.prepare(`SELECT t.*, a1.name from_name, a2.name to_name FROM transactions t
    LEFT JOIN accounts a1 ON a1.id=t.account_id LEFT JOIN accounts a2 ON a2.id=t.to_account_id
    WHERE t.kind='transfer' AND t.direction='out' AND t.deleted_at IS NULL
    ORDER BY t.txn_date DESC, t.id DESC LIMIT 200`).all();
  const data = rows.map(t => {
    const inLeg = db.prepare("SELECT id, status FROM transactions WHERE transfer_group=? AND direction='in' AND deleted_at IS NULL LIMIT 1").get(t.transfer_group);
    return { ...t, in_txn_id: inLeg?.id || null, in_status: inLeg?.status || null, reversible: !t.reversed_by && ['confirmed', 'cleared'].includes(t.status) };
  });
  res.json({ data, total: data.length });
});
R.get('/accounts/:id', auth, P('accounts', 'view'), idParam, (req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'الحساب غير موجود' });
  res.json(accountCalc(a));
});
R.post('/accounts', auth, P('accounts', 'create'), need('name'), (req, res) => {
  const b = req.body || {};
  const type = ['cash', 'bank', 'project', 'wallet', 'other'].includes(b.type) ? b.type : 'cash';
  const code = nextUniqueCode('ACCOUNT', 'accounts', 'code');
  const info = db.prepare(`INSERT INTO accounts (code, name, type, bank_name, account_no, iban, opening_balance, current_balance, project_id, currency, status, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, b.name, type, b.bank_name || '', b.account_no || '', b.iban || '', num(b.opening_balance), num(b.opening_balance),
    nz(b.project_id), b.currency || F.setting('currency', 'SAR'), b.status || 'active', b.notes || '', req.user.id);
  const id = info.lastInsertRowid;
  if (num(b.opening_balance) !== 0) {
    F.postTxn({ kind: 'opening', direction: num(b.opening_balance) >= 0 ? 'in' : 'out', amount: Math.abs(num(b.opening_balance)), accountId: id, txnDate: today(), method: 'other', notes: 'الرصيد الافتتاحي', user: req.user });
  }
  push(req, 'create', 'accounts', 'account', id, `${code} — ${b.name}`);
  res.status(201).json(db.prepare('SELECT * FROM accounts WHERE id=?').get(id));
});
R.put('/accounts/:id', auth, P('accounts', 'edit'), idParam, (req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'الحساب غير موجود' });
  const b = req.body || {};
  const fields = ['name', 'type', 'bank_name', 'account_no', 'iban', 'project_id', 'currency', 'status', 'notes', 'is_default'];
  const cols = fields.filter(f => b[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'لا توجد بيانات للتعديل' });
  db.prepare(`UPDATE accounts SET ${cols.map(c => `${c}=?`).join(',')}, updated_at=datetime('now','localtime') WHERE id=?`).run(...cols.map(c => b[c]), a.id);
  if (b.is_default === 1 || b.is_default === '1') db.prepare('UPDATE accounts SET is_default=0 WHERE id<>?').run(a.id);
  if (b.opening_balance !== undefined && num(b.opening_balance) !== num(a.opening_balance)) {
    if (!can(req.user.perms, 'accounts', 'approve')) return res.status(403).json({ error: 'تعديل الرصيد الافتتاحي يتطلب صلاحية اعتماد' });
    db.prepare('UPDATE accounts SET opening_balance=? WHERE id=?').run(num(b.opening_balance), a.id);
    F.recomputeAccount(a.id);
    push(req, 'update', 'accounts', 'opening_balance', a.id, `تعديل الرصيد الافتتاحي إلى ${num(b.opening_balance)}`);
  }
  push(req, 'update', 'accounts', 'account', a.id, cols.join(','));
  res.json(db.prepare('SELECT * FROM accounts WHERE id=?').get(a.id));
});
R.delete('/accounts/:id', auth, P('accounts', 'delete'), idParam, (req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'الحساب غير موجود' });
  const txns = db.prepare('SELECT COUNT(*) c FROM transactions WHERE account_id=? AND deleted_at IS NULL').get(a.id).c;
  if (txns) return res.status(400).json({ error: 'لا يمكن حذف حساب له حركات مالية — يمكن إيقافه (الحالة: موقوف)' });
  db.prepare(`UPDATE accounts SET deleted_at=datetime('now','localtime') WHERE id=?`).run(a.id);
  push(req, 'delete', 'accounts', 'account', a.id, a.name);
  res.json({ ok: true });
});
// تحويل بين الحسابين — قيد مزدوج (رجلان: out من المصدر + in إلى الوجهة) داخل معاملة ذرّية واحدة
R.post('/accounts/transfer', auth, P('accounts', 'manage'), (req, res) => {
  try {
    const { from_account_id, to_account_id, amount, txn_date, reference_no = '', notes = '', method = 'transfer', allow_overdraft } = req.body || {};
    const out = F.createTransfer({ from_account_id, to_account_id, amount, txn_date, reference_no, notes, method, allow_overdraft, user: req.user });
    const from = db.prepare('SELECT name FROM accounts WHERE id=?').get(Number(from_account_id));
    const to = db.prepare('SELECT name FROM accounts WHERE id=?').get(Number(to_account_id));
    push(req, 'create', 'accounts', 'transfer', out.out_txn_id, `${out.amount} — ${from?.name} → ${to?.name} — مجموعة ${out.transfer_group}`);
    res.status(201).json(out);
  } catch (e) { res.status(e.code || 400).json({ error: e.message, balance: e.balance, overdraft: e.overdraft || false }); }
});
// عكس تحويل — يقلب الرجلين معًا
R.post('/accounts/transfer/:group/reverse', auth, P('accounts', 'manage'), (req, res) => {
  const group = String(req.params.group || '').slice(0, 60);
  if (!/^TRF-[A-Za-z0-9-]+$/i.test(group)) return res.status(400).json({ error: 'معرّف مجموعة التحويل غير صالح' });
  try {
    const out = F.reverseTransfer(group, (req.body || {}).reason || '', req.user);
    push(req, 'update', 'accounts', 'transfer_reverse', null, `عكس تحويل ${group}: ${(req.body || {}).reason || ''}`);
    res.json(out);
  } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});
R.get('/accounts/:id/statement', auth, P('accounts', 'view'), idParam, (req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'الحساب غير موجود' });
  const { from, to } = req.query;
  const w = ['account_id=?', "deleted_at IS NULL"], ps = [a.id];
  if (from) { w.push('txn_date>=?'); ps.push(from); }
  if (to) { w.push('txn_date<=?'); ps.push(to); }
  const rows = db.prepare(`SELECT t.*, c.name client_name, p.code project_code, u.code unit_code, s.code sale_code, us.name user_name
    FROM transactions t LEFT JOIN clients c ON c.id=t.client_id LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN units u ON u.id=t.unit_id
    LEFT JOIN sales s ON s.id=t.sale_id LEFT JOIN users us ON us.id=t.user_id
    WHERE t.${w.join(' AND t.')} ORDER BY t.txn_date, t.id`).all(...ps);
  let run = num(a.opening_balance);
  const withRun = rows.map(t => { run = r2(run + (t.direction === 'in' ? num(t.amount) : -num(t.amount))); return { ...t, running_balance: run }; });
  res.json({ account: a, rows: withRun, opening_balance: num(a.opening_balance), current_balance: r2(a.current_balance), count: withRun.length, filters: { from: from || '', to: to || '' } });
});
R.get('/accounts/:id/statement/excel', auth, P('accounts', 'export'), idParam, async (req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'الحساب غير موجود' });
  const rows = db.prepare(`SELECT t.txn_date, t.code, t.kind, t.direction, t.amount, t.method, t.reference_no, t.check_no, t.status,
      c.name client_name, p.code project_code, u.code unit_code, s.code sale_code, t.notes
    FROM transactions t LEFT JOIN clients c ON c.id=t.client_id LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN units u ON u.id=t.unit_id
    LEFT JOIN sales s ON s.id=t.sale_id WHERE t.account_id=? AND t.deleted_at IS NULL ORDER BY t.txn_date, t.id`).all(a.id);
  await X.sendSheet(res, {
    sheet: `كشف حساب ${a.name}`, title: `كشف حساب — ${a.name} (${a.code})`, prefix: 'ACC', req, user: req.user,
    filters: { type: a.type, from: req.query.from || '', to: req.query.to || '' },
    cols: [{ k: 'txn_date', t: 'التاريخ' }, { k: 'code', t: 'رقم الحركة' }, { k: 'kind', t: 'النوع' }, { k: 'direction', t: 'الاتجاه' },
      { k: 'amount', t: 'المبلغ', money: true }, { k: 'method', t: 'الطريقة' }, { k: 'reference_no', t: 'المرجع' }, { k: 'check_no', t: 'رقم الشيك' },
      { k: 'client_name', t: 'العميل' }, { k: 'project_code', t: 'المشروع' }, { k: 'unit_code', t: 'الوحدة' }, { k: 'sale_code', t: 'عملية البيع' }, { k: 'status', t: 'الحالة' }],
    rows, totalsKeys: ['amount']
  });
});

// =====================================================================
// الحركات المالية (Ledger)
// =====================================================================
R.get('/transactions', auth, P('finance', 'view'), (req, res) => {
  const { page, limit } = pageOf(req.query);
  const w = ['t.deleted_at IS NULL'], ps = [];
  const eq = (col, key) => { if (nz(req.query[key]) !== null) { w.push(`${col}=?`); ps.push(req.query[key]); } };
  eq('t.kind', 'kind'); eq('t.direction', 'direction'); eq('t.account_id', 'account_id'); eq('t.method', 'method');
  eq('t.project_id', 'project_id'); eq('t.client_id', 'client_id'); eq('t.sale_id', 'sale_id'); eq('t.status', 'status');
  if (req.query.unit_id) { w.push('t.unit_id=?'); ps.push(req.query.unit_id); }
  if (req.query.from) { w.push('t.txn_date>=?'); ps.push(req.query.from); }
  if (req.query.to) { w.push('t.txn_date<=?'); ps.push(req.query.to); }
  if (req.query.q) { w.push('(t.code LIKE ? OR t.reference_no LIKE ? OR t.check_no LIKE ? OR t.notes LIKE ?)'); ps.push(...Array(4).fill(`%${req.query.q}%`)); }
  const total = db.prepare(`SELECT COUNT(*) c FROM transactions t WHERE ${w.join(' AND ')}`).get(...ps).c;
  const totals = db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END),0) tin, COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) tout FROM transactions t WHERE ${w.join(' AND ')}`).get(...ps);
  const rows = db.prepare(`SELECT t.*, a.name account_name, c.name client_name, p.code project_code, u.code unit_code, s.code sale_code, us.name user_name
    FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN clients c ON c.id=t.client_id LEFT JOIN projects p ON p.id=t.project_id
    LEFT JOIN units u ON u.id=t.unit_id LEFT JOIN sales s ON s.id=t.sale_id LEFT JOIN users us ON us.id=t.user_id
    WHERE ${w.join(' AND ')} ORDER BY t.txn_date DESC, t.id DESC LIMIT ? OFFSET ?`).all(...ps, limit, (page - 1) * limit);
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1, totals: { in: r2(totals.tin), out: r2(totals.tout) } });
});
R.get('/transactions/excel', auth, P('finance', 'export'), async (req, res) => {
  const rows = db.prepare(`SELECT t.txn_date, t.code, t.kind, t.direction, t.amount, a.name account_name, t.method, t.reference_no, t.check_no,
    c.name client_name, p.code project_code, u.code unit_code, t.status, us.name user_name, t.notes
    FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN clients c ON c.id=t.client_id LEFT JOIN projects p ON p.id=t.project_id
    LEFT JOIN units u ON u.id=t.unit_id LEFT JOIN users us ON us.id=t.user_id WHERE t.deleted_at IS NULL
    ORDER BY t.txn_date DESC, t.id DESC LIMIT 5000`).all();
  await X.sendSheet(res, {
    sheet: 'الحركات المالية', title: 'تقرير الحركات المالية', prefix: 'TXN', req, user: req.user, filters: req.query,
    cols: [{ k: 'txn_date', t: 'التاريخ' }, { k: 'code', t: 'رقم الحركة' }, { k: 'kind', t: 'النوع' }, { k: 'direction', t: 'الاتجاه' }, { k: 'amount', t: 'المبلغ', money: true },
      { k: 'account_name', t: 'الحساب' }, { k: 'method', t: 'الطريقة' }, { k: 'reference_no', t: 'المرجع' }, { k: 'check_no', t: 'رقم الشيك' },
      { k: 'client_name', t: 'العميل' }, { k: 'project_code', t: 'المشروع' }, { k: 'unit_code', t: 'الوحدة' }, { k: 'status', t: 'الحالة' }, { k: 'user_name', t: 'المستخدم' }],
    rows, totalsKeys: ['amount']
  });
});
R.post('/transactions/:id/reverse', auth, P('finance', 'manage'), idParam, (req, res) => {
  const t = db.prepare('SELECT * FROM transactions WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'الحركة غير موجودة' });
  if (t.reversed_by || t.status === 'reversed') return res.status(400).json({ error: 'الحركة معكوسة مسبقًا' });
  if (t.kind === 'reversal') return res.status(400).json({ error: 'لا يمكن عكس حركة عكس' });
  const reason = (req.body || {}).reason;
  if (!reason) return res.status(400).json({ error: 'سبب العكس مطلوب' });
  try {
    let out;
    // تحويل بين الحسابين → عكس الرجلين معًا
    if (t.kind === 'transfer' && t.transfer_group) out = F.reverseTransfer(t.transfer_group, reason, req.user);
    else out = F.reverseTxn(t.id, { reason, user: req.user });
    if (t.sale_id) F.applyPaymentToSchedule(t.sale_id);
    F.recomputeAccount(t.account_id);
    push(req, 'update', 'finance', 'reversal', t.id, `${reason}${out.reversed === false ? ' (بلا أثر مالي — الحركة كانت معلّقة)' : ''}`);
    res.json(out);
  } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});

// =====================================================================
// الدفعات
// =====================================================================
function paymentJoin(where, ps, order = 'p.paid_at DESC, p.id DESC', limit = 200, offset = 0) {
  return db.prepare(`SELECT p.*, a.name account_name, a.bank_name account_bank, c.name client_name, c.phone client_phone,
      u.code unit_code, pr.code project_code, pr.name project_name, s.code sale_code, r.code reservation_code, ct.code contract_code,
      us.name created_by_name, f.original_name attachment_name
    FROM payments p LEFT JOIN accounts a ON a.id=p.account_id LEFT JOIN clients c ON c.id=p.client_id LEFT JOIN units u ON u.id=p.unit_id
    LEFT JOIN projects pr ON pr.id=p.project_id LEFT JOIN sales s ON s.id=p.sale_id LEFT JOIN reservations r ON r.id=p.reservation_id
    LEFT JOIN contracts ct ON ct.id=p.contract_id LEFT JOIN users us ON us.id=p.created_by LEFT JOIN files f ON f.id=p.attachment_id
    WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...ps, limit, offset);
}
function paymentWhere(q) {
  const w = ['p.deleted_at IS NULL'], ps = [];
  const eq = (col, key) => { if (nz(q[key]) !== null) { w.push(`${col}=?`); ps.push(q[key]); } };
  eq('p.sale_id', 'sale_id'); eq('p.reservation_id', 'reservation_id'); eq('p.client_id', 'client_id'); eq('p.project_id', 'project_id');
  eq('p.unit_id', 'unit_id'); eq('p.account_id', 'account_id'); eq('p.method', 'method'); eq('p.status', 'status'); eq('p.kind', 'kind');
  if (q.from) { w.push('p.paid_at>=?'); ps.push(q.from); }
  if (q.to) { w.push('p.paid_at<=?'); ps.push(q.to); }
  if (q.q) { w.push('(p.receipt_no LIKE ? OR p.reference_no LIKE ? OR p.check_no LIKE ? OR p.notes LIKE ?)'); ps.push(...Array(4).fill(`%${q.q}%`)); }
  return { w, ps };
}
R.get('/payments', auth, P('finance', 'view'), (req, res) => {
  const { page, limit } = pageOf(req.query);
  const { w, ps } = paymentWhere(req.query);
  const total = db.prepare(`SELECT COUNT(*) c FROM payments p WHERE ${w.join(' AND ')}`).get(...ps).c;
  const sum = db.prepare(`SELECT COALESCE(SUM(CASE WHEN p.status='confirmed' THEN p.amount ELSE 0 END),0) confirmed,
    COALESCE(SUM(CASE WHEN p.status='pending' THEN p.amount ELSE 0 END),0) pending FROM payments p WHERE ${w.join(' AND ')}`).get(...ps);
  const rows = paymentJoin(w, ps, 'p.paid_at DESC, p.id DESC', limit, (page - 1) * limit);
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1, totals: { confirmed: r2(sum.confirmed), pending: r2(sum.pending) } });
});
R.get('/payments/excel', auth, P('finance', 'export'), async (req, res) => {
  const { w, ps } = paymentWhere(req.query);
  const rows = paymentJoin(w, ps, 'p.paid_at DESC', 5000, 0);
  await X.sendSheet(res, {
    sheet: 'الدفعات', title: 'سجل الدفعات', prefix: 'PAY', req, user: req.user, filters: req.query,
    cols: [{ k: 'paid_at', t: 'تاريخ الدفع' }, { k: 'receipt_no', t: 'رقم الإيصال' }, { k: 'client_name', t: 'العميل' }, { k: 'sale_code', t: 'عملية البيع' },
      { k: 'reservation_code', t: 'الحجز' }, { k: 'unit_code', t: 'الوحدة' }, { k: 'project_code', t: 'المشروع' }, { k: 'amount', t: 'المبلغ', money: true },
      { k: 'method', t: 'طريقة الدفع' }, { k: 'account_name', t: 'الحساب المستلم' }, { k: 'reference_no', t: 'رقم المرجع' }, { k: 'check_no', t: 'رقم الشيك' },
      { k: 'check_due_date', t: 'استحقاق الشيك' }, { k: 'check_status', t: 'حالة الشيك' }, { k: 'status', t: 'حالة العملية' }, { k: 'created_by_name', t: 'المستخدم' }, { k: 'paid_at2', t: 'تاريخ الإنشاء', width: 18 }],
    rows: rows.map(r => ({ ...r, paid_at2: r.created_at })), totalsKeys: ['amount']
  });
});
R.get('/payments/:id', auth, P('finance', 'view'), idParam, (req, res) => {
  const p = paymentJoin(['p.id=?'], [req.params.id], 'p.id DESC', 1, 0)[0];
  if (!p) return res.status(404).json({ error: 'الدفعة غير موجودة' });
  const txn = p.txn_id ? db.prepare('SELECT * FROM transactions WHERE id=?').get(p.txn_id) : null;
  const sale = p.sale_id ? F.saleTotals(p.sale_id) : null;
  res.json({ ...p, txn, sale_totals: sale });
});
R.post('/payments', auth, P('finance', 'create'), (req, res) => {
  try {
    const b = req.body || {};
    // دفعة زائدة تحتاج اعتمادًا (إلا لمن يملك صلاحية الاعتماد)
    const spec = { action_type: 'payment_override', entity_type: 'payment', title: `دفعة بمبلغ ${num(b.amount)} ${b.sale_id ? `على عملية بيع #${b.sale_id}` : ''}`, module: 'finance', amount: num(b.amount), payload: b };
    if (!F.canApprove(req.user) && b.allow_overpayment) {
      const g = F.gate(req, spec, (approver) => F.createPayment({ user: approver, ip: '' }, { ...b, allow_overpayment: true }));
      if (g.pending) return res.status(202).json({ pending_approval: g.approval_id, message: 'الدفعة الزائدة تحتاج اعتماد المدير' });
      return res.status(201).json(g.result);
    }
    const out = F.createPayment(req, b);
    push(req, 'create', 'finance', 'payment', out.id, `دفعة ${num(b.amount)} بطريقة ${b.method || 'cash'}`);
    res.status(201).json(out);
  } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});
// تعديل دفعة — يُعامل كإعادة تحقق كاملة للكيان النهائي (مبلغ/طريقة/مرجع/شيك/حساب/دفع زائد/حالة)
R.put('/payments/:id', auth, P('finance', 'edit'), idParam, (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'الدفعة غير موجودة' });
  const b = req.body || {};
  const doEdit = (user) => F.updatePayment(p.id, b, user);
  if (!F.canApprove(req.user)) {
    const g = F.gate(req, { action_type: 'payment_edit', entity_type: 'payment', entity_id: p.id, title: `تعديل دفعة #${p.id} بمبلغ ${num(b.amount ?? p.amount)}`, module: 'finance', amount: num(b.amount ?? p.amount), payload: { payment_id: p.id, ...b } },
      (approver) => doEdit(approver));
    if (g.pending) return res.status(202).json({ pending_approval: g.approval_id, message: 'تعديل الدفعة يحتاج اعتماد المدير' });
    return res.json(g.result);
  }
  try { doEdit(req.user); res.json(db.prepare('SELECT * FROM payments WHERE id=?').get(p.id)); }
  catch (e) { res.status(e.code || 400).json({ error: e.message, field: e.field, allowed: e.allowed, overpayment: !!e.overpayment }); }
});
R.post('/payments/:id/cancel', auth, P('finance', 'edit'), idParam, (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'الدفعة غير موجودة' });
  const reason = (req.body || {}).reason;
  if (!reason) return res.status(400).json({ error: 'سبب الإلغاء مطلوب' });
  // عكس مالي فقط إذا كانت الدفعة مؤثرة على الرصيد (شيك pending لم يدخل الرصيد → لا يُنقصه الإلغاء)
  const doCancel = (user) => F.cancelPayment(p.id, reason, user);
  if (!F.canApprove(req.user)) {
    const g = F.gate(req, { action_type: 'payment_cancel', entity_type: 'payment', entity_id: p.id, title: `إلغاء دفعة #${p.id} بمبلغ ${num(p.amount)}`, module: 'finance', amount: num(p.amount), payload: { payment_id: p.id, reason } },
      (approver) => doCancel(approver));
    if (g.pending) return res.status(202).json({ pending_approval: g.approval_id, message: 'إلغاء الدفعة يحتاج اعتماد المدير' });
    return res.json(g.result);
  }
  try { res.json(doCancel(req.user)); } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});
// دورة حياة الشيك — مع إعادة احتساب رصيد الحساب فورًا في كل انتقال مؤثر
R.post('/payments/:id/check-status', auth, P('finance', 'edit'), idParam, (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'الدفعة غير موجودة' });
  if (p.method !== 'check') return res.status(400).json({ error: 'الدفعة ليست بشيك' });
  const b = req.body || {};
  const st = b.check_status || b.status;
  if (!['pending', 'cleared', 'bounced', 'cancelled'].includes(st)) return res.status(400).json({ error: 'حالة شيك غير صالحة' });
  try {
    const out = F.setCheckStatus(p.id, st, req.user, { check_date: b.check_date || null, reference_no: b.reference_no || null });
    push(req, 'update', 'finance', 'check_status', p.id, `${p.check_no}: → ${st}`);
    res.json(out);
  } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});
R.get('/payments/:id/receipt', auth, P('finance', 'view'), idParam, (req, res) => {
  const p = paymentJoin(['p.id=?'], [req.params.id], 'p.id DESC', 1, 0)[0];
  if (!p) return res.status(404).json({ error: 'الدفعة غير موجودة' });
  const s = X.settings();
  res.json({
    payment: p, company: s, amount_words: null,
    sale: p.sale_id ? db.prepare('SELECT * FROM sales WHERE id=?').get(p.sale_id) : null,
    totals: p.sale_id ? F.saleTotals(p.sale_id) : null,
    printed_at: new Date().toLocaleString('en-GB')
  });
});

// =====================================================================
// المصروفات
// =====================================================================
R.get('/expense-categories', auth, P('expenses', 'view'), (req, res) => {
  const rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM expenses e WHERE e.category_id=c.id AND e.deleted_at IS NULL) usage_count,
    (SELECT COALESCE(SUM(e.amount),0) FROM expenses e WHERE e.category_id=c.id AND e.status IN ('approved','paid') AND e.deleted_at IS NULL) total_amount
    FROM expense_categories c ORDER BY c.sort_order, c.id`).all();
  res.json({ data: rows });
});
R.post('/expense-categories', auth, P('expenses', 'create'), need('name'), (req, res) => {
  const code = nextUniqueCode('EXC', 'expense_categories', 'code');
  const id = db.prepare('INSERT INTO expense_categories (code, name, kind, sort_order) VALUES (?,?,?,?)').run(code, req.body.name, req.body.kind || 'general', num(req.body.sort_order)).lastInsertRowid;
  push(req, 'create', 'expenses', 'category', id, req.body.name);
  res.status(201).json(db.prepare('SELECT * FROM expense_categories WHERE id=?').get(id));
});
R.put('/expense-categories/:id', auth, P('expenses', 'edit'), idParam, (req, res) => {
  const c = db.prepare('SELECT * FROM expense_categories WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'التصنيف غير موجود' });
  const b = req.body || {};
  db.prepare('UPDATE expense_categories SET name=?, kind=?, is_active=?, sort_order=? WHERE id=?')
    .run(b.name ?? c.name, b.kind ?? c.kind, b.is_active !== undefined ? b.is_active : c.is_active, b.sort_order ?? c.sort_order, c.id);
  push(req, 'update', 'expenses', 'category', c.id, b.name || c.name);
  res.json(db.prepare('SELECT * FROM expense_categories WHERE id=?').get(c.id));
});
R.delete('/expense-categories/:id', auth, P('expenses', 'delete'), idParam, (req, res) => {
  const used = db.prepare('SELECT COUNT(*) c FROM expenses WHERE category_id=? AND deleted_at IS NULL').get(req.params.id).c;
  if (used) return res.status(400).json({ error: 'التصنيف مستخدم في مصروفات — يمكن تعطيله بدل حذفه' });
  db.prepare('DELETE FROM expense_categories WHERE id=?').run(req.params.id);
  push(req, 'delete', 'expenses', 'category', req.params.id, '');
  res.json({ ok: true });
});
function expenseWhere(q) {
  const w = ['e.deleted_at IS NULL'], ps = [];
  const eq = (col, key) => { if (nz(q[key]) !== null) { w.push(`${col}=?`); ps.push(q[key]); } };
  eq('e.category_id', 'category_id'); eq('e.account_id', 'account_id'); eq('e.project_id', 'project_id'); eq('e.unit_id', 'unit_id');
  eq('e.status', 'status'); eq('e.method', 'method'); eq('e.employee_id', 'employee_id');
  if (q.from) { w.push('e.expense_date>=?'); ps.push(q.from); }
  if (q.to) { w.push('e.expense_date<=?'); ps.push(q.to); }
  if (q.q) { w.push('(e.code LIKE ? OR e.description LIKE ? OR e.vendor LIKE ? OR e.reference_no LIKE ?)'); ps.push(...Array(4).fill(`%${q.q}%`)); }
  return { w, ps };
}
R.get('/expenses', auth, P('expenses', 'view'), (req, res) => {
  const { page, limit } = pageOf(req.query);
  const { w, ps } = expenseWhere(req.query);
  const total = db.prepare(`SELECT COUNT(*) c FROM expenses e WHERE ${w.join(' AND ')}`).get(...ps).c;
  const sum = db.prepare(`SELECT COALESCE(SUM(CASE WHEN status IN ('approved','paid') THEN amount ELSE 0 END),0) approved,
    COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),0) pending FROM expenses e WHERE ${w.join(' AND ')}`).get(...ps);
  const rows = db.prepare(`SELECT e.*, c.name category_name, c.code category_code, a.name account_name, p.name project_name, u.code unit_code,
      us.name employee_name, ap.name approver_name, f.original_name attachment_name
    FROM expenses e LEFT JOIN expense_categories c ON c.id=e.category_id LEFT JOIN accounts a ON a.id=e.account_id LEFT JOIN projects p ON p.id=e.project_id
    LEFT JOIN units u ON u.id=e.unit_id LEFT JOIN users us ON us.id=e.employee_id LEFT JOIN users ap ON ap.id=e.approved_by LEFT JOIN files f ON f.id=e.attachment_id
    WHERE ${w.join(' AND ')} ORDER BY e.expense_date DESC, e.id DESC LIMIT ? OFFSET ?`).all(...ps, limit, (page - 1) * limit);
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1, totals: { approved: r2(sum.approved), pending: r2(sum.pending) } });
});
R.get('/expenses/excel', auth, P('expenses', 'export'), async (req, res) => {
  const { w, ps } = expenseWhere(req.query);
  const rows = db.prepare(`SELECT e.code, e.expense_date, c.name category_name, e.amount, a.name account_name, p.name project_name, u.code unit_code,
      e.vendor, e.beneficiary, e.method, e.reference_no, e.description, us.name employee_name, e.status, ap.name approver_name
    FROM expenses e LEFT JOIN expense_categories c ON c.id=e.category_id LEFT JOIN accounts a ON a.id=e.account_id LEFT JOIN projects p ON p.id=e.project_id
    LEFT JOIN units u ON u.id=e.unit_id LEFT JOIN users us ON us.id=e.employee_id LEFT JOIN users ap ON ap.id=e.approved_by
    WHERE ${w.join(' AND ')} ORDER BY e.expense_date DESC LIMIT 5000`).all(...ps);
  await X.sendSheet(res, {
    sheet: 'المصروفات', title: 'تقرير المصروفات', prefix: 'EXP', req, user: req.user, filters: req.query,
    cols: [{ k: 'code', t: 'رقم المصروف' }, { k: 'expense_date', t: 'التاريخ' }, { k: 'category_name', t: 'التصنيف' }, { k: 'amount', t: 'المبلغ', money: true },
      { k: 'account_name', t: 'الحساب المدفوع منه' }, { k: 'project_name', t: 'المشروع' }, { k: 'unit_code', t: 'الوحدة' }, { k: 'vendor', t: 'المورد' },
      { k: 'beneficiary', t: 'المستفيد' }, { k: 'method', t: 'طريقة الدفع' }, { k: 'reference_no', t: 'المرجع' }, { k: 'description', t: 'الوصف' },
      { k: 'employee_name', t: 'الموظف' }, { k: 'status', t: 'الحالة' }, { k: 'approver_name', t: 'المعتمد' }],
    rows, totalsKeys: ['amount']
  });
});
R.get('/expenses/:id', auth, P('expenses', 'view'), idParam, (req, res) => {
  const e = db.prepare(`SELECT e.*, c.name category_name, a.name account_name, p.name project_name, u.code unit_code FROM expenses e
    LEFT JOIN expense_categories c ON c.id=e.category_id LEFT JOIN accounts a ON a.id=e.account_id LEFT JOIN projects p ON p.id=e.project_id
    LEFT JOIN units u ON u.id=e.unit_id WHERE e.id=?`).get(req.params.id);
  if (!e) return res.status(404).json({ error: 'المصروف غير موجود' });
  res.json(e);
});
R.post('/expenses', auth, P('expenses', 'create'), need('amount'), (req, res) => {
  const b = req.body || {};
  const amt = num(b.amount);
  if (amt <= 0) return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
  const method = F.METHODS.includes(b.method) ? b.method : 'cash';
  if (method === 'check' && !b.check_no) return res.status(400).json({ error: 'رقم الشيك مطلوب عند الدفع بشيك' });
  const accId = b.account_id || F.defaultAccountId();
  if (!accId) return res.status(400).json({ error: 'لا يوجد حساب مالي — أنشئ حسابًا أولًا' });
  const code = nextUniqueCode('EXPENSE', 'expenses', 'code');
  const wantPaid = b.pay_now === true || b.pay_now === 1 || b.pay_now === '1';
  const id = db.prepare(`INSERT INTO expenses (code, expense_date, category_id, amount, account_id, project_id, unit_id, vendor, beneficiary, method, reference_no, bank_name, check_no, check_date, check_due_date, check_status, attachment_id, description, employee_id, status, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, b.expense_date || today(), nz(b.category_id), amt, accId, nz(b.project_id), nz(b.unit_id),
    b.vendor || '', b.beneficiary || '', method, b.reference_no || '', b.bank_name || '', b.check_no || '', b.check_date || null, b.check_due_date || null,
    b.check_status || (method === 'check' ? 'pending' : ''), nz(b.attachment_id), b.description || '', nz(b.employee_id) || req.user.id,
    wantPaid ? 'pending' : (b.status && ['draft', 'pending'].includes(b.status) ? b.status : 'draft'), b.notes || '', req.user.id).lastInsertRowid;
  push(req, 'create', 'expenses', 'expense', id, `${code} — ${amt} — ${b.description || ''}`);

  // آلية الاعتماد: أي مصروف يتجاوز الحد المعتمد (أو لمقدّمه صلاحية اعتماد) يرفع طلب اعتماد للمدير
  const threshold = num(F.setting('finance_require_approval_expense_amount', '5000'));
  const needsApproval = !F.canApprove(req.user, 'expenses') || amt > threshold;
  if (needsApproval) {
    const actionType = wantPaid ? 'expense_pay' : 'expense';
    const approvalId = F.raiseApproval(req, {
      action_type: actionType, entity_type: 'expense', entity_id: id,
      title: wantPaid ? `اعتماد صرف مصروف ${code} بمبلغ ${amt}` : `اعتماد مصروف ${code} بمبلغ ${amt}`,
      module: 'expenses', amount: amt, payload: { expense_id: id }
    });
    db.prepare(`UPDATE expenses SET status='pending', approval_id=?, updated_at=datetime('now','localtime') WHERE id=?`).run(approvalId, id);
    return res.status(201).json({ id, code, status: 'pending', pending_approval: approvalId, message: 'المصروف يحتاج اعتماد المدير (يتجاوز الحد المسموح)' });
  }
  if (wantPaid) {
    payExpense(id, req.user);
    return res.status(201).json({ id, code, status: 'paid' });
  }
  res.status(201).json({ id, code, status: db.prepare('SELECT status FROM expenses WHERE id=?').get(id).status });
});
function payExpense(expenseId, user) {
  return db.transaction(() => _payExpense(expenseId, user));
}
function _payExpense(expenseId, user) {
  const e = db.prepare('SELECT * FROM expenses WHERE id=? AND deleted_at IS NULL').get(expenseId);
  if (!e) throw Object.assign(new Error('المصروف غير موجود'), { code: 404 });
  if (e.status === 'paid') return { ok: true, already: true };
  if (e.status === 'cancelled') throw Object.assign(new Error('المصروف ملغى'), { code: 400 });
  const accId = e.account_id || F.defaultAccountId();
  const txnId = F.postTxn({
    kind: 'expense', direction: 'out', amount: e.amount, accountId: accId, txnDate: e.expense_date, method: e.method, reference: e.reference_no,
    checkNo: e.check_no, checkDate: e.check_date, checkDueDate: e.check_due_date, checkStatus: e.check_status, bankName: e.bank_name,
    projectId: e.project_id, unitId: e.unit_id, expenseId: e.id, attachmentId: e.attachment_id, notes: `مصروف ${e.code} — ${e.description || ''}`, user
  });
  db.prepare(`UPDATE expenses SET status='paid', paid_at=?, txn_id=?, approved_by=COALESCE(approved_by,?), approved_at=COALESCE(approved_at,datetime('now','localtime')), updated_at=datetime('now','localtime') WHERE id=?`)
    .run(e.expense_date, txnId, user?.id || null, e.id);
  F.pushAudit(user, 'update', 'expenses', 'pay', e.id, `${e.code} — ${num(e.amount)}`);
  return { ok: true, txn_id: txnId };
}
R.put('/expenses/:id', auth, P('expenses', 'edit'), idParam, (req, res) => {
  const e = db.prepare('SELECT * FROM expenses WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'المصروف غير موجود' });
  if (['paid'].includes(e.status)) return res.status(400).json({ error: 'لا يمكن تعديل مصروف مدفوع — استخدم الإلغاء/العكس' });
  const b = req.body || {};
  const doEdit = (user) => {
    const cols = ['expense_date', 'category_id', 'amount', 'account_id', 'project_id', 'unit_id', 'vendor', 'beneficiary', 'method', 'reference_no', 'bank_name', 'check_no', 'check_date', 'check_due_date', 'check_status', 'attachment_id', 'description', 'employee_id', 'notes'];
    const use = cols.filter(c => b[c] !== undefined);
    if (!use.length) throw Object.assign(new Error('لا توجد بيانات'), { code: 400 });
    db.prepare(`UPDATE expenses SET ${use.map(c => `${c}=?`).join(',')}, updated_at=datetime('now','localtime') WHERE id=?`).run(...use.map(c => b[c]), e.id);
    F.pushAudit(user, 'update', 'expenses', 'expense', e.id, use.join(','));
    return { ok: true };
  };
  if (num(b.amount) && num(b.amount) !== num(e.amount) && !F.canApprove(req.user, 'expenses')) {
    const g = F.gate(req, { action_type: 'expense', entity_type: 'expense', entity_id: e.id, title: `تعديل مصروف ${e.code} إلى ${num(b.amount)}`, module: 'expenses', amount: num(b.amount), payload: { expense_id: e.id, ...b } });
    if (g.pending) return res.status(202).json({ pending_approval: g.approval_id, message: 'تعديل مبلغ المصروف يحتاج اعتماد المدير' });
    return res.json(g.result);
  }
  try { doEdit(req.user); res.json(db.prepare('SELECT * FROM expenses WHERE id=?').get(e.id)); }
  catch (err) { res.status(err.code || 400).json({ error: err.message }); }
});
R.post('/expenses/:id/approve', auth, P('expenses', 'approve'), idParam, (req, res) => {
  const e = db.prepare('SELECT * FROM expenses WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'المصروف غير موجود' });
  if (e.status === 'paid') return res.json({ ok: true, already: true });
  if (e.status === 'cancelled') return res.status(400).json({ error: 'المصروف ملغى' });
  db.prepare(`UPDATE expenses SET status='approved', approved_by=?, approved_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`).run(req.user.id, e.id);
  push(req, 'approve', 'expenses', 'expense', e.id, `${e.code}`);
  res.json({ ok: true, status: 'approved' });
});
R.post('/expenses/:id/reject', auth, P('expenses', 'approve'), idParam, (req, res) => {
  const e = db.prepare('SELECT * FROM expenses WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'المصروف غير موجود' });
  db.prepare(`UPDATE expenses SET status='rejected', approved_by=?, approved_at=datetime('now','localtime'), notes=COALESCE(notes,'') || ' — رفض: ' || ?, updated_at=datetime('now','localtime') WHERE id=?`).run(req.user.id, (req.body || {}).note || '', e.id);
  push(req, 'approve', 'expenses', 'reject', e.id, `${e.code} — ${(req.body || {}).note || ''}`);
  res.json({ ok: true, status: 'rejected' });
});
R.post('/expenses/:id/pay', auth, P('expenses', 'approve'), idParam, (req, res) => {
  try { res.json(payExpense(Number(req.params.id), req.user)); }
  catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});
R.post('/expenses/:id/cancel', auth, P('expenses', 'edit'), idParam, (req, res) => {
  const e = db.prepare('SELECT * FROM expenses WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'المصروف غير موجود' });
  const reason = (req.body || {}).reason;
  if (!reason) return res.status(400).json({ error: 'سبب الإلغاء مطلوب' });
  if (e.status === 'paid') {
    const doCancel = (user) => db.transaction(() => {
      if (e.txn_id) F.reverseTxn(e.txn_id, { reason: `إلغاء مصروف ${e.code}: ${reason}`, user });
      db.prepare(`UPDATE expenses SET status='cancelled', deleted_at=datetime('now','localtime'), notes=COALESCE(notes,'') || ' — ملغى: ' || ?, updated_at=datetime('now','localtime') WHERE id=?`).run(reason, e.id);
      F.pushAudit(user, 'update', 'expenses', 'cancel', e.id, reason);
      F.recomputeAccount(e.account_id);
      return { ok: true };
    });
    if (!F.canApprove(req.user, 'expenses')) {
      const g = F.gate(req, { action_type: 'expense_cancel', entity_type: 'expense', entity_id: e.id, title: `إلغاء مصروف مدفوع ${e.code} بمبلغ ${num(e.amount)}`, module: 'expenses', amount: num(e.amount), payload: { expense_id: e.id, reason } });
      if (g.pending) return res.status(202).json({ pending_approval: g.approval_id, message: 'إلغاء مصروف مدفوع يحتاج اعتماد المدير' });
      return res.json(g.result);
    }
    return res.json(doCancel(req.user));
  }
  db.prepare(`UPDATE expenses SET status='cancelled', deleted_at=datetime('now','localtime'), notes=COALESCE(notes,'') || ' — ملغى: ' || ? WHERE id=?`).run(reason, e.id);
  push(req, 'update', 'expenses', 'cancel', e.id, reason);
  res.json({ ok: true });
});

// =====================================================================
// جدول الأقساط والاستحقاقات
// =====================================================================
function scheduleWhere(q) {
  const w = ['ps.deleted_at IS NULL'], ps = [];
  const eq = (col, key) => { if (nz(q[key]) !== null) { w.push(`${col}=?`); ps.push(q[key]); } };
  eq('ps.sale_id', 'sale_id'); eq('ps.client_id', 'client_id'); eq('ps.project_id', 'project_id'); eq('ps.unit_id', 'unit_id');
  eq('ps.contract_id', 'contract_id'); eq('ps.status', 'status');
  if (q.from) { w.push('ps.due_date>=?'); ps.push(q.from); }
  if (q.to) { w.push('ps.due_date<=?'); ps.push(q.to); }
  if (q.unpaid === '1') w.push(`ps.status IN ('upcoming','due','overdue','partial')`);
  if (q.overdue === '1') w.push(`ps.status='overdue'`);
  return { w, ps };
}
R.get('/schedule', auth, P('schedule', 'view'), (req, res) => {
  F.refreshScheduleStatuses();
  const { page, limit } = pageOf(req.query);
  const { w, ps } = scheduleWhere(req.query);
  const total = db.prepare(`SELECT COUNT(*) c FROM payment_schedule ps WHERE ${w.join(' AND ')}`).get(...ps).c;
  const sum = db.prepare(`SELECT COALESCE(SUM(ps.amount),0) amount, COALESCE(SUM(ps.paid_amount),0) paid FROM payment_schedule ps WHERE ${w.join(' AND ')}`).get(...ps);
  const rows = db.prepare(`SELECT ps.*, (ps.amount - ps.paid_amount) remaining, c.name client_name, c.phone client_phone, u.code unit_code, p.code project_code, p.name project_name,
      s.code sale_code, ct.code contract_code, (CASE WHEN ps.due_date < date('now','localtime') AND ps.status NOT IN ('paid','cancelled') THEN CAST(julianday(date('now','localtime')) - julianday(ps.due_date) AS INTEGER) ELSE 0 END) days_late
    FROM payment_schedule ps LEFT JOIN clients c ON c.id=ps.client_id LEFT JOIN units u ON u.id=ps.unit_id LEFT JOIN projects p ON p.id=ps.project_id
    LEFT JOIN sales s ON s.id=ps.sale_id LEFT JOIN contracts ct ON ct.id=ps.contract_id
    WHERE ${w.join(' AND ')} ORDER BY ps.due_date, ps.seq LIMIT ? OFFSET ?`).all(...ps, limit, (page - 1) * limit);
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1, totals: { amount: r2(sum.amount), paid: r2(sum.paid), remaining: r2(sum.amount - sum.paid) } });
});
R.get('/schedule/excel', auth, P('schedule', 'export'), async (req, res) => {
  F.refreshScheduleStatuses();
  const { w, ps } = scheduleWhere(req.query);
  const rows = db.prepare(`SELECT ps.code, c.name client_name, c.phone client_phone, p.name project_name, u.code unit_code, s.code sale_code, ct.code contract_code,
      ps.seq, ps.label, ps.due_date, ps.amount, ps.paid_amount, (ps.amount - ps.paid_amount) remaining, ps.status
    FROM payment_schedule ps LEFT JOIN clients c ON c.id=ps.client_id LEFT JOIN units u ON u.id=ps.unit_id LEFT JOIN projects p ON p.id=ps.project_id
    LEFT JOIN sales s ON s.id=ps.sale_id LEFT JOIN contracts ct ON ct.id=ps.contract_id WHERE ${w.join(' AND ')} ORDER BY ps.due_date LIMIT 5000`).all(...ps);
  await X.sendSheet(res, {
    sheet: 'جدول الأقساط', title: 'جدول الأقساط والاستحقاقات', prefix: 'SCH', req, user: req.user, filters: req.query,
    cols: [{ k: 'code', t: 'رقم الاستحقاق' }, { k: 'client_name', t: 'العميل' }, { k: 'client_phone', t: 'الجوال' }, { k: 'project_name', t: 'المشروع' },
      { k: 'unit_code', t: 'الوحدة' }, { k: 'sale_code', t: 'عملية البيع' }, { k: 'contract_code', t: 'العقد' }, { k: 'seq', t: 'التسلسل' }, { k: 'label', t: 'البيان' },
      { k: 'due_date', t: 'تاريخ الاستحقاق' }, { k: 'amount', t: 'المبلغ', money: true }, { k: 'paid_amount', t: 'المدفوع', money: true },
      { k: 'remaining', t: 'المتبقي', money: true }, { k: 'status', t: 'الحالة' }],
    rows, totalsKeys: ['amount', 'paid_amount', 'remaining']
  });
});
R.post('/schedule/generate', auth, P('schedule', 'create'), (req, res) => {
  try {
    const b = req.body || {};
    if (!b.sale_id && !b.reservation_id) return res.status(400).json({ error: 'يجب تحديد عملية بيع أو حجز' });
    let total = num(b.total), paid = num(b.paid), client_id = b.client_id, unit_id = b.unit_id, project_id = b.project_id, contract_id = b.contract_id, reservation_id = b.reservation_id;
    if (b.sale_id) {
      const s = db.prepare('SELECT * FROM sales WHERE id=?').get(b.sale_id);
      if (!s) return res.status(404).json({ error: 'عملية البيع غير موجودة' });
      const t = F.saleTotals(s.id);
      total = total || t.net_price; paid = paid || t.paid; client_id = client_id || s.client_id; unit_id = unit_id || s.unit_id;
      project_id = project_id || db.prepare('SELECT project_id FROM units WHERE id=?').get(s.unit_id)?.project_id; contract_id = contract_id || s.contract_id;
    } else {
      const r = db.prepare('SELECT * FROM reservations WHERE id=?').get(b.reservation_id);
      if (!r) return res.status(404).json({ error: 'الحجز غير موجود' });
      const t = F.reservationTotals(r.id);
      total = total || t.net_price; paid = paid || t.deposit_paid; client_id = client_id || r.client_id; unit_id = unit_id || r.unit_id;
      project_id = project_id || db.prepare('SELECT project_id FROM units WHERE id=?').get(r.unit_id)?.project_id;
    }
    const out = F.generateSchedule({ sale_id: b.sale_id || null, reservation_id: reservation_id || null, contract_id, client_id, unit_id, project_id, total, paid, installments: b.installments, first_due: b.first_due, replace: !!b.replace, user: req.user });
    push(req, 'create', 'schedule', 'generate', b.sale_id || b.reservation_id, JSON.stringify(out));
    res.status(201).json(out);
  } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});
R.put('/schedule/:id', auth, P('schedule', 'edit'), idParam, (req, res) => {
  const s = db.prepare('SELECT * FROM payment_schedule WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'الاستحقاق غير موجود' });
  if (s.status === 'paid') return res.status(400).json({ error: 'لا يمكن تعديل استحقاق مسدّد بالكامل' });
  const b = req.body || {};
  const cols = ['due_date', 'amount', 'label', 'notes'].filter(c => b[c] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'لا توجد بيانات' });
  db.prepare(`UPDATE payment_schedule SET ${cols.map(c => `${c}=?`).join(',')}, updated_at=datetime('now','localtime') WHERE id=?`).run(...cols.map(c => b[c]), s.id);
  if (s.sale_id) F.applyPaymentToSchedule(s.sale_id);
  push(req, 'update', 'schedule', 'schedule', s.id, cols.join(','));
  res.json(db.prepare('SELECT * FROM payment_schedule WHERE id=?').get(s.id));
});
R.delete('/schedule/:id', auth, P('schedule', 'delete'), idParam, (req, res) => {
  const s = db.prepare('SELECT * FROM payment_schedule WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'الاستحقاق غير موجود' });
  if (num(s.paid_amount) > 0) return res.status(400).json({ error: 'لا يمكن إلغاء استحقاق مدفوع جزئيًا/كليًا — استخدم التسوية' });
  db.prepare(`UPDATE payment_schedule SET status='cancelled', deleted_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`).run(s.id);
  push(req, 'update', 'schedule', 'cancel', s.id, (req.body || {}).reason || '');
  res.json({ ok: true });
});
R.post('/schedule/:id/pay', auth, P('finance', 'create'), idParam, (req, res) => {
  const s = db.prepare('SELECT * FROM payment_schedule WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'الاستحقاق غير موجود' });
  if (s.status === 'cancelled') return res.status(400).json({ error: 'الاستحقاق ملغى' });
  const b = req.body || {};
  const remaining = r2(num(s.amount) - num(s.paid_amount));
  const amount = b.amount !== undefined ? num(b.amount) : remaining;
  if (amount <= 0) return res.status(400).json({ error: 'لا يوجد متبقٍ على هذا الاستحقاق' });
  if (amount - remaining > 0.01) return res.status(400).json({ error: `المبلغ يتجاوز المتبقي على الاستحقاق (${remaining.toLocaleString('en')})` });
  try {
    const out = F.createPayment(req, {
      amount, method: b.method || 'cash', paid_at: b.paid_at || today(), account_id: b.account_id || null, kind: 'installment',
      sale_id: s.sale_id, reservation_id: s.reservation_id, contract_id: s.contract_id, schedule_id: s.id, client_id: s.client_id,
      unit_id: s.unit_id, project_id: s.project_id, reference_no: b.reference_no || '', check_no: b.check_no || '', check_due_date: b.check_due_date || null,
      bank_name: b.bank_name || '', notes: b.notes || `سداد ${s.label || `قسط ${s.seq}`}`, attachment_id: b.attachment_id || null, user: req.user
    });
    F.applyPaymentToSchedule(s.sale_id);
    push(req, 'create', 'schedule', 'pay', s.id, `سداد استحقاق #${s.id} بمبلغ ${amount}`);
    res.status(201).json(out);
  } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});
R.get('/schedule/overdue', auth, P('schedule', 'view'), (req, res) => {
  F.refreshScheduleStatuses();
  const days = num(req.query.days, 0);
  const rows = db.prepare(`SELECT ps.*, c.name client_name, c.phone client_phone, c.assigned_to, us.name employee_name, u.code unit_code, p.name project_name, p.code project_code,
      s.code sale_code, ct.code contract_code,
      CAST(julianday(date('now','localtime')) - julianday(ps.due_date) AS INTEGER) days_late,
      (SELECT MAX(p2.paid_at) FROM payments p2 WHERE p2.sale_id=ps.sale_id AND p2.status='confirmed' AND p2.deleted_at IS NULL) last_payment_date,
      (SELECT MAX(cm.occurred_at) FROM communications cm WHERE cm.client_id=ps.client_id) last_contact_at
    FROM payment_schedule ps LEFT JOIN clients c ON c.id=ps.client_id LEFT JOIN users us ON us.id=c.assigned_to LEFT JOIN units u ON u.id=ps.unit_id
    LEFT JOIN projects p ON p.id=ps.project_id LEFT JOIN sales s ON s.id=ps.sale_id LEFT JOIN contracts ct ON ct.id=ps.contract_id
    WHERE ps.deleted_at IS NULL AND ps.status NOT IN ('paid','cancelled') AND ps.due_date < date('now','localtime') AND (? = 0 OR CAST(julianday(date('now','localtime')) - julianday(ps.due_date) AS INTEGER) >= ?)
    ORDER BY days_late DESC LIMIT 1000`).all(days, days);
  const total = rows.reduce((a, r) => a + (num(r.amount) - num(r.paid_amount)), 0);
  res.json({ data: rows, count: rows.length, total_overdue: r2(total), filters: { days } });
});
R.get('/schedule/overdue/excel', auth, P('schedule', 'export'), async (req, res) => {
  F.refreshScheduleStatuses();
  const rows = db.prepare(`SELECT c.name client_name, c.phone client_phone, p.name project_name, u.code unit_code, s.code sale_code, ct.code contract_code,
      ps.due_date, ps.amount, ps.paid_amount, (ps.amount - ps.paid_amount) remaining, CAST(julianday(date('now','localtime')) - julianday(ps.due_date) AS INTEGER) days_late,
      (SELECT MAX(p2.paid_at) FROM payments p2 WHERE p2.sale_id=ps.sale_id AND p2.status='confirmed') last_payment_date,
      (SELECT MAX(cm.occurred_at) FROM communications cm WHERE cm.client_id=ps.client_id) last_contact_at, us.name employee_name
    FROM payment_schedule ps LEFT JOIN clients c ON c.id=ps.client_id LEFT JOIN users us ON us.id=c.assigned_to LEFT JOIN units u ON u.id=ps.unit_id
    LEFT JOIN projects p ON p.id=ps.project_id LEFT JOIN sales s ON s.id=ps.sale_id LEFT JOIN contracts ct ON ct.id=ps.contract_id
    WHERE ps.deleted_at IS NULL AND ps.status NOT IN ('paid','cancelled') AND ps.due_date < date('now','localtime') ORDER BY days_late DESC LIMIT 5000`).all();
  await X.sendSheet(res, {
    sheet: 'المبالغ المتأخرة', title: 'تقرير المبالغ المتأخرة', prefix: 'OVD', req, user: req.user, filters: req.query,
    cols: [{ k: 'client_name', t: 'العميل' }, { k: 'client_phone', t: 'الجوال' }, { k: 'project_name', t: 'المشروع' }, { k: 'unit_code', t: 'الوحدة' },
      { k: 'sale_code', t: 'عملية البيع' }, { k: 'contract_code', t: 'رقم العقد' }, { k: 'due_date', t: 'تاريخ الاستحقاق' }, { k: 'amount', t: 'المبلغ', money: true },
      { k: 'paid_amount', t: 'المدفوع', money: true }, { k: 'remaining', t: 'المتبقي', money: true }, { k: 'days_late', t: 'أيام التأخير' },
      { k: 'last_payment_date', t: 'آخر دفعة' }, { k: 'last_contact_at', t: 'آخر تواصل' }, { k: 'employee_name', t: 'الموظف' }],
    rows, totalsKeys: ['amount', 'paid_amount', 'remaining']
  });
});

// =====================================================================
// الاستردادات
// =====================================================================
R.get('/refunds', auth, P('finance', 'view'), (req, res) => {
  const { page, limit } = pageOf(req.query);
  const w = ['r.deleted_at IS NULL'], ps = [];
  if (nz(req.query.status) !== null) { w.push('r.status=?'); ps.push(req.query.status); }
  if (nz(req.query.client_id) !== null) { w.push('r.client_id=?'); ps.push(req.query.client_id); }
  if (nz(req.query.sale_id) !== null) { w.push('r.sale_id=?'); ps.push(req.query.sale_id); }
  const total = db.prepare(`SELECT COUNT(*) c FROM refunds r WHERE ${w.join(' AND ')}`).get(...ps).c;
  const rows = db.prepare(`SELECT r.*, c.name client_name, c.phone client_phone, s.code sale_code, rv.code reservation_code, a.name account_name, us.name requested_by_name, ap.name approved_by_name
    FROM refunds r LEFT JOIN clients c ON c.id=r.client_id LEFT JOIN sales s ON s.id=r.sale_id LEFT JOIN reservations rv ON rv.id=r.reservation_id
    LEFT JOIN accounts a ON a.id=r.account_id LEFT JOIN users us ON us.id=r.requested_by LEFT JOIN users ap ON ap.id=r.approved_by
    WHERE ${w.join(' AND ')} ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...ps, limit, (page - 1) * limit);
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1 });
});
R.post('/refunds', auth, P('finance', 'create'), need('client_id'), (req, res) => {
  const b = req.body || {};
  const amount = num(b.amount);
  if (amount <= 0) return res.status(400).json({ error: 'مبلغ الاسترداد يجب أن يكون أكبر من صفر' });
  if (!b.reason) return res.status(400).json({ error: 'سبب الاسترداد مطلوب' });
  if (b.sale_id) {
    const t = F.saleTotals(b.sale_id);
    const already = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM refunds WHERE sale_id=? AND status IN ('pending','approved','paid') AND deleted_at IS NULL`).get(b.sale_id).v;
    if (amount + num(already) - (t.gross_paid + t.pending_checks) > 0.01) return res.status(400).json({ error: 'مبلغ الاسترداد يتجاوز المدفوع فعليًا' });
  }
  const code = nextUniqueCode('REFUND', 'refunds', 'code');
  const id = db.prepare(`INSERT INTO refunds (code, reservation_id, sale_id, client_id, amount, deducted_amount, method, account_id, reference_no, attachment_id, reason, status, refund_date, requested_by, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, nz(b.reservation_id), nz(b.sale_id), b.client_id, amount, num(b.deducted_amount), b.method || 'cash',
    b.account_id || F.defaultAccountId(), b.reference_no || '', nz(b.attachment_id), b.reason, 'pending', b.refund_date || today(), req.user.id, b.notes || '').lastInsertRowid;
  push(req, 'create', 'finance', 'refund', id, `${code} — ${amount}`);
  if (!F.canApprove(req.user, 'finance')) {
    const approvalId = F.raiseApproval(req, { action_type: 'refund', entity_type: 'refund', entity_id: id, title: `اعتماد استرداد ${code} بمبلغ ${amount}`, module: 'finance', amount, payload: { refund_id: id } });
    db.prepare('UPDATE refunds SET approval_id=? WHERE id=?').run(approvalId, id);
    return res.status(201).json({ id, code, status: 'pending', pending_approval: approvalId, message: 'الاسترداد يحتاج اعتماد المدير' });
  }
  res.status(201).json({ id, code, status: 'pending' });
});
R.post('/refunds/:id/approve', auth, P('finance', 'approve'), idParam, (req, res) => {
  const r = db.prepare('SELECT * FROM refunds WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'الاسترداد غير موجود' });
  if (r.status !== 'pending') return res.status(400).json({ error: 'الاسترداد مُعالج مسبقًا' });
  db.prepare(`UPDATE refunds SET status='approved', approved_by=?, approved_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`).run(req.user.id, r.id);
  push(req, 'approve', 'finance', 'refund', r.id, `${r.code}`);
  res.json({ ok: true, status: 'approved' });
});
R.post('/refunds/:id/reject', auth, P('finance', 'approve'), idParam, (req, res) => {
  const r = db.prepare('SELECT * FROM refunds WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'الاسترداد غير موجود' });
  db.prepare(`UPDATE refunds SET status='rejected', approved_by=?, approved_at=datetime('now','localtime'), notes=COALESCE(notes,'') || ' — رفض: ' || ? WHERE id=?`).run(req.user.id, (req.body || {}).note || '', r.id);
  push(req, 'approve', 'finance', 'refund_reject', r.id, `${r.code}`);
  res.json({ ok: true, status: 'rejected' });
});
R.post('/refunds/:id/pay', auth, P('finance', 'approve'), idParam, (req, res) => {
  const r = db.prepare('SELECT * FROM refunds WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'الاسترداد غير موجود' });
  if (r.status === 'rejected') return res.status(400).json({ error: 'الاسترداد مرفوض' });
  try {
    const out = F.executeRefund(r.id, req.user);
    push(req, 'update', 'finance', 'refund_pay', r.id, `${r.code} — ${num(r.amount)}`);
    res.json({ ok: true, ...out });
  } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});
R.get('/refunds/excel', auth, P('finance', 'export'), async (req, res) => {
  const rows = db.prepare(`SELECT r.code, r.refund_date, c.name client_name, s.code sale_code, rv.code reservation_code, r.amount, r.deducted_amount, r.method,
      a.name account_name, r.reference_no, r.reason, r.status, us.name requested_by_name, ap.name approved_by_name
    FROM refunds r LEFT JOIN clients c ON c.id=r.client_id LEFT JOIN sales s ON s.id=r.sale_id LEFT JOIN reservations rv ON rv.id=r.reservation_id
    LEFT JOIN accounts a ON a.id=r.account_id LEFT JOIN users us ON us.id=r.requested_by LEFT JOIN users ap ON ap.id=r.approved_by
    WHERE r.deleted_at IS NULL ORDER BY r.id DESC LIMIT 5000`).all();
  await X.sendSheet(res, {
    sheet: 'الاستردادات', title: 'تقرير الاستردادات', prefix: 'REF', req, user: req.user, filters: req.query,
    cols: [{ k: 'code', t: 'رقم الاسترداد' }, { k: 'refund_date', t: 'التاريخ' }, { k: 'client_name', t: 'العميل' }, { k: 'sale_code', t: 'عملية البيع' },
      { k: 'reservation_code', t: 'الحجز' }, { k: 'amount', t: 'المبلغ المسترد', money: true }, { k: 'deducted_amount', t: 'المخصوم', money: true },
      { k: 'method', t: 'طريقة الاسترداد' }, { k: 'account_name', t: 'الحساب' }, { k: 'reference_no', t: 'المرجع' }, { k: 'reason', t: 'السبب' },
      { k: 'status', t: 'الحالة' }, { k: 'requested_by_name', t: 'مقدم الطلب' }, { k: 'approved_by_name', t: 'المعتمد' }],
    rows, totalsKeys: ['amount', 'deducted_amount']
  });
});

// =====================================================================
// العمولات ودفعات المسوقين
// =====================================================================
R.get('/commissions', auth, P('commissions', 'view'), (req, res) => {
  const { page, limit } = pageOf(req.query);
  const w = ["s.status<>'cancelled'", 's.broker_id IS NOT NULL'], ps = [];
  if (nz(req.query.broker_id) !== null) { w.push('s.broker_id=?'); ps.push(req.query.broker_id); }
  if (nz(req.query.project_id) !== null) { w.push('u.project_id=?'); ps.push(req.query.project_id); }
  if (req.query.from) { w.push('s.sale_date>=?'); ps.push(req.query.from); }
  if (req.query.to) { w.push('s.sale_date<=?'); ps.push(req.query.to); }
  const base = `FROM sales s JOIN units u ON u.id=s.unit_id JOIN clients c ON c.id=s.client_id JOIN brokers b ON b.id=s.broker_id LEFT JOIN projects p ON p.id=u.project_id
    LEFT JOIN payment_schedule ps2 ON ps2.sale_id=s.id WHERE ${w.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) c ${base}`).get(...ps).c;
  const rows = db.prepare(`SELECT s.id, s.code sale_code, s.sale_date, s.net_price, s.commission, b.id broker_id, b.name broker_name, b.commission_rate, b.commission_method, b.iban, b.due_days,
      c.name client_name, u.code unit_code, p.name project_name,
      COALESCE((SELECT SUM(cp.amount) FROM commission_payments cp WHERE cp.sale_id=s.id AND cp.status='paid' AND cp.deleted_at IS NULL),0) paid
      ${base} ORDER BY s.sale_date DESC LIMIT ? OFFSET ?`).all(...ps, limit, (page - 1) * limit).map(r0 => {
    const dueDays = num(r0.due_days);
    const due = T.addDays(dueDays, r0.sale_date || today());
    const remaining = r2(num(r0.commission) - num(r0.paid));
    const status = remaining <= 0.01 ? 'paid' : (due < today() ? 'overdue' : num(r0.paid) > 0 ? 'partial' : 'due');
    return { ...r0, commission_value: r2(r0.commission), due_date: due, remaining, status };
  });
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1 });
});
R.get('/commissions/excel', auth, P('commissions', 'export'), async (req, res) => {
  const rows = db.prepare(`SELECT s.code sale_code, s.sale_date, b.name broker_name, b.commission_rate, b.commission_method, c.name client_name, u.code unit_code, p.name project_name,
      s.net_price, s.commission, COALESCE((SELECT SUM(cp.amount) FROM commission_payments cp WHERE cp.sale_id=s.id AND cp.status='paid'),0) paid
    FROM sales s JOIN units u ON u.id=s.unit_id JOIN clients c ON c.id=s.client_id JOIN brokers b ON b.id=s.broker_id LEFT JOIN projects p ON p.id=u.project_id
    WHERE s.status<>'cancelled' AND s.broker_id IS NOT NULL ORDER BY s.sale_date DESC LIMIT 5000`).all()
    .map(r => ({ ...r, remaining: r2(num(r.commission) - num(r.paid)) }));
  await X.sendSheet(res, {
    sheet: 'العمولات', title: 'تقرير عمولات المسوقين', prefix: 'COM', req, user: req.user, filters: req.query,
    cols: [{ k: 'sale_code', t: 'عملية البيع' }, { k: 'sale_date', t: 'التاريخ' }, { k: 'broker_name', t: 'المسوق' }, { k: 'commission_rate', t: 'النسبة %' },
      { k: 'commission_method', t: 'طريقة الاحتساب' }, { k: 'client_name', t: 'العميل' }, { k: 'unit_code', t: 'الوحدة' }, { k: 'project_name', t: 'المشروع' },
      { k: 'net_price', t: 'صافي العملية', money: true }, { k: 'commission', t: 'قيمة العمولة', money: true }, { k: 'paid', t: 'المدفوع', money: true }, { k: 'remaining', t: 'المتبقي', money: true }],
    rows, totalsKeys: ['net_price', 'commission', 'paid', 'remaining']
  });
});
R.get('/commission-payments', auth, P('commissions', 'view'), (req, res) => {
  const rows = db.prepare(`SELECT cp.*, b.name broker_name, s.code sale_code, a.name account_name, us.name user_name
    FROM commission_payments cp JOIN brokers b ON b.id=cp.broker_id LEFT JOIN sales s ON s.id=cp.sale_id LEFT JOIN accounts a ON a.id=cp.account_id LEFT JOIN users us ON us.id=cp.user_id
    WHERE cp.deleted_at IS NULL ORDER BY cp.id DESC LIMIT 500`).all();
  res.json({ data: rows });
});
R.post('/commissions/payout', auth, P('commissions', 'create'), need('broker_id', 'amount'), (req, res) => {
 try { return db.transaction(() => _commissionPayout(req, res)); } catch (e) { if (!res.headersSent) res.status(e.code || 400).json({ error: e.message }); } });
function _commissionPayout(req, res) {
  const b = req.body || {};
  const amt = num(b.amount);
  if (amt <= 0) return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
  const broker = db.prepare('SELECT * FROM brokers WHERE id=? AND deleted_at IS NULL').get(b.broker_id);
  if (!broker) return res.status(404).json({ error: 'المسوق غير موجود' });
  if (b.sale_id) {
    const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM commission_payments WHERE sale_id=? AND status='paid' AND deleted_at IS NULL`).get(b.sale_id).v;
    const s = db.prepare('SELECT * FROM sales WHERE id=?').get(b.sale_id);
    if (s && amt + num(paid) - num(s.commission) > 0.01) return res.status(400).json({ error: `المبلغ يتجاوز متبقي العمولة (${r2(num(s.commission) - num(paid)).toLocaleString('en')})` });
  }
  const accId = b.account_id || F.defaultAccountId();
  const code = nextUniqueCode('COMMISSION', 'commission_payments', 'code');
  const id = db.prepare(`INSERT INTO commission_payments (code, broker_id, sale_id, amount, pay_date, account_id, method, reference_no, notes, status, user_id)
    VALUES (?,?,?,?,?,?,?,?,?, 'paid', ?)`).run(code, broker.id, nz(b.sale_id), amt, b.pay_date || today(), accId, b.method || 'transfer', b.reference_no || '', b.notes || '', req.user.id).lastInsertRowid;
  const txnId = F.postTxn({ kind: 'payout', direction: 'out', amount: amt, accountId: accId, txnDate: b.pay_date || today(), method: b.method || 'transfer', reference: b.reference_no || '', saleId: nz(b.sale_id), notes: `عمولة ${broker.name} — ${code}`, user: req.user });
  db.prepare('UPDATE commission_payments SET txn_id=? WHERE id=?').run(txnId, id);
  const totalPaid = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM commission_payments WHERE broker_id=? AND status='paid' AND deleted_at IS NULL`).get(broker.id).v;
  db.prepare('UPDATE brokers SET total_paid=? WHERE id=?').run(r2(totalPaid), broker.id);
  push(req, 'create', 'commissions', 'payout', id, `${code} — ${broker.name} — ${amt}`);
  res.status(201).json({ id, code, txn_id: txnId, broker_total_paid: r2(totalPaid) });
}

R.get('/brokers/:id/statement', auth, P('brokers', 'view'), idParam, (req, res) => {
  const broker = db.prepare('SELECT * FROM brokers WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!broker) return res.status(404).json({ error: 'المسوق غير موجود' });
  const sales = db.prepare(`SELECT s.id, s.code, s.sale_date, s.net_price, s.commission, c.name client_name, u.code unit_code, p.name project_name,
      COALESCE((SELECT SUM(cp.amount) FROM commission_payments cp WHERE cp.sale_id=s.id AND cp.status='paid' AND cp.deleted_at IS NULL),0) paid
    FROM sales s JOIN units u ON u.id=s.unit_id JOIN clients c ON c.id=s.client_id LEFT JOIN projects p ON p.id=u.project_id
    WHERE s.broker_id=? AND s.status<>'cancelled' ORDER BY s.sale_date DESC`).all(broker.id).map(s => ({ ...s, remaining: r2(num(s.commission) - num(s.paid)) }));
  const payouts = db.prepare(`SELECT cp.*, a.name account_name FROM commission_payments cp LEFT JOIN accounts a ON a.id=cp.account_id WHERE cp.broker_id=? AND cp.deleted_at IS NULL ORDER BY cp.id DESC`).all(broker.id);
  const totalCommission = r2(sales.reduce((a, s) => a + num(s.commission), 0));
  const totalPaid = r2(payouts.filter(p => p.status === 'paid').reduce((a, p) => a + num(p.amount), 0));
  res.json({ broker, sales, payouts, summary: { sales_count: sales.length, total_commission: totalCommission, total_paid: totalPaid, remaining: r2(totalCommission - totalPaid) } });
});

// =====================================================================
// الموافقات
// =====================================================================
R.get('/approvals', auth, P('approvals', 'view'), (req, res) => {
  const { page, limit } = pageOf(req.query);
  const w = ['1=1'], ps = [];
  if (nz(req.query.status) !== null) { w.push('a.status=?'); ps.push(req.query.status); }
  if (nz(req.query.action_type) !== null) { w.push('a.action_type=?'); ps.push(req.query.action_type); }
  const total = db.prepare(`SELECT COUNT(*) c FROM approvals a WHERE ${w.join(' AND ')}`).get(...ps).c;
  const rows = db.prepare(`SELECT a.*, u1.name requested_by_name, u2.name decided_by_name FROM approvals a
    LEFT JOIN users u1 ON u1.id=a.requested_by LEFT JOIN users u2 ON u2.id=a.decided_by
    WHERE ${w.join(' AND ')} ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.id DESC LIMIT ? OFFSET ?`).all(...ps, limit, (page - 1) * limit);
  const pendingCount = db.prepare(`SELECT COUNT(*) c FROM approvals WHERE status='pending'`).get().c;
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1, pending: pendingCount, can_approve: F.canApprove(req.user) });
});
R.get('/approvals/pending-count', auth, (req, res) => res.json({ pending: db.prepare(`SELECT COUNT(*) c FROM approvals WHERE status='pending'`).get().c, can_approve: F.canApprove(req.user) }));
R.post('/approvals/:id/approve', auth, P('approvals', 'approve'), idParam, (req, res) => {
  try {
    const out = F.decideApproval(Number(req.params.id), 'approved', req.user, (req.body || {}).note || '');
    res.json(out);
  } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});
R.post('/approvals/:id/reject', auth, P('approvals', 'approve'), idParam, (req, res) => {
  try { res.json(F.decideApproval(Number(req.params.id), 'rejected', req.user, (req.body || {}).note || '')); }
  catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});
R.post('/approvals/:id/cancel', auth, idParam, (req, res) => {
  const a = db.prepare('SELECT * FROM approvals WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (a.status !== 'pending') return res.status(400).json({ error: 'الطلب مُقرّر مسبقًا' });
  if (a.requested_by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'يمكن لمقدم الطلب فقط إلغاؤه' });
  db.prepare(`UPDATE approvals SET status='cancelled', decided_by=?, decided_at=datetime('now','localtime') WHERE id=?`).run(req.user.id, a.id);
  push(req, 'update', 'approvals', 'cancel', a.id, a.title);
  res.json({ ok: true });
});

// =====================================================================
// كشوف الحساب والتقارير المالية
// =====================================================================
R.get('/statements/client/:id', auth, P('statements', 'view'), idParam, (req, res) => {
  const st = F.clientStatement(Number(req.params.id));
  if (!st) return res.status(404).json({ error: 'العميل غير موجود' });
  st.company = X.settings();
  st.filters = { from: req.query.from || '', to: req.query.to || '' };
  if (req.query.from) {
    st.payments = st.payments.filter(p => p.paid_at >= req.query.from);
    if (req.query.to) st.payments = st.payments.filter(p => p.paid_at <= req.query.to);
  } else if (req.query.to) st.payments = st.payments.filter(p => p.paid_at <= req.query.to);
  res.json(st);
});
R.get('/statements/client/:id/excel', auth, P('statements', 'export'), idParam, async (req, res) => {
  const st = F.clientStatement(Number(req.params.id));
  if (!st) return res.status(404).json({ error: 'العميل غير موجود' });
  const rows = st.payments.map(p => ({
    receipt_no: p.receipt_no, paid_at: p.paid_at, kind: p.kind, sale_code: p.sale_code || p.reservation_code || '', unit_code: p.unit_code || '', project_code: p.project_code || '',
    amount: p.amount, method: p.method, account_name: p.account_name || '', reference_no: p.reference_no, check_no: p.check_no, status: p.status, created_at: p.created_at
  }));
  await X.sendSheet(res, {
    sheet: `كشف حساب ${st.client.name}`, title: `كشف حساب العميل — ${st.client.name} (${st.client.code})`, prefix: 'CST', req, user: req.user, filters: req.query,
    cols: [{ k: 'receipt_no', t: 'رقم الإيصال' }, { k: 'paid_at', t: 'تاريخ الدفع' }, { k: 'kind', t: 'النوع' }, { k: 'sale_code', t: 'البيع/الحجز' }, { k: 'unit_code', t: 'الوحدة' },
      { k: 'project_code', t: 'المشروع' }, { k: 'amount', t: 'المبلغ', money: true }, { k: 'method', t: 'طريقة الدفع' }, { k: 'account_name', t: 'الحساب المستلم' },
      { k: 'reference_no', t: 'رقم المرجع' }, { k: 'check_no', t: 'رقم الشيك' }, { k: 'status', t: 'الحالة' }, { k: 'created_at', t: 'تاريخ الإنشاء' }],
    rows, totalsKeys: ['amount']
  });
});
R.get('/statements/project/:id', auth, P('statements', 'view'), idParam, (req, res) => {
  const st = F.projectTotals(Number(req.params.id));
  if (!st) return res.status(404).json({ error: 'المشروع غير موجود' });
  st.company = X.settings();
  st.expensesList = db.prepare(`SELECT e.code, e.expense_date, e.amount, c.name category_name, e.description, e.status FROM expenses e
    LEFT JOIN expense_categories c ON c.id=e.category_id WHERE e.project_id=? AND e.deleted_at IS NULL ORDER BY e.expense_date DESC LIMIT 500`).all(st.project.id);
  st.commissionsList = db.prepare(`SELECT s.code, s.sale_date, s.commission, b.name broker_name, COALESCE((SELECT SUM(cp.amount) FROM commission_payments cp WHERE cp.sale_id=s.id AND cp.status='paid'),0) paid
    FROM sales s JOIN brokers b ON b.id=s.broker_id WHERE s.broker_id IS NOT NULL AND s.unit_id IN (SELECT id FROM units WHERE project_id=?) AND s.status<>'cancelled' ORDER BY s.sale_date DESC`).all(st.project.id);
  res.json(st);
});
R.get('/statements/project/:id/excel', auth, P('statements', 'export'), idParam, async (req, res) => {
  const st = F.projectTotals(Number(req.params.id));
  if (!st) return res.status(404).json({ error: 'المشروع غير موجود' });
  const rows = st.sales.map(s => ({
    code: s.code, sale_date: s.sale_date, unit_code: s.unit_code, client_name: s.client_name, sale_price: s.sale_price, discount: s.discount,
    net_price: s.net_price, paid: s.paid, remaining: s.remaining, commission: s.commission, commission_paid: s.commission_paid, status: s.status
  }));
  await X.sendSheet(res, {
    sheet: `كشف مشروع ${st.project.code}`, title: `الكشف المالي للمشروع — ${st.project.name}`, prefix: 'PST', req, user: req.user, filters: req.query,
    cols: [{ k: 'code', t: 'عملية البيع' }, { k: 'sale_date', t: 'التاريخ' }, { k: 'unit_code', t: 'الوحدة' }, { k: 'client_name', t: 'العميل' },
      { k: 'sale_price', t: 'قيمة العقار', money: true }, { k: 'discount', t: 'الخصم', money: true }, { k: 'net_price', t: 'صافي القيمة', money: true },
      { k: 'paid', t: 'المقبوض', money: true }, { k: 'remaining', t: 'المتبقي', money: true }, { k: 'commission', t: 'العمولة', money: true },
      { k: 'commission_paid', t: 'العمولة المدفوعة', money: true }, { k: 'status', t: 'الحالة' }],
    rows, totalsKeys: ['sale_price', 'discount', 'net_price', 'paid', 'remaining', 'commission']
  });
});
R.get('/finance/overview', auth, P('finance', 'view'), (req, res) => {
  F.refreshScheduleStatuses();
  const cash = db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='cash' THEN current_balance ELSE 0 END),0) v FROM accounts WHERE deleted_at IS NULL AND status='active'`).get().v;
  const bank = db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='bank' THEN current_balance ELSE 0 END),0) v FROM accounts WHERE deleted_at IS NULL AND status='active'`).get().v;
  const sales = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(net_price),0) net, COALESCE(SUM(discount),0) disc, COALESCE(SUM(commission),0) comm FROM sales WHERE status<>'cancelled'`).get();
  const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE status='confirmed' AND deleted_at IS NULL`).get().v;
  const pendingChecks = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE status='pending' AND deleted_at IS NULL`).get().v;
  const refunds = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM refunds WHERE status IN ('approved','paid') AND deleted_at IS NULL`).get().v;
  const overdue = db.prepare(`SELECT COALESCE(SUM(amount - paid_amount),0) v, COUNT(*) c FROM payment_schedule WHERE deleted_at IS NULL AND status='overdue'`).get();
  const expensesMonth = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE status IN ('approved','paid') AND deleted_at IS NULL AND substr(expense_date,1,7)=substr(date('now','localtime'),1,7)`).get().v;
  const collectedMonth = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE status='confirmed' AND deleted_at IS NULL AND substr(paid_at,1,7)=substr(date('now','localtime'),1,7)`).get().v;
  const commissionsDue = r2(num(sales.comm) - db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM commission_payments WHERE status='paid' AND deleted_at IS NULL`).get().v);
  const approvalsPending = db.prepare(`SELECT COUNT(*) c FROM approvals WHERE status='pending'`).get().c;
  const topOverdue = db.prepare(`SELECT c.id, c.name client_name, c.phone, COALESCE(SUM(ps.amount - ps.paid_amount),0) amount, COUNT(*) cnt
    FROM payment_schedule ps JOIN clients c ON c.id=ps.client_id WHERE ps.deleted_at IS NULL AND ps.status='overdue' GROUP BY c.id ORDER BY amount DESC LIMIT 8`).all();
  const byMonthCollections = db.prepare(`SELECT substr(paid_at,1,7) m, COALESCE(SUM(amount),0) v FROM payments WHERE status='confirmed' AND deleted_at IS NULL GROUP BY m ORDER BY m DESC LIMIT 12`).all();
  res.json({
    cash: r2(cash), bank: r2(bank), total_liquidity: r2(num(cash) + num(bank)),
    sales: { count: sales.n, net: r2(sales.net), discounts: r2(sales.disc), commission: r2(sales.comm) },
    collected: r2(paid), refunded: r2(refunds), net_collected: r2(num(paid) - num(refunds)),
    pending_checks: r2(pendingChecks), outstanding: r2(num(sales.net) - (num(paid) - num(refunds))),
    overdue: { amount: r2(overdue.v), count: overdue.c },
    expenses_month: r2(expensesMonth), collected_month: r2(collectedMonth), commissions_due: commissionsDue,
    approvals_pending: approvalsPending, top_overdue: topOverdue, by_month_collections: byMonthCollections.reverse()
  });
});

// =====================================================================
// مُنفّذو الموافقات (يُنفَّذ الطلب بعد الاعتماد)
// =====================================================================
function approver(approver) { return { user: approver, ip: '' }; }
F.registerApprovalExecutor('payment_edit', (p, approverUser) => {
  const pay = db.prepare('SELECT * FROM payments WHERE id=?').get(p.payment_id);
  if (!pay) throw Object.assign(new Error('الدفعة غير موجودة'), { code: 404 });
  const { payment_id, ...rest } = p;
  F.updatePayment(pay.id, rest, approverUser);
  return { note: 'تم تعديل الدفعة بعد الاعتماد (مع إعادة التحقق الكاملة)' };
});
F.registerApprovalExecutor('payment_cancel', (p, approverUser) => {
  const pay = db.prepare('SELECT * FROM payments WHERE id=?').get(p.payment_id);
  if (!pay) throw Object.assign(new Error('الدفعة غير موجودة'), { code: 404 });
  F.cancelPayment(pay.id, p.reason || 'اعتماد الإلغاء', approverUser);
  return { note: 'تم إلغاء الدفعة بعد الاعتماد' };
});
F.registerApprovalExecutor('payment_override', (p, approverUser) => F.createPayment(approver(p), { ...p, allow_overpayment: true, user: approverUser }));
F.registerApprovalExecutor('expense', (p, approverUser) => {
  const e = db.prepare('SELECT * FROM expenses WHERE id=?').get(p.expense_id);
  if (!e) throw Object.assign(new Error('المصروف غير موجود'), { code: 404 });
  const cols = ['expense_date', 'category_id', 'amount', 'account_id', 'project_id', 'unit_id', 'vendor', 'beneficiary', 'method', 'reference_no', 'bank_name', 'check_no', 'check_date', 'check_due_date', 'description', 'employee_id', 'notes'];
  const use = cols.filter(c => p[c] !== undefined);
  if (use.length) db.prepare(`UPDATE expenses SET ${use.map(c => `${c}=?`).join(',')}, updated_at=datetime('now','localtime') WHERE id=?`).run(...use.map(c => p[c]), e.id);
  return { note: 'تم تعديل المصروف بعد الاعتماد' };
});
F.registerApprovalExecutor('expense_pay', (p, approverUser) => {
  const e = db.prepare('SELECT * FROM expenses WHERE id=?').get(p.expense_id);
  if (!e) throw Object.assign(new Error('المصروف غير موجود'), { code: 404 });
  return payExpense(e.id, approverUser);
});
F.registerApprovalExecutor('expense_cancel', (p, approverUser) => {
  const e = db.prepare('SELECT * FROM expenses WHERE id=?').get(p.expense_id);
  if (!e) throw Object.assign(new Error('المصروف غير موجود'), { code: 404 });
  return db.transaction(() => {
    if (e.txn_id) F.reverseTxn(e.txn_id, { reason: `إلغاء مصروف ${e.code} (اعتماد): ${p.reason || ''}`, user: approverUser });
    db.prepare(`UPDATE expenses SET status='cancelled', deleted_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`).run(e.id);
    F.recomputeAccount(e.account_id);
    return { note: 'تم إلغاء المصروف بعد الاعتماد' };
  });
});
F.registerApprovalExecutor('refund', (p, approverUser) => {
  const r = db.prepare('SELECT * FROM refunds WHERE id=?').get(p.refund_id);
  if (!r) throw Object.assign(new Error('الاسترداد غير موجود'), { code: 404 });
  if (r.status !== 'pending') return { note: 'الاسترداد مُعالج' };
  db.prepare(`UPDATE refunds SET status='approved', approved_by=?, approved_at=datetime('now','localtime') WHERE id=?`).run(approverUser.id, r.id);
  return F.executeRefund(r.id, approverUser);
});
F.registerApprovalExecutor('cancel_reservation', (p, approverUser) => F.cancelReservation(p.reservation_id, { ...p, reason: p.reason || 'اعتماد الإلغاء' }, approverUser));
F.registerApprovalExecutor('cancel_sale', (p, approverUser) => F.cancelSale(p.sale_id, p.reason || 'اعتماد الإلغاء', approverUser, p));
F.registerApprovalExecutor('large_discount', (p, approverUser) => {
  const sale = E.createSale(approver(approverUser), { ...p, via_approval: true });
  return { ...sale, note: 'تم تنفيذ البيع بعد اعتماد الخصم' };
});

module.exports = R;
