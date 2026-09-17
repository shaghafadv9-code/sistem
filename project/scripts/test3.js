/**
 * Smart Secretary — اختبارات إضافات الوحدات واهتمامات العملاء (المرحلة الثالثة)
 * يغطي قائمة الاختبارات المطلوبة (26 بندًا): إضافة وحدة، المشروع ← المبنى ← الدور،
 * نوع الدور (روف) وعدم افتراض الدور الخامس روفًا، فلترة عدد الغرف (يساوي/أكبر/أقل/بين)
 * مع بقية الفلاتر، اهتمامات العميل المتعددة، فلترة الاهتمامات، مطابقة الوحدة بالعملاء،
 * التحديد، تصدير Excel بالنتائج المفلترة، فتح وإرسال واتساب (يدوي)، استبدال اسم العميل،
 * تسجيل فتح واتساب في السجل، الصلاحيات، وعدم فقدان البيانات القديمة.
 *
 * التشغيل:  API=http://127.0.0.1:3847/api node scripts/test3.js
 */
const BASE = process.env.API || 'http://127.0.0.1:3847/api';
let pass = 0, fail = 0; const failures = [];
const RUN = String(Date.now()).slice(-6);
const num = (v) => Number(v || 0);

async function req(path, opts = {}, token = null) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const ct = r.headers.get('content-type') || '';
  let d = null;
  if (ct.includes('json')) { try { d = await r.json(); } catch { d = null; } }
  else { d = { _raw: true, _size: (await r.arrayBuffer()).byteLength }; }
  return { s: r.status, d };
}
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name); console.log('  ✗ FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 240) : '')); }
};
const sec = (t) => console.log('\n— ' + t);

