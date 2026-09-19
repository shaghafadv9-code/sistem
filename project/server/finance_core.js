// Smart Secretary — النواة المالية (Single Source of Truth)
// كل مبلغ مالي يمرّ من هنا: دفعة، عربون، مصروف، عمولة، استرداد، تحويل.
// مبادئ:
//  1) لا يُحسب أي مبلغ من قيمة مخزّنة في الحجز/البيع — بل من جدول الدفعات والحركات.
//  2) كل مبلغ له: مصدر + حساب + مرجع + تاريخ + مستخدم + سجل تدقيق.
//  3) لا حذف مباشر: إلغاء/عكس/استرداد فقط، والبيانات القديمة تبقى في السجل.
const { db, nextUniqueCode } = require('./db');
const { audit } = require('./auth');

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => Math.round(num(v) * 100) / 100;
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const today = () => new Date().toISOString().slice(0, 10);
const METHODS = ['cash', 'transfer', 'check', 'card', 'online', 'other'];

function nextCode(prefix, table, col = 'code') {
  try { return nextUniqueCode(prefix, table, col); }
  catch { return `${prefix}-${Date.now()}`; }
}
function setting(key, def = '') {
  try { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return r ? r.value : def; } catch { return def; }
}
function notifyUser(userId, type, title, body = '', link = '') {
  try { db.prepare('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?,?,?,?,?)').run(userId, type, title, body, link); } catch {}
}
function notifyRole(roleName, type, title, body = '', link = '') {
  try {
    db.prepare(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name=? AND u.status='active' AND u.deleted_at IS NULL`).all(roleName)
      .forEach(u => notifyUser(u.id, type, title, body, link));
  } catch {}
}
function pushAudit(user, action, module, entity, id, details) {
  audit({ ...(user || {}), ip: user?.ip || '' }, action, module, entity, id, typeof details === 'string' ? details : JSON.stringify(details));
}

// ---------------- الحسابات ----------------
function defaultAccountId() {
  const a = db.prepare('SELECT id FROM accounts WHERE is_default=1 AND status=\'active\' AND deleted_at IS NULL ORDER BY id LIMIT 1').get();
  if (a) return a.id;
  const b = db.prepare('SELECT id FROM accounts WHERE status=\'active\' AND deleted_at IS NULL ORDER BY id LIMIT 1').get();
  return b ? b.id : null;
}
function recomputeAccount(accountId) {
  if (!accountId) return 0;
  const acc = db.prepare('SELECT * FROM accounts WHERE id=?').get(accountId);
  if (!acc) return 0;
  const moves = db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) v
    FROM transactions WHERE deleted_at IS NULL AND status IN ('confirmed','cleared') AND account_id=?`).get(accountId).v;
  const incoming = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM transactions
    WHERE deleted_at IS NULL AND status IN ('confirmed','cleared') AND to_account_id=? AND direction='in'`).get(accountId).v;
  const bal = r2(num(acc.opening_balance) + num(moves) + num(incoming));
  db.prepare(`UPDATE accounts SET current_balance=?, updated_at=datetime('now','localtime') WHERE id=?`).run(bal, accountId);
  return bal;
}

// ---------------- الحركات (Ledger) ----------------
function postTxn({ kind, direction, amount, accountId, toAccountId = null, txnDate, method = 'cash', reference = '', checkNo = '', checkDate = null, checkDueDate = null, checkStatus = '', bankName = '', status = 'confirmed', clientId = null, projectId = null, unitId = null, saleId = null, reservationId = null, contractId = null, expenseId = null, refundId = null, commissionId = null, payoutId = null, attachmentId = null, notes = '', user, silent = false }) {
  const amt = r2(amount);
  if (!(amt >= 0)) throw new Error('المبلغ غير صالح');
  const accId = accountId || defaultAccountId();
  const info = db.prepare(`INSERT INTO transactions (code, txn_date, kind, direction, amount, account_id, to_account_id, client_id, project_id, unit_id, sale_id, reservation_id, contract_id, expense_id, refund_id, commission_id, payout_id, method, reference_no, check_no, bank_name, check_date, check_due_date, check_status, status, attachment_id, notes, user_id, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    nextCode('TXN', 'transactions'), txnDate || today(), kind, direction, amt, accId, toAccountId, clientId, projectId, unitId, saleId, reservationId, contractId,
    expenseId, refundId, commissionId, payoutId, method, reference, checkNo, bankName, checkDate, checkDueDate, checkStatus, status, attachmentId, notes, user?.id || null, nowStr()
  );
  recomputeAccount(accId);
  if (toAccountId) recomputeAccount(toAccountId);
  if (!silent) pushAudit(user, 'create', 'finance', 'transaction', info.lastInsertRowid, `${kind} ${direction} ${amt} — حساب ${accId}`);
  return info.lastInsertRowid;
}

// ---------------- حساب الدفعات (المصدر الوحيد) ----------------
function saleTotals(saleId) {
  const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(saleId);
  if (!sale) return null;
  const net = r2(sale.net_price);
  const agg = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status='confirmed' THEN amount ELSE 0 END),0) paid,
      COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),0) pending
    FROM payments WHERE sale_id=? AND deleted_at IS NULL`).get(saleId);
  const refunded = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM refunds WHERE sale_id=? AND status IN ('approved','paid') AND deleted_at IS NULL`).get(saleId).v;
  const gross = r2(agg.paid);
  const refund = r2(refunded);
  const paid = r2(gross - refund);
  const commission = r2(sale.commission);
  const commissionPaid = r2(db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM commission_payments WHERE sale_id=? AND status='paid' AND deleted_at IS NULL`).get(saleId).v);
  const expenses = r2(db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE unit_id=? AND status IN ('approved','paid') AND deleted_at IS NULL`).get(sale.unit_id).v);
  return {
    net_price: net, gross_paid: gross, refunded: refund, paid, pending_checks: r2(agg.pending),
    remaining: r2(net - paid), commission, commission_paid: commissionPaid, commission_remaining: r2(commission - commissionPaid),
    unit_expenses: expenses, settlement: r2(net - commission),
    net_profit: r2(net - commission - expenses),
    is_fully_paid: net - paid <= 0.01
  };
}
function reservationTotals(reservationId) {
  const r = db.prepare('SELECT * FROM reservations WHERE id=?').get(reservationId);
  if (!r) return null;
  const agg = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status='confirmed' THEN amount ELSE 0 END),0) paid,
      COALESCE(SUM(CASE WHEN status='pending' THEN amount ELSE 0 END),0) pending
    FROM payments WHERE reservation_id=? AND deleted_at IS NULL`).get(reservationId);
  const refunded = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM refunds WHERE reservation_id=? AND status IN ('approved','paid') AND deleted_at IS NULL`).get(reservationId).v;
  const paid = r2(agg.paid - refunded);
  const net = r2(num(r.price) - num(r.discount));
  return { ...r, net_price: net, deposit_paid: paid, pending_checks: r2(agg.pending), refunded: r2(refunded), remaining: r2(net - paid), converted: !!db.prepare('SELECT id FROM sales WHERE reservation_id=? AND status<>\'cancelled\'').get(reservationId) };
}

