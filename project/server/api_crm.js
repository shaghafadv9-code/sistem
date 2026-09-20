// Smart Secretary — API علاقات العملاء والمبيعات:
// اهتمامات العملاء (فلاتر متقدمة + Excel + مطابقة + مراسلة)، مراحل البيع،
// سجل التواصل، عروض الأسعار، العقود، إدارة المباني/الأدوار/الوحدات، سجل حالة الوحدة.
const express = require('express');
const { db, nextUniqueCode } = require('./db');
const { auth, requirePerm: P, audit } = require('./auth');
const { idParam, need } = require('./security');
const F = require('./finance_core');
const E = require('./estate_core');
const X = require('./xlsx_util');

const R = express.Router();
const num = F.num, r2 = F.r2, today = F.today;
const push = (req, action, module, entity, id, details) => F.pushAudit(req.user, action, module, entity, id, details);
const pageOf = (q, max = 200) => ({ page: Math.max(1, parseInt(q.page) || 1), limit: Math.min(max, Math.max(1, parseInt(q.limit) || 20)) });
const FLOOR_TYPES = [
  { k: 'normal', t: 'دور عادي' }, { k: 'ground', t: 'أرضي' }, { k: 'mezzanine', t: 'ميزانين' },
  { k: 'roof', t: 'روف' }, { k: 'terrace', t: 'سطح' }, { k: 'basement', t: 'قبو' }, { k: 'other', t: 'أخرى' }
];
const PROPERTY_TYPES = [
  { k: 'apartment', t: 'شقة' }, { k: 'villa', t: 'فيلا' }, { k: 'duplex', t: 'دوبلكس' }, { k: 'roof', t: 'روف' },
  { k: 'studio', t: 'استوديو' }, { k: 'land', t: 'أرض' }, { k: 'office', t: 'مكتب' }, { k: 'shop', t: 'معرض/محل' }, { k: 'other', t: 'أخرى' }
];
const PURPOSES = [{ k: 'residence', t: 'سكن' }, { k: 'investment', t: 'استثمار' }, { k: 'resale', t: 'إعادة بيع' }, { k: 'other', t: 'أخرى' }];

// =====================================================================
// اهتمامات العملاء
// =====================================================================
// التحقق: الدور المختار في الاهتمام يجب أن يتبع مبنى داخل المشروع المفضل (إن حُدد المشروع)
function validateInterestFloor(f) {
  if (!f.floor_id) return null;
  const fl = db.prepare('SELECT f.*, b.project_id FROM floors f JOIN buildings b ON b.id=f.building_id WHERE f.id=?').get(f.floor_id);
  if (!fl) return 'الدور المختار غير موجود';
  if (f.preferred_project_id && Number(fl.project_id) !== Number(f.preferred_project_id)) return 'الدور المختار لا يتبع المشروع المفضل';
  return null;
}


