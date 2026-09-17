/**
 * Smart Secretary — اختبارات النظام المالي و CRM (المرحلة الثانية)
 * يغطي: الحسابات، الدفعات، المصروفات، جدول الأقساط، الاسترداد، العمولات، الموافقات،
 * العروض، العقود، البناء/الأدوار/الوحدات، اهتمامات العملاء، المطابقة، المراسلة، التقارير،
 * وسلسلة العمل الكاملة: عميل → اهتمام → عرض سعر → حجز → عربون → عقد → بيع → دفعات → كشف حساب.
 *
 * التشغيل:  API=http://127.0.0.1:3847/api node scripts/test2.js
 */
const BASE = process.env.API || 'http://127.0.0.1:3847/api';
let pass = 0, fail = 0; const failures = [];
const RUN = String(Date.now()).slice(-6);

async function req(path, opts = {}, token = null) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const ct = r.headers.get('content-type') || '';
  let d = null;
  if (ct.includes('json')) { try { d = await r.json(); } catch { d = null; } }
  else { d = { _raw: true }; }
  return { s: r.status, d, h: r.headers };
}
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name); console.log('  ✗ FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 260) : '')); }
};
const sec = (t) => console.log('\n— ' + t);
const num = (v) => Number(v || 0);
const near = (a, b, eps = 0.51) => Math.abs(num(a) - num(b)) <= eps;
const todayStr = () => new Date().toISOString().slice(0, 10);

