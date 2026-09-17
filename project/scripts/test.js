// Smart Secretary — QA suite (backend + logic). Run: npm test
const BASE = process.env.API || 'http://127.0.0.1:3847/api';
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ FAIL ') + n); };
async function req(path, opts = {}, token) {
  const r = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const ct = r.headers.get('content-type') || '';
  const d = ct.includes('json') ? await r.json() : await r.text();
  return { s: r.status, d };
}
(async () => {
  console.log('— Smart Secretary QA —');
  const h = await req('/health');
  ok('health', h.s === 200);

  // دخول
  const bad = await req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
  ok('reject wrong password', bad.s === 401);
  const admin = await req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  ok('admin login', admin.s === 200 && !!admin.d.token);
  const T = admin.d.token;
  const sara = await req('/auth/login', { method: 'POST', body: { username: 'sara', password: 'sara1234' } });
  ok('sara login', sara.s === 200);
  const ST = sara.d.token;
  const me = await req('/auth/me', {}, T);
  ok('me + perms', me.s === 200 && me.d.perms['tasks:create']);

  // صلاحيات: سكرتيرة لا تحذف مستخدمين
  const denied = await req('/users/2', { method: 'DELETE' }, ST);
  ok('backend denies sara deleting users', denied.s === 403);
  // بدون توكن
  const noAuth = await req('/tasks');
  ok('auth required', noAuth.s === 401);

  // عملاء CRUD
  const c1 = await req('/clients', { method: 'POST', body: { code: 'C-QA-' + Date.now(), name: 'عميل اختبار', phone: '0550000000' } }, T);
  ok('client create', c1.s === 201);
  const cid = c1.d.id;
  ok('client get', (await req('/clients/' + cid, {}, T)).s === 200);
  ok('client update', (await req('/clients/' + cid, { method: 'PUT', body: { phone: '0550000001' } }, T)).s === 200);
  ok('client timeline', (await req(`/clients/${cid}/timeline`, {}, T)).s === 200);

  // مهام + حالات
  const t1 = await req('/tasks', { method: 'POST', body: { title: 'مهمة QA', priority: 'high', status: 'new', client_id: cid, assignee_id: 4 } }, T);
  ok('task create', t1.s === 201);
  const tid = t1.d.id;
  ok('task status → in_progress', (await req(`/tasks/${tid}/status`, { method: 'PUT', body: { status: 'in_progress' } }, T)).s === 200);
  ok('task comment', (await req(`/tasks/${tid}/comments`, { method: 'POST', body: { body: 'تعليق اختبار' } }, T)).s === 201);
  ok('task status invalid rejected', (await req(`/tasks/${tid}/status`, { method: 'PUT', body: { status: 'nope' } }, T)).s === 400);

  // مواعيد
  const a1 = await req('/appointments', { method: 'POST', body: { title: 'موعد QA', date: '2026-09-20', start_time: '10:00', end_time: '10:30', client_id: cid } }, T);
  ok('appointment create', a1.s === 201);

  // اتصال + تحويل
  const k1 = await req('/calls', { method: 'POST', body: { contact_name: 'متصل QA', phone: '0551110000', direction: 'in', started_at: '2026-09-17 09:00', client_id: cid, user_id: 1 } }, T);
  ok('call create', k1.s === 201);
  const conv = await req(`/calls/${k1.d.id}/convert`, { method: 'POST', body: { to: 'task', title: 'متابعة QA' } }, T);
  ok('call → task', conv.s === 200 && !!conv.d.task_id);

  // ملاحظات
  const n1 = await req('/notes', { method: 'POST', body: { title: 'ملاحظة QA', body: 'نص', tags: '["qa"]', user_id: 1 } }, T);
  ok('note create', n1.s === 201);

  // بحث شامل
  const sr = await req('/search?q=' + encodeURIComponent('عميل اختبار'), {}, T);
  ok('global search finds client', sr.s === 200 && sr.d.groups.some(g => g.key === 'clients'));

  // لوحة القيادة
  const dash = await req('/dashboard', {}, T);
  ok('dashboard aggregates', dash.s === 200 && dash.d.stats && Array.isArray(dash.d.focus));

  // إشعارات
  const nt = await req('/notifications?limit=5', {}, T);
  ok('notifications list', nt.s === 200 && typeof nt.d.unread === 'number');

  // مشاريع ووحدات
  const projs = await req('/projects?limit=20', {}, T);
  ok('projects 101-108 exist', projs.s === 200 && projs.d.data.length >= 8);
  const units = await req('/units?limit=5&status=available', {}, T);
  ok('units available', units.s === 200 && units.d.data.length > 0);
  const unit = units.d.data[0];

  // حجز: قيم غير منطقية مرفوضة
  const badRes = await req('/reservations', { method: 'POST', body: { unit_id: unit.id, client_id: cid, price: unit.price, discount: unit.price + 1, deposit: 0, reservation_date: '2026-09-17' } }, T);
  ok('reject discount > price', badRes.s === 400);
  const res = await req('/reservations', { method: 'POST', body: { unit_id: unit.id, client_id: cid, price: unit.price, discount: 1000, deposit: 5000, reservation_date: '2026-09-17', expiry_date: '2026-09-24' } }, T);
  ok('reservation create', res.s === 201);
  const uAfter = await req('/units?limit=200', {}, T);
  ok('unit becomes reserved', uAfter.d.data.find(u => u.id === unit.id)?.status === 'reserved');
  // حجز مكرر مرفوض
  const dupRes = await req('/reservations', { method: 'POST', body: { unit_id: unit.id, client_id: cid, price: unit.price, reservation_date: '2026-09-17' } }, T);
  ok('reject double booking', dupRes.s === 400);
  // إلغاء بقيم غير منطقية مرفوض
  const badCancel = await req(`/reservations/${res.d.id}/cancel`, { method: 'POST', body: { cancel_reason: 'x', refund_amount: 99999999, deducted_amount: 0 } }, T);
  ok('reject refund > deposit', badCancel.s === 400);

  // تحويل لبيع + حسابات تلقائية
  const sale = await req('/sales', { method: 'POST', body: { reservation_id: res.d.id, sale_price: unit.price, discount: 1000, down_payment: 5000, commission: 5000, sale_date: '2026-09-17' } }, T);
  ok('sale from reservation', sale.s === 201);
  ok('net = price - discount', sale.d.net_price === unit.price - 1000);
  ok('settlement = net - commission', sale.d.settlement === unit.price - 1000 - 5000);
  const sFull = await req('/sales/' + sale.d.id, {}, T);
  ok('sale detail + invoice', sFull.s === 200 && !!sFull.d.invoice);
  // دفعة تتجاوز المتبقي مرفوضة
  const over = await req(`/sales/${sale.d.id}/payments`, { method: 'POST', body: { amount: sFull.d.remaining + 100, paid_at: '2026-09-17' } }, T);
  ok('reject overpayment', over.s === 400);
  const pay1 = await req(`/sales/${sale.d.id}/payments`, { method: 'POST', body: { amount: 1000, method: 'cash', paid_at: '2026-09-17' } }, T);
  ok('payment ok', pay1.s === 201);
  const fin = await req('/finance/summary', {}, T);
  ok('finance summary', fin.s === 200 && fin.d.sales.n >= 1);

  // تقارير + إكسل
  const rep = await req('/reports/sales', {}, T);
  ok('report data + meta', rep.s === 200 && rep.d.meta.no && rep.d.rows.length >= 1);
  const xl = await fetch(BASE + '/reports/sales/excel', { headers: { Authorization: 'Bearer ' + T } });
  ok('excel export', xl.status === 200 && (xl.headers.get('content-type') || '').includes('spreadsheet'));

  // مساعد ذكي
  const as1 = await req('/assistant', { method: 'POST', body: { text: 'ما هي مهامي اليوم؟' } }, T);
  ok('assistant tasks', as1.s === 200 && !!as1.d.reply);
  const as2 = await req('/assistant', { method: 'POST', body: { text: 'أضف مهمة اختبار المساعد' } }, T);
  ok('assistant asks confirm', as2.s === 200 && !!as2.d.pending);
  const as3 = await req('/assistant', { method: 'POST', body: { text: '', confirmed: true, pending: as2.d.pending } }, T);
  ok('assistant creates after confirm', as3.s === 200 && as3.d.reply.includes('تم إنشاء'));

  // نسخ احتياطي
  const bk = await req('/backup', { method: 'POST' }, T);
  ok('backup create', bk.s === 201);
  ok('backup list', (await req('/backup', {}, T)).d.data.length >= 1);
  // صلاحية النسخ للسكرتيرة مرفوضة
  ok('sara denied backup', (await req('/backup', { method: 'POST' }, ST)).s === 403);

  // سجل التدقيق
  const au = await req('/audit?limit=5', {}, T);
  ok('audit has entries', au.s === 200 && au.d.data.length > 0);

  // تنظيف بيانات QA
  await req('/tasks/' + tid, { method: 'DELETE' }, T);
  await req('/clients/' + cid, { method: 'DELETE' }, T);
  ok('cleanup ok', true);

  console.log(`\nالنتيجة: ${pass} ناجح / ${fail} فاشل`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('QA crashed:', e); process.exit(1); });