// تسجيل فتح واتساب للمراسلة في سجل التواصل وسجل العميل (لا يعني أن الرسالة أُرسلت)
R.post('/interests/log-contact', auth, P('interests', 'contact'), (req, res) => {
  const b = req.body || {};
  const ids = Array.isArray(b.interest_ids) ? b.interest_ids.map(Number).filter(Boolean) : (b.interest_id ? [Number(b.interest_id)] : []);
  if (!ids.length) return res.status(400).json({ error: 'حدد اهتمامًا أو أكثر' });
  const rows = db.prepare(`${INTEREST_SELECT} WHERE i.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  if (!rows.length) return res.status(404).json({ error: 'لا توجد اهتمامات مطابقة' });
  const unit = b.unit_id ? E.unitRow(b.unit_id) : null;
  const kind = 'whatsapp';
  const note = String(b.note || '').trim();
  const result = b.sent_confirmed ? 'تم الإرسال (تأكيد يدوي)' : 'تم فتح واتساب للمراسلة';
  const body = [note || (unit ? `مراسلة بخصوص الوحدة ${unit.code}` : 'مراسلة عبر واتساب'), unit ? `الوحدة: ${unit.code} — ${unit.project_name || ''}` : ''].filter(Boolean).join(' — ');
  const ins = db.prepare(`INSERT INTO communications (client_id, interest_id, unit_id, employee_id, kind, body, result, next_follow_up, occurred_at, created_at)
    VALUES (?,?,?,?,?,?,?,?, datetime('now','localtime'), datetime('now','localtime'))`);
  const created = [];
  rows.forEach(i => {
    const info = ins.run(i.client_id, i.id, unit ? unit.id : null, req.user.id, kind, body, result, b.next_follow_up || null);
    created.push(info.lastInsertRowid);
    try { db.prepare(`UPDATE clients SET last_contact_at=datetime('now','localtime') WHERE id=?`).run(i.client_id); } catch {}
  });
  push(req, 'update', 'interests', 'contact', unit ? unit.id : null, `${result} — ${rows.length} عميل${unit ? ' / وحدة ' + unit.code : ''}`);
  res.status(201).json({ ok: true, count: created.length, ids: created, result, note: 'تم تسجيل العملية في سجل التواصل — لا يُعد هذا تأكيدًا لإرسال الرسالة' });
});

// =====================================================================
// المباني والأدوار: قوائم للاختيار المتسلسل (مشروع → مبنى → دور)
// =====================================================================
R.get('/buildings', auth, P('projects', 'view'), (req, res) => {
  const pid = req.query.project_id ? Number(req.query.project_id) : null;
  const rows = pid
    ? db.prepare(`SELECT b.*, p.name project_name, p.code project_code,
        (SELECT COUNT(*) FROM floors f WHERE f.building_id=b.id) floors_no,
        (SELECT COUNT(*) FROM units u WHERE u.building_id=b.id AND u.deleted_at IS NULL) units_count
        FROM buildings b JOIN projects p ON p.id=b.project_id WHERE b.project_id=? ORDER BY b.id`).all(pid)
    : db.prepare(`SELECT b.*, p.name project_name, p.code project_code,
        (SELECT COUNT(*) FROM floors f WHERE f.building_id=b.id) floors_no,
        (SELECT COUNT(*) FROM units u WHERE u.building_id=b.id AND u.deleted_at IS NULL) units_count
        FROM buildings b JOIN projects p ON p.id=b.project_id ORDER BY b.project_id, b.id`).all();
  res.json({ data: rows, floor_types: FLOOR_TYPES });
});

R.get('/floors', auth, P('units', 'view'), (req, res) => {
  const bid = req.query.building_id ? Number(req.query.building_id) : null;
  const base = `SELECT f.*, f.display_name label, b.name building_name, b.project_id,
    (SELECT COUNT(*) FROM units u WHERE u.floor_id=f.id AND u.deleted_at IS NULL) units_count,
    (SELECT COUNT(*) FROM units u WHERE u.floor_id=f.id AND u.deleted_at IS NULL AND u.status='available') available_count
    FROM floors f JOIN buildings b ON b.id=f.building_id`;
  const rows = bid ? db.prepare(`${base} WHERE f.building_id=? ORDER BY f.number`).all(bid)
    : db.prepare(`${base} ORDER BY b.project_id, f.building_id, f.number`).all();
  res.json({ data: rows.map(r => ({ ...r, type_t: (FLOOR_TYPES.find(t => t.k === r.type) || {}).t || r.type })), floor_types: FLOOR_TYPES });
});

// =====================================================================
// توافق أسماء الحقول: min_price / max_price / room_count / is_roof /
// parking_spaces / property_status  ↔  الأعمدة الفعلية في الجدول
// =====================================================================
const ALIAS_IN = {
  min_price: 'budget_min', max_price: 'budget_max', room_count: 'rooms', rooms_count: 'rooms',
  is_roof: 'wants_roof', roof: 'wants_roof', parking_spaces: 'parking', property_status: 'delivery_status',
  target_price: 'budget_max', max_rooms: 'rooms'
};
function normalizeInterest(b = {}) {
  const o = { ...b };
  Object.entries(ALIAS_IN).forEach(([alias, col]) => {
    if (o[col] === undefined && o[alias] !== undefined) o[col] = o[alias];
  });
  // الأرقام: تُحوَّل فقط عند إرسالها فعليًا (لا تُصفَّر حقول لم تُرسل)
  ['budget_min', 'budget_max', 'rooms', 'bathrooms', 'area_min', 'area_max', 'parking'].forEach(k => {
    if (o[k] === '') o[k] = 0;
    else if (o[k] !== undefined && o[k] !== null) o[k] = Number(o[k]) || 0;
  });
  if (o.wants_roof !== undefined) o.wants_roof = (o.wants_roof === true || o.wants_roof === 1 || o.wants_roof === '1' || o.wants_roof === 'true') ? 1 : 0;
  if (o.preferred_project_id === '') o.preferred_project_id = null;
  if (o.floor_id === '') o.floor_id = null;
  else if (o.floor_id !== undefined && o.floor_id !== null) o.floor_id = Number(o.floor_id) || null;
  return o;
}
// يضيف الأسماء القياسية إلى صفوف القراءة (لا يُغيّر الأعمدة الأصلية)
function interestOut(r) {
  if (!r) return r;
  return {
    ...r,
    min_price: num(r.budget_min), max_price: num(r.budget_max), room_count: num(r.rooms),
    is_roof: num(r.wants_roof) ? 1 : 0, parking_spaces: num(r.parking), property_status: r.delivery_status,
    floor_label: r.floor_display || r.floor_name || (r.floor_type ? (FLOOR_TYPES.find(t => t.k === r.floor_type) || {}).t : '') || '',
    rooms_label: num(r.rooms) > 0 ? String(num(r.rooms)) : 'غير محدد',
    price_label: (num(r.budget_min) || num(r.budget_max)) ? `${num(r.budget_min).toLocaleString('en')} — ${num(r.budget_max).toLocaleString('en')}` : 'غير محدد',
    area_label: (num(r.area_min) || num(r.area_max)) ? `${num(r.area_min)} — ${num(r.area_max)} م²` : 'غير محدد'
  };
}

const INTEREST_SELECT = `SELECT i.*, c.name client_name, c.code client_code, c.phone client_phone, c.phone2 client_phone2, c.email client_email,
  fl.number floor_no, fl.name floor_name, fl.type floor_type, fl.display_name floor_display, bd.name building_name, bd.id building_id,
  c.city client_city, c.status client_status, c.pipeline_stage, c.source client_source, c.last_contact_at, c.assigned_to, us.name employee_name,
  p.name project_name, p.code project_code, (SELECT COUNT(*) FROM units u WHERE u.deleted_at IS NULL
    AND (i.preferred_project_id IS NULL OR u.project_id=i.preferred_project_id)
    AND (i.rooms=0 OR u.rooms=i.rooms) AND (i.budget_min=0 OR u.price>=i.budget_min) AND (i.budget_max=0 OR u.price<=i.budget_max)
    AND u.status IN ('available','resale')) open_units
  FROM client_interests i JOIN clients c ON c.id=i.client_id LEFT JOIN projects p ON p.id=i.preferred_project_id
  LEFT JOIN users us ON us.id=c.assigned_to LEFT JOIN floors fl ON fl.id=i.floor_id LEFT JOIN buildings bd ON bd.id=fl.building_id`;

R.get('/interests', auth, P('interests', 'view'), (req, res) => {
  const { page, limit } = pageOf(req.query);
  const { where, params } = E.interestFilterWhere(req.query);
  const total = db.prepare(`SELECT COUNT(*) c FROM client_interests i JOIN clients c ON c.id=i.client_id WHERE ${where}`).get(...params).c;
  const rows = db.prepare(`${INTEREST_SELECT} WHERE ${where} ORDER BY i.id DESC LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
  const ids = db.prepare(`SELECT DISTINCT i.id FROM client_interests i JOIN clients c ON c.id=i.client_id WHERE ${where}`).all(...params).map(r => r.id);
  res.json({ data: rows.map(interestOut), total, page, pages: Math.ceil(total / limit) || 1, ids, filters: req.query });
});

R.get('/interests/meta', auth, P('interests', 'view'), (req, res) => {
  const distinct = (sql) => db.prepare(sql).all().map(r => r.v).filter(Boolean);
  res.json({
    property_types: PROPERTY_TYPES, purposes: PURPOSES, floor_types: FLOOR_TYPES,
    projects: db.prepare('SELECT id, name, code FROM projects WHERE deleted_at IS NULL ORDER BY name').all(),
    buildings: db.prepare('SELECT id, name, project_id FROM buildings ORDER BY name').all(),
    floors: db.prepare('SELECT f.id, f.number, f.name, f.type, f.building_id, b.project_id FROM floors f JOIN buildings b ON b.id=f.building_id ORDER BY b.project_id, f.number').all(),
    employees: db.prepare(`SELECT id, name FROM users WHERE status='active' AND deleted_at IS NULL ORDER BY name`).all(),
    clients: db.prepare('SELECT id, name, phone FROM clients WHERE deleted_at IS NULL ORDER BY name LIMIT 500').all(),
    cities: distinct('SELECT DISTINCT city v FROM clients WHERE city IS NOT NULL AND city<>\'\''),
    areas: distinct('SELECT DISTINCT preferred_area v FROM client_interests WHERE preferred_area<>\'\''),
    sources: distinct('SELECT DISTINCT source v FROM clients WHERE source<>\'\''),
    rooms_values: db.prepare('SELECT DISTINCT rooms v FROM units WHERE deleted_at IS NULL AND rooms>0 ORDER BY rooms').all().map(r => r.v),
    client_statuses: db.prepare('SELECT DISTINCT status v FROM clients WHERE deleted_at IS NULL').all().map(r => r.v),
    stages: E.pipelineStages(),
    brokers: db.prepare('SELECT id, name FROM brokers WHERE deleted_at IS NULL ORDER BY name').all()
  });
});

R.get('/interests/excel', auth, P('interests', 'export'), async (req, res) => {
  const { where, params } = E.interestFilterWhere(req.query);
  const rows = db.prepare(`${INTEREST_SELECT} WHERE ${where} ORDER BY i.id DESC LIMIT 5000`).all(...params);
  const T = Object.fromEntries(PROPERTY_TYPES.map(t => [t.k, t.t]));
  const PU = Object.fromEntries(PURPOSES.map(t => [t.k, t.t]));
  await X.sendSheet(res, {
    sheet: 'اهتمامات العملاء', title: 'تقرير اهتمامات العملاء (نتائج الفلترة الحالية)', prefix: 'INT', req, user: req.user, filters: req.query,
    cols: [
      { k: 'client_name', t: 'اسم العميل' }, { k: 'client_phone', t: 'الجوال' }, { k: 'client_phone2', t: 'جوال بديل' },
      { k: 'client_email', t: 'البريد الإلكتروني' }, { k: 'project_name', t: 'المشروع المفضل' }, { k: 'property_type_t', t: 'نوع العقار' },
      { k: 'area_t', t: 'المنطقة' }, { k: 'budget_min_t', t: 'الميزانية الدنيا', money: true }, { k: 'budget_max_t', t: 'الميزانية العليا', money: true },
      { k: 'rooms_t', t: 'عدد الغرف' }, { k: 'bathrooms_t', t: 'عدد الحمامات' }, { k: 'floor_t', t: 'الدور المطلوب' },
      { k: 'roof_t', t: 'روف' }, { k: 'area_size', t: 'المساحة المطلوبة' }, { k: 'purpose_t', t: 'الغرض' },
      { k: 'parking_t', t: 'مواقف السيارات' }, { k: 'status_t', t: 'حالة العقار' },
      { k: 'last_contact_at', t: 'آخر تواصل' }, { k: 'employee_name', t: 'موظف المبيعات' }, { k: 'client_source', t: 'مصدر العميل' },
      { k: 'notes', t: 'ملاحظات' }, { k: 'open_units', t: 'وحدات متاحة مطابقة' }
    ],
    rows: rows.map(r => ({
      ...interestOut(r),
      property_type_t: T[r.property_type] || r.property_type, purpose_t: PU[r.purpose] || r.purpose,
      roof_t: num(r.wants_roof) ? 'نعم' : 'لا',
      area_t: r.preferred_area || r.city || 'غير محدد',
      budget_min_t: num(r.budget_min), budget_max_t: num(r.budget_max),
      rooms_t: num(r.rooms) > 0 ? num(r.rooms) : 'غير محدد',
      bathrooms_t: num(r.bathrooms) > 0 ? num(r.bathrooms) : 'غير محدد',
      floor_t: r.floor_display || r.floor_name || (r.floor_pref ? ((FLOOR_TYPES.find(t => t.k === r.floor_pref) || {}).t || r.floor_pref) : 'غير محدد'),
      status_t: ({ ready: 'جاهز', under_construction: 'تحت الإنشاء', any: 'لا يهم' })[r.delivery_status] || 'لا يهم',
      parking_t: num(r.parking) > 0 ? num(r.parking) : 'غير محدد',
      area_size: (num(r.area_min) || num(r.area_max)) ? `${num(r.area_min)} — ${num(r.area_max)} م²` : 'غير محدد'
    }))
  });
});
// مراسلة العملاء (نص جاهز + فتح واتساب — الإرسال يدوي من الموظف)

R.post('/interests/messages', auth, P('interests', 'contact'), (req, res) => {
  const b = req.body || {};
  const ids = Array.isArray(b.interest_ids) ? b.interest_ids.map(Number).filter(Boolean) : [];
  const template = String(b.template || '').trim();
  if (!template) return res.status(400).json({ error: 'نص الرسالة مطلوب' });
  if (!ids.length) return res.status(400).json({ error: 'حدد عميلًا واحدًا على الأقل' });
  const rows = db.prepare(`${INTEREST_SELECT} WHERE i.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const messages = rows.map(i => {
    const unit = b.unit_id ? E.unitRow(b.unit_id) : null;
    const project = i.preferred_project_id ? db.prepare('SELECT * FROM projects WHERE id=?').get(i.preferred_project_id) : null;
    const text = E.buildClientMessage({ name: i.client_name, code: i.client_code }, { template, unit, project });
    return {
      interest_id: i.id, client_id: i.client_id, client_name: i.client_name, phone: i.client_phone, phone2: i.client_phone2,
      email: i.client_email, project_name: i.project_name, purpose: i.purpose, property_type: i.property_type,
      rooms: num(i.rooms), price: num(i.budget_max) || num(i.budget_min),
      text, wa_link: E.waLink(i.client_phone, text), wa_link2: i.client_phone2 ? E.waLink(i.client_phone2, text) : ''
    };
  });
  push(req, 'create', 'interests', 'message_batch', null, `${messages.length} رسالة جاهزة`);
  res.json({ messages, note: 'افتح واتساب لكل عميل وأرسل الرسالة يدويًا — الربط الرسمي بـ WhatsApp Business API جاهز للإضافة لاحقًا' });
});
// وحدات مطابقة للاهتمامات المفلترة

R.get('/interests/match-units', auth, P('interests', 'view'), (req, res) => {
  const { where, params } = E.interestFilterWhere(req.query);
  const interests = db.prepare(`${INTEREST_SELECT} WHERE ${where} ORDER BY i.id DESC LIMIT 50`).all(...params);
  const seen = new Set(), units = [];
  interests.forEach(i => {
    const w = ['u.deleted_at IS NULL', "u.status IN ('available','resale')"], ps = [];
    if (i.property_type) { w.push('u.type=?'); ps.push(i.property_type); }
    if (i.preferred_project_id) { w.push('u.project_id=?'); ps.push(i.preferred_project_id); }
    if (num(i.budget_min) > 0) { w.push('u.price>=?'); ps.push(num(i.budget_min)); }
    if (num(i.budget_max) > 0) { w.push('u.price<=?'); ps.push(num(i.budget_max)); }
    if (num(i.rooms) > 0) { w.push('u.rooms=?'); ps.push(num(i.rooms)); }
    if (num(i.bathrooms) > 0) { w.push('u.bathrooms>=?'); ps.push(num(i.bathrooms)); }
    if (num(i.budget_min) > 0) { /* ميزانية */ }
    if (num(i.area_min) > 0) { w.push('u.area>=?'); ps.push(num(i.area_min)); }
    if (num(i.area_max) > 0) { w.push('u.area<=?'); ps.push(num(i.area_max)); }
    if (num(i.floor_id) > 0) { w.push('u.floor_id=?'); ps.push(num(i.floor_id)); }
    if (num(i.wants_roof) === 1) w.push("(f.type IN ('roof','terrace') OR u.has_roof=1)");
    const rows = db.prepare(`SELECT u.*, p.name project_name, b.name building_name, f.name floor_name, f.display_name floor_display, f.type floor_type,
      (SELECT COUNT(*) FROM client_interests i2 WHERE i2.id=?) interest_ref
      FROM units u JOIN projects p ON p.id=u.project_id LEFT JOIN buildings b ON b.id=u.building_id LEFT JOIN floors f ON f.id=u.floor_id
      WHERE ${w.join(' AND ')} ORDER BY u.price LIMIT 6`).all(i.id, ...ps);
    rows.forEach(u => { if (!seen.has(u.id)) { seen.add(u.id); units.push({ ...u, for_client: i.client_name, for_client_id: i.client_id, interest_id: i.id, interest_code: i.code }); } });
  });
  res.json({ units: units.slice(0, 200), interests_count: interests.length });
});

// =====================================================================
// مراحل البيع (Pipeline)
// =====================================================================

R.get('/interests/:id', auth, P('interests', 'view'), idParam, (req, res) => {
  const row = db.prepare(`${INTEREST_SELECT} WHERE i.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'الاهتمام غير موجود' });
  row.stage_history = db.prepare(`SELECT h.*, u.name user_name FROM client_stage_history h LEFT JOIN users u ON u.id=h.user_id WHERE h.client_id=? ORDER BY h.id DESC LIMIT 30`).all(row.client_id);
  row.communications = db.prepare(`SELECT cm.*, u.name user_name FROM communications cm LEFT JOIN users u ON u.id=cm.employee_id WHERE cm.client_id=? ORDER BY cm.occurred_at DESC LIMIT 30`).all(row.client_id);
  res.json(row);
});
function interestFields(b) {
  return {
    client_id: b.client_id, property_type: b.property_type || 'apartment', preferred_project_id: b.preferred_project_id || null,
    preferred_area: b.preferred_area || '', city: b.city || '', budget_min: num(b.budget_min), budget_max: num(b.budget_max),
    rooms: num(b.rooms), bathrooms: num(b.bathrooms), floor_pref: b.floor_pref || '', wants_roof: b.wants_roof ? 1 : 0,
    area_min: num(b.area_min), area_max: num(b.area_max), parking: num(b.parking), delivery_status: b.delivery_status || 'any',
    purpose: b.purpose || 'residence', priority: b.priority || 'medium', notes: b.notes || '', special_requests: b.special_requests || '',
    sales_notes: b.sales_notes || '', floor_id: b.floor_id ? Number(b.floor_id) : null,
    is_active: b.is_active === undefined ? 1 : (b.is_active ? 1 : 0)
  };
}