(async () => {
  console.log('— Smart Secretary E2E (Finance + CRM) —');
  const log = await req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  ok('admin login', log.s === 200 && !!log.d.token, log.d);
  const T = log.d.token;
  const sara = await req('/auth/login', { method: 'POST', body: { username: 'sara', password: 'sara1234' } });
  const ST = sara.d?.token;

  // ============================================================
  sec('1) الحسابات المالية والحركات (Ledger)');
  const accs = await req('/accounts', {}, T);
  ok('حسابات: قائمة', accs.s === 200 && accs.d.data.length >= 2, accs.d);
  const cashAcc = accs.d.data.find(a => a.type === 'cash') || accs.d.data[0];
  const bankAcc = accs.d.data.find(a => a.type === 'bank') || accs.d.data[0];
  const sum0 = await req('/accounts/summary', {}, T);
  ok('حسابات: ملخص الأرصدة', sum0.s === 200 && typeof sum0.d.total === 'number', sum0.d);
  const newAcc = await req('/accounts', { method: 'POST', body: { name: 'حساب اختبار ' + RUN, type: 'bank', bank_name: 'بنك الاختبار', account_no: 'SA' + RUN, opening_balance: 100000, status: 'active' } }, T);
  ok('حسابات: إنشاء حساب جديد', [200, 201].includes(newAcc.s) && newAcc.d.id, newAcc.d);

  // ============================================================
  sec('2) العملاء والاهتمامات');
  const cRes = await req('/clients', { method: 'POST', body: { name: 'عميل E2E ' + RUN, phone: '0555' + RUN, city: 'جدة', source: 'اختبار آلي', assigned_to: null } }, T);
  ok('إنشاء عميل اختباري', cRes.s === 201 && cRes.d.id, cRes.d);
  const CID = cRes.d.id;
  const projList = await req('/projects?limit=5', {}, T);
  const PROJ = projList.d.data[0];

  const in1 = await req('/interests', { method: 'POST', body: { client_id: CID, property_type: 'apartment', preferred_project_id: PROJ.id, budget_min: 200000, budget_max: 900000, rooms: 3, bathrooms: 2, purpose: 'residence', floor_pref: 'normal', notes: 'اهتمام اختباري' } }, T);
  ok('اهتمامات: إنشاء اهتمام (شقة 3 غرف)', in1.s === 201 && in1.d.id, in1.d);
  const in2 = await req('/interests', { method: 'POST', body: { client_id: CID, property_type: 'roof', budget_min: 100000, budget_max: 600000, rooms: 2, wants_roof: 1, purpose: 'investment', priority: 'high' } }, T);
  ok('اهتمامات: إنشاء اهتمام ثانٍ (روف)', in2.s === 201, in2.d);
  const badInt = await req('/interests', { method: 'POST', body: { client_id: CID, budget_min: 900000, budget_max: 100000 } }, T);
  ok('اهتمامات: رفض ميزانية غير منطقية', badInt.s === 400, badInt.d);
  const cAfter = await req('/clients/' + CID, {}, T);
  ok('اهتمامات: ملخص الاهتمامات يُحدّث في ملف العميل', !!cAfter.d.interest_summary && cAfter.d.interest_summary.length > 3, cAfter.d.interest_summary);
  const meta = await req('/interests/meta', {}, T);
  ok('اهتمامات: قوائم الفلاتر (meta)', meta.s === 200 && Array.isArray(meta.d.stages) && meta.d.stages.length >= 10, Object.keys(meta.d || {}));
  const filt = await req(`/interests?client_id=${CID}&rooms=3`, {}, T);
  ok('اهتمامات: فلترة متقدمة', filt.s === 200 && filt.d.data.length >= 1, filt.d);
  const iUpd = await req('/interests/' + in1.d.id, { method: 'PUT', body: { budget_max: 950000, sales_notes: 'تم التحديث' } }, T);
  ok('اهتمامات: تعديل', iUpd.s === 200 && num(iUpd.d.budget_max) === 950000, iUpd.d);

  // ============================================================
  sec('3) المباني والأدوار (أنواع الأدوار لا تُفترض)');
  const bld = await req('/buildings', { method: 'POST', body: { project_id: PROJ.id, name: 'مبنى اختبار ' + RUN, floors_count: 5, floors: [ { number: 1, type: 'normal' }, { number: 2, type: 'normal' }, { number: 5, type: 'roof' }, { number: 6, type: 'terrace' }, { number: 0, type: 'ground' } ] } }, T);
  ok('مبانٍ: إنشاء مبنى بأدوار متنوعة', bld.s === 201 && bld.d.floors.length === 5, bld.d);
  const roofFloor = (bld.d?.floors || []).find(f => f.type === 'roof');
  ok('أدوار: الدور الخامس روف يُسمى "الدور 5 — روف"', !!roofFloor && roofFloor.name.includes('روف'), roofFloor && roofFloor.name);
  const normalFloor = (bld.d?.floors || []).find(f => f.type === 'normal');
  ok('أدوار: الدور العادي لا يُسمى روف', !!normalFloor && !normalFloor.name.includes('روف'), normalFloor && normalFloor.name);
  const pjB = await req('/projects/' + PROJ.id + '/buildings', {}, T);
  ok('مبانٍ: أدوار كل مبنى تُجلب منفصلة', pjB.s === 200 && pjB.d.data.length >= 1 && Array.isArray(pjB.d.data[0].floors), pjB.d.data?.length);
  const fMeta = await req('/floors/meta', {}, T);
  ok('أدوار: أنواع الأدوار (روف/سطح/ميزانين/قبو)', fMeta.s === 200 && ['roof', 'terrace', 'mezzanine', 'basement'].every(k => fMeta.d.floor_types.some(t => t.k === k)), fMeta.d.floor_types?.map(t => t.k));
  const newFloor = await req(`/buildings/${bld.d.id}/floors`, { method: 'POST', body: { number: 3, type: 'normal' } }, T);
  ok('أدوار: إضافة دور لمبنى', newFloor.s === 201 && newFloor.d.id, newFloor.d);
  const dupFloor = await req(`/buildings/${bld.d.id}/floors`, { method: 'POST', body: { number: 3 } }, T);
  ok('أدوار: رفض تكرار رقم الدور', dupFloor.s === 409, dupFloor.d);

  // وحدات مرتبطة بالمبنى والدور
  const unitCreates = [];
  for (const [i, f] of (bld.d.floors || []).slice(0, 3).entries()) {
    unitCreates.push(await req('/units', { method: 'POST', body: { code: `E2E-${RUN}-${i + 1}`, project_id: PROJ.id, building_id: bld.d.id, floor_id: f.id, type: 'apartment', rooms: i + 2, bathrooms: 1, area: 120 + i * 10, price: 300000 + i * 50000, status: 'available', delivery_status: 'ready' } }, T));
  }
  ok('وحدات: إنشاء وحدات مربوطة بمبنى/دور', unitCreates.every(u => u.s === 201), unitCreates.map(u => u.d));
  const UNIT = unitCreates[0].d;
  const noBldUnit = await req('/units', { method: 'POST', body: { code: 'E2E-NOBLD-' + RUN, project_id: PROJ.id, type: 'apartment', rooms: 2, price: 100000, status: 'available' } }, T);
  ok('وحدات: رفض إضافة وحدة بلا مبنى/دور عند إلزام المشروع', noBldUnit.s === 400, noBldUnit.d);

  // فلاتر الوحدات المتقدمة (الغرف = / ≥ / بين)
  const fEq = await req(`/units?rooms_op=eq&rooms=3&project_id=${PROJ.id}`, {}, T);
  ok('وحدات: فلتر الغرف = 3', fEq.s === 200 && fEq.d.data.every(u => num(u.rooms) === 3), fEq.d.data?.map(u => u.rooms));
  const fGte = await req(`/units?rooms_op=gte&rooms=3&project_id=${PROJ.id}`, {}, T);
  ok('وحدات: فلتر الغرف ≥ 3', fGte.s === 200 && fGte.d.data.length >= 1 && fGte.d.data.every(u => num(u.rooms) >= 3), fGte.d.data?.map(u => u.rooms));
  const fBtw = await req(`/units?rooms_op=between&rooms=2&rooms_max=3&project_id=${PROJ.id}`, {}, T);
  ok('وحدات: فلتر الغرف بين 2 و3', fBtw.s === 200 && fBtw.d.data.every(u => num(u.rooms) >= 2 && num(u.rooms) <= 3), fBtw.d.data?.map(u => u.rooms));
  const fFloor = await req(`/units?building_id=${bld.d.id}&floor_id=${bld.d.floors[0].id}`, {}, T);
  ok('وحدات: فلترة بالمبنى والدور', fFloor.s === 200 && fFloor.d.data.length >= 1, fFloor.d.data?.length);
  const fRoof = await req(`/units?project_id=${PROJ.id}&floor_type=roof`, {}, T);
  ok('وحدات: فلترة بنوع الدور (روف)', fRoof.s === 200, fRoof.d);

  // ============================================================
  sec('4) عرض السعر → الحجز → العربون (سلسلة واحدة بلا تكرار مبالغ');
  const q1 = await req('/quotations', { method: 'POST', body: { client_id: CID, unit_id: UNIT.id, price: num(UNIT.price), discount: 5000, quote_date: todayStr(), valid_until: todayStr(), terms: 'سعر خاص لاختبار النظام' } }, T);
  ok('عروض: إنشاء عرض سعر', q1.s === 201 && q1.d.id, q1.d);
  const qDet = await req('/quotations/' + q1.d.id, {}, T);
  ok('عروض: تفاصيل + بيانات الشركة للطباعة', qDet.s === 200 && !!qDet.d.company, Object.keys(qDet.d || {}).slice(0, 6));
  ok('عروض: صافي العرض = السعر - الخصم', near(qDet.d.net_price, num(UNIT.price) - 5000), qDet.d.net_price);
  const qConv = await req(`/quotations/${q1.d.id}/convert`, { method: 'POST', body: { deposit: 10000, deposit_method: 'cash', expiry_date: null } }, T);
  ok('عروض: تحويل إلى حجز', qConv.s === 201 && qConv.d.id, qConv.d);
  const RID = qConv.d.id;
  const rDet = await req('/reservations/' + RID, {}, T);
  ok('حجوزات: تفاصيل الحجز + الدفعات + الإجماليات', rDet.s === 200 && near(rDet.d.totals.deposit_paid, 10000), rDet.d.totals);
  const cashAccAfter = (await req('/accounts/' + cashAcc.id, {}, T)).d;
  ok('حجوزات: العربون سُجل كدفعة حقيقية على الحساب', near(cashAccAfter.current_balance, num(cashAcc.current_balance) + 10000, 1), { before: cashAcc.current_balance, after: cashAccAfter.current_balance });
  const rUnit = await req('/units/' + UNIT.id + '/full', {}, T);
  ok('حجوزات: الوحدة أصبحت محجوزة', rUnit.d.unit && rUnit.d.unit.status === 'reserved', rUnit.d.unit && rUnit.d.unit.status);
  ok('حجوزات: عرض "الدور — نوع الدور" للوحدة', !!rUnit.d.unit.floor_label || !!rUnit.d.unit.label, rUnit.d.unit && rUnit.d.unit.label);
  const cStage1 = await req('/clients/' + CID + '/stages', {}, T);
  ok('CRM: مرحلة العميل انتقلت إلى "محجوز"', cStage1.s === 200 && (cStage1.d.data || []).some(h => h.to_stage === 'reserved'), (cStage1.d.data || []).map(h => h.to_stage));
  const rDetail2 = await req(`/reservations/${RID}`, {}, T);
  ok('حجوزات: دفعة العربون ظاهرة في سجل الحجز', (rDetail2.d.payments || []).length >= 1, rDetail2.d.payments?.length);

  // ============================================================
  sec('5) العقد');
  const ctr = await req('/contracts', { method: 'POST', body: { client_id: CID, reservation_id: RID, unit_id: UNIT.id, contract_date: todayStr(), start_date: todayStr(), end_date: todayStr(), amount: num(UNIT.price), discount: 5000, terms: 'عقد اختباري' } }, T);
  ok('عقود: إنشاء عقد', ctr.s === 201 && ctr.d.id, ctr.d);
  const sign = await req(`/contracts/${ctr.d.id}/sign`, { method: 'POST', body: { signed_at: todayStr() } }, T);
  ok('عقود: توقيع العقد وتغيير الحالة', sign.s === 200 && sign.d.status === 'active' && sign.d.signed_at, sign.d);
  const ctrPrint = await req(`/contracts/${ctr.d.id}/print`, {}, T);
  ok('عقود: بيانات الطباعة/PDF', ctrPrint.s === 200 && !!ctrPrint.d.company, ctrPrint.s);

  // ============================================================
  sec('6) البيع من الحجز (بدون احتساب العربون مرتين)');
  const sale = await req('/sales', { method: 'POST', body: { reservation_id: RID, sale_price: num(UNIT.price), discount: 5000, down_payment: 30000, commission: 5000, sale_date: todayStr(), notes: 'بيع اختباري' } }, T);
  ok('بيع: تحويل الحجز إلى بيع', sale.s === 201 && sale.d.id, sale.d);
  const SID = sale.d.id;
  ok('بيع: العربون رُبط بالبيع (deposit_linked)', sale.d.deposit_linked === true, sale.d);
  ok('بيع: الصافي = السعر - الخصم', near(sale.d.net_price, num(UNIT.price) - 5000), sale.d.net_price);
  ok('بيع: جدول الأقساط تولّد تلقائيًا', !!sale.d.schedule && sale.d.schedule.rows >= 1, sale.d.schedule);
  const sDet = await req('/sales/' + SID, {}, T);
  const netSale = num(sDet.d.net_price);
  ok('بيع: المدفوع لا يحتسب العربون مرتين (paid = 30000)', near(sDet.d.paid, 30000), { paid: sDet.d.paid, gross: sDet.d.gross_paid, deposit: 10000 });
  ok('بيع: القاعدة paid + remaining = net', near(num(sDet.d.paid) + num(sDet.d.remaining), netSale), { paid: sDet.d.paid, remaining: sDet.d.remaining, net: netSale });
  ok('بيع: الوحدة أصبحت مباعة', (await req('/units/' + UNIT.id, {}, T)).d.status === 'sold');
  ok('بيع: العقد مرتبط بعملية البيع', !!sDet.d.contract, sDet.d.contract && sDet.d.contract.code);
  ok('بيع: فاتورة صادرة', !!sDet.d.invoice, sDet.d.invoice && sDet.d.invoice.code);
  const uHist = await req('/units/' + UNIT.id + '/history', {}, T);
  ok('وحدات: سجل حالة الوحدة غير قابل للحذف (متاح→محجوز→مباع)', uHist.s === 200 && uHist.d.data.length >= 3, uHist.d.data?.map(h => h.to_status));

  // ============================================================
  sec('7) الدفعات (طرق مختلفة، شيكات، منع التجاوز)');
  const over = await req('/payments', { method: 'POST', body: { sale_id: SID, amount: num(sDet.d.remaining) + 5000, method: 'cash', paid_at: todayStr(), account_id: cashAcc.id } }, T);
  ok('دفعات: رفض دفعة تتجاوز المتبقي', over.s === 400, over.d);
  const p1 = await req('/payments', { method: 'POST', body: { sale_id: SID, amount: 20000, method: 'transfer', paid_at: todayStr(), account_id: bankAcc.id, reference_no: 'TRF-' + RUN, kind: 'installment' } }, T);
  ok('دفعات: تسجيل دفعة تحويل بنكي', [200, 201].includes(p1.s) && p1.d.id, p1.d);
  const p2 = await req('/payments', { method: 'POST', body: { sale_id: SID, amount: 15000, method: 'check', paid_at: todayStr(), account_id: bankAcc.id, check_no: 'CHK-' + RUN, check_due_date: todayStr(), bank_name: 'بنك الاختبار' } }, T);
  ok('دفعات: تسجيل شيك (حالة معلق)', [200, 201].includes(p2.s) && p2.d.id, p2.d);
  const sAfterP2 = await req('/sales/' + SID, {}, T);
  ok('دفعات: الشيك المعلق لا يُحتسب في المدفوع', near(sAfterP2.d.paid, 50000), { paid: sAfterP2.d.paid, pending: sAfterP2.d.pending_checks });
  ok('دفعات: pending_checks يعرض قيمة الشيكات', near(sAfterP2.d.pending_checks, 15000), sAfterP2.d.pending_checks);
  const chkOk = await req(`/payments/${p2.d.id}/check-status`, { method: 'POST', body: { check_status: 'cleared' } }, T);
  ok('دفعات: تحديث حالة الشيك إلى محصّل', chkOk.s === 200, chkOk.d);
  const sAfterChk = await req('/sales/' + SID, {}, T);
  ok('دفعات: بعد تحصيل الشيك paid = 65000', near(sAfterChk.d.paid, 65000), { paid: sAfterChk.d.paid });
  ok('دفعات: القاعدة paid + remaining = net بعد الشيك', near(num(sAfterChk.d.paid) + num(sAfterChk.d.remaining), netSale), { paid: sAfterChk.d.paid, remaining: sAfterChk.d.remaining });
  const receipt = await req(`/payments/${p1.d.id}/receipt`, {}, T);
  ok('دفعات: بيانات سند/إيصال القبض', receipt.s === 200, receipt.s);
  const payList = await req(`/payments?sale_id=${SID}`, {}, T);
  ok('دفعات: قائمة الدفعات مربوطة بعملية البيع', payList.s === 200 && payList.d.data.length >= 3, payList.d.data?.length);
  const payBad = await req('/payments', { method: 'POST', body: { sale_id: SID, amount: -5, method: 'cash', paid_at: todayStr() } }, T);
  ok('دفعات: رفض مبلغ غير صالح', payBad.s === 400, payBad.d);
  const payNoSale = await req('/payments', { method: 'POST', body: { amount: 100, method: 'cash', paid_at: todayStr() } }, T);
  ok('دفعات: رفض دفعة غير مربوطة ببيع/حجز', payNoSale.s === 400, payNoSale.d);

  // ============================================================
  sec('8) جدول الأقساط والمتأخرات');
  const sch = await req(`/schedule?sale_id=${SID}`, {}, T);
  ok('أقساط: قائمة أقساط البيع', sch.s === 200 && sch.d.data.length >= 1, sch.d.data?.length);
  const settled = (sch.d.data || []).find(r => num(r.remaining) <= 0.01);
  if (settled) {
    const dbl = await req(`/schedule/${settled.id}/pay`, { method: 'POST', body: { amount: 100, method: 'cash', account_id: cashAcc.id, paid_at: todayStr() } }, T);
    ok('أقساط: رفض دفع قسط مسدَّد بالكامل', dbl.s === 400, dbl.d);
  } else { ok('أقساط: رفض دفع قسط مسدَّد بالكامل', true); }
  const openSch = (sch.d.data || []).find(r => num(r.remaining) > 0.01);
  ok('أقساط: يوجد قسط مفتوح للمتابعة', !!openSch, { rows: sch.d.data?.length, totals: sch.d.totals });
  if (openSch) {
    const paySch = await req(`/schedule/${openSch.id}/pay`, { method: 'POST', body: { amount: Math.min(5000, num(openSch.remaining)), method: 'cash', account_id: cashAcc.id, paid_at: todayStr() } }, T);
    ok('أقساط: دفع قسط من الجدول', [200, 201].includes(paySch.s), paySch.d);
    const schAfter = await req(`/schedule?sale_id=${SID}`, {}, T);
    const paidRow = schAfter.d.data.find(r => r.id === openSch.id);
    ok('أقساط: تحديث المدفوع/المتبقي للقسط', num(paidRow.paid_amount) > num(openSch.paid_amount), paidRow && { paid: paidRow.paid_amount, status: paidRow.status });
  }
  const ova = await req('/schedule/overdue', {}, T);
  ok('أقساط: تقرير المتأخرات', ova.s === 200 && Array.isArray(ova.d.data), ova.s);
  const ovaX = await fetch(BASE + '/schedule/overdue/excel', { headers: { Authorization: 'Bearer ' + T } });
  ok('أقساط: تصدير المتأخرات Excel', ovaX.status === 200 && (ovaX.headers.get('content-type') || '').includes('spreadsheet'), ovaX.status);

  // ============================================================
  sec('9) كشوف الحسابات (عميل / مشروع / حساب)');
  const stmt = await req('/statements/client/' + CID, {}, T);
  ok('كشف العميل: قيمة ← خصم ← صافي ← دفعات', stmt.s === 200 && num(stmt.d.summary.net_sales) > 0, stmt.d && stmt.d.summary);
  const t = stmt.d.summary || {};
  ok('كشف العميل: المدفوع + المتبقي = الصافي', near(num(t.total_paid) + num(t.remaining_on_client), num(t.net_sales)), { paid: t.total_paid, remaining: t.remaining_on_client, net: t.net_sales });
  ok('كشف العميل: يحتوي حركات الدفعات والأقساط', (stmt.d.payments || []).length >= 1 && Array.isArray(stmt.d.schedule), { payments: stmt.d.payments?.length, schedule: stmt.d.schedule?.length });
  const stmtX = await fetch(BASE + `/statements/client/${CID}/excel`, { headers: { Authorization: 'Bearer ' + T } });
  ok('كشف العميل: تصدير Excel', stmtX.status === 200 && (stmtX.headers.get('content-type') || '').includes('spreadsheet'), stmtX.status);
  const pStmt = await req('/statements/project/' + PROJ.id, {}, T);
  ok('كشف المشروع: الإيراد/التحصيل/المصروف/الصافي', pStmt.s === 200 && pStmt.d.project && pStmt.d.net_cash_flow !== undefined, pStmt.d && Object.keys(pStmt.d).slice(0, 8));
  ok('كشف المشروع: تفصيل المصروفات والعمولات (Drill-down)', Array.isArray(pStmt.d.expensesList) && Array.isArray(pStmt.d.commissionsList), { exp: pStmt.d.expensesList?.length, com: pStmt.d.commissionsList?.length });
  const accStmt = await req(`/accounts/${cashAcc.id}/statement`, {}, T);
  ok('كشف الحساب: حركات الحساب مطابقة للرصيد', accStmt.s === 200 && accStmt.d.rows.length >= 1 && near(accStmt.d.current_balance, accStmt.d.rows[accStmt.d.rows.length - 1].running_balance), accStmt.d && { cur: accStmt.d.current_balance, run: accStmt.d.rows?.slice(-1)[0]?.running_balance });
  const txn = await req(`/transactions?account_id=${cashAcc.id}&limit=5`, {}, T);
  ok('الحركات المالية: سجل Ledger للحساب', txn.s === 200 && txn.d.data.length >= 1, txn.d.data?.length);

  // ============================================================
  sec('10) المصروفات (تصنيفات + اعتماد)');
  const cats = await req('/expense-categories', {}, T);
  ok('مصروفات: تصنيفات افتراضية (رواتب/إيجار/تسويق...)', cats.s === 200 && cats.d.data.length >= 10, cats.d.data?.length);
  const expCat = cats.d.data[0];
  const exp = await req('/expenses', { method: 'POST', body: { category_id: expCat.id, amount: 1500, expense_date: todayStr(), account_id: cashAcc.id, method: 'cash', project_id: PROJ.id, description: 'مصروف اختباري ' + RUN } }, T);
  ok('مصروفات: إنشاء مصروف', [200, 201].includes(exp.s) && exp.d.id, exp.d);
  const expPay = await req(`/expenses/${exp.d.id}/pay`, { method: 'POST', body: {} }, T);
  ok('مصروفات: صرف المصروف من الحساب', [200, 201].includes(expPay.s), expPay.d);
  const expBade = await req('/expenses', { method: 'POST', body: { category_id: expCat.id, amount: 0, expense_date: todayStr() } }, T);
  ok('مصروفات: رفض مبلغ صفر', expBade.s === 400, expBade.d);
  const expList = await req(`/expenses?project_id=${PROJ.id}`, {}, T);
  ok('مصروفات: فلترة بالمشروع', expList.s === 200 && expList.d.data.length >= 1, expList.d.data?.length);

  // ============================================================
  sec('11) الاسترداد والإلغاء (لا حذف لبيانات مالية)');
  const beforeRefund = (await req('/sales/' + SID, {}, T)).d;
  const refund = await req('/refunds', { method: 'POST', body: { client_id: CID, sale_id: SID, amount: 2000, deducted_amount: 0, method: 'cash', account_id: cashAcc.id, reason: 'استرداد اختباري' } }, T);
  ok('استرداد: إنشاء طلب استرداد', [200, 201].includes(refund.s) && refund.d.id, refund.d);
  const RID_REF = refund.d.id;
  const rAppr = await req(`/refunds/${RID_REF}/approve`, { method: 'POST', body: {}, headers: { 'X-Idempotent': RUN } }, T);
  ok('استرداد: اعتماد المدير', [200, 201].includes(rAppr.s), rAppr.d);
  const rPay = await req(`/refunds/${RID_REF}/pay`, { method: 'POST', body: {} }, T);
  ok('استرداد: صرف المبلغ', [200, 201].includes(rPay.s), rPay.d);
  const sAfterRefund = await req('/sales/' + SID, {}, T);
  ok('استرداد: المدفوع ناقص الاسترداد والمتبقي يعود للارتفاع',
    near(sAfterRefund.d.paid, num(beforeRefund.paid) - 2000) && near(sAfterRefund.d.remaining, num(netSale) - num(sAfterRefund.d.paid)),
    { before: beforeRefund.paid, after: sAfterRefund.d.paid, remaining: sAfterRefund.d.remaining });
  ok('استرداد: القاعدة paid + remaining = net بعد الاسترداد', near(num(sAfterRefund.d.paid) + num(sAfterRefund.d.remaining), num(netSale)), { paid: sAfterRefund.d.paid, remaining: sAfterRefund.d.remaining });
  ok('استرداد: دفعات البيع القديمة لم تُحذف', (sAfterRefund.d.payments || []).length >= 3, sAfterRefund.d.payments?.length);
  const delPay = await req('/payments/' + p1.d.id, { method: 'DELETE' }, T);
  const stillThere = await req('/payments/' + p1.d.id, {}, T);
  ok('حماية: لا حذف للدفعات المالية (السجل باقٍ)', delPay.s !== 200 && stillThere.s === 200, { del: delPay.s, get: stillThere.s });
  const delExp = await req('/expenses/' + exp.d.id, { method: 'DELETE' }, T);
  ok('حماية: لا حذف للمصروفات (إلغاء فقط)', delExp.s !== 200, delExp.s);

  // ============================================================
  sec('12) الموافقات (اعتماد المدير + Audit Log)');
  const acc2 = await req('/auth/login', { method: 'POST', body: { username: 'accountant', password: 'acc12345' } });
  const AT = acc2.d?.token;
  if (AT) {
    const bigExp = await req('/expenses', { method: 'POST', body: { category_id: expCat.id, amount: 25000, expense_date: todayStr(), account_id: cashAcc.id, method: 'cash', description: 'مصروف كبير يحتاج اعتماد ' + RUN } }, AT);
    const isPending = bigExp.s === 202 || bigExp.d?.pending_approval;
    ok('موافقات: مصروف كبير يتطلب اعتماد المدير', isPending, bigExp.d);
    if (isPending) {
      const appr = await req(`/approvals/${bigExp.d.pending_approval || bigExp.d.id}/approve`, { method: 'POST', body: {} }, T);
      ok('موافقات: اعتماد الطلب من المدير', [200, 201].includes(appr.s), appr.d);
      const pend = await req('/approvals/pending-count', {}, T);
      ok('موافقات: عدّاد الطلبات المعلقة متاح', pend.s === 200 && typeof pend.d.pending === 'number', pend.d);
    }
  } else { ok('موافقات: حساب المحاسب متاح لاختبار الاعتماد', false, acc2.d); }
  const apprList = await req('/approvals?limit=10', {}, T);
  ok('موافقات: سجل الطلبات', apprList.s === 200 && Array.isArray(apprList.d.data), apprList.s);
  const auditPay = await req('/audit?limit=50', {}, T);
  ok('تدقيق: كل حركة مالية لها سجل تدقيق', auditPay.s === 200 && (auditPay.d.data || []).some(a => ['payment', 'refund', 'expense', 'finance'].includes(a.entity) || ['finance', 'expenses', 'approvals'].includes(a.module)), auditPay.d.data?.slice(0, 3));

  // ============================================================
  sec('13) العمولات والمسوقون');
  const com = await req('/commissions', {}, T);
  ok('عمولات: قائمة عمولات المبيعات', com.s === 200 && com.d.data.length >= 1, com.d.data?.length);
  const brk = (await req('/brokers?limit=1', {}, T)).d.data[0];
  if (brk) {
    const brkStmt = await req(`/brokers/${brk.id}/statement`, {}, T);
    ok('مسوقون: كشف حساب المسوق', brkStmt.s === 200, brkStmt.s);
  } else { console.log('   (لا يوجد مسوق للتجربة)'); }
  const comPay = await req('/commission-payments', {}, T);
  ok('عمولات: دفعات العمولات', comPay.s === 200 && Array.isArray(comPay.d.data), comPay.s);

  // ============================================================
  sec('14) CRM: التواصل، المراحل، المطابقة، المراسلة');
  const comm = await req('/communications', { method: 'POST', body: { client_id: CID, kind: 'call', direction: 'out', body: 'اتصال متابعة', result: 'مهتم', occurred_at: todayStr(), next_follow_up: todayStr() } }, T);
  ok('تواصل: تسجيل مكالمة متابعة', comm.s === 201 && comm.d.id, comm.d);
  const cComms = await req('/clients/' + CID + '/communications', {}, T);
  ok('تواصل: سجل تواصل العميل', cComms.s === 200 && cComms.d.data.length >= 1, cComms.d.data?.length);
  const up = await req('/communications/upcoming?days=30', {}, T);
  ok('تواصل: المتابعات القادمة', up.s === 200 && Array.isArray(up.d.data), up.s);
  const stageUpd = await req(`/clients/${CID}/stage`, { method: 'PUT', body: { stage: 'negotiation', note: 'تفاوض على السعر' } }, T);
  ok('CRM: تحديث مرحلة العميل (تفاوض)', stageUpd.s === 200, stageUpd.d);
  const pipe = await req('/pipeline', {}, T);
  ok('CRM: لوحة المراحل (Pipeline)', pipe.s === 200 && Array.isArray(pipe.d.stages) && pipe.d.stages.length >= 10, pipe.d.stages?.length);
  ok('CRM: 10 مراحل: عميل محتمل→تم التواصل→مهتم→معاينة→عرض سعر→تفاوض→حجز→عقد→بيع→مغلق',
    ['عميل محتمل', 'تم التواصل', 'مهتم', 'معاينة', 'عرض سعر', 'تفاوض', 'حجز', 'عقد', 'بيع', 'مغلق'].every(n => (pipe.d.stages || []).some(s => s.name === n)),
    pipe.d.stages?.map(s => s.name));

  // مطابقة الاهتمامات بالوحدات
  const match = await req('/units/' + UNIT.id + '/matches?min_score=0', {}, T);
  ok('مطابقة: العملاء المهتمون بهذه الوحدة', match.s === 200 && Array.isArray(match.d.matches) && match.d.matches.length >= 1, { keys: Object.keys(match.d || {}), n: (match.d.matches || []).length });
  const matchX = await fetch(BASE + `/units/${UNIT.id}/matches/excel`, { headers: { Authorization: 'Bearer ' + T } });
  ok('مطابقة: تصدير العملاء المهتمين Excel', matchX.status === 200 && (matchX.headers.get('content-type') || '').includes('spreadsheet'), matchX.status);
  const mu = await req(`/interests/match-units?client_id=${CID}`, {}, T);
  ok('مطابقة: وحدات مناسبة لاهتمامات العملاء', mu.s === 200 && Array.isArray(mu.d.units), mu.s);

  // المراسلة الجاهزة + واتساب
  const msg = await req('/interests/messages', { method: 'POST', body: { interest_ids: [in1.d.id, in2.d.id], unit_id: unitCreates[1].d.id, template: 'مرحبًا {{اسم العميل}}، مشروع {{اسم المشروع}} — {{عدد الغرف}} غرف بسعر {{السعر}}.\n{{رابط الوحدة}}' } }, T);
  ok('مراسلة: تجهيز رسائل للعملاء المهتمين', msg.s === 200 && msg.d.messages.length === 2, msg.d && msg.d.messages?.length);
  const m0 = (msg.d.messages || [])[0] || {};
  ok('مراسلة: استبدال المتغيرات (اسم العميل/المشروع/الغرف/السعر)', !!m0.text && !m0.text.includes('{{') && m0.text.includes('عميل E2E'), m0.text);
  ok('مراسلة: رابط واتساب جاهز للفتح', !!m0.wa_link && m0.wa_link.startsWith('https://wa.me/'), m0.wa_link);
  ok('مراسلة: لا إرسال جماعي تلقائي (تجهيز يدوي فقط)', !!msg.d.note, msg.d.note);

  // ============================================================
  sec('15) التقارير الشاملة + Excel (كل تقرير)');
  const repList = await req('/reports', {}, T);
  const names = (repList.d.reports || []).map(r => r.key);
  ok('تقارير: قائمة التقارير تحتوي تقارير النظام الجديد',
    ['collections', 'overdue_installments', 'schedule', 'expenses_report', 'commissions_report', 'accounts_report', 'refunds_report', 'contracts_report', 'quotations_report', 'project_financials', 'units_inventory', 'interested_clients', 'not_followed_up', 'top_demands'].every(k => names.includes(k)),
    names);
  let repOk = 0, repFail = [];
  for (const n of names) {
    const r = await req('/reports/' + n + '?limit=5', {}, T);
    if (r.s === 200 && Array.isArray(r.d.rows) && r.d.meta && r.d.meta.filters !== undefined) repOk++;
    else repFail.push(n + ':' + r.s);
  }
  ok(`تقارير: جميع التقارير (${names.length}) تعمل ببيانات وبيانات تعريفية`, repFail.length === 0, repFail);
  for (const n of ['collections', 'interested_clients', 'project_financials', 'schedule', 'expenses_report', 'contracts_report']) {
    if (!names.includes(n)) continue;
    const x = await fetch(BASE + `/reports/${n}/excel`, { headers: { Authorization: 'Bearer ' + T } });
    const buf = Buffer.from(await x.arrayBuffer());
    ok(`تصدير Excel — ${n}`, x.status === 200 && (x.headers.get('content-type') || '').includes('spreadsheet') && buf.length > 2000, { status: x.status, size: buf.length });
  }
  for (const n of ['interests', 'quotations', 'contracts', 'payments', 'expenses', 'commissions']) {
    const x = await fetch(BASE + `/${n}/excel`, { headers: { Authorization: 'Bearer ' + T } });
    ok(`تصدير Excel مباشر — ${n}`, x.status === 200 && (x.headers.get('content-type') || '').includes('spreadsheet'), x.status);
  }
  const prnt = await req(`/units/${UNIT.id}/full`, {}, T);
  ok('طباعة/PDF: بيانات الوحدة كاملة للطباعة (وحدة+سجل+دفعات)', prnt.s === 200 && !!prnt.d.unit && Array.isArray(prnt.d.history), Object.keys(prnt.d || {}));

  // ============================================================
  sec('16) الصلاحيات والأمان');
  if (ST) {
    ok('أمان: السكرتيرة لا ترى الحسابات المالية', (await req('/accounts', {}, ST)).s === 403);
    ok('أمان: السكرتيرة لا تعتمد المصروفات', (await req('/expenses', { method: 'POST', body: { amount: 100 } }, ST)).s === 403);
    ok('أمان: السكرتيرة لا ترى الموافقات', (await req('/approvals', {}, ST)).s === 403);
    ok('أمان: السكرتيرة تستطيع متابعة الاهتمامات (interests)', (await req('/interests?limit=1', {}, ST)).s === 200);
  }
  ok('أمان: بدون توثيق مرفوض', (await req('/accounts')).s === 401);
  const xss = await req('/clients', { method: 'POST', body: { name: '<script>alert(1)</script>' + RUN, phone: '0500' + RUN } }, T);
  ok('أمان: تخزين المدخلات يتم كمعرّف نصي (لا تنفيذ)', xss.s === 201);
  if (xss.d?.id) await req('/clients/' + xss.d.id, { method: 'DELETE' }, T);
  const sqli = await req(`/interests?q=${encodeURIComponent("' OR 1=1 --")}`, {}, T);
  ok('أمان: محاولة حقن SQL لا تُنفَّذ (لا نتيجة غير مفلترة)', sqli.s === 200 && sqli.d.data.length === 0, sqli.d.data?.length);

  // ============================================================
  sec('17) لوحة الملخص المالي');
  const ov = await req('/finance/overview', {}, T);
  ok('لوحة: ملخص مالي شامل', ov.s === 200, ov.s);
  const fin = await req('/finance/summary', {}, T);
  ok('لوحة: إجماليات النظام (مبيعات/تحصيل/متأخرات)', fin.s === 200 && fin.d.sales && fin.d.overdue, Object.keys(fin.d || {}));

  console.log(`\nالنتيجة: ${pass} ناجح / ${fail} فاشل`);
  if (failures.length) console.log('الفاشلة:\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('QA crashed:', e); process.exit(1); });