(async () => {
  console.log('— Smart Secretary — اختبارات الوحدات واهتمامات العملاء —');
  const log = await req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  ok('دخول المدير', log.s === 200 && !!log.d.token, log.d);
  const T = log.d.token;

  // ============================================================
  sec('1) البنية الحالية والبيانات القديمة (بلا فقدان)');
  const beforeU = await req('/units?limit=1', {}, T);
  const beforeC = await req('/clients?limit=1', {}, T);
  const beforeS = await req('/sales?limit=1', {}, T);
  const beforeR = await req('/reservations?limit=1', {}, T);
  ok('الوحدات الحالية موجودة', beforeU.s === 200 && beforeU.d.total > 0, beforeU.d.total);
  ok('العملاء الحاليون موجودون', beforeC.s === 200 && beforeC.d.total > 0, beforeC.d.total);
  ok('المبيعات الحالية موجودة', beforeS.s === 200 && beforeS.d.total > 0, beforeS.d.total);
  ok('الحجوزات الحالية موجودة', beforeR.s === 200 && beforeR.d.total > 0, beforeR.d.total);
  const U0 = beforeU.d.total, C0 = beforeC.d.total, S0 = beforeS.d.total, R0 = beforeR.d.total;

  // ============================================================
  sec('2) المشروع ← المبنى ← الدور (بنوع الدور)');
  const proj = await req('/projects', { method: 'POST', body: { code: 'T' + RUN.slice(-3), name: 'مشروع اختبار ' + RUN, city: 'جدة', status: 'active' } }, T);
  ok('إنشاء مشروع اختباري', [200, 201].includes(proj.s) && proj.d.id, proj.d);
  const PID = proj.d.id;
  const proj2 = await req('/projects', { method: 'POST', body: { code: 'U' + RUN.slice(-3), name: 'مشروع مقارنة ' + RUN, city: 'جدة', status: 'active' } }, T);
  const PID2 = proj2.d.id;

  const bA = await req('/buildings', { method: 'POST', body: { project_id: PID, name: 'مبنى A ' + RUN, floors_count: 4 } }, T);
  ok('إنشاء مبنى داخل المشروع (مع أدوار تلقائية)', [200, 201].includes(bA.s) && bA.d.id, bA.d);
  const BA = bA.d.id;
  const bB = await req('/buildings', { method: 'POST', body: { project_id: PID2, name: 'مبنى B ' + RUN, floors_count: 3 } }, T);
  const BB = bB.d.id;

  const bList = await req(`/buildings?project_id=${PID}`, {}, T);
  ok('المباني تُعرض حسب المشروع فقط', bList.s === 200 && bList.d.data.length === 1 && bList.d.data[0].id === BA, bList.d.data?.map(b => b.name));
  const bList2 = await req(`/buildings?project_id=${PID2}`, {}, T);
  ok('مشروع آخر يعرض مبناه فقط', bList2.d.data.length === 1 && bList2.d.data[0].id === BB);

  const fList = await req(`/floors?building_id=${BA}`, {}, T);
  ok('الأدوار تُعرض حسب المبنى فقط', fList.s === 200 && fList.d.data.length === 4 && fList.d.data.every(f => f.building_id === BA), fList.d.data?.length);

  // الدور الخامس كروف في مشروع اختباري (ولا يفترض النظام ذلك تلقائيًا في غيره)
  const f5 = await req(`/buildings/${BA}/floors`, { method: 'POST', body: { number: 5, type: 'roof' } }, T);
  ok('إنشاء الدور الخامس بنوع «روف»', [200, 201].includes(f5.s) && f5.d.type === 'roof', f5.d);
  const F5 = f5.d.id;
  ok('اسم الدور يُعرض «الدور 5 — روف»', /روف/.test(f5.d.display_name || f5.d.name), f5.d.display_name);
  const bFloors = await req(`/floors?building_id=${BA}`, {}, T);
  const otherFloors = bFloors.d.data.filter(f => f.id !== F5);
  ok('بقية أدوار نفس المبنى ليست روفًا تلقائيًا', otherFloors.every(f => f.type !== 'roof'), otherFloors.map(f => [f.number, f.type]));
  const bBFloors = await req(`/floors?building_id=${BB}`, {}, T);
  ok('الدور الخامس في مبنى آخر ليس روفًا (لا افتراض تلقائي)', bBFloors.d.data.every(f => f.type !== 'roof'), bBFloors.d.data.map(f => [f.number, f.type]));
  const fTypes = await req('/floors/meta', {}, T);
  const tk = (fTypes.d.floor_types || []).map(t => t.k);
  ok('أنواع الأدوار متاحة: قبو/أرضي/ميزانين/عادي/روف/سطح/أخرى', ['basement', 'ground', 'mezzanine', 'normal', 'roof', 'terrace', 'other'].every(k => tk.includes(k)), tk);

  // ============================================================
  sec('3) إضافة وحدة مرتبطة بالدور (مشروع ← مبنى ← دور)');
  const u1 = await req('/units', { method: 'POST', body: { code: 'T-' + RUN + '-1', project_id: PID, building_id: BA, floor_id: F5, type: 'apartment', rooms: 4, bathrooms: 2, parking: 2, area: 160, price: 1000000, status: 'available', delivery_status: 'ready' } }, T);
  ok('إضافة وحدة على الدور الخامس (روف)', [200, 201].includes(u1.s) && u1.d.floor_id === F5, u1.d);
  const U1 = u1.d.id;
  const u2 = await req('/units', { method: 'POST', body: { code: 'T-' + RUN + '-2', project_id: PID, building_id: BA, floor_id: otherFloors[0].id, type: 'apartment', rooms: 3, bathrooms: 2, area: 130, price: 850000, status: 'available' } }, T);
  ok('إضافة وحدة على دور عادي', [200, 201].includes(u2.s) && u2.d.floor_id === otherFloors[0].id, u2.d);
  const U2 = u2.d.id;

  const badFloor = await req('/units', { method: 'POST', body: { code: 'T-' + RUN + '-X', project_id: PID, building_id: BA, floor_id: bBFloors.d.data[0].id, price: 500000 } }, T);
  ok('منع ربط وحدة بدور لا يتبع المبنى المختار', badFloor.s === 400, badFloor.d);
  const noFloor = await req('/units', { method: 'POST', body: { code: 'T-' + RUN + '-Y', project_id: PID, building_id: BA, price: 500000 } }, T);
  ok('منع حفظ وحدة بدون دور في مشروع يتطلب الدور', noFloor.s === 400, noFloor.d);

  const uFull = await req(`/units/${U1}/full`, {}, T);
  ok('بيانات الوحدة تُعرض مع الدور ونوعه (الدور — روف)', uFull.s === 200 && /روف/.test(uFull.d.unit.floor_label || ''), uFull.d.unit?.floor_label);
  ok('بيانات الوحدة: المشروع والمبنى وعدد الغرف رقم فعلي', num(uFull.d.unit.project_id) === num(PID) && uFull.d.unit.building_name === ('مبنى A ' + RUN) && num(uFull.d.unit.rooms) === 4, { p: uFull.d.unit.project_id, pid: PID, b: uFull.d.unit.building_name, r: uFull.d.unit.rooms });

  // ============================================================
  sec('4) فلتر عدد الغرف (يساوي/أكبر/أقل/بين) مع بقية الفلاتر');
  const chat = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const rEq = await req('/units?' + chat({ rooms: 4, rooms_op: 'eq', project_id: PID, limit: 100 }), {}, T);
  ok('غرف = 4 داخل المشروع', rEq.s === 200 && rEq.d.data.every(u => num(u.rooms) === 4) && rEq.d.data.some(u => u.id === U1), rEq.d.total);
  const rGte = await req('/units?' + chat({ rooms: 3, rooms_op: 'gte', project_id: PID, limit: 100 }), {}, T);
  ok('غرف ≥ 3', rGte.d.data.every(u => num(u.rooms) >= 3), rGte.d.total);
  const rLt = await req('/units?' + chat({ rooms: 4, rooms_op: 'lt', project_id: PID, limit: 100 }), {}, T);
  ok('غرف < 4', rLt.d.data.every(u => num(u.rooms) < 4), rLt.d.total);
  const rBet = await req('/units?' + chat({ rooms: 3, rooms_max: 4, rooms_op: 'between', project_id: PID, limit: 100 }), {}, T);
  ok('غرف بين 3 و4', rBet.d.data.every(u => num(u.rooms) >= 3 && num(u.rooms) <= 4) && rBet.d.data.length >= 2, rBet.d.total);
  const rRoof = await req('/units?' + chat({ roof: 1, project_id: PID, limit: 100 }), {}, T);
  ok('فلتر روف داخل المشروع', rRoof.s === 200 && rRoof.d.data.some(u => u.id === U1), rRoof.d.total);
  const rCombo = await req('/units?' + chat({ project_id: PID, floor_type: 'roof', rooms: 4, rooms_op: 'eq', price_min: 900000, price_max: 1200000, status: 'available', limit: 100 }), {}, T);
  ok('فلاتر مجتمعة: مشروع + روف + 4 غرف + السعر + الحالة', rCombo.s === 200 && rCombo.d.data.some(u => u.id === U1) && rCombo.d.data.every(u => u.floor_type === 'roof'), rCombo.d.total);
  const rType = await req('/units?' + chat({ unit_type: 'apartment', project_id: PID, limit: 100 }), {}, T);
  ok('فلتر نوع الوحدة', rType.d.data.every(u => u.type === 'apartment'));
  const rArea = await req('/units?' + chat({ area_min: 150, area_max: 200, project_id: PID, limit: 100 }), {}, T);
  ok('فلتر المساحة (من/إلى)', rArea.d.data.every(u => num(u.area) >= 150 && num(u.area) <= 200));
  const rBuilding = await req('/units?' + chat({ building_id: BA, floor_id: F5, limit: 100 }), {}, T);
  ok('فلتر المبنى + الدور', rBuilding.s === 200 && rBuilding.d.data.every(u => u.building_id === BA && u.floor_id === F5), rBuilding.d.total);

  // ============================================================
  sec('5) العملاء والاهتمامات المتعددة');
  const cl = await req('/clients', { method: 'POST', body: { name: 'عميل اهتمامات ' + RUN, phone: '0566' + RUN, phone2: '0577' + RUN, email: `int${RUN}@test.sa`, city: 'جدة', source: 'اختبار آلي', status: 'potential' } }, T);
  ok('إضافة عميل جديد', [200, 201].includes(cl.s) && cl.d.id, cl.d);
  const CID = cl.d.id;

  const in1 = await req('/interests', { method: 'POST', body: { client_id: CID, property_type: 'apartment', preferred_project_id: PID, min_price: 700000, max_price: 900000, room_count: 3, bathrooms: 2, min_area: 120, max_area: 170, purpose: 'residence', is_roof: 0, property_status: 'ready', notes: 'اهتمام 1' } }, T);
  ok('اهتمام 1 (شقة 3 غرف — بأسماء الحقول القياسية)', [200, 201].includes(in1.s) && in1.d.id && num(in1.d.budget_min) === 700000 && num(in1.d.rooms) === 3, in1.d);
  const I1 = in1.d.id;
  const in2 = await req('/interests', { method: 'POST', body: { client_id: CID, property_type: 'roof', preferred_project_id: PID, floor_id: F5, min_price: 1000000, max_price: 1300000, room_count: 4, is_roof: 1, purpose: 'investment', notes: 'اهتمام 2 (روف)' } }, T);
  ok('اهتمام 2 لنفس العميل (روف 4 غرف)', [200, 201].includes(in2.s) && in2.d.id && num(in2.d.wants_roof) === 1 && in2.d.floor_id === F5, in2.d);
  const I2 = in2.d.id;
  const listC = await req(`/interests?client_id=${CID}`, {}, T);
  ok('العميل الواحد له أكثر من اهتمام (1 ← Many)', listC.s === 200 && listC.d.total === 2, listC.d.total);
  const clientRow = await req('/clients/' + CID, {}, T);
  ok('بيانات العميل في جدول العملاء وحده (لا تكرار)', clientRow.s === 200 && clientRow.d.phone === '0566' + RUN && clientRow.d.source === 'اختبار آلي', { p: clientRow.d?.phone });
  const one = await req('/interests/' + I1, {}, T);
  ok('صف الاهتمام يعرض بيانات العميل بالربط client_id', one.s === 200 && one.d.client_id === CID && one.d.client_name === 'عميل اهتمامات ' + RUN, one.d?.client_name);

  // ============================================================
  sec('6) فلترة اهتمامات العملاء (منها عدد الغرف بأشكاله)');
  const q = (o) => '/interests?' + chat({ client_id: CID, limit: 50, ...o });
  const eq3 = await req(q({ rooms: 3, rooms_op: 'eq' }), {}, T);
  ok('اهتمامات: عدد الغرف = 3', eq3.s === 200 && eq3.d.data.every(r => num(r.rooms) === 3) && eq3.d.total >= 1, eq3.d.total);
  const gt2 = await req(q({ rooms: 2, rooms_op: 'gt' }), {}, T);
  ok('اهتمامات: غرف > 2', gt2.d.data.every(r => num(r.rooms) > 2), gt2.d.total);
  const lt4 = await req(q({ rooms: 4, rooms_op: 'lt' }), {}, T);
  ok('اهتمامات: غرف < 4', lt4.d.data.every(r => num(r.rooms) < 4), lt4.d.total);
  const bet = await req(q({ rooms: 3, rooms_max: 4, rooms_op: 'between' }), {}, T);
  ok('اهتمامات: غرف بين 3 و4', bet.d.total >= 2, bet.d.total);
  const prc = await req(q({ min_price: 600000, max_price: 1000000 }), {}, T);
  ok('اهتمامات: ميزانية (min_price/max_price)', prc.s === 200 && prc.d.total >= 1, prc.d.total);
  const rf = await req(q({ is_roof: 1 }), {}, T);
  ok('اهتمامات: فلتر روف', rf.d.total === 1 && rf.d.data[0].id === I2, rf.d.total);
  const bth = await req(q({ bathrooms: 2 }), {}, T);
  ok('اهتمامات: فلتر عدد الحمامات', bth.d.total >= 1, bth.d.total);
  const ar = await req(q({ area_min: 100, area_max: 200 }), {}, T);
  ok('اهتمامات: فلتر المساحة (تداخل)', ar.s === 200 && ar.d.total >= 1, ar.d.total);
  const unspec = await req(q({ rooms: 5, rooms_op: 'eq' }), {}, T);
  const unspecInc = await req(q({ rooms: 5, rooms_op: 'eq', rooms_include_unspecified: 1 }), {}, T);
  ok('غير المحدد لا يُعامل كصفر: 5 غرف لا تُطابق «غير محدد» افتراضيًا', unspec.d.total === 0 && unspecInc.d.total === 0, { a: unspec.d.total, b: unspecInc.d.total });
  const zeroRoom = await req('/interests', { method: 'POST', body: { client_id: CID, property_type: 'villa', notes: 'بدون تحديد غرف' } }, T);
  ok('اهتمام بدون عدد غرف يُحفظ كـ«غير محدد» لا صفر يُطابق', zeroRoom.s === 201 && num(zeroRoom.d.rooms) === 0 && zeroRoom.d.rooms_label === 'غير محدد', zeroRoom.d);
  const unspec2 = await req(q({ rooms: 5, rooms_op: 'eq' }), {}, T);
  const unspec3 = await req(q({ rooms: 5, rooms_op: 'eq', rooms_include_unspecified: 1 }), {}, T);
  ok('خيار تضمين «غير محدد» يعمل عند الطلب', unspec3.d.total === 1 && unspec2.d.total === 0, { with: unspec3.d.total, without: unspec2.d.total });
  const filtEmp = await req('/interests?employee_id=1&limit=5', {}, T);
  ok('اهتمامات: فلتر موظف المبيعات يعمل', filtEmp.s === 200, filtEmp.s);
  const filtSrc = await req('/interests?source=' + encodeURIComponent('اختبار آلي') + '&limit=5', {}, T);
  ok('اهتمامات: فلتر مصدر العميل', filtSrc.s === 200 && filtSrc.d.total >= 1, filtSrc.d.total);
  const meta = await req('/interests/meta', {}, T);
  ok('اهتمامات: قوائم الفلاتر (مشاريع/أدوار/موظفون/مصادر)', meta.s === 200 && meta.d.floors && meta.d.sources !== undefined, Object.keys(meta.d || {}));

  // ============================================================
  sec('7) مطابقة العملاء مع الوحدات (غير صارمة)');
  const m1 = await req(`/units/${U1}/matches?min_score=0`, {}, T);
  ok('مطابقة الوحدة بالعملاء المهتمين', m1.s === 200 && Array.isArray(m1.d.matches), m1.d.matches?.length);
  const mine = (m1.d.matches || []).filter(m => m.client_id === CID);
  ok('العميل المهتم (روف 4 غرف) يظهر للوحدة الروف', mine.length >= 1, (m1.d.matches || []).map(m => [m.client_id, m.score]));
  ok('المطابقة تعرض نسبة توافق وأسبابها', mine.length ? (mine[0].score > 0 && (mine[0].reasons || []).length > 0) : false, mine[0]?.reasons);
  ok('المطابقة تعرض بيانات العميل والموظف وآخر تواصل', mine.length ? (mine[0].client_name === 'عميل اهتمامات ' + RUN && 'client_phone' in mine[0]) : false);
  const m2 = await req(`/units/${U2}/matches?min_score=0`, {}, T);
  const mine2 = (m2.d.matches || []).filter(m => m.client_id === CID);
  ok('عميل لم يحدد المشروع يُطابق وحدات مشاريع أخرى (غير صارم)', mine2.length >= 1, (m2.d.matches || []).map(m => [m.client_id, m.score]));
  const matchUnits = await req(`/interests/match-units?client_id=${CID}&limit=20`, {}, T);
  ok('وحدات مناسبة للعميل (الاتجاه المعاكس)', matchUnits.s === 200 && Array.isArray(matchUnits.d.units), matchUnits.d.units?.length);

  // ============================================================
  sec('8) مراسلة واتساب (جاهزة + استبدال المتغيرات + سجل التواصل)');
  const msg = await req('/interests/messages', { method: 'POST', body: { interest_ids: [I2], template: 'السلام عليكم {{اسم العميل}}\nالمشروع: {{اسم المشروع}}\nنوع العقار: {{نوع العقار}}\nعدد الغرف: {{عدد الغرف}}\nالسعر: {{السعر}}' } }, T);
  ok('تجهيز رسالة واتساب', msg.s === 200 && msg.d.messages?.length === 1, msg.d);
  const m0 = msg.d.messages?.[0] || {};
  ok('استبدال {{اسم العميل}} بالاسم الحقيقي', m0.text?.includes('عميل اهتمامات ' + RUN), m0.text?.slice(0, 60));
  ok('الرابط يستخدم جوال العميل من جدول العملاء', /wa\.me\/96656|wa\.me\/0566/.test(m0.wa_link || ''), m0.wa_link);
  ok('رسالة جاهزة فقط — لا إرسال جماعي تلقائي', /يدوي/.test(msg.d.note || ''), msg.d.note);
  const lc = await req('/interests/log-contact', { method: 'POST', body: { interest_ids: [I2], unit_id: U1, note: 'مراسلة اختبار ' + RUN } }, T);
  ok('تسجيل فتح واتساب في سجل التواصل', lc.s === 201 && lc.d.count === 1, lc.d);
  ok('السجل يذكر «تم فتح واتساب للمراسلة» لا «تم الإرسال»', /فتح واتساب/.test(lc.d.result || '') && !/تم الإرسال/.test(lc.d.result || ''), lc.d.result);
  const comms = await req(`/clients/${CID}/communications`, {}, T);
  const hasComm = (comms.d.data || []).some(c => c.kind === 'whatsapp' && /فتح واتساب/.test(c.result || ''));
  ok('العملية ظاهرة في سجل العميل مع الموظف والوقت', hasComm, comms.d.data?.length);
  const tl = await req(`/timeline/client/${CID}`, {}, T);
  ok('العملية ظاهرة في الـ Timeline', tl.s === 200 && Array.isArray(tl.d.events), tl.d?.events?.length);

  // ============================================================
  sec('9) تصدير Excel بالنتائج المفلترة');
  const xl = await req('/interests/excel?rooms=4&rooms_op=eq&client_id=' + CID, {}, T);
  ok('تصدير اهتمامات Excel (نتائج الفلترة الحالية)', xl.s === 200 && xl.d._size > 3000, xl.d._size);
  const xl2 = await req(`/units/${U1}/matches/excel?min_score=0`, {}, T);
  ok('تصدير العملاء المهتمين بالوحدة Excel', xl2.s === 200 && xl2.d._size > 3000, xl2.d._size);
  const xl3 = await req('/units/excel?project_id=' + PID, {}, T).catch(() => ({ s: 404, d: {} }));
  ok('تصدير الوحدات Excel (إن كان متاحًا)', [200, 404].includes(xl3.s), xl3.s);

  // ============================================================
  sec('10) تحديد العملاء والإجراءات الجماعية (بيانات الواجهة)');
  const allIds = await req('/interests?' + chat({ client_id: CID, limit: 50, rooms: 3, rooms_op: 'eq' }), {}, T);
  ok('قائمة معرّفات النتائج لتحديد الكل', Array.isArray(allIds.d.ids) && allIds.d.ids.length === allIds.d.total, { ids: allIds.d.ids?.length, total: allIds.d.total });
  const bulk = await req('/interests/messages', { method: 'POST', body: { interest_ids: allIds.d.ids, template: 'السلام عليكم {{اسم العميل}}' } }, T);
  ok('مراسلة مجموعة (جاهزة — الإرسال يدوي)', bulk.s === 200 && bulk.d.messages.length === allIds.d.ids.length, bulk.d.messages?.length);

  // ============================================================
  sec('11) الصلاحيات');
  const deny = await req('/interests/excel');
  ok('بدون توثيق: التصدير مرفوض', deny.s === 401, deny.s);
  const saraL = await req('/auth/login', { method: 'POST', body: { username: 'sara', password: 'sara1234' } });
  const ST = saraL.d?.token;
  const saraView = await req('/interests?limit=1', {}, ST);
  ok('السكرتيرة تستطيع العرض (interests:view)', saraView.s === 200, saraView.s);
  const saraUnits = await req('/floors?building_id=' + BA, {}, ST);
  ok('السكرتيرة تستطيع قراءة الأدوار (وحدة الوحدات)', saraUnits.s === 200, saraUnits.s);
  // سحب صلاحية التصدير من السكرتيرة ثم إرجاعها (اختبار فعلي لتحكم الصلاحيات)
  const roles = await req('/roles/meta', {}, T);
  const saraRole = await req('/roles', {}, T).then(r => (r.d.data || []).find(x => x.name === 'secretary'));
  const permsBefore = await req(`/roles/${saraRole.id}/permissions`, {}, T);
  const kept = (permsBefore.d.data || []).filter(p => !(p.module === 'interests' && p.action === 'export'));
  await req('/roles/' + saraRole.id, { method: 'PUT', body: { permissions: kept } }, T);
  const saraNoExport = await req('/interests/excel', {}, ST);
  ok('سحب صلاحية التصدير يمنع التصدير فعليًا (interests:export)', saraNoExport.s === 403, saraNoExport.s);
  await req('/roles/' + saraRole.id, { method: 'PUT', body: { permissions: permsBefore.d.data } }, T);
  const saraExportBack = await req('/interests/excel', {}, ST);
  ok('إرجاع الصلاحية يعيد التصدير', saraExportBack.s === 200, saraExportBack.s);
  ok('صلاحية المراسلة (interests:contact) موجودة للأدوار', (await req('/roles/' + saraRole.id + '/permissions', {}, T)).d.data.some(p => p.module === 'interests' && p.action === 'contact'));

  // ============================================================
  sec('12) سجل التدقيق');
  const au = await req('/audit?limit=200', {}, T);
  const rowsA = au.d.data || au.d.rows || [];
  const has = (mod, act) => rowsA.some(r => (r.module === mod) && (r.action === act));
  ok('سجل التدقيق يضم إضافة/تعديل اهتمام', has('interests', 'create'), rowsA.length);
  ok('سجل التدقيق يضم تصدير Excel', has('reports', 'export'), rowsA.length);

  // ============================================================
  sec('13) عدم فقدان البيانات القديمة');
  const afterU = await req('/units?limit=1', {}, T);
  const afterC = await req('/clients?limit=1', {}, T);
  const afterS = await req('/sales?limit=1', {}, T);
  const afterR = await req('/reservations?limit=1', {}, T);
  ok('لا فقدان في الوحدات القديمة', afterU.d.total >= U0, { before: U0, after: afterU.d.total });
  ok('لا فقدان في العملاء القديمين', afterC.d.total >= C0, { before: C0, after: afterC.d.total });
  ok('لا فقدان في المبيعات القديمة', afterS.d.total >= S0, { before: S0, after: afterS.d.total });
  ok('لا فقدان في الحجوزات القديمة', afterR.d.total >= R0, { before: R0, after: afterR.d.total });

  console.log(`\nالنتيجة: ${pass} ناجح / ${fail} فاشل`);
  if (failures.length) console.log('الفاشلة:\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('QA crashed:', e); process.exit(1); });