// ---------------- توزيع الدفعات على جدول الأقساط ----------------
function applyPaymentToSchedule(saleId) {
  if (!saleId) return;
  const rows = db.prepare(`SELECT * FROM payment_schedule WHERE sale_id=? AND deleted_at IS NULL AND status<>'cancelled' ORDER BY seq, due_date, id`).all(saleId);
  if (!rows.length) return;
  const tot = saleTotals(saleId) || { paid: 0 };
  let pool = r2(Math.max(0, tot.paid));
  const upd = db.prepare(`UPDATE payment_schedule SET paid_amount=?, status=?, updated_at=datetime('now','localtime') WHERE id=?`);
  const todayS = today();
  rows.forEach(row => {
    const amount = r2(row.amount);
    const alloc = Math.min(pool, amount);
    pool = r2(pool - alloc);
    let status;
    if (alloc + 0.009 >= amount && amount > 0) status = 'paid';
    else if (row.due_date < todayS) status = alloc > 0 ? 'overdue' : 'overdue';
    else if (row.due_date === todayS) status = alloc > 0 ? 'partial' : 'due';
    else status = alloc > 0 ? 'partial' : 'upcoming';
    upd.run(alloc, status, row.id);
  });
}
function refreshScheduleStatuses() {
  // تحديث الحالات الزمنية (قادم → مستحق اليوم → متأخر) لكل الجداول غير المُقفلة
  db.prepare(`UPDATE payment_schedule SET status='due', updated_at=datetime('now','localtime')
    WHERE deleted_at IS NULL AND status='upcoming' AND due_date = date('now','localtime')`).run();
  db.prepare(`UPDATE payment_schedule SET status='overdue', updated_at=datetime('now','localtime')
    WHERE deleted_at IS NULL AND status IN ('upcoming','due','partial') AND due_date < date('now','localtime')`).run();
}

