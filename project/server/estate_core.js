// Smart Secretary — نواة العقارات والمبيعات (حجز → عربون → بيع → عقد → أقساط)
// مصدر واحد لعمليات: عروض الأسعار، الحجوزات، المبيعات، العقود، مطابقة الاهتمامات، الفلاتر.
const { db, nextUniqueCode } = require('./db');
const F = require('./finance_core');

const num = F.num, r2 = F.r2, today = F.today;
const ROOM_OPS = ['any', 'eq', 'gte', 'lte', 'between'];

function unitRow(id) { return db.prepare(`SELECT u.*, p.code project_code, p.name project_name, p.require_building, p.require_floor,
  b.name building_name, f.number floor_no, f.name floor_name, f.type floor_type FROM units u
  JOIN projects p ON p.id=u.project_id LEFT JOIN buildings b ON b.id=u.building_id LEFT JOIN floors f ON f.id=u.floor_id WHERE u.id=?`).get(id); }
function unitDisplay(unitId) {
  const u = unitRow(unitId);
  if (!u) return { floor_label: '', label: '' };
  const floorName = u.floor_name || (u.floor_no ? `الدور ${u.floor_no}` : '');
  const isRoof = u.floor_type === 'roof';
  const floor_label = floorName ? (isRoof && !/روف/.test(floorName) ? `${floorName} — روف` : floorName) : (isRoof ? 'روف' : '');
  return { floor_label, label: `${u.code}${floor_label ? ' — ' + floor_label : ''}` };
}