R.post('/interests', auth, P('interests', 'create'), need('client_id'), (req, res) => {
  req.body = normalizeInterest(req.body || {});
  const b = req.body || {};
  if (!db.prepare('SELECT id FROM clients WHERE id=? AND deleted_at IS NULL').get(b.client_id)) return res.status(404).json({ error: 'العميل غير موجود' });
  if (num(b.budget_min) > 0 && num(b.budget_max) > 0 && num(b.budget_min) > num(b.budget_max)) return res.status(400).json({ error: 'الحد الأدنى للسعر أكبر من الحد الأعلى' });
  const f = interestFields(b);
  const badFloor = validateInterestFloor(f);
  if (badFloor) return res.status(400).json({ error: badFloor });
  const code = nextUniqueCode('INT', 'client_interests', 'code');
  const id = db.prepare(`INSERT INTO client_interests (code, client_id, property_type, preferred_project_id, preferred_area, city, budget_min, budget_max, rooms, bathrooms, floor_pref, wants_roof, area_min, area_max, parking, delivery_status, purpose, priority, notes, special_requests, sales_notes, floor_id, is_active, created_by, updated_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, f.client_id, f.property_type, f.preferred_project_id, f.preferred_area, f.city, f.budget_min, f.budget_max, f.rooms, f.bathrooms, f.floor_pref, f.wants_roof, f.area_min, f.area_max, f.parking, f.delivery_status, f.purpose, f.priority, f.notes, f.special_requests, f.sales_notes, f.floor_id, f.is_active, req.user.id, req.user.id).lastInsertRowid;
  db.prepare('UPDATE clients SET interest_summary=? WHERE id=?').run(interestSummary(f.client_id), f.client_id);
  push(req, 'create', 'interests', 'interest', id, `${code} — عميل ${f.client_id}`);
  res.status(201).json(interestOut(db.prepare(`${INTEREST_SELECT} WHERE i.id=?`).get(id)));
});

R.put('/interests/:id', auth, P('interests', 'edit'), idParam, (req, res) => {
  req.body = normalizeInterest(req.body || {});
  const cur = db.prepare('SELECT * FROM client_interests WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'الاهتمام غير موجود' });
  const f = interestFields({ ...cur, ...(req.body || {}) });
  const badFloor = validateInterestFloor(f);
  if (badFloor) return res.status(400).json({ error: badFloor });
  db.prepare(`UPDATE client_interests SET property_type=?, preferred_project_id=?, preferred_area=?, city=?, budget_min=?, budget_max=?, rooms=?, bathrooms=?, floor_pref=?, wants_roof=?, area_min=?, area_max=?, parking=?, delivery_status=?, purpose=?, priority=?, notes=?, special_requests=?, sales_notes=?, floor_id=?, is_active=?, updated_by=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(f.property_type, f.preferred_project_id, f.preferred_area, f.city, f.budget_min, f.budget_max, f.rooms, f.bathrooms, f.floor_pref, f.wants_roof, f.area_min, f.area_max, f.parking, f.delivery_status, f.purpose, f.priority, f.notes, f.special_requests, f.sales_notes, f.floor_id, f.is_active, req.user.id, cur.id);
  db.prepare('UPDATE clients SET interest_summary=? WHERE id=?').run(interestSummary(cur.client_id), cur.client_id);
  push(req, 'update', 'interests', 'interest', cur.id, 'تحديث اهتمام');
  res.json(interestOut(db.prepare(`${INTEREST_SELECT} WHERE i.id=?`).get(cur.id)));
});

R.delete('/interests/:id', auth, P('interests', 'delete'), idParam, (req, res) => {
  const cur = db.prepare('SELECT * FROM client_interests WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'الاهتمام غير موجود' });
  db.prepare(`UPDATE client_interests SET deleted_at=datetime('now','localtime') WHERE id=?`).run(cur.id);
  push(req, 'delete', 'interests', 'interest', cur.id, cur.code);
  res.json({ ok: true });
});
function interestSummary(clientId) {
  const rows = db.prepare('SELECT property_type, rooms, budget_min, budget_max FROM client_interests WHERE client_id=? AND deleted_at IS NULL AND is_active=1').all(clientId);
  const T = Object.fromEntries(PROPERTY_TYPES.map(t => [t.k, t.t]));
  return rows.map(r => `${T[r.property_type] || r.property_type}${r.rooms ? ' ' + r.rooms + ' غرف' : ''}${(num(r.budget_min) || num(r.budget_max)) ? ` — ${num(r.budget_min).toLocaleString('en')} إلى ${num(r.budget_max).toLocaleString('en')}` : ''}`).join(' | ');
}

R.get('/pipeline', auth, P('pipeline', 'view'), (req, res) => {
  const stages = E.pipelineStages();
  const params = [];
  let w = 'c.deleted_at IS NULL';
  if (req.query.employee_id) { w += ' AND c.assigned_to=?'; params.push(req.query.employee_id); }
  if (req.query.project_id) { w += ' AND EXISTS (SELECT 1 FROM client_interests i WHERE i.client_id=c.id AND i.preferred_project_id=?)'; params.push(req.query.project_id); }
  const clients = db.prepare(`SELECT c.id, c.code, c.name, c.phone, c.status, c.pipeline_stage, c.stage_changed_at, c.last_contact_at, c.assigned_to,
      us.name employee_name, (SELECT GROUP_CONCAT(DISTINCT i2.property_type) FROM client_interests i2 WHERE i2.client_id=c.id AND i2.deleted_at IS NULL) interests,
      (SELECT COALESCE(SUM(s.net_price),0) FROM sales s WHERE s.client_id=c.id AND s.status<>'cancelled') total_sales
    FROM clients c LEFT JOIN users us ON us.id=c.assigned_to WHERE ${w} ORDER BY c.id DESC LIMIT 1000`).all(...params);
  const board = stages.map(s => ({ ...s, clients: clients.filter(c => (c.pipeline_stage || 'lead') === s.k) }));
  const unassigned = clients.filter(c => !stages.some(s => s.k === (c.pipeline_stage || 'lead')));
  if (unassigned.length) board.push({ k: 'other', name: 'غير محدد', color: '#94a3b8', clients: unassigned });
  res.json({ stages: board, total: clients.length, summary: stages.map(s => ({ k: s.k, name: s.name, count: clients.filter(c => (c.pipeline_stage || 'lead') === s.k).length })) });
});

R.put('/clients/:id/stage', auth, P('pipeline', 'edit'), idParam, (req, res) => {
  const { stage, note } = req.body || {};
  const stages = E.pipelineStages();
  if (stage !== 'closed' && stage !== 'lead' && !stages.some(s => s.k === stage)) return res.status(400).json({ error: 'مرحلة غير صالحة' });
  const out = E.setClientStage(Number(req.params.id), stage, note, req.user);
  if (!out) return res.status(404).json({ error: 'العميل غير موجود' });
  res.json({ ok: true, ...out });
});

R.get('/clients/:id/stages', auth, P('pipeline', 'view'), idParam, (req, res) => {
  res.json({ data: db.prepare(`SELECT h.*, u.name user_name FROM client_stage_history h LEFT JOIN users u ON u.id=h.user_id WHERE h.client_id=? ORDER BY h.id DESC`).all(req.params.id) });
});

// =====================================================================
// سجل التواصل (Timeline)
// =====================================================================
function commWhere(q) {
  const w = ['cm.deleted_at IS NULL'], ps = [];
  const eq = (col, key) => { if (q[key] !== undefined && q[key] !== '' && q[key] !== null) { w.push(`${col}=?`); ps.push(q[key]); } };
  eq('cm.client_id', 'client_id'); eq('cm.kind', 'kind'); eq('cm.employee_id', 'employee_id'); eq('cm.interest_id', 'interest_id');
  if (q.from) { w.push('cm.occurred_at>=?'); ps.push(q.from); }
  if (q.to) { w.push('cm.occurred_at<=?'); ps.push(q.to); }
  if (q.q) { w.push('(cm.body LIKE ? OR cm.subject LIKE ? OR cm.result LIKE ?)'); ps.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  return { w, ps };
}

R.get('/communications', auth, P('communications', 'view'), (req, res) => {
  const { page, limit } = pageOf(req.query);
  const { w, ps } = commWhere(req.query);
  const total = db.prepare(`SELECT COUNT(*) c FROM communications cm WHERE ${w.join(' AND ')}`).get(...ps).c;
  const rows = db.prepare(`SELECT cm.*, c.name client_name, c.phone client_phone, u.name employee_name, i.code interest_code
    FROM communications cm JOIN clients c ON c.id=cm.client_id LEFT JOIN users u ON u.id=cm.employee_id LEFT JOIN client_interests i ON i.id=cm.interest_id
    WHERE ${w.join(' AND ')} ORDER BY cm.occurred_at DESC, cm.id DESC LIMIT ? OFFSET ?`).all(...ps, limit, (page - 1) * limit);
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1 });
});

R.get('/communications/upcoming', auth, P('communications', 'view'), (req, res) => {
  const days = num(req.query.days, 7);
  const rows = db.prepare(`SELECT cm.*, c.name client_name, c.phone client_phone, u.name employee_name FROM communications cm
    JOIN clients c ON c.id=cm.client_id LEFT JOIN users u ON u.id=cm.employee_id
    WHERE cm.deleted_at IS NULL AND cm.next_follow_up IS NOT NULL AND cm.next_follow_up <= date('now','localtime', '+' || ? || ' days') AND cm.next_follow_up >= date('now','localtime','-30 days')
    ORDER BY cm.next_follow_up LIMIT 300`).all(days);
  res.json({ data: rows, count: rows.length });
});

R.post('/communications', auth, P('communications', 'create'), need('client_id', 'kind'), (req, res) => {
  const b = req.body || {};
  if (!['whatsapp', 'call', 'sms', 'email', 'meeting', 'note', 'visit'].includes(b.kind)) return res.status(400).json({ error: 'نوع تواصل غير صالح' });
  if (!db.prepare('SELECT id FROM clients WHERE id=? AND deleted_at IS NULL').get(b.client_id)) return res.status(404).json({ error: 'العميل غير موجود' });
  const id = db.prepare(`INSERT INTO communications (client_id, interest_id, unit_id, sale_id, quotation_id, kind, direction, subject, body, result, employee_id, occurred_at, next_follow_up)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.client_id, b.interest_id || null, b.unit_id || null, b.sale_id || null, b.quotation_id || null, b.kind,
    b.direction || 'out', b.subject || '', b.body || '', b.result || '', b.employee_id || req.user.id, b.occurred_at || F.nowStr(), b.next_follow_up || null).lastInsertRowid;
  db.prepare(`UPDATE clients SET last_contact_at=?, updated_at=datetime('now','localtime') WHERE id=?`).run(b.occurred_at || F.nowStr(), b.client_id);
  // تحديث تلقائي لمرحلة العميل عند التواصل الأول
  try {
    const c = db.prepare('SELECT pipeline_stage FROM clients WHERE id=?').get(b.client_id);
    if (c && ['lead', '', null].includes(c.pipeline_stage)) E.setClientStage(b.client_id, 'contacted', 'تواصل أول', req.user);
  } catch {}
  push(req, 'create', 'communications', 'communication', id, `${b.kind} — عميل ${b.client_id}`);
  res.status(201).json(db.prepare('SELECT * FROM communications WHERE id=?').get(id));
});

R.put('/communications/:id', auth, P('communications', 'edit'), idParam, (req, res) => {
  const c = db.prepare('SELECT * FROM communications WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'السجل غير موجود' });
  const b = req.body || {};
  db.prepare(`UPDATE communications SET kind=?, subject=?, body=?, result=?, occurred_at=?, next_follow_up=? WHERE id=?`)
    .run(b.kind || c.kind, b.subject ?? c.subject, b.body ?? c.body, b.result ?? c.result, b.occurred_at || c.occurred_at, b.next_follow_up ?? c.next_follow_up, c.id);
  push(req, 'update', 'communications', 'communication', c.id, b.kind || c.kind);
  res.json(db.prepare('SELECT * FROM communications WHERE id=?').get(c.id));
});

R.delete('/communications/:id', auth, P('communications', 'delete'), idParam, (req, res) => {
  const c = db.prepare('SELECT * FROM communications WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'السجل غير موجود' });
  db.prepare(`UPDATE communications SET deleted_at=datetime('now','localtime') WHERE id=?`).run(c.id);
  push(req, 'delete', 'communications', 'communication', c.id, '');
  res.json({ ok: true });
});

R.get('/clients/:id/communications', auth, P('clients', 'view'), idParam, (req, res) => {
  res.json({
    data: db.prepare(`SELECT cm.*, u.name employee_name FROM communications cm LEFT JOIN users u ON u.id=cm.employee_id WHERE cm.client_id=? AND cm.deleted_at IS NULL ORDER BY cm.occurred_at DESC`).all(req.params.id),
    client: db.prepare('SELECT id, name, phone, phone2, email, pipeline_stage, last_contact_at, assigned_to FROM clients WHERE id=?').get(req.params.id)
  });
});

// =====================================================================
// عروض الأسعار
// =====================================================================
const QUOTE_SELECT = `SELECT q.*, c.name client_name, c.phone client_phone, c.email client_email, p.name project_name, p.code project_code, u.code unit_code,
  u.rooms unit_rooms, u.area unit_area, u.type unit_type, b.name building_name, f.name floor_name, f.type floor_type, b2.name broker_display, us.name created_by_name,
  r.code reservation_code
  FROM quotations q JOIN clients c ON c.id=q.client_id LEFT JOIN projects p ON p.id=q.project_id LEFT JOIN units u ON u.id=q.unit_id
  LEFT JOIN buildings b ON b.id=u.building_id LEFT JOIN floors f ON f.id=u.floor_id LEFT JOIN brokers b2 ON b2.id=q.broker_id
  LEFT JOIN users us ON us.id=q.created_by LEFT JOIN reservations r ON r.id=q.reservation_id`;

R.get('/quotations', auth, P('quotations', 'view'), (req, res) => {
  const { page, limit } = pageOf(req.query);
  const w = ['q.deleted_at IS NULL'], ps = [];
  const eq = (col, key) => { if (req.query[key] !== undefined && req.query[key] !== '' && req.query[key] !== null) { w.push(`${col}=?`); ps.push(req.query[key]); } };
  eq('q.status', 'status'); eq('q.client_id', 'client_id'); eq('q.project_id', 'project_id'); eq('q.unit_id', 'unit_id');
  if (req.query.from) { w.push('q.quote_date>=?'); ps.push(req.query.from); }
  if (req.query.to) { w.push('q.quote_date<=?'); ps.push(req.query.to); }
  if (req.query.q) { w.push('(q.code LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)'); ps.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  const total = db.prepare(`SELECT COUNT(*) c FROM quotations q JOIN clients c ON c.id=q.client_id WHERE ${w.join(' AND ')}`).get(...ps).c;
  const rows = db.prepare(`${QUOTE_SELECT} WHERE ${w.join(' AND ')} ORDER BY q.id DESC LIMIT ? OFFSET ?`).all(...ps, limit, (page - 1) * limit);
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1 });
});

R.get('/quotations/excel', auth, P('quotations', 'export'), async (req, res) => {
  const rows = db.prepare(`${QUOTE_SELECT} WHERE q.deleted_at IS NULL ORDER BY q.id DESC LIMIT 5000`).all();
  await X.sendSheet(res, {
    sheet: 'عروض الأسعار', title: 'تقرير عروض الأسعار', prefix: 'QTN', req, user: req.user, filters: req.query,
    cols: [{ k: 'code', t: 'رقم العرض' }, { k: 'quote_date', t: 'تاريخ العرض' }, { k: 'valid_until', t: 'تاريخ الانتهاء' }, { k: 'client_name', t: 'العميل' },
      { k: 'client_phone', t: 'الجوال' }, { k: 'project_name', t: 'المشروع' }, { k: 'unit_code', t: 'الوحدة' }, { k: 'price', t: 'السعر', money: true },
      { k: 'discount', t: 'الخصم', money: true }, { k: 'net_price', t: 'الصافي', money: true }, { k: 'broker_display', t: 'المسوق' }, { k: 'status', t: 'الحالة' }, { k: 'notes', t: 'ملاحظات' }],
    rows, totalsKeys: ['price', 'discount', 'net_price']
  });
});

// =====================================================================
// العقود
// =====================================================================
const CONTRACT_SELECT = `SELECT ct.*, c.name client_name, c.phone client_phone, c.nationality, p.name project_name, p.code project_code, u.code unit_code,
  s.code sale_code, s.net_price sale_net, rv.code reservation_code, us.name created_by_name, f.original_name file_name,
  (SELECT id FROM quotations q WHERE q.id=ct.quotation_id) quotation_ref
  FROM contracts ct JOIN clients c ON c.id=ct.client_id LEFT JOIN projects p ON p.id=ct.project_id LEFT JOIN units u ON u.id=ct.unit_id
  LEFT JOIN sales s ON s.id=ct.sale_id LEFT JOIN reservations rv ON rv.id=ct.reservation_id LEFT JOIN users us ON us.id=ct.created_by LEFT JOIN files f ON f.id=ct.file_id`;
function contractCalc(ct) {
  const schedule = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) amount, COALESCE(SUM(paid_amount),0) paid FROM payment_schedule WHERE contract_id=? AND deleted_at IS NULL`).get(ct.id);
  const tot = ct.sale_id ? F.saleTotals(ct.sale_id) : { paid: 0, remaining: num(ct.net_amount), net_price: num(ct.net_amount), commission: 0, commission_paid: 0 };
  const payments = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE contract_id=? AND status='confirmed' AND deleted_at IS NULL`).get(ct.id).v;
  return { ...ct, schedule_count: schedule.n, schedule_amount: r2(schedule.amount), schedule_paid: r2(schedule.paid), totals: tot, contract_paid: r2(payments), contract_remaining: r2(num(ct.net_amount) - num(payments)) };
}

R.get('/quotations/:id', auth, P('quotations', 'view'), idParam, (req, res) => {
  const q = db.prepare(`${QUOTE_SELECT} WHERE q.id=?`).get(req.params.id);
  if (!q) return res.status(404).json({ error: 'عرض السعر غير موجود' });
  q.company = X.settings();
  q.valid_days = q.valid_until ? Math.ceil((new Date(q.valid_until) - new Date()) / 86400000) : null;
  res.json(q);
});

R.post('/quotations', auth, P('quotations', 'create'), (req, res) => {
  try { const out = E.createQuotation(req, req.body || {}); res.status(201).json(out); }
  catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});

R.put('/quotations/:id', auth, P('quotations', 'edit'), idParam, (req, res) => {
  const q = db.prepare('SELECT * FROM quotations WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'عرض السعر غير موجود' });
  if (q.status === 'converted') return res.status(400).json({ error: 'لا يمكن تعديل عرض محوّل إلى حجز' });
  const b = req.body || {};
  const price = b.price !== undefined ? num(b.price) : num(q.price);
  const discount = b.discount !== undefined ? num(b.discount) : num(q.discount);
  if (price <= 0 || discount < 0 || discount > price) return res.status(400).json({ error: 'السعر/الخصم غير منطقي' });
  db.prepare(`UPDATE quotations SET unit_id=?, project_id=?, price=?, discount=?, net_price=?, broker_id=COALESCE(?,broker_id), broker_name=COALESCE(NULLIF(?,''),broker_name),
      quote_date=?, valid_until=?, status=?, notes=?, terms=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(b.unit_id !== undefined ? b.unit_id : q.unit_id, b.project_id !== undefined ? b.project_id : (q.project_id || null), price, discount, r2(price - discount),
      b.broker_id !== undefined ? b.broker_id : null, b.broker_name || '',
      b.quote_date || q.quote_date, b.valid_until !== undefined ? b.valid_until : q.valid_until, b.status || q.status, b.notes ?? q.notes, b.terms ?? q.terms, q.id);
  push(req, 'update', 'quotations', 'quotation', q.id, q.code);
  res.json(db.prepare('SELECT * FROM quotations WHERE id=?').get(q.id));
});

R.post('/quotations/:id/status', auth, P('quotations', 'edit'), idParam, (req, res) => {
  const q = db.prepare('SELECT * FROM quotations WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'عرض السعر غير موجود' });
  const st = (req.body || {}).status;
  if (!['draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled'].includes(st)) return res.status(400).json({ error: 'حالة غير صالحة' });
  db.prepare(`UPDATE quotations SET status=?, updated_at=datetime('now','localtime') WHERE id=?`).run(st, q.id);
  push(req, 'update', 'quotations', 'status', q.id, `${q.code} → ${st}`);
  res.json({ ok: true, status: st });
});

R.post('/quotations/:id/convert', auth, P('reservations', 'create'), idParam, (req, res) => {
  try {
    const out = E.convertQuotation(req, Number(req.params.id), req.body || {});
    res.status(201).json({ ...out, message: 'تم تحويل عرض السعر إلى حجز' });
  } catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});

R.delete('/quotations/:id', auth, P('quotations', 'delete'), idParam, (req, res) => {
  const q = db.prepare('SELECT * FROM quotations WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'عرض السعر غير موجود' });
  if (q.status === 'converted') return res.status(400).json({ error: 'لا يمكن حذف عرض محوّل إلى حجز' });
  db.prepare(`UPDATE quotations SET status='cancelled', deleted_at=datetime('now','localtime') WHERE id=?`).run(q.id);
  push(req, 'delete', 'quotations', 'quotation', q.id, q.code);
  res.json({ ok: true });
});

R.get('/contracts', auth, P('contracts', 'view'), (req, res) => {
  const { page, limit } = pageOf(req.query);
  const w = ['ct.deleted_at IS NULL'], ps = [];
  const eq = (col, key) => { if (req.query[key] !== undefined && req.query[key] !== '' && req.query[key] !== null) { w.push(`${col}=?`); ps.push(req.query[key]); } };
  eq('ct.status', 'status'); eq('ct.client_id', 'client_id'); eq('ct.project_id', 'project_id'); eq('ct.unit_id', 'unit_id'); eq('ct.sale_id', 'sale_id');
  if (req.query.from) { w.push('ct.contract_date>=?'); ps.push(req.query.from); }
  if (req.query.to) { w.push('ct.contract_date<=?'); ps.push(req.query.to); }
  if (req.query.expiring === '1') w.push("ct.end_date IS NOT NULL AND ct.end_date <= date('now','localtime','+30 days') AND ct.status IN ('active','signed')");
  if (req.query.q) { w.push('(ct.code LIKE ? OR c.name LIKE ? OR u.code LIKE ?)'); ps.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  const total = db.prepare(`SELECT COUNT(*) c FROM contracts ct JOIN clients c ON c.id=ct.client_id LEFT JOIN units u ON u.id=ct.unit_id WHERE ${w.join(' AND ')}`).get(...ps).c;
  const rows = db.prepare(`${CONTRACT_SELECT} WHERE ${w.join(' AND ')} ORDER BY ct.id DESC LIMIT ? OFFSET ?`).all(...ps, limit, (page - 1) * limit).map(contractCalc);
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1 });
});

R.get('/contracts/excel', auth, P('contracts', 'export'), async (req, res) => {
  const rows = db.prepare(`${CONTRACT_SELECT} WHERE ct.deleted_at IS NULL ORDER BY ct.id DESC LIMIT 5000`).all().map(contractCalc);
  await X.sendSheet(res, {
    sheet: 'العقود', title: 'تقرير العقود', prefix: 'CON', req, user: req.user, filters: req.query,
    cols: [{ k: 'code', t: 'رقم العقد' }, { k: 'client_name', t: 'العميل' }, { k: 'project_name', t: 'المشروع' }, { k: 'unit_code', t: 'الوحدة' }, { k: 'sale_code', t: 'عملية البيع' },
      { k: 'contract_date', t: 'تاريخ العقد' }, { k: 'start_date', t: 'تاريخ البداية' }, { k: 'end_date', t: 'تاريخ الانتهاء' }, { k: 'amount', t: 'قيمة العقد', money: true },
      { k: 'discount', t: 'الخصم', money: true }, { k: 'net_amount', t: 'صافي العقد', money: true }, { k: 'schedule_paid', t: 'المدفوع', money: true },
      { k: 'contract_remaining', t: 'المتبقي', money: true }, { k: 'signed_at', t: 'تاريخ التوقيع' }, { k: 'status', t: 'الحالة' }],
    rows, totalsKeys: ['amount', 'discount', 'net_amount', 'schedule_paid', 'contract_remaining']
  });
});

// =====================================================================
// المباني والأدوار (مع نوع الدور — روف/أرضي/...)
// =====================================================================

R.get('/contracts/:id', auth, P('contracts', 'view'), idParam, (req, res) => {
  const ct = db.prepare(`${CONTRACT_SELECT} WHERE ct.id=?`).get(req.params.id);
  if (!ct) return res.status(404).json({ error: 'العقد غير موجود' });
  const out = contractCalc(ct);
  out.company = X.settings();
  out.schedule = db.prepare(`SELECT ps.*, (ps.amount - ps.paid_amount) remaining FROM payment_schedule ps WHERE ps.contract_id=? AND ps.deleted_at IS NULL ORDER BY ps.seq, ps.due_date`).all(ct.id);
  out.payments = db.prepare(`SELECT p.*, a.name account_name FROM payments p LEFT JOIN accounts a ON a.id=p.account_id WHERE p.contract_id=? AND p.deleted_at IS NULL ORDER BY p.paid_at`).all(ct.id);
  out.status_history = db.prepare(`SELECT * FROM audit_logs WHERE module='contracts' AND entity_id=? ORDER BY id DESC LIMIT 30`).all(ct.id);
  res.json(out);
});

R.post('/contracts', auth, P('contracts', 'create'), need('client_id', 'contract_date'), (req, res) => {
  try { res.status(201).json(E.createContract(req, req.body || {})); }
  catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});

R.put('/contracts/:id', auth, P('contracts', 'edit'), idParam, (req, res) => {
  const ct = db.prepare('SELECT * FROM contracts WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!ct) return res.status(404).json({ error: 'العقد غير موجود' });
  const b = req.body || {};
  const cols = ['contract_date', 'start_date', 'end_date', 'amount', 'discount', 'net_amount', 'status', 'file_id', 'signed_at', 'terms', 'notes', 'unit_id', 'project_id'];
  const use = cols.filter(c => b[c] !== undefined);
  if (!use.length) return res.status(400).json({ error: 'لا توجد بيانات' });
  const doEdit = (user) => {
    db.prepare(`UPDATE contracts SET ${use.map(c => `${c}=?`).join(',')}, updated_at=datetime('now','localtime') WHERE id=?`).run(...use.map(c => b[c]), ct.id);
    if (b.status) push(user, 'update', 'contracts', 'status', ct.id, `${ct.code} → ${b.status}`);
    if (b.net_amount !== undefined && ct.sale_id) db.prepare('UPDATE sales SET net_price=? WHERE id=?').run(num(b.net_amount), ct.sale_id);
    F.pushAudit(user, 'update', 'contracts', 'contract', ct.id, use.join(','));
    return { ok: true };
  };
  if ((b.net_amount !== undefined && num(b.net_amount) !== num(ct.net_amount)) && !F.canApprove(req.user)) {
    const g = F.gate(req, { action_type: 'contract_amount', entity_type: 'contract', entity_id: ct.id, title: `تعديل قيمة العقد ${ct.code}`, module: 'contracts', amount: num(b.net_amount), payload: { contract_id: ct.id, ...b } });
    if (g.pending) return res.status(202).json({ pending_approval: g.approval_id, message: 'تعديل قيمة العقد يحتاج اعتماد المدير' });
    return res.json(g.result);
  }
  res.json(doEdit(req.user));
});

R.post('/contracts/:id/sign', auth, P('contracts', 'edit'), idParam, (req, res) => {
  const ct = db.prepare('SELECT * FROM contracts WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!ct) return res.status(404).json({ error: 'العقد غير موجود' });
  if (['cancelled'].includes(ct.status)) return res.status(400).json({ error: 'العقد ملغى' });
  const signedAt = (req.body || {}).signed_at || today();
  db.prepare(`UPDATE contracts SET status='active', signed_at=?, file_id=COALESCE(?, file_id), updated_at=datetime('now','localtime') WHERE id=?`)
    .run(signedAt, (req.body || {}).file_id || null, ct.id);
  push(req, 'update', 'contracts', 'sign', ct.id, `${ct.code} — توقيع ${signedAt}`);
  res.json({ ok: true, status: 'active', signed_at: signedAt });
});

R.get('/contracts/:id/print', auth, P('contracts', 'view'), idParam, (req, res) => {
  const ct = db.prepare(`${CONTRACT_SELECT} WHERE ct.id=?`).get(req.params.id);
  if (!ct) return res.status(404).json({ error: 'العقد غير موجود' });
  const out = contractCalc(ct);
  out.company = X.settings();
  out.schedule = db.prepare('SELECT ps.*, (ps.amount - ps.paid_amount) remaining FROM payment_schedule ps WHERE ps.contract_id=? AND ps.deleted_at IS NULL ORDER BY ps.seq').all(ct.id);
  res.json(out);
});

R.get('/floors/meta', auth, (req, res) => res.json({ floor_types: FLOOR_TYPES, property_types: PROPERTY_TYPES }));

R.get('/projects/:id/buildings', auth, P('projects', 'view'), idParam, (req, res) => {
  const buildings = db.prepare('SELECT * FROM buildings WHERE project_id=? ORDER BY id').all(req.params.id);
  buildings.forEach(b => {
    b.floors = db.prepare(`SELECT f.*, (SELECT COUNT(*) FROM units u WHERE u.floor_id=f.id AND u.deleted_at IS NULL) units_count FROM floors f WHERE f.building_id=? ORDER BY f.number`).all(b.id);
    b.units_count = db.prepare('SELECT COUNT(*) c FROM units WHERE building_id=? AND deleted_at IS NULL').get(b.id).c;
  });
  const unassigned = db.prepare('SELECT COUNT(*) c FROM units WHERE project_id=? AND deleted_at IS NULL AND building_id IS NULL').get(req.params.id).c;
  res.json({ data: buildings, unassigned_units: unassigned, floor_types: FLOOR_TYPES });
});

R.post('/buildings', auth, P('projects', 'create'), need('project_id', 'name'), (req, res) => {
  const b = req.body || {};
  if (!db.prepare('SELECT id FROM projects WHERE id=?').get(b.project_id)) return res.status(404).json({ error: 'المشروع غير موجود' });
  const bid = db.prepare('INSERT INTO buildings (project_id, name, floors_count, notes, code) VALUES (?,?,?,?,?)')
    .run(b.project_id, b.name, num(b.floors_count, 1), b.notes || '', b.code || '').lastInsertRowid;
  const floors = Array.isArray(b.floors) && b.floors.length ? b.floors : [];
  if (floors.length) {
    floors.forEach((f, i) => {
      const number = num(f.number, i + 1);
      const type = FLOOR_TYPES.some(t => t.k === f.type) ? f.type : 'normal';
      const name = f.name || defaultFloorName(number, type);
      db.prepare('INSERT INTO floors (building_id, number, name, type, display_name) VALUES (?,?,?,?,?)').run(bid, number, name, type, `${name}${type === 'roof' && !/روف/.test(name) ? ' — روف' : ''}`);
    });
    db.prepare('UPDATE buildings SET floors_count=? WHERE id=?').run(floors.length, bid);
  } else {
    for (let i = 1; i <= num(b.floors_count, 1); i++) db.prepare('INSERT INTO floors (building_id, number, name, type, display_name) VALUES (?,?,?,?,?)').run(bid, i, defaultFloorName(i, 'normal'), 'normal', defaultFloorName(i, 'normal'));
  }
  push(req, 'create', 'projects', 'building', bid, b.name);
  res.status(201).json({ id: bid, floors: db.prepare('SELECT * FROM floors WHERE building_id=? ORDER BY number').all(bid) });
});

R.put('/buildings/:id', auth, P('projects', 'edit'), idParam, (req, res) => {
  const b = db.prepare('SELECT * FROM buildings WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'المبنى غير موجود' });
  const x = req.body || {};
  db.prepare('UPDATE buildings SET name=?, notes=?, floors_count=?, code=?, status=? WHERE id=?')
    .run(x.name ?? b.name, x.notes ?? b.notes, x.floors_count ?? b.floors_count, x.code ?? b.code, x.status ?? b.status, b.id);
  push(req, 'update', 'projects', 'building', b.id, x.name || b.name);
  res.json(db.prepare('SELECT * FROM buildings WHERE id=?').get(b.id));
});
function defaultFloorName(number, type) {
  const T = { ground: 'الأرضي', mezzanine: 'الميزانين', roof: 'روف', terrace: 'السطح', basement: 'القبو', normal: '', other: '' };
  if (type === 'roof') return `الدور ${number} — روف`;
  if (T[type]) return `الدور ${number} — ${T[type]}`;
  return `الدور ${number}`;
}

R.post('/buildings/:id/floors', auth, P('projects', 'create'), idParam, need('number'), (req, res) => {
  const b = db.prepare('SELECT * FROM buildings WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'المبنى غير موجود' });
  const x = req.body || {};
  const type = FLOOR_TYPES.some(t => t.k === x.type) ? x.type : 'normal';
  const name = x.name || defaultFloorName(num(x.number), type);
  if (db.prepare('SELECT id FROM floors WHERE building_id=? AND number=?').get(b.id, num(x.number))) return res.status(409).json({ error: 'رقم الدور مستخدم في هذا المبنى' });
  const id = db.prepare('INSERT INTO floors (building_id, number, name, type, display_name, notes) VALUES (?,?,?,?,?,?)')
    .run(b.id, num(x.number), name, type, `${name}${type === 'roof' && !/روف/.test(name) ? ' — روف' : ''}`, x.notes || '').lastInsertRowid;
  db.prepare('UPDATE buildings SET floors_count=(SELECT COUNT(*) FROM floors WHERE building_id=?) WHERE id=?').run(b.id, b.id);
  push(req, 'create', 'projects', 'floor', id, `${b.name} — ${name}`);
  res.status(201).json(db.prepare('SELECT * FROM floors WHERE id=?').get(id));
});

R.put('/floors/:id', auth, P('projects', 'edit'), idParam, (req, res) => {
  const f = db.prepare('SELECT f.*, b.project_id FROM floors f JOIN buildings b ON b.id=f.building_id WHERE f.id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'الدور غير موجود' });
  const x = req.body || {};
  const type = FLOOR_TYPES.some(t => t.k === x.type) ? x.type : f.type;
  const number = x.number !== undefined ? num(x.number) : f.number;
  const name = x.name !== undefined ? x.name : (type !== f.type ? defaultFloorName(number, type) : f.name);
  db.prepare('UPDATE floors SET number=?, name=?, type=?, display_name=?, notes=? WHERE id=?')
    .run(number, name, type, `${name}${type === 'roof' && !/روف/.test(name) ? ' — روف' : ''}`, x.notes ?? f.notes, f.id);
  push(req, 'update', 'projects', 'floor', f.id, `${name} (${type})`);
  res.json(db.prepare('SELECT * FROM floors WHERE id=?').get(f.id));
});

R.delete('/floors/:id', auth, P('projects', 'delete'), idParam, (req, res) => {
  const used = db.prepare('SELECT COUNT(*) c FROM units WHERE floor_id=? AND deleted_at IS NULL').get(req.params.id).c;
  if (used) return res.status(400).json({ error: `لا يمكن حذف دور يحتوي على ${used} وحدة` });
  const f = db.prepare('SELECT * FROM floors WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'الدور غير موجود' });
  db.prepare('DELETE FROM floors WHERE id=?').run(f.id);
  db.prepare('UPDATE buildings SET floors_count=(SELECT COUNT(*) FROM floors WHERE building_id=?) WHERE id=?').run(f.building_id, f.building_id);
  push(req, 'delete', 'projects', 'floor', f.id, f.name);
  res.json({ ok: true });
});

// =====================================================================
// الوحدات: سجل الحالة + المطابقة
// =====================================================================

R.get('/units/:id/full', auth, P('units', 'view'), idParam, (req, res) => {
  const u = E.unitRow(req.params.id);
  if (!u) return res.status(404).json({ error: 'الوحدة غير موجودة' });
  const display = E.unitDisplay(u.id);
  const payments = db.prepare(`SELECT p.*, a.name account_name FROM payments p LEFT JOIN accounts a ON a.id=p.account_id WHERE p.unit_id=? AND p.deleted_at IS NULL ORDER BY p.paid_at`).all(u.id);
  const sale = db.prepare(`SELECT s.*, c.name client_name FROM sales s JOIN clients c ON c.id=s.client_id WHERE s.unit_id=? ORDER BY s.id DESC LIMIT 1`).get(u.id);
  const reservation = db.prepare(`SELECT r.*, c.name client_name FROM reservations r JOIN clients c ON c.id=r.client_id WHERE r.unit_id=? ORDER BY r.id DESC LIMIT 1`).get(u.id);
  res.json({
    unit: { ...u, ...display }, history: E.unitHistory(u.id), payments, sale: sale ? { ...sale, totals: F.saleTotals(sale.id) } : null,
    reservation: reservation ? { ...reservation, totals: F.reservationTotals(reservation.id) } : null,
    interest_matches: E.matchInterestsToUnit(u.id, { limit: 10, minScore: num(F.setting('interest_match_threshold', '60')) }).matches
  });
});

R.get('/units/:id/history', auth, P('units', 'view'), idParam, (req, res) => res.json({ data: E.unitHistory(req.params.id) }));

R.post('/units/:id/status', auth, P('units', 'edit'), idParam, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'صلاحية مرفوضة: تعديل الوحدات متاح لمدير النظام (Admin) فقط' });
  const b = req.body || {};
  if (!['available', 'reserved', 'sold', 'resale', 'blocked'].includes(b.status)) return res.status(400).json({ error: 'حالة غير صالحة' });
  if (!b.reason) return res.status(400).json({ error: 'سبب تغيير الحالة مطلوب (يُسجَّل في التاريخ)' });
  try { res.json(F.setUnitStatus(Number(req.params.id), b.status, b.reason, req.user)); }
  catch (e) { res.status(e.code || 400).json({ error: e.message }); }
});

R.get('/units/:id/matches', auth, P('units', 'view'), idParam, (req, res) => {
  const minScore = num(req.query.min_score, num(F.setting('interest_match_threshold', '60')));
  const out = E.matchInterestsToUnit(Number(req.params.id), { limit: num(req.query.limit, 100), minScore });
  if (!out.unit) return res.status(404).json({ error: 'الوحدة غير موجودة' });
  // تسجيل عملية المطابقة في سجل التدقيق (البند 25)
  try { push(req, 'view', 'interests', 'match_unit', out.unit.id, `مطابقة العملاء مع الوحدة ${out.unit.code} — ${out.matches.length} عميل بمطابقة ${minScore}%+`); } catch {}
  res.json({ ...out, min_score: minScore });
});

R.get('/units/:id/matches/excel', auth, P('units', 'export'), idParam, async (req, res) => {
  const out = E.matchInterestsToUnit(Number(req.params.id), { limit: 500, minScore: num(req.query.min_score, 0) });
  if (!out.unit) return res.status(404).json({ error: 'الوحدة غير موجودة' });
  const T = Object.fromEntries(PROPERTY_TYPES.map(t => [t.k, t.t]));
  await X.sendSheet(res, {
    sheet: `مهتمون بوحدة ${out.unit.code}`, title: `العملاء المهتمون بالوحدة ${out.unit.code} — ${out.unit.project_name || ''}`, prefix: 'MAT', req, user: req.user, filters: req.query,
    cols: [{ k: 'client_name', t: 'العميل' }, { k: 'client_phone', t: 'الجوال' }, { k: 'type_t', t: 'نوع الاهتمام' }, { k: 'budget', t: 'الميزانية' },
      { k: 'rooms', t: 'عدد الغرف' }, { k: 'project_name', t: 'المشروع المفضل' }, { k: 'last_contact_at', t: 'آخر تواصل' }, { k: 'employee_name', t: 'الموظف المسؤول' },
      { k: 'score', t: 'نسبة التوافق %' }, { k: 'reasons_t', t: 'أسباب التوافق' }],
    rows: out.matches.map(m => ({ ...m, type_t: T[m.property_type] || m.property_type, budget: `${num(m.budget_min).toLocaleString('en')} - ${num(m.budget_max).toLocaleString('en')}`, reasons_t: (m.reasons || []).join('، ') }))
  });
});

// =====================================================================
// مُنفّذ اعتماد تعديل قيمة العقد (يُستدعى آليًا بعد موافقة المدير)
// =====================================================================
F.registerApprovalExecutor('contract_amount', (p, approverUser) => {
  const ct = db.prepare('SELECT * FROM contracts WHERE id=?').get(p.contract_id);
  if (!ct) throw Object.assign(new Error('العقد غير موجود'), { code: 404 });
  const cols = ['contract_date', 'start_date', 'end_date', 'amount', 'discount', 'net_amount', 'status', 'file_id', 'signed_at', 'terms', 'notes', 'unit_id', 'project_id'];
  const use = cols.filter(c => p[c] !== undefined);
  if (use.length) db.prepare(`UPDATE contracts SET ${use.map(c => `${c}=?`).join(',')}, updated_at=datetime('now','localtime') WHERE id=?`).run(...use.map(c => p[c]), ct.id);
  if (p.net_amount !== undefined && ct.sale_id) db.prepare('UPDATE sales SET net_price=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run(num(p.net_amount), ct.sale_id);
  F.pushAudit(approverUser, 'update', 'contracts', 'contract', ct.id, `اعتماد تعديل قيمة العقد ${ct.code} → ${num(p.net_amount)}`);
  notify(ct.client_id, 'contract', `تم اعتماد تعديل قيمة العقد ${ct.code}`, `القيمة الجديدة: ${num(p.net_amount).toLocaleString('en')}`, '/contracts');
  return { ok: true, contract_id: ct.id };
});

module.exports = R;