// ---------------- إنشاء دفعة (مصدر واحد) ----------------
function createPayment(req, data) {
  let {
    amount, method = 'cash', paid_at, notes = '', reference_no = '', account_id = null, kind = 'installment',
    sale_id = null, reservation_id = null, contract_id = null, schedule_id = null, client_id = null, unit_id = null, project_id = null,
    bank_name = '', check_no = '', check_date = null, check_due_date = null, check_status = '', attachment_id = null, status = null, allow_overpayment = false, user
  } = data;

  const amt = r2(amount);
  if (!(amt > 0)) throw Object.assign(new Error('المبلغ يجب أن يكون أكبر من صفر'), { code: 400 });
  if (!METHODS.includes(method)) throw Object.assign(new Error('طريقة الدفع غير صالحة'), { code: 400 });
  if (method === 'check' && !check_no) throw Object.assign(new Error('رقم الشيك مطلوب عند الدفع بشيك'), { code: 400 });

  let sale = null, resv = null, clientId = client_id, unitId = unit_id, projectId = project_id;
  if (sale_id) {
    sale = db.prepare('SELECT * FROM sales WHERE id=?').get(sale_id);
    if (!sale) throw Object.assign(new Error('عملية البيع غير موجودة'), { code: 404 });
    if (sale.status === 'cancelled') throw Object.assign(new Error('لا يمكن تسجيل دفعة على عملية ملغاة'), { code: 400 });
    clientId = sale.client_id; unitId = sale.unit_id;
    projectId = projectId || db.prepare('SELECT project_id FROM units WHERE id=?').get(sale.unit_id)?.project_id || null;
    const t = saleTotals(sale_id);
    const committed = r2(t.paid + t.pending_checks);
    const allowed = r2(t.net_price - committed);
    if (!allow_overpayment && amt - allowed > 0.01) {
      throw Object.assign(new Error(`المبلغ يتجاوز المتبقي على العملية (${allowed.toLocaleString('en')}) — يلزم اعتماد الدفع الزائد`), { code: 400 });
    }
    contract_id = contract_id || sale.contract_id || null;
  } else if (reservation_id) {
    resv = db.prepare('SELECT * FROM reservations WHERE id=?').get(reservation_id);
    if (!resv) throw Object.assign(new Error('الحجز غير موجود'), { code: 404 });
    if (resv.status === 'cancelled') throw Object.assign(new Error('لا يمكن تسجيل دفعة على حجز ملغى'), { code: 400 });
    clientId = resv.client_id; unitId = resv.unit_id;
    projectId = projectId || db.prepare('SELECT project_id FROM units WHERE id=?').get(resv.unit_id)?.project_id || null;
    const t = reservationTotals(reservation_id);
    const allowed = r2(t.net_price - (t.deposit_paid + t.pending_checks));
    if (!allow_overpayment && amt - allowed > 0.01) throw Object.assign(new Error(`المبلغ يتجاوز المتبقي على الحجز (${allowed.toLocaleString('en')})`), { code: 400 });
  }
  if (!sale && !resv) throw Object.assign(new Error('يجب ربط الدفعة ببيع أو حجز'), { code: 400 });

  const accId = account_id || defaultAccountId();
  if (!accId) throw Object.assign(new Error('لا يوجد حساب مالي فعّال — أنشئ حسابًا أولًا'), { code: 400 });
  const acc = db.prepare('SELECT * FROM accounts WHERE id=? AND deleted_at IS NULL').get(accId);
  if (!acc) throw Object.assign(new Error('الحساب المستلم غير موجود'), { code: 404 });
  if (acc.status !== 'active') throw Object.assign(new Error('الحساب المستلم غير فعّال'), { code: 400 });

  const payStatus = status || (method === 'check' ? 'pending' : 'confirmed');
  const kindMap = { deposit: 'deposit', down_payment: 'down_payment', installment: 'installment', full: 'full', other: 'other' };
  const payKind = kindMap[kind] || 'installment';

  const info = db.prepare(`INSERT INTO payments (receipt_no, kind, sale_id, reservation_id, contract_id, schedule_id, client_id, unit_id, project_id, amount, method, account_id, bank_name, reference_no, check_no, check_date, check_due_date, check_status, status, attachment_id, paid_at, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    nextCode('PAYMENT', 'payments', 'receipt_no'), payKind, sale_id, reservation_id, contract_id, schedule_id, clientId, unitId, projectId, amt, method, accId,
    bank_name || acc.bank_name || '', reference_no, check_no, check_date, check_due_date, check_status || (method === 'check' ? 'pending' : ''), payStatus, attachment_id, paid_at || today(), notes, user?.id || null
  );
  const payId = info.lastInsertRowid;

  const txnId = postTxn({
    kind: payKind, direction: 'in', amount: amt, accountId: accId, txnDate: paid_at || today(), method, reference: reference_no,
    checkNo: check_no, checkDate: check_date, checkDueDate: check_due_date, checkStatus: check_status || (method === 'check' ? 'pending' : ''),
    bankName: bank_name || acc.bank_name || '', status: payStatus === 'pending' ? 'pending' : 'confirmed',
    clientId, projectId, unitId, saleId: sale_id, reservationId: reservation_id, contractId: contract_id, attachmentId: attachment_id,
    notes: `دفعة ${payKind === 'deposit' ? 'عربون' : payKind === 'down_payment' ? 'دفعة أولى' : 'قسط'}`, user
  });
  db.prepare('UPDATE payments SET txn_id=? WHERE id=?').run(txnId, payId);
  if (sale_id) {
    applyPaymentToSchedule(sale_id);
    const t = saleTotals(sale_id);
    db.prepare('UPDATE sales SET net_paid_cache=? WHERE id=?').run(t.paid, sale_id);
    if (t.is_fully_paid && db.prepare('SELECT status FROM sales WHERE id=?').get(sale_id).status === 'active') {
      db.prepare(`UPDATE sales SET status='completed', updated_at=datetime('now','localtime') WHERE id=?`).run(sale_id);
      const c = db.prepare('SELECT id FROM contracts WHERE sale_id=?').get(sale_id);
      if (c) db.prepare(`UPDATE contracts SET status='completed', updated_at=datetime('now','localtime') WHERE id=?`).run(c.id);
    }
  }
  if (reservation_id && kind === 'deposit') {
    db.prepare(`UPDATE reservations SET deposit_method=?, deposit_ref=?, updated_at=datetime('now','localtime') WHERE id=?`).run(method, reference_no || check_no || '', reservation_id);
  }
  pushAudit(user, 'create', 'finance', 'payment', payId, `دفعة ${amt} — ${method} — حساب #${accId}${sale ? ` — بيع ${sale.code}` : ''}${resv ? ` — حجز ${resv.code}` : ''}`);
  return { id: payId, receipt_no: db.prepare('SELECT receipt_no FROM payments WHERE id=?').get(payId).receipt_no, txn_id: txnId, status: payStatus };
}

// ---------------- ربط العربون بالبيع (بدون تكرار المبلغ) ----------------
function linkDepositToSale(reservationId, saleId, user) {
  const rows = db.prepare('SELECT * FROM payments WHERE reservation_id=? AND deleted_at IS NULL').all(reservationId);
  let linked = 0;
  rows.forEach(p => {
    if (p.sale_id === saleId) return;
    db.prepare('UPDATE payments SET sale_id=?, contract_id=(SELECT id FROM contracts WHERE sale_id=? LIMIT 1) WHERE id=?').run(saleId, saleId, p.id);
    db.prepare('UPDATE transactions SET sale_id=? WHERE id=?').run(saleId, p.txn_id || -1);
    linked++;
  });
  if (linked) {
    applyPaymentToSchedule(saleId);
    const t = saleTotals(saleId);
    db.prepare('UPDATE sales SET net_paid_cache=? WHERE id=?').run(t.paid, saleId);
    pushAudit(user, 'update', 'finance', 'deposit_link', saleId, `ربط ${linked} دفعة عربون بالبيع #${saleId} دون تكرار المبلغ`);
  }
  return linked;
}

// ---------------- الاسترداد ----------------
function executeRefund(refundId, user) {
  const rf = db.prepare('SELECT * FROM refunds WHERE id=?').get(refundId);
  if (!rf) throw Object.assign(new Error('طلب الاسترداد غير موجود'), { code: 404 });
  if (rf.status === 'paid') return { ok: true, already: true };
  const accId = rf.account_id || defaultAccountId();
  const txnId = postTxn({
    kind: 'refund', direction: 'out', amount: rf.amount, accountId: accId, txnDate: rf.refund_date || today(), method: rf.method,
    reference: rf.reference_no, clientId: rf.client_id, saleId: rf.sale_id, reservationId: rf.reservation_id,
    refundId: rf.id, attachmentId: rf.attachment_id, notes: `استرداد — ${rf.reason || ''}`, user
  });
  db.prepare(`UPDATE refunds SET status='paid', txn_id=?, refund_date=COALESCE(refund_date,?), approved_by=COALESCE(approved_by,?), approved_at=COALESCE(approved_at, datetime('now','localtime')), updated_at=datetime('now','localtime') WHERE id=?`)
    .run(txnId, today(), user?.id || null, refundId);
  if (rf.sale_id) applyPaymentToSchedule(rf.sale_id);
  return { ok: true, txn_id: txnId };
}

// ---------------- إلغاء بيع ----------------
function cancelSale(saleId, reason, user, { refundAmount = 0, deducted = 0, method = 'cash', account_id = null, reference_no = '', refund_date = null } = {}) {
  const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(saleId);
  if (!sale) throw Object.assign(new Error('عملية البيع غير موجودة'), { code: 404 });
  if (sale.status === 'cancelled') throw Object.assign(new Error('العملية ملغاة مسبقًا'), { code: 400 });
  const t = saleTotals(saleId);
  const paid = Math.max(0, t.paid + t.pending_checks);
  if (r2(refundAmount + deducted) - paid > 0.01) throw Object.assign(new Error('المسترد + المخصوم يتجاوز المدفوع فعليًا'), { code: 400 });

  db.prepare(`UPDATE sales SET status='cancelled', cancel_reason=?, cancelled_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`).run(reason || '', saleId);
  db.prepare(`UPDATE payment_schedule SET status='cancelled', updated_at=datetime('now','localtime') WHERE sale_id=? AND status<>'paid' AND deleted_at IS NULL`).run(saleId);
  const c = db.prepare('SELECT * FROM contracts WHERE sale_id=?').get(saleId);
  if (c) db.prepare(`UPDATE contracts SET status='cancelled', updated_at=datetime('now','localtime') WHERE id=?`).run(c.id);
  // إرجاع الوحدة إلى متاحة مع تسجيل الحالة
  const unit = db.prepare('SELECT * FROM units WHERE id=?').get(sale.unit_id);
  if (unit) setUnitStatus(unit.id, 'available', `إلغاء بيع ${sale.code} — ${reason || ''}`, user);

  let refundId = null;
  if (refundAmount > 0) {
    refundId = db.prepare(`INSERT INTO refunds (code, reservation_id, sale_id, client_id, amount, deducted_amount, method, account_id, reference_no, reason, status, refund_date, requested_by, approved_by, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`).run(
      nextCode('REF', 'refunds'), sale.reservation_id, saleId, sale.client_id, r2(refundAmount), r2(deducted), method, account_id || defaultAccountId(), reference_no, reason || '', 'approved', refund_date || today(), user?.id || null, user?.id || null
    ).lastInsertRowid;
    executeRefund(refundId, user);
  } else if (deducted > 0) {
    refundId = db.prepare(`INSERT INTO refunds (code, reservation_id, sale_id, client_id, amount, deducted_amount, method, reason, status, requested_by, approved_by, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`).run(nextCode('REF', 'refunds'), sale.reservation_id, saleId, sale.client_id, 0, r2(deducted), method, reason || '', 'approved', user?.id || null, user?.id || null).lastInsertRowid;
  }
  pushAudit(user, 'update', 'sales', 'cancel', saleId, `إلغاء ${sale.code} — ${reason || ''} — مسترد ${refundAmount} — مخصوم ${deducted}`);
  notifyRole('admin', 'sale', `إلغاء عملية بيع ${sale.code}`, reason || '', '/sales');
  return { ok: true, refund_id: refundId, paid, refunded: r2(refundAmount), deducted: r2(deducted) };
}

// ---------------- إلغاء حجز ----------------
function cancelReservation(reservationId, { reason, refundAmount = 0, deducted = 0, method = 'cash', account_id = null, reference_no = '', refund_date = null }, user) {
  const r = db.prepare('SELECT * FROM reservations WHERE id=?').get(reservationId);
  if (!r) throw Object.assign(new Error('الحجز غير موجود'), { code: 404 });
  if (r.status !== 'active') throw Object.assign(new Error('الحجز غير نشط'), { code: 400 });
  if (!reason) throw Object.assign(new Error('سبب الإلغاء مطلوب'), { code: 400 });
  const t = reservationTotals(reservationId);
  const paid = Math.max(0, t.deposit_paid + t.pending_checks);
  if (r2(refundAmount + deducted) - paid > 0.01) throw Object.assign(new Error('المسترد + المخصوم يتجاوز المدفوع فعليًا'), { code: 400 });

  db.prepare(`UPDATE reservations SET status='cancelled', cancel_reason=?, refund_amount=?, deducted_amount=?, refund_status=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(reason, r2(refundAmount), r2(deducted), refundAmount > 0 ? 'pending' : 'none', reservationId);
  setUnitStatus(r.unit_id, 'available', `إلغاء حجز ${r.code} — ${reason}`, user);
  db.prepare(`UPDATE payment_schedule SET status='cancelled', updated_at=datetime('now','localtime') WHERE reservation_id=? AND deleted_at IS NULL`).run(reservationId);

  let refundId = null;
  if (refundAmount > 0 || deducted > 0) {
    refundId = db.prepare(`INSERT INTO refunds (code, reservation_id, client_id, amount, deducted_amount, method, account_id, reference_no, reason, status, refund_date, requested_by, approved_by, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`).run(
      nextCode('REF', 'refunds'), reservationId, r.client_id, r2(refundAmount), r2(deducted), method, account_id || defaultAccountId(), reference_no, reason, refundAmount > 0 ? 'approved' : 'approved', refund_date || today(), user?.id || null, user?.id || null
    ).lastInsertRowid;
    if (refundAmount > 0) executeRefund(refundId, user);
    db.prepare(`UPDATE reservations SET refund_status=? WHERE id=?`).run(refundAmount > 0 ? 'refunded' : 'deducted', reservationId);
  }
  pushAudit(user, 'update', 'reservations', 'cancel', reservationId, `إلغاء ${r.code} — ${reason} — مسترد ${refundAmount} — مخصوم ${deducted}`);
  return { ok: true, refund_id: refundId, paid, refunded: r2(refundAmount), deducted: r2(deducted) };
}

// ---------------- سجل حالة الوحدة (لا يُحذف) ----------------
function setUnitStatus(unitId, toStatus, reason, user, extra = {}) {
  const u = db.prepare('SELECT * FROM units WHERE id=?').get(unitId);
  if (!u) throw Object.assign(new Error('الوحدة غير موجودة'), { code: 404 });
  if (u.status === toStatus) return { ok: true, unchanged: true };
  db.prepare(`UPDATE units SET status=?, updated_at=datetime('now','localtime') WHERE id=?`).run(toStatus, unitId);
  db.prepare('INSERT INTO unit_status_history (unit_id, from_status, to_status, reason, user_id) VALUES (?,?,?,?,?)')
    .run(unitId, u.status, toStatus, reason || '', user?.id || null);
  pushAudit(user, 'update', 'units', 'status_change', unitId, `${u.code}: ${u.status} → ${toStatus} — ${reason || ''}`);
  return { ok: true, from: u.status, to: toStatus };
}

// ---------------- نظام الموافقات ----------------
const EXECUTORS = {};
function registerApprovalExecutor(actionType, fn) { EXECUTORS[actionType] = fn; }
function canApprove(user, module = 'approvals') {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return !!(user.perms && (user.perms[`${module}:approve`] || user.perms['approvals:approve']));
}
function raiseApproval(req, { action_type, entity_type, entity_id = null, title, module = '', amount = 0, payload = {} }) {
  const info = db.prepare(`INSERT INTO approvals (code, entity_type, entity_id, action_type, title, module, amount, payload, status, requested_by)
    VALUES (?,?,?,?,?,?,?,?, 'pending', ?)`).run(
    nextCode('APR', 'approvals'), entity_type, entity_id, action_type, title, module, r2(amount), JSON.stringify(payload || {}), req.user?.id || null
  );
  const id = info.lastInsertRowid;
  notifyRole('admin', 'approval', `طلب اعتماد جديد: ${title}`, `المبلغ: ${r2(amount).toLocaleString('en')} — بواسطة ${req.user?.name || ''}`, '/approvals');
  pushAudit(req.user, 'create', 'approvals', action_type, id, title);
  return id;
}
function decideApproval(approvalId, decision, approver, note = '') {
  const ap = db.prepare('SELECT * FROM approvals WHERE id=?').get(approvalId);
  if (!ap) throw Object.assign(new Error('طلب الاعتماد غير موجود'), { code: 404 });
  if (ap.status !== 'pending') throw Object.assign(new Error('طلب الاعتماد مُقرّر مسبقًا'), { code: 400 });
  if (decision === 'rejected') {
    db.prepare(`UPDATE approvals SET status='rejected', decided_by=?, decided_at=datetime('now','localtime'), decision_note=? WHERE id=?`).run(approver.id, note, approvalId);
    notifyUser(ap.requested_by, 'approval', `رُفض طلب الاعتماد: ${ap.title}`, note, '/approvals');
    pushAudit(approver, 'approve', 'approvals', ap.action_type, approvalId, `رفض — ${note}`);
    return { ok: true, status: 'rejected' };
  }
  let result = { ok: true };
  const fn = EXECUTORS[ap.action_type];
  if (fn) {
    try { result = fn(JSON.parse(ap.payload || '{}'), approver) || { ok: true }; }
    catch (e) { db.prepare(`UPDATE approvals SET status='rejected', decided_by=?, decided_at=datetime('now','localtime'), decision_note=? WHERE id=?`).run(approver.id, 'فشل التنفيذ: ' + e.message, approvalId); throw e; }
  }
  db.prepare(`UPDATE approvals SET status='approved', decided_by=?, decided_at=datetime('now','localtime'), decision_note=?, result_note=? WHERE id=?`)
    .run(approver.id, note, result?.note || 'تم التنفيذ', approvalId);
  notifyUser(ap.requested_by, 'approval', `تم اعتماد: ${ap.title}`, note, '/approvals');
  pushAudit(approver, 'approve', 'approvals', ap.action_type, approvalId, `اعتماد — ${note}`);
  return { ok: true, status: 'approved', result };
}
// بوابة: إما التنفيذ المباشر (لديه صلاحية) أو إنشاء طلب اعتماد
function gate(req, spec, executor) {
  if (canApprove(req.user)) {
    let result = { ok: true };
    if (executor) result = executor(req.user, spec) || { ok: true };
    return { pending: false, result };
  }
  const approvalId = raiseApproval(req, { ...spec, payload: spec.payload || {} });
  return { pending: true, approval_id: approvalId };
}

// ---------------- موازنة المشروع ----------------
function projectTotals(projectId, filters = {}) {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if (!p) return null;
  const sales = db.prepare(`SELECT s.*, u.code unit_code, c.name client_name FROM sales s
    JOIN units u ON u.id=s.unit_id JOIN clients c ON c.id=s.client_id WHERE u.project_id=? AND s.status<>'cancelled'`).all(projectId);
  const grossSales = r2(sales.reduce((a, s) => a + num(s.sale_price), 0));
  const discounts = r2(sales.reduce((a, s) => a + num(s.discount), 0));
  const netSales = r2(grossSales - discounts);
  const paid = r2(db.prepare(`SELECT COALESCE(SUM(p.amount),0) v FROM payments p JOIN units u ON u.id=p.unit_id
    WHERE u.project_id=? AND p.status='confirmed' AND p.deleted_at IS NULL`).get(projectId).v);
  const refunded = r2(db.prepare(`SELECT COALESCE(SUM(r.amount),0) v FROM refunds r LEFT JOIN sales s ON s.id=r.sale_id LEFT JOIN units u ON u.id=s.unit_id
    LEFT JOIN reservations rv ON rv.id=r.reservation_id LEFT JOIN units u2 ON u2.id=rv.unit_id
    WHERE (u.project_id=? OR u2.project_id=?) AND r.status IN ('approved','paid')`).get(projectId, projectId).v);
  const expenses = r2(db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE project_id=? AND status IN ('approved','paid') AND deleted_at IS NULL`).get(projectId).v);
  const commissions = r2(sales.reduce((a, s) => a + num(s.commission), 0));
  const commissionsPaid = r2(db.prepare(`SELECT COALESCE(SUM(cp.amount),0) v FROM commission_payments cp JOIN sales s ON s.id=cp.sale_id JOIN units u ON u.id=s.unit_id
    WHERE u.project_id=? AND cp.status='paid' AND cp.deleted_at IS NULL`).get(projectId).v);
  const unitsCount = db.prepare('SELECT COUNT(*) c FROM units WHERE project_id=? AND deleted_at IS NULL').get(projectId).c;
  const soldCount = db.prepare(`SELECT COUNT(DISTINCT unit_id) c FROM sales WHERE status<>'cancelled' AND unit_id IN (SELECT id FROM units WHERE project_id=?)`).get(projectId).c;
  return {
    project: p,
    sales_count: sales.length, gross_sales: grossSales, discounts, net_sales: netSales,
    collected: r2(paid - refunded), gross_collected: paid, refunded,
    remaining: r2(netSales - (paid - refunded)),
    expenses, commissions, commissions_paid: commissionsPaid, commissions_due: r2(commissions - commissionsPaid),
    net_cash_flow: r2((paid - refunded) - expenses - commissionsPaid),
    net_profit: r2(netSales - expenses - commissions),
    units_count: unitsCount, sold_count: soldCount, available_count: db.prepare(`SELECT COUNT(*) c FROM units WHERE project_id=? AND status='available'`).get(projectId).c,
    sales: sales.map(s => ({ id: s.id, code: s.code, unit_code: s.unit_code, client_name: s.client_name, sale_price: num(s.sale_price), discount: num(s.discount), net_price: num(s.net_price), commission: num(s.commission), sale_date: s.sale_date, status: s.status, ...saleTotals(s.id) }))
  };
}

// ---------------- كشف حساب العميل ----------------
function clientStatement(clientId) {
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(clientId);
  if (!c) return null;
  const sales = db.prepare(`SELECT s.*, u.code unit_code, u.project_id, p.code project_code, p.name project_name, ct.code contract_code, ct.status contract_status
    FROM sales s JOIN units u ON u.id=s.unit_id JOIN projects p ON p.id=u.project_id
    LEFT JOIN contracts ct ON ct.sale_id=s.id WHERE s.client_id=? ORDER BY s.id`).all(clientId);
  const payments = db.prepare(`SELECT p.*, a.name account_name, a.type account_type, b.name bank_display, s.code sale_code, r.code reservation_code,
      u.code unit_code, pr.code project_code
    FROM payments p LEFT JOIN accounts a ON a.id=p.account_id LEFT JOIN accounts b ON b.id=p.bank_name
    LEFT JOIN sales s ON s.id=p.sale_id LEFT JOIN reservations r ON r.id=p.reservation_id
    LEFT JOIN units u ON u.id=p.unit_id LEFT JOIN projects pr ON pr.id=p.project_id
    WHERE p.client_id=? AND p.deleted_at IS NULL ORDER BY p.paid_at, p.id`).all(clientId);
  const refunds = db.prepare(`SELECT r.*, a.name account_name FROM refunds r LEFT JOIN accounts a ON a.id=r.account_id WHERE r.client_id=? AND r.deleted_at IS NULL ORDER BY r.id`).all(clientId);
  const schedule = db.prepare(`SELECT ps.*, s.code sale_code, u.code unit_code, pr.code project_code FROM payment_schedule ps
    LEFT JOIN sales s ON s.id=ps.sale_id LEFT JOIN units u ON u.id=ps.unit_id LEFT JOIN projects pr ON pr.id=ps.project_id
    WHERE ps.client_id=? AND ps.deleted_at IS NULL ORDER BY ps.due_date, ps.seq`).all(clientId);
  const grossSales = r2(sales.reduce((a, s) => a + num(s.sale_price), 0));
  const discounts = r2(sales.reduce((a, s) => a + num(s.discount), 0));
  const netSales = r2(grossSales - discounts);
  const paidConfirmed = r2(payments.filter(p => p.status === 'confirmed').reduce((a, p) => a + num(p.amount), 0));
  const pendingChecks = r2(payments.filter(p => p.status === 'pending').reduce((a, p) => a + num(p.amount), 0));
  const refunded = r2(refunds.filter(r => ['approved', 'paid'].includes(r.status)).reduce((a, r) => a + num(r.amount), 0));
  const totalPaid = r2(paidConfirmed - refunded);
  const schedDue = r2(schedule.filter(s => !['paid', 'cancelled'].includes(s.status) && s.due_date <= today()).reduce((a, s) => a + Math.max(0, num(s.amount) - num(s.paid_amount)), 0));
  return {
    client: c,
    summary: {
      gross_sales: grossSales, discounts, net_sales: netSales,
      total_paid: totalPaid, gross_paid: paidConfirmed, pending_checks: pendingChecks, refunded,
      remaining_on_client: r2(netSales - totalPaid),
      overdue: schedDue,
      paid_ratio: netSales > 0 ? r2(Math.min(100, (totalPaid / netSales) * 100)) : 0
    },
    sales, payments, refunds, schedule
  };
}

// ---------------- توليد جدول الأقساط ----------------
function generateSchedule({ sale_id = null, reservation_id = null, client_id, unit_id = null, project_id = null, contract_id = null, total = 0, paid = 0, installments = 12, first_due = null, labelPrefix = 'قسط', replace = false, user = null }) {
  if (!client_id) throw Object.assign(new Error('العميل مطلوب لجدول الأقساط'), { code: 400 });
  if (sale_id) {
    const exists = db.prepare('SELECT COUNT(*) c FROM payment_schedule WHERE sale_id=? AND deleted_at IS NULL').get(sale_id).c;
    if (exists && !replace) throw Object.assign(new Error('يوجد جدول أقساط لهذه العملية — استخدم replace=1 لإعادة التوليد'), { code: 409 });
    if (exists && replace) {
      const locked = db.prepare(`SELECT COUNT(*) c FROM payment_schedule WHERE sale_id=? AND paid_amount>0 AND deleted_at IS NULL`).get(sale_id).c;
      if (locked) throw Object.assign(new Error('لا يمكن إعادة توليد الجدول لوجود أقساط مسددة — استخدم التعديل اليدوي'), { code: 400 });
      db.prepare(`UPDATE payment_schedule SET deleted_at=datetime('now','localtime') WHERE sale_id=? AND deleted_at IS NULL`).run(sale_id);
    }
  }
  const remaining = r2(Math.max(0, num(total) - num(paid)));
  const n = Math.max(1, Math.min(120, parseInt(installments) || 12));
  const ins = db.prepare(`INSERT INTO payment_schedule (code, sale_id, reservation_id, contract_id, client_id, unit_id, project_id, seq, label, due_date, amount, paid_amount, status, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const start = first_due || today();
  const rows = [];
  if (num(paid) > 0) {
    rows.push(ins.run(nextCode('SCH', 'payment_schedule'), sale_id, reservation_id, contract_id, client_id, unit_id, project_id, 1, 'المدفوع', start, num(paid), num(paid), 'paid', user?.id || null).lastInsertRowid);
  }
  const each = r2(remaining / n);
  let acc = 0;
  for (let i = 1; i <= n; i++) {
    const amt = i === n ? r2(remaining - acc) : each;
    acc = r2(acc + amt);
    const d = new Date(start + 'T00:00:00');
    d.setMonth(d.getMonth() + i);
    const due = d.toISOString().slice(0, 10);
    const seq = rows.length + i;
    rows.push(ins.run(nextCode('SCH', 'payment_schedule'), sale_id, reservation_id, contract_id, client_id, unit_id, project_id, seq, `${labelPrefix} ${i}`, due, amt, 0, due <= today() ? 'due' : 'upcoming', user?.id || null).lastInsertRowid);
  }
  if (sale_id) applyPaymentToSchedule(sale_id);
  pushAudit(user, 'create', 'schedule', 'payment_schedule', sale_id, `توليد ${rows.length} استحقاق — إجمالي ${r2(num(paid) + remaining)}`);
  return { rows: rows.length, remaining, installments: n };
}

module.exports = {
  num, r2, today, nowStr, METHODS, nextCode, setting,
  notifyUser, notifyRole, pushAudit,
  defaultAccountId, recomputeAccount, postTxn,
  saleTotals, reservationTotals, applyPaymentToSchedule, refreshScheduleStatuses,
  createPayment, linkDepositToSale, executeRefund, cancelSale, cancelReservation,
  setUnitStatus, canApprove, raiseApproval, decideApproval, gate, registerApprovalExecutor, EXECUTORS,
  projectTotals, clientStatement, generateSchedule
};