// ---------------- الفلاتر الموحّدة ----------------
function unitFilterWhere(q = {}, tbl = 'u') {
  const w = [`${tbl}.deleted_at IS NULL`], ps = [];
  const eq = (col, key) => { if (q[key] !== undefined && q[key] !== '' && q[key] !== null) { w.push(`${col}=?`); ps.push(q[key]); } };
  eq(`${tbl}.project_id`, 'project_id'); eq(`${tbl}.building_id`, 'building_id'); eq(`${tbl}.floor_id`, 'floor_id');
  eq(`${tbl}.status`, 'status'); eq(`${tbl}.type`, 'unit_type'); eq(`${tbl}.delivery_status`, 'delivery_status');
  // أسماء مختصرة متوافقة (project / building / floor / type)
  if (q.project && !q.project_id) { w.push(`${tbl}.project_id=?`); ps.push(q.project); }
  if (q.building && !q.building_id) { w.push(`${tbl}.building_id=?`); ps.push(q.building); }
  if (q.floor && !q.floor_id) { w.push(`${tbl}.floor_id=?`); ps.push(q.floor); }
  if (q.type && !q.unit_type) { w.push(`${tbl}.type=?`); ps.push(q.type); }
  if (q.floor_type) { w.push('f.type=?'); ps.push(q.floor_type); }
  // روف: عبر علم الوحدة أو نوع الدور = روف أو نوع الدور المميز للسطح/التراس
  const roof = q.has_roof !== undefined ? q.has_roof : q.roof;
  if (roof === '1' || roof === 1 || roof === true || roof === 'true') w.push(`(${tbl}.has_roof=1 OR f.type IN ('roof','terrace'))`);
  else if (roof === '0' || roof === 0 || roof === false || roof === 'false') w.push(`(COALESCE(${tbl}.has_roof,0)=0 AND (f.type IS NULL OR f.type NOT IN ('roof','terrace')))`);
  if (q.ready === '1') w.push(`${tbl}.delivery_status='ready'`);
  const n = (v) => (v === undefined || v === '' || v === null ? null : Number(v));
  let priceMin = n(q.price_min), priceMax = n(q.price_max);
  if (q.min_price !== undefined) priceMin = n(q.min_price);
  if (q.max_price !== undefined) priceMax = n(q.max_price);
  if (priceMin !== null) { w.push(`${tbl}.price>=?`); ps.push(priceMin); }
  if (priceMax !== null) { w.push(`${tbl}.price<=?`); ps.push(priceMax); }
  if (n(q.area_min) !== null) { w.push(`${tbl}.area>=?`); ps.push(n(q.area_min)); }
  if (n(q.area_max) !== null) { w.push(`${tbl}.area<=?`); ps.push(n(q.area_max)); }
  const baths = n(q.bathrooms);
  if (baths !== null) {
    const bop = q.bathrooms_op === 'gte' ? '>=' : q.bathrooms_op === 'lte' ? '<=' : '=';
    w.push(`${tbl}.bathrooms ${bop} ?`); ps.push(baths);
  }
  if (n(q.parking) !== null) { w.push(`${tbl}.parking>=?`); ps.push(n(q.parking)); }
  // عدد الغرف: = / >= / <= / بين
  const ROOM_ALIAS = { eq: 'eq', '=': 'eq', gte: 'gte', '>=': 'gte', gt: 'gt', '>': 'gt', lte: 'lte', '<=': 'lte', lt: 'lt', '<': 'lt', between: 'between', any: 'any' };
  const op = ROOM_ALIAS[q.rooms_op] !== undefined ? ROOM_ALIAS[q.rooms_op]
    : (q.rooms !== undefined && q.rooms !== '' ? 'eq' : 'any');
  const rooms = n(q.rooms), roomsMax = n(q.rooms_max);
  if (op === 'eq' && rooms !== null) { w.push(`${tbl}.rooms=?`); ps.push(rooms); }
  else if (op === 'gte' && rooms !== null) { w.push(`${tbl}.rooms>=?`); ps.push(rooms); }
  else if (op === 'lte' && rooms !== null) { w.push(`${tbl}.rooms<=?`); ps.push(rooms); }
  else if (op === 'gt' && rooms !== null) { w.push(`${tbl}.rooms>?`); ps.push(rooms); }
  else if (op === 'lt' && rooms !== null) { w.push(`${tbl}.rooms<?`); ps.push(rooms); }
  else if (op === 'between' && rooms !== null && roomsMax !== null) { w.push(`${tbl}.rooms BETWEEN ? AND ?`); ps.push(Math.min(rooms, roomsMax), Math.max(rooms, roomsMax)); }
  if (q.q) { w.push(`(${tbl}.code LIKE ? OR ${tbl}.description LIKE ? OR b.name LIKE ?)`); ps.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  return { where: w.join(' AND '), params: ps };
}
function interestFilterWhere(q = {}) {
  const w = ['i.deleted_at IS NULL'], ps = [];
  const n = (v) => (v === undefined || v === '' || v === null ? null : Number(v));
  const inc = (v) => v === '1' || v === 1 || v === true || v === 'true';
  const val = (...keys) => { for (const k of keys) { const v = q[k]; if (v !== undefined && v !== '' && v !== null) return v; } return undefined; };

  // نوع العقار / المشروع / المنطقة / المدينة
  const ptype = val('property_type');
  if (ptype) { w.push('i.property_type=?'); ps.push(ptype); }
  const pid = val('project_id', 'preferred_project_id');
  if (pid) { w.push('i.preferred_project_id=?'); ps.push(pid); }
  const area = val('area', 'preferred_area');
  if (area) { w.push('(i.preferred_area LIKE ? OR i.city LIKE ?)'); ps.push(`%${area}%`, `%${area}%`); }
  const city = val('city');
  if (city) { w.push('i.city LIKE ?'); ps.push(`%${city}%`); }
  const purpose = val('purpose');
  if (purpose) { w.push('i.purpose=?'); ps.push(purpose); }
  // حالة العقار: جاهز / تحت الإنشاء / لا يهم  (delivery_status = property_status)
  const pstatus = val('delivery_status', 'property_status');
  if (pstatus && pstatus !== 'any') { w.push('i.delivery_status=?'); ps.push(pstatus); }

  // ------ عدد الغرف: = / > / >= / < / <= / بين  (+ خيار تضمين غير المحدد) ------
  const OP = { eq: '=', '=': '=', gt: '>', '>': '>', gte: '>=', '>=': '>=', lt: '<', '<': '<', lte: '<=', '<=': '<=', between: 'between', between_in: 'between' };
  let op = OP[q.rooms_op] || (n(val('rooms', 'room_count')) !== null ? '=' : 'any');
  const rooms = n(val('rooms', 'room_count'));
  const roomsMax = n(val('rooms_max', 'max_rooms', 'rooms_to'));
  const includeUnspec = inc(q.rooms_include_unspecified) || inc(q.include_unspecified);
  if (op !== 'any' && (rooms !== null || roomsMax !== null)) {
    let cond = '';
    if (op === 'between') {
      const a = rooms !== null ? rooms : roomsMax, b = roomsMax !== null ? roomsMax : rooms;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      cond = 'i.rooms BETWEEN ? AND ?'; ps.push(lo, hi);
    } else { cond = `i.rooms ${op} ?`; ps.push(rooms !== null ? rooms : roomsMax); }
    w.push(includeUnspec ? `((i.rooms IS NOT NULL AND ${cond}) OR COALESCE(i.rooms,0)=0)` : `(i.rooms IS NOT NULL AND ${cond})`);
  }

  // ------ عدد الحمامات ------
  const baths = n(val('bathrooms'));
  if (baths !== null) {
    const bop = OP[q.bathrooms_op] || '=';
    if (bop === 'between') { const b2 = n(q.bathrooms_max); if (b2 !== null) { const lo = Math.min(baths, b2), hi = Math.max(baths, b2); w.push('i.bathrooms BETWEEN ? AND ?'); ps.push(lo, hi); } }
    else { w.push(`(i.bathrooms IS NOT NULL AND i.bathrooms ${bop} ?)`); ps.push(baths); }
  }

  // ------ الروف ------
  const roof = val('wants_roof', 'is_roof', 'roof');
  if (roof === '1' || roof === 1 || roof === true || roof === 'true' || roof === 'yes') w.push('i.wants_roof=1');
  else if (roof === '0' || roof === 0 || roof === false || roof === 'false' || roof === 'no') w.push('COALESCE(i.wants_roof,0)=0');

  // ------ الدور: دور محدد بالمعرّف أو نوع دور ------
  const fid = n(val('floor_id'));
  if (fid !== null) { w.push('i.floor_id=?'); ps.push(fid); }
  const fpref = val('floor_pref', 'floor_type');
  if (fpref) { w.push('(i.floor_pref LIKE ? OR i.floor_pref = ?)'); ps.push(`%${fpref}%`, fpref); }

  // ------ الميزانية (تداخل): budget_min/max أو min_price/max_price ------
  const bMin = n(val('budget_min', 'min_price', 'price_min'));
  const bMax = n(val('budget_max', 'max_price', 'price_max'));
  if (bMin !== null) { w.push('(COALESCE(i.budget_max,0)=0 OR i.budget_max>=?)'); ps.push(bMin); }
  if (bMax !== null) { w.push('(COALESCE(i.budget_min,0)=0 OR i.budget_min<=?)'); ps.push(bMax); }

  // ------ المساحة (تداخل) ------
  const aMin = n(val('area_min', 'min_area'));
  const aMax = n(val('area_max', 'max_area'));
  if (aMin !== null) { w.push('(COALESCE(i.area_max,0)=0 OR i.area_max>=?)'); ps.push(aMin); }
  if (aMax !== null) { w.push('(COALESCE(i.area_min,0)=0 OR i.area_min<=?)'); ps.push(aMax); }

  // ------ مواقف السيارات ------
  const parking = n(val('parking', 'parking_spaces'));
  if (parking !== null) { w.push('COALESCE(i.parking,0)>=?'); ps.push(parking); }

  // ------ بيانات العميل ------
  if (q.client_id) { w.push('i.client_id=?'); ps.push(q.client_id); }
  if (q.client_status) { w.push('c.status=?'); ps.push(q.client_status); }
  if (q.employee_id) { w.push('c.assigned_to=?'); ps.push(q.employee_id); }
  if (q.source) { w.push('c.source LIKE ?'); ps.push(`%${q.source}%`); }
  if (q.stage) { w.push('c.pipeline_stage=?'); ps.push(q.stage); }
  if (q.not_contacted_days) { const d = n(q.not_contacted_days); if (d !== null) { w.push("(c.last_contact_at IS NULL OR c.last_contact_at <= datetime('now','localtime','-' || ? || ' days'))"); ps.push(d); } }
  if (q.active === '1') w.push('i.is_active=1');
  if (q.active === '0') w.push('COALESCE(i.is_active,1)=0');
  if (q.priority) { w.push('i.priority=?'); ps.push(q.priority); }
  const pmin = n(val('priority_min')) || 0;
  if (q.priority_min) { w.push('i.priority=?'); ps.push(q.priority_min); }
  if (q.interest_id) { w.push('i.id=?'); ps.push(q.interest_id); }
  if (q.open_units_min) { const m = n(q.open_units_min); if (m !== null) { w.push(`(SELECT COUNT(*) FROM units u WHERE u.deleted_at IS NULL AND u.status IN ('available','resale') AND (i.preferred_project_id IS NULL OR u.project_id=i.preferred_project_id) AND (COALESCE(i.rooms,0)=0 OR u.rooms=i.rooms) AND (COALESCE(i.budget_min,0)=0 OR u.price>=i.budget_min) AND (COALESCE(i.budget_max,0)=0 OR u.price<=i.budget_max)) >= ?`); ps.push(m); } }
  if (q.q) { w.push('(c.name LIKE ? OR c.phone LIKE ? OR c.phone2 LIKE ? OR c.email LIKE ? OR c.code LIKE ? OR i.notes LIKE ? OR i.preferred_area LIKE ?)'); ps.push(...Array(7).fill(`%${q.q}%`)); }
  return { where: w.join(' AND '), params: ps };
}

// ---------------- عروض الأسعار ----------------
function createQuotation(req, b = {}) {
  const { client_id, unit_id = null, project_id = null, price, discount = 0, broker_id = null, quote_date, valid_until = null, notes = '', terms = '' } = b;
  if (!client_id) throw Object.assign(new Error('العميل مطلوب'), { code: 400 });
  if (!db.prepare('SELECT id FROM clients WHERE id=? AND deleted_at IS NULL').get(client_id)) throw Object.assign(new Error('العميل غير موجود'), { code: 404 });
  let unit = null, project = project_id;
  if (unit_id) {
    unit = unitRow(unit_id);
    if (!unit) throw Object.assign(new Error('الوحدة غير موجودة'), { code: 404 });
    project = project || unit.project_id;
  }
  const pr = num(price !== undefined && price !== null && price !== '' ? price : (unit ? unit.price : 0));
  const dc = num(discount);
  if (pr <= 0) throw Object.assign(new Error('سعر العرض يجب أن يكون أكبر من صفر'), { code: 400 });
  if (dc < 0 || dc > pr) throw Object.assign(new Error('الخصم غير منطقي'), { code: 400 });
  let brokerName = '';
  if (broker_id) {
    const br = db.prepare('SELECT * FROM brokers WHERE id=? AND deleted_at IS NULL').get(broker_id);
    if (!br) throw Object.assign(new Error('المسوق غير موجود'), { code: 404 });
    brokerName = br.name;
  }
  const code = nextUniqueCode('QUOTATION', 'quotations', 'code');
  const id = db.prepare(`INSERT INTO quotations (code, client_id, project_id, unit_id, price, discount, net_price, broker_id, broker_name, quote_date, valid_until, status, notes, terms, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, client_id, project, unit_id, pr, dc, r2(pr - dc), broker_id, brokerName, quote_date || today(), valid_until, 'sent', notes, terms, req.user.id).lastInsertRowid;
  F.pushAudit(req.user, 'create', 'quotations', 'quotation', id, `${code} — صافي ${r2(pr - dc)}`);
  return db.prepare('SELECT * FROM quotations WHERE id=?').get(id);
}
/** تحويل عرض السعر عملية ذرّية (عرض + حجز/بيع + حالة الوحدة) */
function convertQuotation(req, quotationId, body = {}) {
  return db.transaction(() => _convertQuotationInner(req, quotationId, body));
}
function _convertQuotationInner(req, quotationId, body = {}) {
  const q = db.prepare('SELECT * FROM quotations WHERE id=? AND deleted_at IS NULL').get(quotationId);
  if (!q) throw Object.assign(new Error('عرض السعر غير موجود'), { code: 404 });
  if (['converted'].includes(q.status)) throw Object.assign(new Error('عرض السعر محوّل مسبقًا'), { code: 400 });
  if (!q.unit_id && !body.unit_id) throw Object.assign(new Error('يجب تحديد الوحدة لتحويل العرض إلى حجز'), { code: 400 });
  const resv = createReservation(req, {
    unit_id: body.unit_id || q.unit_id, client_id: q.client_id, price: q.price, discount: q.discount,
    deposit: body.deposit || 0, deposit_method: body.deposit_method || 'cash', deposit_ref: body.deposit_ref || '',
    reservation_date: body.reservation_date || today(), expiry_date: body.expiry_date || null,
    employee_id: body.employee_id || req.user.id, notes: body.notes || `محوّل من عرض السعر ${q.code}`,
    account_id: body.account_id || null, quotation_id: q.id, quotation_already_linked: true
  });
  db.prepare(`UPDATE quotations SET status='converted', reservation_id=?, updated_at=datetime('now','localtime') WHERE id=?`).run(resv.id, q.id);
  return resv;
}

// ---------------- الحجوزات ----------------
/** الحجز عملية ذرّية: فحص الوحدة + إنشاء الحجز + العربون + حالة الوحدة — كلها داخل معاملة واحدة */
function createReservation(req, b = {}) {
  return db.transaction(() => _createReservationInner(req, b));
}
function _createReservationInner(req, b = {}) {
  const { unit_id, client_id, price, discount = 0, deposit = 0, deposit_method = 'cash', deposit_ref = '', reservation_date, expiry_date = null, employee_id = null, notes = '', account_id = null, quotation_id = null, check_no = '', check_due_date = null, bank_name = '' } = b;
  if (!unit_id || !client_id || price === undefined || !reservation_date) throw Object.assign(new Error('الوحدة والعميل والسعر وتاريخ الحجز حقول مطلوبة'), { code: 400 });
  const unit = unitRow(unit_id);
  if (!unit) throw Object.assign(new Error('الوحدة غير موجودة'), { code: 404 });
  if (!['available', 'resale'].includes(unit.status)) throw Object.assign(new Error(`الوحدة ${unit.code} غير متاحة للحجز (حالتها: ${unit.status})`), { code: 400 });
  // invariant: لا يمكن حجز وحدة مباعة/محجوزة، ولا أكثر من حجز نشط للوحدة الواحدة
  const conflicting = db.prepare("SELECT id, code FROM reservations WHERE unit_id=? AND status='active' LIMIT 1").get(unit_id);
  if (conflicting) throw Object.assign(new Error(`يوجد حجز نشط مسبقًا على الوحدة ${unit.code} (${conflicting.code}) — ألغِه أولًا`), { code: 409 });
  const activeSale = db.prepare("SELECT id, code FROM sales WHERE unit_id=? AND status IN ('active','completed') LIMIT 1").get(unit_id);
  if (activeSale) throw Object.assign(new Error(`الوحدة ${unit.code} مباعة (${activeSale.code}) — لا يمكن حجزها`), { code: 409 });
  const client = db.prepare('SELECT * FROM clients WHERE id=? AND deleted_at IS NULL').get(client_id);
  if (!client) throw Object.assign(new Error('العميل غير موجود'), { code: 404 });
  const pr = num(price), dc = num(discount), dp = num(deposit);
  if (pr <= 0) throw Object.assign(new Error('السعر يجب أن يكون أكبر من صفر'), { code: 400 });
  if (dc < 0 || dc > pr) throw Object.assign(new Error('الخصم غير منطقي — يجب أن يكون بين 0 والسعر'), { code: 400 });
  if (dp < 0 || dp - (pr - dc) > 0.01) throw Object.assign(new Error('العربون غير منطقي — يجب ألا يتجاوز الصافي'), { code: 400 });

  const code = nextUniqueCode('RESERVATION', 'reservations', 'code');
  const id = db.prepare(`INSERT INTO reservations (code, unit_id, client_id, price, discount, deposit, deposit_method, deposit_ref, reservation_date, expiry_date, employee_id, notes, created_by, account_id, quotation_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, unit_id, client_id, pr, dc, 0, deposit_method, deposit_ref, reservation_date, expiry_date, employee_id || req.user.id, notes, req.user.id, account_id || F.defaultAccountId(), quotation_id).lastInsertRowid;

  // العربون = دفعة حقيقية مرتبطة بالحجز والحساب (لا رقم منفصل)
  let payment = null;
  if (dp > 0) {
    payment = F.createPayment(req, {
      amount: dp, method: deposit_method, paid_at: reservation_date, account_id, kind: 'deposit',
      reservation_id: id, client_id, unit_id, project_id: unit.project_id, reference_no: deposit_ref, check_no, check_due_date,
      bank_name, notes: `عربون حجز ${code}`, user: req.user
    });
  }
  F.setUnitStatus(unit_id, 'reserved', `حجز ${code}`, req.user);
  // مزامنة كاش العربون مع الدفعات الفعلية (payments = مصدر الحقيقة)
  if (dp > 0) F.syncReservationDeposit(id);
  setClientStage(client_id, 'reserved', `حجز ${code}`, req.user);
  F.pushAudit(req.user, 'create', 'reservations', 'reservation', id, `${code} — وحدة ${unit.code} — عربون ${dp}`);
  F.notifyRole('admin', 'reservation', `حجز جديد ${code}`, `وحدة ${unit.code} — ${pr.toLocaleString('en')}`, '/reservations');
  if (quotation_id) {
    const q = db.prepare('SELECT client_id FROM quotations WHERE id=?').get(quotation_id);
    if (q && !b.quotation_already_linked) db.prepare(`UPDATE quotations SET status='converted', reservation_id=?, updated_at=datetime('now','localtime') WHERE id=?`).run(id, quotation_id);
  }
  return { id, code, deposit_payment: payment, unit: unit.code };
}

// ---------------- العقود ----------------
function createContract(req, b = {}) {
  const { client_id, project_id = null, unit_id = null, sale_id = null, reservation_id = null, contract_date, start_date = null, end_date = null,
    amount = 0, discount = 0, net_amount = null, status = 'draft', terms = '', notes = '', file_id = null, signed_at = null } = b;
  if (!client_id || !contract_date) throw Object.assign(new Error('العميل وتاريخ العقد مطلوبان'), { code: 400 });
  const code = nextUniqueCode('CONTRACT', 'contracts', 'code');
  const net = net_amount !== null && net_amount !== undefined && net_amount !== '' ? num(net_amount) : r2(num(amount) - num(discount));
  const depositPaid = sale_id ? F.saleTotals(sale_id).paid : 0;
  const id = db.prepare(`INSERT INTO contracts (code, client_id, project_id, unit_id, sale_id, reservation_id, contract_date, start_date, end_date, amount, discount, net_amount, deposit_amount, status, file_id, signed_at, terms, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, client_id, project_id, unit_id, sale_id, reservation_id, contract_date, start_date, end_date,
    num(amount), num(discount), net, depositPaid, status, file_id, signed_at, terms, notes, req.user.id).lastInsertRowid;
  if (sale_id) db.prepare('UPDATE sales SET contract_id=? WHERE id=?').run(id, sale_id);
  if (reservation_id) db.prepare('UPDATE reservations SET contract_id=? WHERE id=?').run(id, reservation_id);
  F.pushAudit(req.user, 'create', 'contracts', 'contract', id, `${code} — صافي ${net}`);
  return db.prepare('SELECT * FROM contracts WHERE id=?').get(id);
}

// ---------------- المبيعات (تحويل حجز → بيع) ----------------
/** البيع عملية ذرّية: وحدة + بيع + دفعة + عقد + أقساط + فاتورة — كلها داخل معاملة واحدة */
function createSale(req, b = {}) {
  return db.transaction(() => _createSaleInner(req, b));
}
function _createSaleInner(req, b = {}) {
  let { reservation_id = null, unit_id = null, client_id = null, sale_price, discount = 0, down_payment = 0, broker_id = null, commission = null,
    broker_name = '', payment_method = 'transfer', reference_no = '', sale_date, notes = '', account_id = null, quotation_id = null, installments = null,
    check_no = '', check_due_date = null, bank_name = '' } = b;
  let unit = null, resv = null;
  if (reservation_id) {
    resv = db.prepare('SELECT * FROM reservations WHERE id=?').get(reservation_id);
    if (!resv) throw Object.assign(new Error('الحجز غير موجود'), { code: 404 });
    if (resv.status !== 'active') throw Object.assign(new Error(`الحجز ${resv.code} غير نشط (حالته: ${resv.status})`), { code: 400 });
    // إذا مُرّرت unit_id مع reservation_id يجب أن تتطابق
    if (unit_id && Number(unit_id) !== Number(resv.unit_id)) throw Object.assign(new Error('الوحدة المحددة لا تطابق وحدة الحجز'), { code: 400 });
    if (client_id && Number(client_id) !== Number(resv.client_id)) throw Object.assign(new Error('العميل المحدد لا يطابق عميل الحجز'), { code: 400 });
    unit = unitRow(resv.unit_id);
    client_id = resv.client_id;
  } else {
    if (!unit_id || !client_id) throw Object.assign(new Error('الوحدة والعميل مطلوبان'), { code: 400 });
    unit = unitRow(unit_id);
    if (!unit) throw Object.assign(new Error('الوحدة غير موجودة'), { code: 404 });
    // invariant: وحدة محجوزة لا تُباع مباشرة بدون حجزها الصحيح — يمنع بيع وحدة محجوزة لعميل آخر
    if (unit.status === 'reserved') {
      const active = db.prepare("SELECT id, code, client_id FROM reservations WHERE unit_id=? AND status='active' LIMIT 1").get(unit.id);
      if (active) throw Object.assign(new Error(`الوحدة ${unit.code} محجوزة بالحجز ${active.code} — يجب إتمام البيع عبر هذا الحجز أو إلغاؤه أولًا`), { code: 409 });
      throw Object.assign(new Error(`الوحدة ${unit.code} بحالة "محجوزة" بلا حجز نشط — صحّح حالة الوحدة أولًا`), { code: 409 });
    }
    if (!['available', 'resale'].includes(unit.status)) throw Object.assign(new Error(`الوحدة غير متاحة للبيع (حالتها ${unit.status})`), { code: 400 });
    const existingSale = db.prepare("SELECT id, code FROM sales WHERE unit_id=? AND status IN ('active','completed') LIMIT 1").get(unit.id);
    if (existingSale) throw Object.assign(new Error(`توجد عملية بيع سابقة على الوحدة ${unit.code} (${existingSale.code})`), { code: 409 });
  }
  const sp = num(sale_price !== undefined && sale_price !== null && sale_price !== '' ? sale_price : (resv ? resv.price : unit.price));
  const dc = num(discount !== undefined && discount !== null && discount !== '' ? discount : (resv ? resv.discount : 0));
  if (sp <= 0) throw Object.assign(new Error('سعر البيع يجب أن يكون أكبر من صفر'), { code: 400 });
  if (dc < 0 || dc > sp) throw Object.assign(new Error('الخصم يجب أن يكون بين 0 وسعر البيع'), { code: 400 });
  const net = r2(sp - dc);

  // اعتماد الخصم الكبير
  const threshold = num(F.setting('finance_require_approval_discount_percent', '10'));
  const discPct = sp > 0 ? (dc / sp) * 100 : 0;
  if (gateNeeded(req, 'large_discount', discPct, threshold, `خصم ${r2(discPct)}% على عملية بيع`)) {
    return gateFlow(req, 'large_discount', 'حجز اعتماد', {
      title: `اعتماد خصم ${r2(discPct)}% — وحدة ${unit.code}`, module: 'sales', amount: dc,
      payload: { ...b, client_id, unit_id: unit.id, sale_price: sp, discount: dc, sale_date: sale_date || today(), _approve_now: true }
    });
  }

  let broker = null, cm = num(commission), bname = broker_name;
  if (broker_id) {
    broker = db.prepare('SELECT * FROM brokers WHERE id=? AND deleted_at IS NULL').get(broker_id);
    if (!broker) throw Object.assign(new Error('الوسيط غير موجود'), { code: 404 });
    if (!bname) bname = broker.name;
    if (commission === null || commission === undefined || commission === '') {
      cm = broker.commission_method === 'fixed' ? num(broker.commission_rate) : r2(net * num(broker.commission_rate) / 100);
    }
  }
  if (cm < 0 || cm > net) throw Object.assign(new Error('العمولة يجب أن تكون بين 0 والصافي'), { code: 400 });
  const settlement = r2(net - cm);
  const code = nextUniqueCode('SALE', 'sales', 'code');
  const saleId = db.prepare(`INSERT INTO sales (code, reservation_id, unit_id, client_id, sale_price, discount, net_price, down_payment, commission, commission_due, broker_id, broker_name, settlement, payment_method, reference_no, sale_date, status, notes, created_by, account_id, quotation_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, reservation_id, unit.id, client_id, sp, dc, net, num(down_payment), cm, cm, broker ? broker.id : null,
    bname, settlement, payment_method, reference_no, sale_date || today(), 'active', notes, req.user.id, account_id || F.defaultAccountId(), quotation_id || (resv ? resv.quotation_id : null)).lastInsertRowid;

  F.setUnitStatus(unit.id, 'sold', `بيع ${code}`, req.user);

  // ربط عربون الحجز بالبيع (بدون تكرار المبلغ)
  if (resv) {
    F.linkDepositToSale(resv.id, saleId, req.user);
    db.prepare(`UPDATE reservations SET status='completed', updated_at=datetime('now','localtime') WHERE id=?`).run(resv.id);
  }
  // إغلاق أي حجوزات نشطة أخرى على نفس الوحدة وفق سياسة واضحة (وحدة واحدة = بيع واحد)
  try {
    const others = db.prepare("SELECT id, code FROM reservations WHERE unit_id=? AND status='active'").all(unit.id);
    others.forEach(o => {
      db.prepare(`UPDATE reservations SET status='cancelled', cancel_reason=?, updated_at=datetime('now','localtime') WHERE id=?`)
        .run(`أُغلق تلقائيًا بسبب إتمام البيع ${code} على نفس الوحدة`, o.id);
      F.pushAudit(req.user, 'update', 'reservations', 'reservation', o.id, `إغلاق الحجز ${o.code} بعد بيع الوحدة`);
    });
  } catch {}
  // تسجيل الدفعة الأولى الحقيقية (المتبقي بعد احتساب أي عربون مربوط)
  const afterLink = F.saleTotals(saleId).paid;
  const extra = r2(num(down_payment) - afterLink);
  if (extra > 0.01) {
    if (extra - net > 0.01) throw Object.assign(new Error('الدفعة الأولى تتجاوز صافي العملية'), { code: 400 });
    // مرجع التحويل إلزامي عند إنشاء دفعة أولى فعلية بتحويل/دفع إلكتروني
    const pm = String(payment_method || '').toLowerCase();
    if (['transfer', 'online'].includes(pm) && !String(reference_no || '').trim()) {
      throw Object.assign(new Error('مرجع التحويل البنكي (reference_no) مطلوب عند الدفعة الأولى بتحويل بنكي'), { code: 400, field: 'reference_no' });
    }
    if (pm === 'check' && !String(check_no || '').trim()) {
      throw Object.assign(new Error('رقم الشيك مطلوب عند الدفعة الأولى بشيك'), { code: 400, field: 'check_no' });
    }
    F.createPayment(req, {
      amount: extra, method: payment_method, paid_at: sale_date || today(), account_id, kind: 'down_payment',
      sale_id: saleId, client_id, unit_id: unit.id, project_id: unit.project_id, reference_no, check_no, check_due_date, bank_name,
      notes: `دفعة أولى لعملية ${code}`, user: req.user
    });
  }
  // مزامنة رأس البيع (طريقة الدفع + المرجع) مع الدفعات الفعلية — يمنع بيعًا يقول transfer بلا مرجع
  try {
    const srcPay = db.prepare(`SELECT method, reference_no, check_no FROM payments
      WHERE sale_id=? AND deleted_at IS NULL AND kind IN ('deposit','down_payment') ORDER BY id LIMIT 1`).get(saleId);
    if (srcPay) {
      const effMethod = String(b.payment_method || '').trim() ? payment_method : srcPay.method;
      const effRef = String(reference_no || '').trim() || String(srcPay.reference_no || '').trim() || String(srcPay.check_no || '').trim();
      if (effMethod !== payment_method || effRef !== String(reference_no || '')) {
        db.prepare('UPDATE sales SET payment_method=?, reference_no=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run(effMethod, effRef, saleId);
      }
    }
  } catch {}
  // العقد
  let contract = db.prepare('SELECT * FROM contracts WHERE sale_id=?').get(saleId);
  if (!contract) {
    contract = createContract(req, {
      client_id, project_id: unit.project_id, unit_id: unit.id, sale_id: saleId, reservation_id: reservation_id || null,
      contract_date: sale_date || today(), start_date: sale_date || today(), amount: sp, discount: dc, net_amount: net,
      status: 'active', signed_at: sale_date || today(), notes: 'عقد مُنشأ آليًا من عملية البيع'
    });
  }
  // جدول الأقساط
  const paidNow = F.saleTotals(saleId).paid;
  let scheduleInfo = null;
  try {
    scheduleInfo = F.generateSchedule({
      sale_id: saleId, reservation_id: reservation_id || null, contract_id: contract.id, client_id, unit_id: unit.id, project_id: unit.project_id,
      total: net, paid: paidNow, installments: installments || num(F.setting('finance_installments_count_default', '12')) || 12,
      first_due: sale_date || today(), user: req.user
    });
  } catch (e) { scheduleInfo = { error: e.message }; }
  // الفاتورة
  const invCode = `INV-${new Date().getFullYear()}-${String(saleId).padStart(4, '0')}`;
  db.prepare('INSERT INTO invoices (code, sale_id, client_id, amount, issued_at) VALUES (?,?,?,?,?)').run(invCode, saleId, client_id, net, sale_date || today());
  setClientStage(client_id, 'sold', `بيع ${code}`, req.user);
  F.pushAudit(req.user, 'create', 'sales', 'sale', saleId, `${code} — صافي ${net} — حساب #${account_id || F.defaultAccountId()}`);
  F.notifyRole('admin', 'sale', `عملية بيع جديدة ${code}`, `صافي ${net.toLocaleString('en')}`, '/sales');
  return { id: saleId, code, net_price: net, settlement, contract_id: contract.id, schedule: scheduleInfo, deposit_linked: !!resv };
}

function gateNeeded(req, action, value, threshold, title) {
  if (F.canApprove(req.user)) return false;
  return value > threshold + 1e-9;
}
function gateFlow(req, actionType, label, spec) {
  const g = F.gate(req, { action_type: actionType, entity_type: spec.entity_type || actionType, entity_id: spec.entity_id || null, title: spec.title, module: spec.module || '', amount: spec.amount || 0, payload: spec.payload || {} });
  if (g.pending) return { pending_approval: g.approval_id, message: `${label}: تم إرسال الطلب للمدير للاعتماد` };
  return g.result;
}

// ---------------- مطابقة اهتمامات العملاء مع الوحدات ----------------
function matchInterestsToUnit(unitId, { limit = 50, minScore = 0 } = {}) {
  const u = unitRow(unitId);
  if (!u) return { unit: null, matches: [] };
  const rows = db.prepare(`SELECT i.*, c.name client_name, c.phone client_phone, c.phone2 client_phone2, c.email client_email, c.status client_status,
      c.pipeline_stage, c.last_contact_at, u2.name employee_name, p.name project_name, p.code project_code
    FROM client_interests i JOIN clients c ON c.id=i.client_id LEFT JOIN users u2 ON u2.id=c.assigned_to
    LEFT JOIN projects p ON p.id=i.preferred_project_id WHERE i.deleted_at IS NULL AND c.deleted_at IS NULL AND i.is_active=1`).all();
  const matches = [];
  rows.forEach(i => {
    let score = 0; const reasons = [];
    // نوع العقار (وزن 20)
    if (i.property_type && i.property_type === u.type) { score += 20; reasons.push('نوع العقار مطابق'); }
    // المشروع (25)
    if (i.preferred_project_id && i.preferred_project_id === u.project_id) { score += 25; reasons.push('المشروع المفضل مطابق'); }
    // الميزانية (25)
    const p = num(u.price);
    if (num(i.budget_min) > 0 || num(i.budget_max) > 0) {
      const min = num(i.budget_min) || 0, max = num(i.budget_max) || Infinity;
      if (p >= min && p <= max) { score += 25; reasons.push('السعر داخل الميزانية'); }
      else if (p >= min * 0.9 && p <= max * 1.1) { score += 10; reasons.push('السعر قريب من الميزانية'); }
    } else { score += 5; reasons.push('لا توجد ميزانية محددة'); }
    // عدد الغرف (15)
    if (num(i.rooms) > 0) { if (num(i.rooms) === num(u.rooms)) { score += 15; reasons.push('عدد الغرف مطابق'); } else if (Math.abs(num(i.rooms) - num(u.rooms)) === 1) { score += 6; reasons.push('فرق غرفة واحدة'); } }
    else score += 3;
    // المساحة (10)
    if (num(i.area_min) || num(i.area_max)) {
      const a = num(u.area), min = num(i.area_min) || 0, max = num(i.area_max) || Infinity;
      if (a >= min && a <= max) { score += 10; reasons.push('المساحة مطابقة'); }
    } else score += 2;
    // عدد الحمامات (5) — غير محدد = لا شرط
    if (num(i.bathrooms) > 0) {
      if (num(i.bathrooms) === num(u.bathrooms)) { score += 5; reasons.push('عدد الحمامات مطابق'); }
      else if (Math.abs(num(i.bathrooms) - num(u.bathrooms)) === 1) { score += 2; reasons.push('فرق حمام واحد'); }
    } else score += 1;
    // الدور / الروف (5) — غير محدد = لا شرط
    if (num(i.wants_roof) === 1) { if (u.floor_type === 'roof' || u.floor_type === 'terrace' || num(u.has_roof) === 1) { score += 5; reasons.push('روف مطلوب ومتوفر'); } }
    else if (i.floor_id) { if (num(i.floor_id) === num(u.floor_id)) { score += 5; reasons.push('نفس الدور المطلوب'); } }
    else if (i.floor_pref) { if ((u.floor_name || '').includes(i.floor_pref) || (u.floor_type && i.floor_pref.includes(u.floor_type))) { score += 5; reasons.push('نوع الدور مطابق'); } }
    else score += 1;
    // المنطقة/المدينة (5)
    if (i.city || i.preferred_area) { if ((u.project_name || '').includes(i.city || '') || (i.city || '') === '' ) score += 2; }
    const total = Math.min(100, score);
    if (total >= minScore) matches.push({
      ...i, score: total, reasons, unit_id: u.id, unit_code: u.code, unit_price: p, unit_rooms: u.rooms, unit_area: u.area,
      unit_bathrooms: u.bathrooms, unit_building: u.building_name, unit_floor_id: u.floor_id, unit_type: u.type,
      unit_has_roof: num(u.has_roof) ? 1 : 0, floor_label: unitDisplay(u.id).floor_label,
      min_price: num(i.budget_min), max_price: num(i.budget_max), room_count: num(i.rooms), is_roof: num(i.wants_roof) ? 1 : 0,
      parking_spaces: num(i.parking), property_status: i.delivery_status
    });
  });
  matches.sort((a, b) => b.score - a.score || String(b.updated_at).localeCompare(String(a.updated_at)));
  return { unit: { ...u, ...unitDisplay(unitId) }, matches: matches.slice(0, limit) };
}

// ---------------- مراحل البيع ----------------
function setClientStage(clientId, toStage, note, user) {
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(clientId);
  if (!c) return null;
  if (c.pipeline_stage === toStage) return { changed: false };
  db.prepare(`UPDATE clients SET pipeline_stage=?, stage_changed_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`).run(toStage, clientId);
  db.prepare('INSERT INTO client_stage_history (client_id, from_stage, to_stage, note, user_id) VALUES (?,?,?,?,?)').run(clientId, c.pipeline_stage || '', toStage, note || '', user?.id || null);
  F.pushAudit(user, 'update', 'pipeline', 'client_stage', clientId, `${c.name}: ${c.pipeline_stage} → ${toStage}`);
  return { changed: true, from: c.pipeline_stage, to: toStage };
}
function pipelineStages() {
  try { return JSON.parse(F.setting('pipeline_stages', '[]')); } catch { return []; }
}

// ---------------- سجل حالة الوحدة ----------------
function unitHistory(unitId) {
  return db.prepare(`SELECT h.*, u.name user_name FROM unit_status_history h LEFT JOIN users u ON u.id=h.user_id WHERE h.unit_id=? ORDER BY h.id DESC`).all(unitId);
}

// ---------------- القوالب والمراسلة ----------------
function renderTemplate(text, vars = {}) {
  return String(text || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}
function buildClientMessage(client, { template, unit = null, project = null }) {
  const vars = {
    'اسم العميل': client.name, client_name: client.name,
    'رقم العميل': client.code, client_code: client.code,
    'اسم المشروع': project?.name || '', project_name: project?.name || '',
    'عدد الغرف': unit ? unit.rooms : '', rooms: unit ? unit.rooms : '',
    'السعر': unit ? Number(unit.price).toLocaleString('en') : '', price: unit ? Number(unit.price).toLocaleString('en') : '',
    'رابط الوحدة': unit ? `#/projects?unit=${unit.id}` : '', unit_link: unit ? `#/projects?unit=${unit.id}` : '',
    'اسم الوحدة': unit ? unit.code : '', unit_code: unit ? unit.code : '',
    'اسم الشركة': F.setting('company_name', 'الشركة')
  };
  return renderTemplate(template, vars);
}
function waLink(phone, text) {
  const cc = F.setting('whatsapp_country_code', '966');
  let p = String(phone || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0')) p = cc + p.slice(1);
  if (!p.startsWith(cc) && p.length <= 10) p = cc + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(text || '')}`;
}

module.exports = {
  unitRow, unitDisplay, unitFilterWhere, interestFilterWhere,
  createQuotation, convertQuotation, createReservation, createContract, createSale,
  matchInterestsToUnit, setClientStage, pipelineStages, unitHistory,
  renderTemplate, buildClientMessage, waLink, gateFlow, gateNeeded
};
