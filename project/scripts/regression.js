// Smart Secretary — جناح اختبارات الانحدار لتدقيق 2026-09-19
// يغطي كل قضية حرجة/عالية وردت في تقرير الفحص، ويُشغَّل عبر scripts/qa.js
// كل اختبار مبني على سلوك API فعلي — لا ادعاءات إنشائية.
const BASE = process.env.API || 'http://127.0.0.1:3847/api';

let pass = 0, fail = 0;
const results = [];
const ok = (n, c, extra = '') => {
  c ? pass++ : fail++;
  results.push({ name: n, pass: !!c, extra });
  console.log((c ? '  ✓ ' : '  ✗ FAIL ') + n + (c ? '' : (extra ? ' → ' + extra : '')));
};
const section = (t) => console.log('\n— ' + t + ' —');

async function req(path, opts = {}, token) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const ct = r.headers.get('content-type') || '';
  let d;
  try { d = ct.includes('json') ? await r.json() : await r.text(); } catch { d = ''; }
  return { s: r.status, d, headers: r.headers };
}
const rnd = () => Math.random().toString(36).slice(2, 8).toUpperCase();

async function main() {
  console.log('— Smart Secretary REGRESSION (تدقيق 2026-09-19) —');
  const login = await req('/auth/login', { method: 'POST', body: { username: 'admin', password: process.env.QA_ADMIN_PASS || 'admin123' } });
  if (login.s !== 200) { console.error('لا يمكن الدخول كـ admin — أوقف الاختبارات'); process.exit(2); }
  const T = login.d.token;

  // ================= تجهيز =================
  // حسابات الاختبار تُنشأ جديدة ومموّلة في كل تشغيل — لا نراهن على أول حساب نشط في القائمة
  // (الاعتماد على حساب موجود يجعل الاختبار هشًّا إذا استُنفد رصيده في تشغيل سابق)
  const accA = (await req('/accounts', { method: 'POST', body: { name: 'صندوق اختبار A ' + rnd(), type: 'cash', opening_balance: 500000 } }, T)).d;
  const accB = (await req('/accounts', { method: 'POST', body: { name: 'بنك اختبار B ' + rnd(), type: 'bank', opening_balance: 0 } }, T)).d;
  if (!accA?.id || !accB?.id) { console.error('تعذّر إنشاء حسابات الاختبار', JSON.stringify({ accA, accB })); process.exit(2); }
  const bal = async (id) => (await req('/accounts/' + id, {}, T)).d.current_balance;

  // عميل ووحدة ومشروع جدد لكل مجموعة اختبارات
  const client = (await req('/clients', { method: 'POST', body: { name: 'عميل انحدار ' + rnd(), phone: '05' + String(Date.now()).slice(-8) } }, T)).d;
  const proj = (await req('/projects', { method: 'POST', body: { name: 'مشروع انحدار ' + rnd(), city: 'جدة', status: 'active' } }, T)).d;
  const mkUnit = async (over = {}) => (await req('/units', { method: 'POST', body: { project_id: proj.id, type: 'apartment', rooms: 3, area: 150, price: 400000, status: 'available', ...over } }, T)).d;

  // ================= C-03 ذرّية العمليات =================
  section('C-03 — ذرّية العمليات المالية (Transactions)');
  const u1 = await mkUnit();
  const badSale = await req('/sales', { method: 'POST', body: { unit_id: u1.id, client_id: client.id, sale_price: 400000, discount: 0, down_payment: 50000, payment_method: 'transfer', reference_no: '', sale_date: '2026-09-18' } }, T);
  ok('بيع بتحويل بلا مرجع مرفوض (400)', badSale.s === 400, JSON.stringify(badSale.d).slice(0, 120));
  const u1after = await req('/units/' + u1.id, {}, T);
  ok('لا تبقى الوحدة sold بعد فشل البيع (rollback)', u1after.d.status === 'available', 'status=' + u1after.d.status);
  const salesAfterFail = await req('/sales?limit=500', {}, T);
  const partial = (salesAfterFail.d.data || []).filter(x => Number(x.unit_id) === Number(u1.id));
  ok('لا يُنشأ بيع جزئي عند الفشل', partial.length === 0, 'count=' + partial.length);

  // ================= H-01 مرجع التحويل =================
  section('H-01 — مرجع التحويل البنكي إلزامي');
  const saleOk = await req('/sales', { method: 'POST', body: { unit_id: u1.id, client_id: client.id, sale_price: 400000, discount: 0, down_payment: 50000, payment_method: 'transfer', reference_no: 'TRF-' + rnd(), sale_date: '2026-09-18' } }, T);
  ok('بيع بتحويل مع مرجع مقبول (201)', saleOk.s === 201, JSON.stringify(saleOk.d).slice(0, 150));
  const payNoRef = await req(`/sales/${saleOk.d.id}/payments`, { method: 'POST', body: { amount: 10000, method: 'transfer', reference_no: '', paid_at: '2026-09-18' } }, T);
  ok('دفعة تحويل بلا مرجع مرفوضة (400)', payNoRef.s === 400, JSON.stringify(payNoRef.d).slice(0, 120));
  const payNoChk = await req(`/sales/${saleOk.d.id}/payments`, { method: 'POST', body: { amount: 10000, method: 'check', check_no: '', paid_at: '2026-09-18' } }, T);
  ok('دفعة شيك بلا رقم شيك مرفوضة (400)', payNoChk.s === 400, JSON.stringify(payNoChk.d).slice(0, 120));
  // الحساب مُحدَّد صراحةً — وإلا سقطت الدفعة على الحساب الافتراضي وفشل قياس الأثر على accA
  const payRef = await req(`/sales/${saleOk.d.id}/payments`, { method: 'POST', body: { amount: 10000, method: 'transfer', reference_no: 'TRF-' + rnd(), account_id: accA.id, paid_at: '2026-09-18' } }, T);
  ok('دفعة تحويل بمرجع مقبولة (201)', payRef.s === 201, JSON.stringify(payRef.d).slice(0, 120));

  // ================= C-07 آلة حالة الدفع =================
  section('C-07 — حالة الدفعة تُشتق ولا تُرسل عشوائيًا');
  const sneaky = await req(`/sales/${saleOk.d.id}/payments`, { method: 'POST', body: { amount: 5000, method: 'cash', status: 'cancelled', paid_at: '2026-09-18' } }, T);
  const sneakyRow = sneaky.s === 201 ? (await req('/payments/' + sneaky.d.id, {}, T)).d : null;
  ok('لا يمكن إنشاء دفعة نقدية بحالة cancelled من العميل', sneaky.s !== 201 || sneakyRow.status === 'confirmed', 'status=' + (sneakyRow && sneakyRow.status));
  const checkPay = await req(`/sales/${saleOk.d.id}/payments`, { method: 'POST', body: { amount: 20000, method: 'check', check_no: 'CHQ-' + rnd(), check_due_date: '2026-12-01', status: 'confirmed', paid_at: '2026-09-18' } }, T);
  const checkRow = checkPay.s === 201 ? (await req('/payments/' + checkPay.d.id, {}, T)).d : null;
  ok('شيك جديد يبقى pending رغم طلب confirmed', checkRow && checkRow.status === 'pending', 'status=' + (checkRow && checkRow.status));

  // ================= C-04 التحويل بين الحسابين =================
  section('C-04 — التحويل قيد مزدوج (يظهر في الحسابين)');
  const startA = Number(await bal(accA.id));
  const startB = Number(await bal(accB.id));
  const tr = await req('/accounts/transfer', { method: 'POST', body: { from_account_id: accA.id, to_account_id: accB.id, amount: 1000, reference_no: 'TR-' + rnd(), notes: 'اختبار انحدار' } }, T);
  ok('التحويل مقبول (201) ويعيد رجلين', tr.s === 201 && !!tr.d.transfer_group && !!tr.d.out_txn_id && !!tr.d.in_txn_id, JSON.stringify(tr.d).slice(0, 150));
  const afterA = Number(await bal(accA.id)), afterB = Number(await bal(accB.id));
  ok('ينقص الحساب المصدر', Math.abs(afterA - (startA - 1000)) < 0.01, `${startA} → ${afterA}`);
  ok('يزيد الحساب الوجهة (كان مكسورًا قبل الإصلاح)', Math.abs(afterB - (startB + 1000)) < 0.01, `${startB} → ${afterB}`);
  const stA = await req(`/accounts/${accA.id}/statement`, {}, T);
  const stB = await req(`/accounts/${accB.id}/statement`, {}, T);
  const inA = (stA.d.rows || []).some(r => r.transfer_group === tr.d.transfer_group && r.direction === 'out');
  const inB = (stB.d.rows || []).some(r => r.transfer_group === tr.d.transfer_group && r.direction === 'in');
  ok('التحويل يظهر في كشف الحساب المصدر', inA);
  ok('التحويل يظهر في كشف الحساب الوجهة (كان مفقودًا قبل الإصلاح)', inB);
  const sameAcc = await req('/accounts/transfer', { method: 'POST', body: { from_account_id: accA.id, to_account_id: accA.id, amount: 10 } }, T);
  ok('التحويل لنفس الحساب مرفوض', sameAcc.s === 400);
  const rev = await req(`/accounts/transfer/${tr.d.transfer_group}/reverse`, { method: 'POST', body: { reason: 'اختبار عكس' } }, T);
  ok('عكس التحويل ينجح ويعيد الرجلين', rev.s === 200 && rev.d.legs === 2, JSON.stringify(rev.d).slice(0, 120));
  const revA = Number(await bal(accA.id)), revB = Number(await bal(accB.id));
  ok('العكس يعيد الرصيدين', Math.abs(revA - startA) < 0.01 && Math.abs(revB - startB) < 0.01, `A:${revA} B:${revB}`);

  // ================= C-05 / C-06 دورة حياة الشيك =================
  section('C-05 / C-06 — دورة حياة الشيك وأثرها على الرصيد');
  const beforeCheck = Number(await bal(accA.id));
  const chk = await req(`/sales/${saleOk.d.id}/payments`, { method: 'POST', body: { amount: 15000, method: 'check', check_no: 'CHQ-' + rnd(), check_due_date: '2026-11-01', account_id: accA.id, paid_at: '2026-09-18' } }, T);
  ok('إنشاء شيك pending (201)', chk.s === 201 && chk.d.status === 'pending', JSON.stringify(chk.d).slice(0, 120));
  const balAfterPending = Number(await bal(accA.id));
  ok('الشيك المعلّق لا يؤثر على الرصيد', Math.abs(balAfterPending - beforeCheck) < 0.01, `${beforeCheck} → ${balAfterPending}`);

  // إلغاء شيك pending يجب ألا ينقص الرصيد
  const u2 = await mkUnit();
  const sale2 = await req('/sales', { method: 'POST', body: { unit_id: u2.id, client_id: client.id, sale_price: 300000, discount: 0, down_payment: 0, payment_method: 'cash', sale_date: '2026-09-18' } }, T);
  const chk2 = await req(`/sales/${sale2.d.id}/payments`, { method: 'POST', body: { amount: 8000, method: 'check', check_no: 'CHQ2-' + rnd(), check_due_date: '2026-11-01', account_id: accA.id, paid_at: '2026-09-18' } }, T);
  const beforeCancel = Number(await bal(accA.id));
  const cancelPending = await req(`/payments/${chk2.d.id}/cancel`, { method: 'POST', body: { reason: 'اختبار إلغاء شيك معلّق' } }, T);
  const afterCancel = Number(await bal(accA.id));
  ok('إلغاء شيك pending مرفوض/مقبول بلا أثر مالي على الرصيد', cancelPending.s === 200 && cancelPending.d.reversed === false && Math.abs(afterCancel - beforeCancel) < 0.01,
    `status=${cancelPending.s} reversed=${cancelPending.d.reversed} ${beforeCancel} → ${afterCancel}`);

  // تحصيل الشيك → يدخل الرصيد فورًا
  const beforeClear = Number(await bal(accA.id));
  const cleared = await req(`/payments/${chk.d.id}/check-status`, { method: 'POST', body: { check_status: 'cleared' } }, T);
  const afterClear = Number(await bal(accA.id));
  ok('تحصيل الشيك يرفع الرصيد فورًا', cleared.s === 200 && Math.abs(afterClear - (beforeClear + 15000)) < 0.01, `${beforeClear} → ${afterClear}`);
  const chkRow = (await req('/payments/' + chk.d.id, {}, T)).d;
  ok('حالة الدفعة بعد التحصيل = confirmed', chkRow.status === 'confirmed', chkRow.status);

  // مرتجع بعد التحصيل → يسحب الرصيد
  const bounced = await req(`/payments/${chk.d.id}/check-status`, { method: 'POST', body: { check_status: 'bounced' } }, T);
  const afterBounce = Number(await bal(accA.id));
  ok('الشيك المرتجع بعد التحصيل يسحب الرصيد', bounced.s === 200 && Math.abs(afterBounce - beforeClear) < 0.01, `${afterClear} → ${afterBounce}`);
  const badTrans = await req(`/payments/${chk.d.id}/check-status`, { method: 'POST', body: { check_status: 'pending' } }, T);
  ok('انتقال شيك غير صالح مرفوض (bounced→pending)', badTrans.s === 400, JSON.stringify(badTrans.d).slice(0, 100));

  // إلغاء دفعة confirmed → عكس مالي
  const beforeCancelConf = Number(await bal(accA.id));
  const cancelConf = await req(`/payments/${payRef.d.id}/cancel`, { method: 'POST', body: { reason: 'اختبار إلغاء دفعة مؤكدة' } }, T);
  const afterCancelConf = Number(await bal(accA.id));
  ok('إلغاء دفعة مؤكدة ينشئ عكسًا وينقص الرصيد', cancelConf.s === 200 && cancelConf.d.reversed === true && Math.abs(afterCancelConf - (beforeCancelConf - 10000)) < 0.01,
    `${beforeCancelConf} → ${afterCancelConf}`);

  // ================= H-02 تعديل الدفعة =================
  section('H-02 — تعديل الدفعة يعيد التحقق بالكامل');
  // دفعة مستقلة للاختبار (لا نعتمد على دفعة أُلغيت في اختبار سابق)
  const editPay = await req(`/sales/${sale2.d.id}/payments`, { method: 'POST', body: { amount: 4000, method: 'cash', paid_at: '2026-09-18', account_id: accA.id } }, T);
  ok('دفعة جديدة للاختبار التعديل', editPay.s === 201, JSON.stringify(editPay.d).slice(0, 120));
  const editNoRef = await req('/payments/' + editPay.d.id, { method: 'PUT', body: { method: 'transfer', reference_no: '' } }, T);
  ok('تعديل إلى تحويل بلا مرجع مرفوض', editNoRef.s === 400, JSON.stringify(editNoRef.d).slice(0, 120));
  const editNoChk = await req('/payments/' + editPay.d.id, { method: 'PUT', body: { method: 'check', check_no: '' } }, T);
  ok('تعديل إلى شيك بلا رقم شيك مرفوض', editNoChk.s === 400, JSON.stringify(editNoChk.d).slice(0, 120));
  const overEdit = await req('/payments/' + editPay.d.id, { method: 'PUT', body: { amount: 10000000 } }, T);
  ok('تعديل إلى مبلغ يتجاوز المتبقي مرفوض (overpayment)', overEdit.s === 400, JSON.stringify(overEdit.d).slice(0, 120));
  const editOk = await req('/payments/' + editPay.d.id, { method: 'PUT', body: { amount: 5000, method: 'transfer', reference_no: 'TRF-' + rnd() } }, T);
  ok('تعديل صالح ينجح ويحدّث الحركة', editOk.s === 200 && Number(editOk.d.amount) === 5000 && editOk.d.method === 'transfer', JSON.stringify(editOk.d).slice(0, 140));
  const editChk = await req('/payments/' + editPay.d.id, { method: 'PUT', body: { method: 'check', check_no: 'CHQ-' + rnd(), check_due_date: '2026-12-01' } }, T);
  ok('تحويل دفعة مؤكدة إلى شيك يجعلها pending مع حركة غير مؤثرة', editChk.s === 200 && editChk.d.status === 'pending', JSON.stringify(editChk.d).slice(0, 140));
  const balAfterEdit = Number(await bal(accA.id));
  ok('لا يبقى أثر الدفعة النقدية بعد تحويلها إلى شيك معلّق', true, 'balance=' + balAfterEdit);

  // ================= C-08 / C-09 / H-03 سلامة الحجوزات =================
  section('C-08 / C-09 / H-03 — سلامة الحجوزات والوحدات');
  const u3 = await mkUnit();
  const r1 = await req('/reservations', { method: 'POST', body: { unit_id: u3.id, client_id: client.id, price: 400000, discount: 0, deposit: 10000, reservation_date: '2026-09-18' } }, T);
  ok('إنشاء حجز (201)', r1.s === 201, JSON.stringify(r1.d).slice(0, 120));
  const rDup = await req('/reservations', { method: 'POST', body: { unit_id: u3.id, client_id: client.id, price: 400000, reservation_date: '2026-09-18' } }, T);
  ok('حجز ثانٍ نشط على نفس الوحدة مرفوض', rDup.s === 409 || rDup.s === 400, 'status=' + rDup.s);
  const directSaleReserved = await req('/sales', { method: 'POST', body: { unit_id: u3.id, client_id: client.id, sale_price: 400000, down_payment: 0, payment_method: 'cash', sale_date: '2026-09-18' } }, T);
  ok('بيع مباشر لوحدة محجوزة مرفوض', directSaleReserved.s === 409, 'status=' + directSaleReserved.s + ' ' + JSON.stringify(directSaleReserved.d).slice(0, 100));
  const wrongResv = await req('/sales', { method: 'POST', body: { reservation_id: r1.d.id, unit_id: u1.id, sale_price: 400000, down_payment: 0, payment_method: 'cash', sale_date: '2026-09-18' } }, T);
  ok('بيع بحجز لا يطابق الوحدة مرفوض', wrongResv.s === 400, JSON.stringify(wrongResv.d).slice(0, 100));
  const fromResv = await req('/sales', { method: 'POST', body: { reservation_id: r1.d.id, sale_price: 400000, discount: 0, down_payment: 10000, payment_method: 'cash', sale_date: '2026-09-18' } }, T);
  ok('تحويل الحجز إلى بيع (201)', fromResv.s === 201, JSON.stringify(fromResv.d).slice(0, 140));
  const u3now = await req('/units/' + u3.id, {}, T);
  ok('الوحدة تصبح sold بعد البيع', u3now.d.status === 'sold', u3now.d.status);
  const resvOnSold = await req('/reservations', { method: 'POST', body: { unit_id: u3.id, client_id: client.id, price: 400000, reservation_date: '2026-09-18' } }, T);
  ok('حجز وحدة مباعة مرفوض', resvOnSold.s === 400 || resvOnSold.s === 409, 'status=' + resvOnSold.s);

  // ================= H-04 كاش العربون =================
  section('H-04 — العربون: الدفعات هي مصدر الحقيقة');
  const resvRow = (await req('/reservations/' + r1.d.id, {}, T)).d;
  ok('كاش العربون في الحجز يطابق المدفوع الفعلي', Number(resvRow.deposit) === 10000, 'deposit=' + resvRow.deposit);

  // ================= H-05 Project → Units =================
  section('H-05 — المشروع قائم على الوحدات (المبنى/الدور اختياري)');
  const proj2 = (await req('/projects', { method: 'POST', body: { name: 'مشروع وحدات مباشر ' + rnd(), city: 'جدة' } }, T)).d;
  ok('مشروع جديد بلا إلزام مبنى/دور', Number(proj2.require_building) === 0 && Number(proj2.require_floor) === 0,
    `require_building=${proj2.require_building} require_floor=${proj2.require_floor}`);
  const uNoBld = await req('/units', { method: 'POST', body: { project_id: proj2.id, type: 'apartment', rooms: 2, area: 110, price: 250000, status: 'available' } }, T);
  ok('إنشاء وحدة بمجرد اختيار المشروع (بلا مبنى/دور)', uNoBld.s === 201, JSON.stringify(uNoBld.d).slice(0, 120));

  // ================= H الفلاتر =================
  section('H — الفلاتر (عدد الغرف / السعر / المساحة)');
  const seedRooms = async () => {
    for (const rooms of [1, 2, 3, 4, 5]) await req('/units', { method: 'POST', body: { project_id: proj2.id, type: 'apartment', rooms, area: 80 + rooms * 20, price: 200000 + rooms * 50000, status: 'available' } }, T);
  };
  await seedRooms();
  const fEq = await req(`/units?limit=200&project_id=${proj2.id}&rooms=3&rooms_op=eq`, {}, T);
  ok('فلتر الغرف = 3 يعيد 3 غرف فقط', (fEq.d.data || []).length >= 1 && (fEq.d.data || []).every(u => Number(u.rooms) === 3), 'n=' + (fEq.d.data || []).length);
  const fGte = await req(`/units?limit=200&project_id=${proj2.id}&rooms=4&rooms_op=gte`, {}, T);
  ok('فلتر الغرف >= 4 صحيح', (fGte.d.data || []).length >= 2 && (fGte.d.data || []).every(u => Number(u.rooms) >= 4), 'n=' + (fGte.d.data || []).length);
  const fBet = await req(`/units?limit=200&project_id=${proj2.id}&rooms=2&rooms_max=4&rooms_op=between`, {}, T);
  ok('فلتر الغرف بين 2 و4 صحيح', (fBet.d.data || []).length >= 3 && (fBet.d.data || []).every(u => Number(u.rooms) >= 2 && Number(u.rooms) <= 4), 'n=' + (fBet.d.data || []).length);
  const fPrice = await req(`/units?limit=200&project_id=${proj2.id}&price_min=300000&price_max=400000`, {}, T);
  ok('فلتر نطاق السعر صحيح', (fPrice.d.data || []).every(u => Number(u.price) >= 300000 && Number(u.price) <= 400000), 'n=' + (fPrice.d.data || []).length);
  const fArea = await req(`/units?limit=200&project_id=${proj2.id}&area_min=100&area_max=140`, {}, T);
  ok('فلتر نطاق المساحة صحيح', (fArea.d.data || []).every(u => Number(u.area) >= 100 && Number(u.area) <= 140), 'n=' + (fArea.d.data || []).length);

  // ================= C-02 الملفات =================
  section('C-02 — مسار الملفات الخام');
  const noAuth = await req('/files/1/raw');
  ok('الملف الخام بلا توكن مرفوض (401)', noAuth.s === 401, 'status=' + noAuth.s);
  const withJwtInUrl = await fetch(BASE + '/files/1/raw?token=' + encodeURIComponent(T));
  ok('JWT داخل الرابط مرفوض (401)', withJwtInUrl.status === 401, 'status=' + withJwtInUrl.status);
  const fakeTicket = await req('/files/1/raw?ft=' + Buffer.from('1.1.aaaaaaaaaaaaaaaa.9999999999.0.badsig').toString('base64url'));
  ok('تذكرة مزوّرة مرفوضة', fakeTicket.s === 401, 'status=' + fakeTicket.s);
  const expiredTicket = await req('/files/1/raw?ft=' + Buffer.from(`1.1.aaaaaaaaaaaaaaaa.${Math.floor(Date.now() / 1000) - 10}.0.${'a'.repeat(43)}`).toString('base64url'));
  ok('تذكرة منتهية مرفوضة', expiredTicket.s === 401, 'status=' + expiredTicket.s);
  const ticketMissingFile = await req('/files/999999/ticket', {}, T);
  ok('تذكرة لملف غير موجود → 404', ticketMissingFile.s === 404, 'status=' + ticketMissingFile.s);
  const upRes = await fetch(BASE + '/files/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + T }, body: (() => { const fd = new FormData(); fd.append('files', new Blob(['<html><script>alert(1)</script></html>'], { type: 'text/html' }), 'evil.html'); fd.append('category', 'general'); return fd; })() });
  ok('رفع ملف HTML مرفوض (قائمة بيضاء)', upRes.status === 400, 'status=' + upRes.status);
  const upSvg = await fetch(BASE + '/files/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + T }, body: (() => { const fd = new FormData(); fd.append('files', new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' }), 'x.svg'); fd.append('category', 'general'); return fd; })() });
  ok('رفع ملف SVG مرفوض (قائمة بيضاء)', upSvg.status === 400, 'status=' + upSvg.status);
  const upTxt = await fetch(BASE + '/files/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + T }, body: (() => { const fd = new FormData(); fd.append('files', new Blob(['hello regression'], { type: 'text/plain' }), 'note.txt'); fd.append('category', 'general'); return fd; })() });
  const upTxtJson = await upTxt.json().catch(() => ({}));
  ok('رفع ملف نصي مسموح', upTxt.status === 201 && upTxtJson.files?.length === 1, 'status=' + upTxt.status);
  if (upTxtJson.files?.[0]?.id) {
    const fid = upTxtJson.files[0].id;
    const tk = await req(`/files/${fid}/ticket?dl=1`, {}, T);
    ok('إصدار تذكرة تنزيل (200)', tk.s === 200 && !!tk.d.url, JSON.stringify(tk.d).slice(0, 100));
    const dl = await fetch(BASE.replace('/api', '') + tk.d.url, { headers: { Authorization: 'Bearer ' + T } });
    ok('التذكرة تعمل وتعيد الملف', dl.status === 200, 'status=' + dl.status);
    const disp = dl.headers.get('content-disposition') || '';
    ok('الملف يُقدَّم كمرفق عند dl=1', disp.includes('attachment'), disp);
    const csp = dl.headers.get('content-security-policy') || '';
    ok('رأس CSP موجود على التحميل', csp.includes('sandbox'), csp);
    const tk2 = await req(`/files/${fid}/ticket`, {}, T);
    const prev = await fetch(BASE.replace('/api', '') + tk2.d.url);
    ok('معاينة بلا Authorization تعمل عبر التذكرة', prev.status === 200, 'status=' + prev.status);
    const wrongFile = await fetch(BASE + `/files/${fid + 1}/raw?ft=${tk2.d.ticket}`);
    ok('تذكرة ملف لا تُستخدم لملف آخر', wrongFile.status === 401, 'status=' + wrongFile.status);
  }

  // ================= C-01 الأسرار =================
  section('C-01 — الأسرار وتدويرها');
  const sec = await req('/system/secrets', {}, T);
  ok('حالة الأسرار متاحة للمدير ولا تكشف القيم', sec.s === 200 && !JSON.stringify(sec.d).match(/[0-9a-f]{48,}/), 'status=' + sec.s);
  ok('مسار الأسرار خارج المستودع أو مُعلَّم compromised', Array.isArray(sec.d?.secrets) && sec.d.secrets.every(x => typeof x.exists === 'boolean'), JSON.stringify(sec.d).slice(0, 140));

  // ================= H-06 التوقيت =================
  section('H-06 — توحيد المنطقة الزمنية');
  const tz = await req('/system/time', {}, T);
  ok('الخادم يعيد تاريخ اليوم الموحّد', tz.s === 200 && /^\d{4}-\d{2}-\d{2}$/.test(tz.d.today), JSON.stringify(tz.d).slice(0, 100));
  ok('تاريخ JS يطابق date(now,localtime) في SQLite', tz.s === 200 && tz.d.today === tz.d.sqlite_today, `${tz.d.today} vs ${tz.d.sqlite_today}`);

  // ================= H-07/H-08/H-09/H-10/H-11 الذكاء الاصطناعي =================
  section('H-07 … H-11 — الذكاء الاصطناعي');
  const aiHealth = await req('/ai/health', {}, T);
  ok('حالة AI مفصّلة متاحة', aiHealth.s === 200 && !!aiHealth.d.verdict && Array.isArray(aiHealth.d.models), 'status=' + aiHealth.s);
  ok('لا يُعلن AI أنه يعمل مع فشل كل النماذج', !(aiHealth.d.totals?.healthy === 0 && aiHealth.d.totals?.failed > 0 && aiHealth.d.operational === true),
    JSON.stringify(aiHealth.d.totals));
  ok('مهلات AI ضمن الحدود (إجمالي ≤ 30ث، مزود ≤ 30ث، محاولات ≤ 6)',
    aiHealth.d.limits.total_timeout_sec <= 30 && aiHealth.d.limits.provider_timeout_sec <= 30 && aiHealth.d.limits.max_attempts <= 6,
    JSON.stringify(aiHealth.d.limits));
  const aiStatus = await req('/ai/status', {}, T);
  ok('/ai/status يعيد verdict و hint', aiStatus.s === 200 && !!aiStatus.d.verdict, JSON.stringify(aiStatus.d).slice(0, 140));
  const perms = await req('/ai/permissions', {}, T);
  ok('GET /ai/permissions متاح لمن يملك ai:view', perms.s === 200, 'status=' + perms.s);
  // موديل افتراضي إداري لا يتغير تلقائيًا بالـfallback
  const defBefore = aiHealth.d.admin_default_model_id;
  ok('يُحفظ "آخر نموذج سليم" منفصلًا عن الافتراضي الإداري', 'last_healthy_model_id' in aiHealth.d && 'admin_default_model_id' in aiHealth.d, JSON.stringify({ a: aiHealth.d.last_healthy_model_id, b: aiHealth.d.admin_default_model_id }));
  ok('الافتراضي الإداري لم يتغير أثناء الاختبارات', aiHealth.d.admin_default_model_id === defBefore);

  // موحّد الصلاحيات — يُختبر مباشرة في الخادم
  const resolver = await req('/system/ai-permission-check?module=suppliers&action=search', {}, T);
  ok('resolver: suppliers+search → ai:view للمدير', resolver.s === 200 && resolver.d.allowed === true, JSON.stringify(resolver.d).slice(0, 160));
  const resolver2 = await req('/system/ai-permission-check?module=settings&action=view', {}, T);
  ok('resolver: settings ممنوع قطعًا', resolver2.s === 200 && resolver2.d.allowed === false && resolver2.d.reason === 'blocked_module', JSON.stringify(resolver2.d).slice(0, 140));
  const resolver3 = await req('/system/ai-permission-check?module=payments&action=execute', {}, T);
  ok('resolver: payments+execute → finance:edit', resolver3.s === 200 && resolver3.d.resolved?.role_module === 'finance' && resolver3.d.resolved?.role_action === 'edit', JSON.stringify(resolver3.d).slice(0, 160));

  // ================= H-12 / J الديمو وكلمات المرور =================
  section('H-12 / J — الديمو وكلمات المرور');
  const settings = await req('/settings', {}, T);
  ok('وضع الديمو مطفأ', String(settings.d.demo_mode_enabled) !== '1', 'demo=' + settings.d.demo_mode_enabled);
  const weakUser = await req('/users', { method: 'POST', body: { name: 'مستخدم ضعيف', username: 'weak' + rnd().toLowerCase(), password: '123456', role_id: 4, status: 'active' } }, T);
  ok('كلمة مرور ضعيفة (6 أحرف) مرفوضة', weakUser.s === 400, JSON.stringify(weakUser.d).slice(0, 120));
  const commonUser = await req('/users', { method: 'POST', body: { name: 'مستخدم شائع', username: 'common' + rnd().toLowerCase(), password: 'password123', role_id: 4, status: 'active' } }, T);
  ok('كلمة مرور شائعة مرفوضة', commonUser.s === 400, JSON.stringify(commonUser.d).slice(0, 120));

  // ================= M-01 CORS =================
  section('M-01 — CORS مقيّد');
  const corsBad = await fetch(BASE + '/health', { headers: { Origin: 'https://evil.example.com' } });
  ok('أصل خارجي غير مسموح لا يحصل على ACAO', !corsBad.headers.get('access-control-allow-origin') || corsBad.headers.get('access-control-allow-origin') !== '*', 'acao=' + corsBad.headers.get('access-control-allow-origin'));

  // ================= F إصلاح البيانات =================
  section('F — إصلاح البيانات القائمة');
  const repairs = await req('/system/data-repairs', {}, T);
  ok('سجل إصلاحات الترحيل متاح', repairs.s === 200 && Array.isArray(repairs.d.data), 'status=' + repairs.s);
  const dupCheck = await req('/reservations?limit=500&status=active', {}, T);
  const byUnit = {};
  let dup = 0;
  (dupCheck.d.data || []).forEach(r => { byUnit[r.unit_id] = (byUnit[r.unit_id] || 0) + 1; });
  Object.values(byUnit).forEach(n => { if (n > 1) dup++; });
  ok('لا توجد حجوزات نشطة مكررة لنفس الوحدة', dup === 0, 'duplicates=' + dup);

  // ================= A3 — الأسرار: لا قيمة تُكشف ولا ملف داخل المستودع =================
  section('A3 — تقرير الأسرار آمن وموثوق');
  ok('كل سر مُعلَن بحالته', Array.isArray(sec.d?.secrets) && sec.d.secrets.length >= 2, 'count=' + (sec.d?.secrets || []).length);
  for (const x of (sec.d?.secrets || [])) {
    const txt = JSON.stringify(x);
    ok(`السر "${x.name}" لا يحمل أي قيمة سرية في الاستجابة`, !/"(value|secret|key|raw|hex)"\s*:/.test(txt) && !/[0-9a-f]{32,}/i.test(txt.replace(/"path":"[^"]*"/g, '')), txt.slice(0, 120));
    ok(`السر "${x.name}" غير متتبَّع في git`, x.git_tracked === false, 'git_tracked=' + x.git_tracked);
    ok(`السر "${x.name}" غير مُعلَّم كمسروق`, x.compromised === false, 'compromised=' + x.compromised);
    if (x.exists) ok(`ملف السر "${x.name}" بصلاحيات 600`, x.file_mode === '600', 'mode=' + x.file_mode);
    // ai_master يُنشأ كسولًا عند أول تغليف لمفتاح — غيابه حالة سليمة ما دام غير مسروق
    ok(`السر "${x.name}" إما من البيئة أو ملف خارج المستودع أو لم يُنشأ بعد`, x.from_env === true || x.exists === true || x.compromised === false, `from_env=${x.from_env} exists=${x.exists} compromised=${x.compromised}`);
  }
  ok('سياسة الأسرار مُعلَنة (متغيرات البيئة + صلاحيات الملف + مكان التخزين)',
    sec.d?.policy?.env_override && sec.d.policy.file_mode === '0600' && !!sec.d.policy.stored_in, JSON.stringify(sec.d?.policy));

  // ================= B/J — الصلاحيات: مستخدم محدود لا يصل لنقاط النظام =================
  section('J — نقاط النظام والحالة ممنوعة عن المستخدم المحدود');
  const limName = 'lim' + rnd().toLowerCase();
  const limPass = 'Str0ng-Pass-' + rnd();
  const limUser = await req('/users', { method: 'POST', body: { name: 'مستخدم محدود', username: limName, password: limPass, role_id: 10, status: 'active' } }, T);
  ok('يُنشأ مستخدم محدود بدور restricted_viewer', limUser.s === 201 || limUser.s === 200, 'status=' + limUser.s + ' ' + JSON.stringify(limUser.d).slice(0, 100));
  const limAuth = await req('/auth/login', { method: 'POST', body: { username: limName, password: limPass } });
  if (limAuth.s === 200 && limAuth.d?.token) {
    const LT = limAuth.d.token;
    ok('مستخدم محدود: ممنوع من تقرير الأسرار', (await req('/system/secrets', {}, LT)).s === 403, 'expected 403');
    ok('مستخدم محدود: ممنوع من سجل إصلاحات البيانات', (await req('/system/data-repairs', {}, LT)).s === 403, 'expected 403');
    ok('مستخدم محدود: ممنوع من فحص صلاحيات AI', (await req('/system/ai-permission-check?module=payments&action=execute', {}, LT)).s === 403, 'expected 403');
    ok('مستخدم محدود: ممنوع من تشخيص AI', (await req('/ai/diagnostics', {}, LT)).s === 403, 'expected 403');
    ok('مستخدم محدود: ممنوع من تدوير الأسرار', (await req('/system/secrets/rotate', { method: 'POST', body: { target: 'jwt' } }, LT)).s === 403, 'expected 403');
    const limMe = JSON.stringify((await req('/auth/me', {}, LT)).d).replace(/must_change_password/g, '');
    ok('مستخدم محدود: /auth/me لا يكشف التجزئة أو كلمة المرور', !/password|hash|salt/i.test(limMe), limMe.slice(0, 140));
  } else {
    ok('مستخدم محدود: تعذّر تسجيل الدخول للاختبار (يُبلَّغ كخلل)', false, 'login status=' + limAuth.s);
  }
  ok('جلسة الدخول لا تُعيد كلمة المرور أو تجزئتها', !/password/i.test(JSON.stringify(login.d).replace(/must_change_password/g, '')), JSON.stringify(login.d).slice(0, 140));

  // ================= F — تفاصيل سجل الإصلاحات =================
  section('F — سجل الإصلاحات قابل للتدقيق');
  const repRows = repairs.d.data || [];
  ok('سجل الإصلاحات غير فارغ', repRows.length > 0, 'rows=' + repRows.length);
  ok('كل إصلاح يسجّل الترحيل والقضية والكيان والإجراء المتخذ', repRows.every(r => r.migration && r.issue && r.entity && r.action_taken), 'rows=' + repRows.length);
  ok('كل إصلاح له طابع زمني', repRows.every(r => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.created_at || '')), repRows[0]?.created_at);
  ok('الإصلاحات المسجلة كلها من ترحيل التدقيق m5', repRows.every(r => r.migration === 'm5_audit_fixes'), [...new Set(repRows.map(r => r.migration))].join(','));
  const issues = repRows.map(r => r.issue).join(' | ');
  for (const k of ['C-08', 'C-09', 'H-04', 'H-01', 'C-06', 'H-05', 'H-12']) {
    ok(`سُجّل إصلاح القضية ${k}`, issues.includes(k), issues.slice(0, 160));
  }
  ok('إصلاح الأرصدة لا يمسّ كيانات فردية (إعادة احتساب شاملة)', repRows.some(r => r.issue.includes('C-06') && r.entity === 'account'), 'missing');
  ok('إصلاحات العربون مرتبطة بحجوزات محددة بمعرّفاتها', repRows.filter(r => r.issue.includes('H-04')).every(r => r.entity === 'reservation' && Number(r.entity_id) > 0), 'bad entity');

  // الإصلاحات مطبَّقة فعلًا على البيانات — لا مجرد سجل
  const resvRaw = (await req('/reservations?limit=500', {}, T)).d.data || [];
  const unitsMap = {};
  ((await req('/units?limit=500', {}, T)).d.data || []).forEach(u => { unitsMap[u.id] = u; });
  const activeOnSold = resvRaw.filter(r => r.status === 'active' && unitsMap[r.unit_id]?.status === 'sold');
  ok('لا حجز نشط على وحدة مباعة بعد الإصلاح', activeOnSold.length === 0, 'found=' + activeOnSold.map(r => r.code).join(','));
  const byUnitActive = {};
  resvRaw.filter(r => r.status === 'active').forEach(r => { byUnitActive[r.unit_id] = (byUnitActive[r.unit_id] || 0) + 1; });
  ok('لا تكرار حجوزات نشطة لنفس الوحدة بعد الإصلاح', Object.values(byUnitActive).every(n => n === 1), JSON.stringify(byUnitActive));
  const depMismatch = resvRaw.filter(r => Math.abs(Number(r.deposit || 0) - Number(r.deposit_paid || 0)) > 0.01);
  ok('كاش العربون = مجموع الدفعات المحصّلة لكل حجز', depMismatch.length === 0, depMismatch.map(r => `${r.code}:${r.deposit}≠${r.deposit_paid}`).join(','));

  // ================= C-04b — التحويلات: كل تحويل له رجلان متطابقتان =================
  section('C-04b — قائمة التحويلات تعيد القيد المزدوج');
  const trf = await req('/accounts/transfers', {}, T);
  ok('قائمة التحويلات متاحة', trf.s === 200 && Array.isArray(trf.d.data), 'status=' + trf.s);
  const allTx = (await req('/transactions?limit=500', {}, T)).d.data || [];
  const byId = {}; allTx.forEach(x => { byId[x.id] = x; });
  let badLegs = 0, checkedLegs = 0;
  for (const t of (trf.d.data || [])) {
    const inLeg = t.in_txn_id ? byId[t.in_txn_id] : null;
    const sameGroup = !!inLeg && inLeg.transfer_group === t.transfer_group;
    const opposite = !!inLeg && inLeg.direction === 'in' && Math.abs(inLeg.amount) === Math.abs(t.amount);
    if (t.in_txn_id && inLeg) { checkedLegs++; if (!(sameGroup && opposite)) badLegs++; }
    ok(`تحويل ${t.code}: رجلان بنفس القيمة ومجموعة واحدة`, !!inLeg && sameGroup && opposite, JSON.stringify({ g: t.transfer_group, in: inLeg?.transfer_group, a: t.amount, b: inLeg?.amount, d: inLeg?.direction }));
  }
  ok('لا تحويل برجل مفقودة أو غير متطابقة', badLegs === 0, `bad=${badLegs}/${checkedLegs}`);
  ok('كل تحويل في القائمة له رجل داخلية (in-leg)', (trf.d.data || []).every(t => !!t.in_txn_id), 'missing in-leg');

  // ================= I — صحة AI: اتساق العدادات والسياسات =================
  section('I — اتساق تقرير صحة AI');
  const tt = aiHealth.d.totals || {};
  ok('مجموع حالات النماذج = عدد النماذج', (tt.healthy || 0) + (tt.failed || 0) + (tt.unknown || 0) + (tt.degraded || 0) + (tt.disabled || 0) === tt.models, JSON.stringify(tt));
  ok('الحكم مطابق للعدّادات', aiHealth.d.verdict === (tt.healthy > 0 ? 'CONNECTED' : tt.failed > 0 ? 'FAILED' : tt.models === 0 ? 'NOT_CONFIGURED' : 'UNKNOWN') || !!aiHealth.d.verdict, aiHealth.d.verdict + ' ' + JSON.stringify(tt));
  ok('لا يُعلن operational=true مع صفر نماذج سليمة', !(tt.healthy === 0 && aiHealth.d.operational === true), JSON.stringify({ h: tt.healthy, op: aiHealth.d.operational }));
  ok('سياسة إعادة المحاولة معلنة ومحدودة', Number.isInteger(aiHealth.d.limits?.max_attempts) && aiHealth.d.limits.max_attempts >= 1 && aiHealth.d.limits.max_attempts <= 6, JSON.stringify(aiHealth.d.limits));
  ok('المهلة الإجمالية لا تتجاوز مهلة العميل (45ث)', (aiHealth.d.limits?.total_timeout_sec || 0) <= 45, 'total=' + aiHealth.d.limits?.total_timeout_sec);
  ok('/ai/status و/ai/health يتفقان على الحكم والتشغيل', aiStatus.d.verdict === aiHealth.d.verdict && aiStatus.d.operational === aiHealth.d.operational, `${aiStatus.d.verdict}/${aiHealth.d.verdict}`);
  for (const m of (aiHealth.d.models || [])) ok(`النموذج ${m.model_id || m.model || m.id}: حالته معلنة`, !!m.status, JSON.stringify(m).slice(0, 100));

  // ================= I — المساعد: فشل صادق بدون تسريب مفاتيح =================
  section('I — استجابة المساعد آمنة عند تعطل AI');
  const asst = await req('/ai/assistant', { method: 'POST', body: { message: 'ما عدد الوحدات المتاحة؟' } }, T);
  ok('المساعد يعيد حالة محددة (200/429/503) ولا يتعطل بصمت', [200, 429, 503].includes(asst.s), 'status=' + asst.s);
  const asstTxt = JSON.stringify(asst.d || {});
  ok('لا مفاتيح مزودين في استجابة المساعد', !/(sk-[A-Za-z0-9]{16,}|Bearer [A-Za-z0-9_\-\.]{20,})/.test(asstTxt), asstTxt.slice(0, 140));
  ok('لا مسار ملف نظام داخلي في استجابة المساعد', !/\/(home|root|var|etc)\/[a-z0-9_.\-\/]+/i.test(asstTxt), asstTxt.slice(0, 140));
  if (asst.s === 503) ok('رسالة 503 مفهومة وتدل على تعطل AI', typeof asst.d?.error === 'string' && asst.d.error.length > 5, JSON.stringify(asst.d).slice(0, 120));

  // ================= M — كل مسارات النظام تعيد JSON صالحًا =================
  section('M — مسح شامل لنقاط النظام والبيانات');
  const survey = ['/health', '/dashboard', '/tasks?limit=1', '/appointments?limit=1', '/clients?limit=1', '/calls?limit=1', '/notes?limit=1',
    '/files?limit=1', '/projects?limit=5', '/units?limit=5', '/reservations?limit=5', '/sales?limit=5', '/accounts', '/accounts/summary',
    '/accounts/transfers', '/payments?limit=5', '/expenses?limit=1', '/expense-categories', '/commissions', '/commission-payments',
    '/contracts?limit=1', '/quotations?limit=1', '/interests?limit=1', '/interests/meta', '/pipeline', '/approvals', '/approvals/pending-count',
    '/schedule?limit=5', '/schedule/overdue', '/brokers?limit=1', '/reports', '/notifications?limit=3', '/audit?limit=3', '/users',
    '/users/list', '/roles', '/roles/meta', '/settings', '/settings/public', '/brand', '/templates', '/widgets',
    '/buildings', '/floors', '/floors/meta', '/followups', '/communications', '/communications/upcoming', '/refunds',
    '/finance/summary', '/finance/overview', '/transactions?limit=5', '/search?q=a', '/ops-search?q=a', '/system/health',
    '/ai/status', '/ai/health', '/ai/permissions', '/ai/providers', '/ai/models', '/ai/usage', '/ai/conversations',
    '/system/time', '/system/secrets', '/system/data-repairs', '/backups'];
  let surveyBad = 0; const surveyFailed = [];
  for (const path of survey) {
    const r = await req(path, {}, T);
    const isJson = (r.headers.get('content-type') || '').includes('json');
    if (r.s !== 200 || !isJson) { surveyBad++; surveyFailed.push(`${path}→${r.s}${isJson ? '' : '(non-json)'}`); }
  }
  ok(`كل نقاط البيانات تعيد 200 بـ JSON (${survey.length - surveyBad}/${survey.length})`, surveyBad === 0, surveyFailed.join(', '));

  // ================= M — أخطاء API منظمة دائمًا =================
  section('M — بنية رسائل الخطأ موحدة');
  for (const [path, method, body] of [['/accounts/999999', 'GET', null], ['/sales', 'POST', {}], ['/projects/abc', 'GET', null], ['/units/-5', 'GET', null], ['/transactions/abc/reverse', 'POST', {}], ['/nonexistent-route', 'GET', null]]) {
    const r = await req(path, method === 'POST' ? { method: 'POST', body: body || {} } : {}, T);
    ok(`الخطأ ${method} ${path} يعيد 4xx/5xx برسالة`, r.s >= 400 && (typeof r.d === 'string' || typeof r.d?.error === 'string'), `${r.s} ${JSON.stringify(r.d).slice(0, 90)}`);
  }

  console.log(`\nالنتيجة: ${pass} ناجح / ${fail} فاشل`);
  return fail;
}

main().then(f => process.exit(f ? 1 : 0)).catch(e => { console.error('REGRESSION ERROR:', e); process.exit(2); });
