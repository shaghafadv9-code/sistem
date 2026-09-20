// Smart Secretary — Migrations (نسخة مُرقّمة وقابلة للتتبع)
// كل ترحيل يُطبَّق مرة واحدة فقط ويُسجَّل في جدول migrations.
// القاعدة: لا حذف مباشر لبيانات مالية، ولا تعديل على الواجهة دون مصدر واحد للحقيقة.
const { db, flush } = require('./db');
const TT = require('./time');

const NOW = "datetime('now','localtime')";

function tableCols(t) {
  try { return db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name); } catch { return []; }
}
function ensureCol(t, col, ddl) {
  try {
    if (!tableCols(t).includes(col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${ddl}`);
  } catch (e) { console.warn('[migrate] ensureCol failed', t, col, e.message); }
}
function has(sql, ...p) { try { return !!db.prepare(sql).get(...p); } catch { return false; } }
function code(prefix, table) {
  try { return `${prefix}-${String(db.prepare(`SELECT COALESCE(MAX(id),0)+1 n FROM ${table}`).get().n).padStart(4, '0')}`; }
  catch { return `${prefix}-${Date.now()}`; }
}
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// =====================================================================
// 1) المخطط الأساسي الجديد: الحسابات، الحركات، العقود، الأقساط، المصروفات،
//    الاستردادات، العمولات، عروض الأسعار، اهتمامات العملاء، التواصل،
//    مراحل البيع، سجل حالة الوحدة، الموافقات + أعمدة جديدة + فهارس.
// =====================================================================
function m1_schema() {
  const S = [];

  // ---------- الحسابات المالية ----------
  S.push(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'cash' CHECK (type IN ('cash','bank','project','wallet','other')),
  bank_name TEXT DEFAULT '',
  account_no TEXT DEFAULT '',
  iban TEXT DEFAULT '',
  opening_balance REAL NOT NULL DEFAULT 0,
  current_balance REAL NOT NULL DEFAULT 0,
  project_id INTEGER REFERENCES projects(id),
  currency TEXT DEFAULT 'SAR',
  is_default INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','closed')),
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(type, status);
CREATE INDEX IF NOT EXISTS idx_accounts_project ON accounts(project_id);
`);

  // ---------- سجل الحركات المالية (Ledger) — مصدر واحد لتأثير أي مبلغ على أي حساب ----------
  S.push(`
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT DEFAULT '',
  txn_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opening','deposit','down_payment','installment','payment','expense','commission','payout','refund','transfer','adjustment','reversal')),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount REAL NOT NULL CHECK (amount >= 0),
  account_id INTEGER REFERENCES accounts(id),
  to_account_id INTEGER REFERENCES accounts(id),
  client_id INTEGER REFERENCES clients(id),
  project_id INTEGER REFERENCES projects(id),
  unit_id INTEGER REFERENCES units(id),
  sale_id INTEGER REFERENCES sales(id),
  reservation_id INTEGER REFERENCES reservations(id),
  contract_id INTEGER REFERENCES contracts(id),
  expense_id INTEGER,
  refund_id INTEGER,
  commission_id INTEGER,
  payout_id INTEGER,
  method TEXT DEFAULT 'cash',
  reference_no TEXT DEFAULT '',
  check_no TEXT DEFAULT '',
  bank_name TEXT DEFAULT '',
  check_date TEXT,
  check_due_date TEXT,
  check_status TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cleared','bounced','cancelled','reversed')),
  attachment_id INTEGER REFERENCES files(id),
  notes TEXT DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  reversal_of INTEGER,
  reversed_by INTEGER,
  deleted_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_txn_account ON transactions(account_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_txn_sale ON transactions(sale_id);
CREATE INDEX IF NOT EXISTS idx_txn_kind ON transactions(kind, status);
CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_txn_ref ON transactions(reference_no);
CREATE INDEX IF NOT EXISTS idx_txn_project ON transactions(project_id);
`);

  // ---------- العقود ----------
  S.push(`
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  project_id INTEGER REFERENCES projects(id),
  unit_id INTEGER REFERENCES units(id),
  sale_id INTEGER REFERENCES sales(id),
  reservation_id INTEGER REFERENCES reservations(id),
  quotation_id INTEGER,
  contract_date TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  amount REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
  net_amount REAL NOT NULL DEFAULT 0,
  deposit_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_signature','signed','active','completed','cancelled','expired')),
  file_id INTEGER REFERENCES files(id),
  signed_at TEXT,
  terms TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contracts_client ON contracts(client_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_sale ON contracts(sale_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
`);

  // ---------- جدول الأقساط والاستحقاقات ----------
  S.push(`
CREATE TABLE IF NOT EXISTS payment_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT DEFAULT '',
  sale_id INTEGER REFERENCES sales(id),
  reservation_id INTEGER REFERENCES reservations(id),
  contract_id INTEGER REFERENCES contracts(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  unit_id INTEGER REFERENCES units(id),
  project_id INTEGER REFERENCES projects(id),
  seq INTEGER NOT NULL DEFAULT 1,
  label TEXT DEFAULT '',
  due_date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  paid_amount REAL NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','due','paid','partial','overdue','cancelled')),
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sched_sale ON payment_schedule(sale_id);
CREATE INDEX IF NOT EXISTS idx_sched_client ON payment_schedule(client_id, status);
CREATE INDEX IF NOT EXISTS idx_sched_due ON payment_schedule(due_date, status);
CREATE INDEX IF NOT EXISTS idx_sched_project ON payment_schedule(project_id);
`);

  // ---------- المصروفات ----------
  S.push(`
CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT DEFAULT 'general',
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  expense_date TEXT NOT NULL,
  category_id INTEGER REFERENCES expense_categories(id),
  amount REAL NOT NULL CHECK (amount > 0),
  account_id INTEGER REFERENCES accounts(id),
  project_id INTEGER REFERENCES projects(id),
  unit_id INTEGER REFERENCES units(id),
  vendor TEXT DEFAULT '',
  beneficiary TEXT DEFAULT '',
  method TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','transfer','check','card','online','other')),
  reference_no TEXT DEFAULT '',
  bank_name TEXT DEFAULT '',
  check_no TEXT DEFAULT '',
  check_date TEXT,
  check_due_date TEXT,
  check_status TEXT DEFAULT '',
  attachment_id INTEGER REFERENCES files(id),
  description TEXT DEFAULT '',
  employee_id INTEGER REFERENCES users(id),
  request_no TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected','paid','cancelled')),
  approval_id INTEGER,
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  paid_at TEXT,
  txn_id INTEGER,
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_exp_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_exp_cat ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_exp_account ON expenses(account_id);
CREATE INDEX IF NOT EXISTS idx_exp_project ON expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_exp_status ON expenses(status);
`);

  // ---------- الاستردادات ----------
  S.push(`
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  reservation_id INTEGER REFERENCES reservations(id),
  sale_id INTEGER REFERENCES sales(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  amount REAL NOT NULL CHECK (amount >= 0),
  deducted_amount REAL NOT NULL DEFAULT 0,
  method TEXT DEFAULT 'cash',
  account_id INTEGER REFERENCES accounts(id),
  reference_no TEXT DEFAULT '',
  attachment_id INTEGER REFERENCES files(id),
  reason TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected','cancelled')),
  refund_date TEXT,
  approval_id INTEGER,
  requested_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  txn_id INTEGER,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_refund_sale ON refunds(sale_id);
CREATE INDEX IF NOT EXISTS idx_refund_client ON refunds(client_id);
CREATE INDEX IF NOT EXISTS idx_refund_status ON refunds(status);
`);

  // ---------- دفعات العمولات للمسوقين ----------
  S.push(`
CREATE TABLE IF NOT EXISTS commission_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  broker_id INTEGER NOT NULL REFERENCES brokers(id),
  sale_id INTEGER REFERENCES sales(id),
  commission_id INTEGER,
  amount REAL NOT NULL CHECK (amount > 0),
  pay_date TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id),
  method TEXT DEFAULT 'transfer',
  reference_no TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  txn_id INTEGER,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('pending','paid','cancelled')),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_compay_broker ON commission_payments(broker_id, status);
CREATE INDEX IF NOT EXISTS idx_compay_sale ON commission_payments(sale_id);
`);

  // ---------- عروض الأسعار ----------
  S.push(`
CREATE TABLE IF NOT EXISTS quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  project_id INTEGER REFERENCES projects(id),
  unit_id INTEGER REFERENCES units(id),
  price REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
  discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
  net_price REAL NOT NULL DEFAULT 0,
  broker_id INTEGER REFERENCES brokers(id),
  broker_name TEXT DEFAULT '',
  quote_date TEXT NOT NULL,
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired','converted','cancelled')),
  notes TEXT DEFAULT '',
  terms TEXT DEFAULT '',
  reservation_id INTEGER REFERENCES reservations(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_quote_client ON quotations(client_id, status);
CREATE INDEX IF NOT EXISTS idx_quote_unit ON quotations(unit_id);
`);

  // ---------- اهتمامات العملاء ----------
  S.push(`
CREATE TABLE IF NOT EXISTS client_interests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT DEFAULT '',
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  property_type TEXT DEFAULT 'apartment',
  preferred_project_id INTEGER REFERENCES projects(id),
  preferred_area TEXT DEFAULT '',
  city TEXT DEFAULT '',
  budget_min REAL DEFAULT 0,
  budget_max REAL DEFAULT 0,
  rooms INTEGER DEFAULT 0,
  bathrooms INTEGER DEFAULT 0,
  floor_pref TEXT DEFAULT '',
  wants_roof INTEGER DEFAULT 0,
  area_min REAL DEFAULT 0,
  area_max REAL DEFAULT 0,
  parking INTEGER DEFAULT 0,
  delivery_status TEXT DEFAULT 'any',
  purpose TEXT DEFAULT 'residence',
  priority TEXT DEFAULT 'medium',
  notes TEXT DEFAULT '',
  special_requests TEXT DEFAULT '',
  sales_notes TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_int_client ON client_interests(client_id);
CREATE INDEX IF NOT EXISTS idx_int_rooms ON client_interests(rooms);
CREATE INDEX IF NOT EXISTS idx_int_budget ON client_interests(budget_min, budget_max);
CREATE INDEX IF NOT EXISTS idx_int_project ON client_interests(preferred_project_id);
CREATE INDEX IF NOT EXISTS idx_int_type ON client_interests(property_type);
CREATE INDEX IF NOT EXISTS idx_int_purpose ON client_interests(purpose);
`);

  // ---------- سجل التواصل ----------
  S.push(`
CREATE TABLE IF NOT EXISTS communications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  interest_id INTEGER REFERENCES client_interests(id),
  unit_id INTEGER REFERENCES units(id),
  sale_id INTEGER REFERENCES sales(id),
  quotation_id INTEGER REFERENCES quotations(id),
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('whatsapp','call','sms','email','meeting','note','visit')),
  direction TEXT DEFAULT 'out',
  subject TEXT DEFAULT '',
  body TEXT DEFAULT '',
  result TEXT DEFAULT '',
  employee_id INTEGER REFERENCES users(id),
  occurred_at TEXT NOT NULL,
  next_follow_up TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_comm_client ON communications(client_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_comm_follow ON communications(next_follow_up);
`);

  // ---------- مراحل البيع (Sales Pipeline) ----------
  S.push(`
CREATE TABLE IF NOT EXISTS client_stage_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  from_stage TEXT DEFAULT '',
  to_stage TEXT NOT NULL,
  note TEXT DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_stagehist_client ON client_stage_history(client_id);
`);

  // ---------- سجل حالة الوحدة ----------
  S.push(`
CREATE TABLE IF NOT EXISTS unit_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  from_status TEXT DEFAULT '',
  to_status TEXT NOT NULL,
  reason TEXT DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_unitsh_unit ON unit_status_history(unit_id);
`);

  // ---------- الموافقات ----------
  S.push(`
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  action_type TEXT NOT NULL,
  title TEXT NOT NULL,
  module TEXT DEFAULT '',
  amount REAL DEFAULT 0,
  payload TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by INTEGER REFERENCES users(id),
  requested_at TEXT DEFAULT (datetime('now','localtime')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT DEFAULT '',
  result_note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_appr_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_appr_entity ON approvals(entity_type, entity_id);
`);


  // ---------- إنشاء كل الجداول الجديدة قبل أي تعديل على الجداول القائمة ----------
  S.forEach(x => db.exec(x));

  // ---------- إعادة بناء payments: مصدر واحد لكل مبلغ داخل + حقول كاملة ----------
  if (tableCols('payments').includes('sale_id')) {
    const colDef = db.prepare('PRAGMA table_info(payments)').all();
    const saleCol = colDef.find(c => c.name === 'sale_id');
    if (saleCol && Number(saleCol.notnull) === 1) {
      db.exec('ALTER TABLE payments RENAME TO payments_legacy');
      db.exec(`
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'installment' CHECK (kind IN ('deposit','down_payment','installment','full','other')),
  sale_id INTEGER REFERENCES sales(id),
  reservation_id INTEGER REFERENCES reservations(id),
  contract_id INTEGER REFERENCES contracts(id),
  schedule_id INTEGER REFERENCES payment_schedule(id),
  client_id INTEGER REFERENCES clients(id),
  unit_id INTEGER REFERENCES units(id),
  project_id INTEGER REFERENCES projects(id),
  amount REAL NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','transfer','check','card','online','other')),
  account_id INTEGER REFERENCES accounts(id),
  bank_name TEXT DEFAULT '',
  reference_no TEXT DEFAULT '',
  check_no TEXT DEFAULT '',
  check_date TEXT,
  check_due_date TEXT,
  check_status TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cancelled','reversed','bounced')),
  attachment_id INTEGER REFERENCES files(id),
  txn_id INTEGER,
  paid_at TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
INSERT INTO payments (id, kind, sale_id, client_id, unit_id, project_id, amount, method, reference_no, status, paid_at, notes, created_by, created_at)
  SELECT p.id, 'installment', p.sale_id, s.client_id, s.unit_id, u.project_id, p.amount,
         CASE WHEN p.method IN ('cash','transfer','check','card','online','other') THEN p.method ELSE 'other' END,
         p.reference_no, 'confirmed', p.paid_at, p.notes, p.created_by, p.created_at
  FROM payments_legacy p
  LEFT JOIN sales s ON s.id = p.sale_id
  LEFT JOIN units u ON u.id = s.unit_id;
DROP TABLE payments_legacy;
`);
    }
  }
  // (فهارس جدول payments تُنشأ بعد إعادة البناء أعلاه)
  db.exec(`
CREATE INDEX IF NOT EXISTS idx_pay_sale ON payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_pay_reservation ON payments(reservation_id);
CREATE INDEX IF NOT EXISTS idx_pay_client ON payments(client_id, status);
CREATE INDEX IF NOT EXISTS idx_pay_account ON payments(account_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_pay_date ON payments(paid_at);
CREATE INDEX IF NOT EXISTS idx_pay_project ON payments(project_id);
CREATE INDEX IF NOT EXISTS idx_pay_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_pay_ref ON payments(reference_no);
`);


  // ---------- أعمدة جديدة للجداول القائمة ----------
  // المباني والأدوار: نوع الدور (روف/أرضي/...)
  ensureCol('floors', 'type', "TEXT DEFAULT 'normal'");
  ensureCol('floors', 'display_name', "TEXT DEFAULT ''");
  ensureCol('floors', 'notes', "TEXT DEFAULT ''");
  ensureCol('buildings', 'code', "TEXT DEFAULT ''");
  ensureCol('buildings', 'status', "TEXT DEFAULT 'active'");
  ensureCol('units', 'bathrooms', 'INTEGER DEFAULT 0');
  ensureCol('units', 'parking', 'INTEGER DEFAULT 0');
  ensureCol('units', 'has_roof', 'INTEGER DEFAULT 0');
  ensureCol('units', 'roof_area', 'REAL DEFAULT 0');
  ensureCol('units', 'delivery_status', "TEXT DEFAULT 'ready'");
  ensureCol('units', 'facing', "TEXT DEFAULT ''");
  ensureCol('units', 'building_id', 'INTEGER REFERENCES buildings(id)');
  ensureCol('units', 'floor_id', 'INTEGER REFERENCES floors(id)');
  ensureCol('units', 'notes', "TEXT DEFAULT ''");
  ensureCol('units', 'handover_date', 'TEXT');
  // المشاريع: إلزامية المبنى/الدور
  // Project → Units: المبنى/الدور بيانات وصفية اختيارية (وليست محور الهيكلة)
  ensureCol('projects', 'require_building', 'INTEGER DEFAULT 0');
  ensureCol('projects', 'require_floor', 'INTEGER DEFAULT 0');
  ensureCol('projects', 'default_floor_type', "TEXT DEFAULT 'normal'");
  // العملاء: مرحلة البيع + الجنسية + آخر تواصل
  ensureCol('clients', 'pipeline_stage', "TEXT DEFAULT 'lead'");
  ensureCol('clients', 'stage_changed_at', 'TEXT');
  ensureCol('clients', 'last_contact_at', 'TEXT');
  ensureCol('clients', 'nationality', "TEXT DEFAULT ''");
  ensureCol('clients', 'interest_summary', "TEXT DEFAULT ''");
  // الحجوزات
  ensureCol('reservations', 'account_id', 'INTEGER REFERENCES accounts(id)');
  ensureCol('reservations', 'quotation_id', 'INTEGER REFERENCES quotations(id)');
  ensureCol('reservations', 'contract_id', 'INTEGER REFERENCES contracts(id)');
  ensureCol('reservations', 'cancel_approved_by', 'INTEGER REFERENCES users(id)');
  // المبيعات
  ensureCol('sales', 'contract_id', 'INTEGER REFERENCES contracts(id)');
  ensureCol('sales', 'account_id', 'INTEGER REFERENCES accounts(id)');
  ensureCol('sales', 'quotation_id', 'INTEGER REFERENCES quotations(id)');
  ensureCol('sales', 'net_paid_cache', 'REAL DEFAULT 0');
  ensureCol('sales', 'cancel_reason', "TEXT DEFAULT ''");
  ensureCol('sales', 'cancelled_at', 'TEXT');
  // الوسطاء
  ensureCol('brokers', 'id_no', "TEXT DEFAULT ''");
  ensureCol('brokers', 'broker_type', "TEXT DEFAULT 'broker'");
  ensureCol('brokers', 'commission_method', "TEXT DEFAULT 'percent'");
  ensureCol('brokers', 'bank_name', "TEXT DEFAULT ''");
  ensureCol('brokers', 'bank_account', "TEXT DEFAULT ''");
  ensureCol('brokers', 'iban', "TEXT DEFAULT ''");
  ensureCol('brokers', 'status', "TEXT DEFAULT 'active'");
  ensureCol('brokers', 'due_days', 'INTEGER DEFAULT 0');
  ensureCol('brokers', 'license_no', "TEXT DEFAULT ''");
  // الملفات: روابط جديدة
  for (const [c, ddl] of [['contract_id', 'INTEGER'], ['payment_id', 'INTEGER'], ['expense_id', 'INTEGER'], ['quotation_id', 'INTEGER'], ['refund_id', 'INTEGER'], ['interest_id', 'INTEGER'], ['account_id', 'INTEGER']]) ensureCol('files', c, ddl);


  // ---------- فهارس الأداء ----------
  db.exec(`
CREATE INDEX IF NOT EXISTS idx_units_rooms ON units(rooms, status);
CREATE INDEX IF NOT EXISTS idx_units_price ON units(price);
CREATE INDEX IF NOT EXISTS idx_units_area ON units(area);
CREATE INDEX IF NOT EXISTS idx_units_building ON units(building_id);
CREATE INDEX IF NOT EXISTS idx_units_floor ON units(floor_id);
CREATE INDEX IF NOT EXISTS idx_units_type ON units(type);
CREATE INDEX IF NOT EXISTS idx_units_code ON units(code);
CREATE INDEX IF NOT EXISTS idx_clients_code ON clients(code);
CREATE INDEX IF NOT EXISTS idx_clients_assigned ON clients(assigned_to);
CREATE INDEX IF NOT EXISTS idx_floors_building ON floors(building_id, number);
CREATE INDEX IF NOT EXISTS idx_floors_type ON floors(type);
CREATE INDEX IF NOT EXISTS idx_buildings_project ON buildings(project_id);
CREATE INDEX IF NOT EXISTS idx_sales_client ON sales(client_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_unit ON sales(unit_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_broker ON sales(broker_id);
CREATE INDEX IF NOT EXISTS idx_res_client ON reservations(client_id, status);
CREATE INDEX IF NOT EXISTS idx_res_unit ON reservations(unit_id);
CREATE INDEX IF NOT EXISTS idx_unitsh_status ON unit_status_history(to_status);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
`);
}


// =====================================================================
// 2) القيم الافتراضية: الحسابات، تصنيفات المصروفات، مراحل البيع، الصلاحيات
// =====================================================================
function m2_defaults() {
  // الحسابات الافتراضية
  if (!has('SELECT id FROM accounts WHERE code=?', 'ACC-0001')) {
    const admin = db.prepare(`SELECT id FROM users ORDER BY id LIMIT 1`).get();
    db.prepare(`INSERT INTO accounts (code, name, type, opening_balance, current_balance, is_default, status, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?,?)`).run('ACC-0001', 'الصندوق', 'cash', 0, 0, 1, 'active', 'الصندوق الرئيسي — الحساب الافتراضي للمقبوضات النقدية', admin ? admin.id : null);
  }
  if (!has('SELECT id FROM accounts WHERE code=?', 'ACC-0002')) {
    const admin = db.prepare(`SELECT id FROM users ORDER BY id LIMIT 1`).get();
    db.prepare(`INSERT INTO accounts (code, name, type, bank_name, account_no, iban, opening_balance, current_balance, is_default, status, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('ACC-0002', 'الحساب البنكي الرئيسي', 'bank', 'البنك الأهلي', '1234567890', 'SA0000000000000000000000', 0, 0, 1, 'active', admin ? admin.id : null);
  }

  // تصنيفات المصروفات
  const CATS = [
    ['EXC-01', 'رواتب', 'payroll'], ['EXC-02', 'إيجار', 'rent'], ['EXC-03', 'تسويق', 'marketing'],
    ['EXC-04', 'صيانة', 'maintenance'], ['EXC-05', 'نقل', 'transport'], ['EXC-06', 'رسوم حكومية', 'government'],
    ['EXC-07', 'رسوم بنكية', 'bank'], ['EXC-08', 'عمولات', 'commission'], ['EXC-09', 'مصروفات مشروع', 'project'],
    ['EXC-10', 'ضيافة', 'hospitality'], ['EXC-11', 'أخرى', 'other']
  ];
  CATS.forEach(([c, n, k], i) => {
    if (!has('SELECT id FROM expense_categories WHERE code=?', c)) {
      db.prepare('INSERT INTO expense_categories (code, name, kind, sort_order) VALUES (?,?,?,?)').run(c, n, k, i);
    }
  });

  // مراحل البيع
  if (!has('SELECT key FROM settings WHERE key=?', 'pipeline_stages')) {
    const stages = [
      { k: 'lead', name: 'عميل محتمل', color: '#64748b' },
      { k: 'contacted', name: 'تم التواصل', color: '#0ea5e9' },
      { k: 'interested', name: 'مهتم', color: '#6366f1' },
      { k: 'visit', name: 'معاينة', color: '#8b5cf6' },
      { k: 'quotation', name: 'عرض سعر', color: '#a855f7' },
      { k: 'negotiation', name: 'تفاوض', color: '#f59e0b' },
      { k: 'reserved', name: 'حجز', color: '#f97316' },
      { k: 'contract', name: 'عقد', color: '#14b8a6' },
      { k: 'sold', name: 'بيع', color: '#16a34a' },
      { k: 'closed', name: 'مغلق', color: '#475569' }
    ];
    db.prepare('INSERT INTO settings (key, value) VALUES (?,?)').run('pipeline_stages', JSON.stringify(stages));
  }

  // إعدادات النظام المالية
  const DEF = {
    currency: 'ر.س',
    finance_require_approval_discount_percent: '10',
    finance_require_approval_expense_amount: '5000',
    finance_allow_overpayment: '0',
    interest_match_threshold: '60',
    whatsapp_country_code: '966',
    finance_installments_count_default: '12'
  };
  Object.entries(DEF).forEach(([k, v]) => { if (!has('SELECT key FROM settings WHERE key=?', k)) db.prepare('INSERT INTO settings (key, value) VALUES (?,?)').run(k, v); });

  // قالب رسالة جاهز لمراسلة العملاء المهتمين (متغيرات تُستبدل آليًا لكل عميل)
  if (!has('SELECT id FROM message_templates WHERE name=?', 'مراسلة العملاء المهتمين')) {
    db.prepare(`INSERT INTO message_templates (name, kind, subject, body, vars_json, is_default) VALUES (?,?,?,?,?,?)`).run(
      'مراسلة العملاء المهتمين', 'whatsapp', '',
      'السلام عليكم {{اسم العميل}}\nلدينا وحدة جديدة قد تناسب اهتمامك:\nالمشروع: {{اسم المشروع}}\nعدد الغرف: {{عدد الغرف}}\nالسعر: {{السعر}} {{currency}}\n{{رابط الوحدة}}\n{{company_name}}',
      JSON.stringify(['اسم العميل', 'اسم المشروع', 'عدد الغرف', 'السعر', 'رابط الوحدة', 'currency', 'company_name']), 1);
  }

  // صلاحيات الوحدات الجديدة لكل دور (إضافية فقط — لا تُلغي أي صلاحية قائمة)
  const DEFAULTS = {
    admin: ['accounts', 'expenses', 'schedule', 'contracts', 'quotations', 'interests', 'pipeline', 'commissions', 'approvals', 'statements', 'communications'],
    accountant: ['accounts', 'expenses', 'schedule', 'contracts', 'quotations', 'interests', 'commissions', 'approvals', 'statements', 'communications'],
    reservations: ['schedule', 'contracts', 'quotations', 'interests', 'pipeline', 'statements', 'commissions', 'communications'],
    secretary: ['interests', 'pipeline', 'quotations', 'statements', 'schedule', 'communications']
  };
  const ALL = ['view', 'create', 'edit', 'delete', 'export', 'print', 'approve', 'manage'];
  for (const [role, mods] of Object.entries(DEFAULTS)) {
    const r = db.prepare('SELECT id FROM roles WHERE name=?').get(role);
    if (!r) continue;
    for (const m of mods) {
      const acts = role === 'admin' ? ALL
        : role === 'accountant' ? ['view', 'create', 'edit', 'export', 'print', 'approve', 'manage']
          : ['view', 'create', 'edit', 'export', 'print'];
      for (const a of acts) {
        try { db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, module, action) VALUES (?,?,?)').run(r.id, m, a); } catch {}
      }
    }
  }
}

// =====================================================================
// 3) ترحيل البيانات: العربون/الدفعة الأولى كدفعات حقيقية، العقود، السجل،
//    الأقساط، مراحل العملاء، والحركات المالية للحسابات.
// =====================================================================
function m3_backfill() {
  const admin = db.prepare(`SELECT id FROM users WHERE role_id=(SELECT id FROM roles WHERE name='admin') ORDER BY id LIMIT 1`).get();
  const uid = admin ? admin.id : (db.prepare('SELECT id FROM users ORDER BY id LIMIT 1')?.get()?.id ?? null);
  const defAcc = db.prepare('SELECT id FROM accounts WHERE is_default=1 ORDER BY id LIMIT 1').get();
  const defAccId = defAcc ? defAcc.id : null;

  // 3.1 الدفعات القائمة بلا حركة مالية → أنشئ حركة صندوق/بنك
  const orphanPays = db.prepare(`
    SELECT p.* FROM payments p WHERE p.txn_id IS NULL AND p.status='confirmed' AND p.deleted_at IS NULL`).all();
  const insTxn = db.prepare(`INSERT INTO transactions (code, txn_date, kind, direction, amount, account_id, client_id, project_id, unit_id, sale_id, reservation_id, method, reference_no, status, notes, user_id, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const setPayTxn = db.prepare('UPDATE payments SET txn_id=? WHERE id=?');
  orphanPays.forEach(p => {
    const kind = p.kind === 'deposit' ? 'deposit' : p.kind === 'down_payment' ? 'down_payment' : 'installment';
    const t = insTxn.run(code('TXN', 'transactions'), p.paid_at, kind, 'in', p.amount, p.account_id || defAccId, p.client_id, p.project_id, p.unit_id, p.sale_id, p.reservation_id, p.method, p.reference_no || '', 'confirmed', 'ترحيل دفعة قائمة', p.created_by || uid, p.created_at);
    setPayTxn.run(t.lastInsertRowid, p.id);
    if (!p.account_id && defAccId) db.prepare('UPDATE payments SET account_id=? WHERE id=?').run(defAccId, p.id);
  });

  // 3.2 عرابين الحجوزات النشطة/المكتملة بدون دفعة مسجّلة → دفعة عربون حقيقية
  const resv = db.prepare(`
    SELECT r.*, u.project_id FROM reservations r JOIN units u ON u.id=r.unit_id
    WHERE r.deposit > 0 AND r.status IN ('active','completed')
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.reservation_id=r.id AND p.deleted_at IS NULL)`).all();
  const insPay = db.prepare(`INSERT INTO payments (receipt_no, kind, sale_id, reservation_id, client_id, unit_id, project_id, amount, method, account_id, reference_no, status, paid_at, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  resv.forEach(r => {
    const payId = insPay.run(code('RCPT', 'payments'), 'deposit', null, r.id, r.client_id, r.unit_id, r.project_id, num(r.deposit),
      ['cash', 'transfer', 'check', 'card', 'online', 'other'].includes(r.deposit_method) ? r.deposit_method : 'cash',
      defAccId, r.deposit_ref || '', 'confirmed', r.reservation_date, 'عربون حجز (ترحيل بيانات)', r.created_by || uid).lastInsertRowid;
    const t = insTxn.run(code('TXN', 'transactions'), r.reservation_date, 'deposit', 'in', num(r.deposit), defAccId, r.client_id, r.project_id, r.unit_id, null, r.id, 'cash', r.deposit_ref || '', 'confirmed', `عربون حجز ${r.code}`, r.created_by || uid, r.created_at);
    setPayTxn.run(t.lastInsertRowid, payId);
  });

  // 3.3 ربط عربون الحجوزات المتحوّلة إلى بيع بالبيع نفسه (بدون تكرار المبلغ)
  const converted = db.prepare(`SELECT id, sale_id FROM (
      SELECT r.id, (SELECT s.id FROM sales s WHERE s.reservation_id=r.id AND s.status<>'cancelled' ORDER BY s.id DESC LIMIT 1) sale_id
      FROM reservations r WHERE r.status='completed') WHERE sale_id IS NOT NULL`).all();
  converted.forEach(c => {
    db.prepare('UPDATE payments SET sale_id=? WHERE reservation_id=? AND sale_id IS NULL AND deleted_at IS NULL').run(c.sale_id, c.id);
    db.prepare(`UPDATE transactions SET sale_id=? WHERE reservation_id=? AND sale_id IS NULL`).run(c.sale_id, c.id);
  });

  // 3.4 الدفعة الأولى في المبيعات التي لا توجد لها أي دفعة مسجّلة → دفعة فعلية
  const salesNoPay = db.prepare(`
    SELECT s.*, u.project_id FROM sales s JOIN units u ON u.id=s.unit_id
    WHERE s.down_payment > 0 AND s.status<>'cancelled'
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.sale_id=s.id AND p.deleted_at IS NULL)`).all();
  salesNoPay.forEach(s => {
    const payId = insPay.run(code('RCPT', 'payments'), 'down_payment', s.id, s.reservation_id, s.client_id, s.unit_id, s.project_id, num(s.down_payment),
      ['cash', 'transfer', 'check', 'card', 'online', 'other'].includes(s.payment_method) ? s.payment_method : 'transfer',
      s.account_id || defAccId, s.reference_no || '', 'confirmed', s.sale_date, 'دفعة أولى (ترحيل بيانات)', s.created_by || uid).lastInsertRowid;
    const t = insTxn.run(code('TXN', 'transactions'), s.sale_date, 'down_payment', 'in', num(s.down_payment), s.account_id || defAccId, s.client_id, s.project_id, s.unit_id, s.id, s.reservation_id, 'transfer', s.reference_no || '', 'confirmed', `دفعة أولى لعملية ${s.code}`, s.created_by || uid, s.created_at);
    setPayTxn.run(t.lastInsertRowid, payId);
  });

  // 3.5 تعبئة الحقول المشتقة للدفعات (العميل/الوحدة/المشروع)
  db.prepare(`UPDATE payments SET
      client_id = COALESCE(client_id, (SELECT s.client_id FROM sales s WHERE s.id=payments.sale_id), (SELECT r.client_id FROM reservations r WHERE r.id=payments.reservation_id)),
      unit_id = COALESCE(unit_id, (SELECT s.unit_id FROM sales s WHERE s.id=payments.sale_id), (SELECT r.unit_id FROM reservations r WHERE r.id=payments.reservation_id)),
      project_id = COALESCE(project_id, (SELECT u.project_id FROM units u WHERE u.id=payments.unit_id)),
      account_id = COALESCE(account_id, ?) WHERE deleted_at IS NULL`).run(defAccId);

  // 3.6 عقود للعمليات القائمة التي لا عقد لها
  const salesNoContract = db.prepare(`
    SELECT s.*, u.project_id FROM sales s JOIN units u ON u.id=s.unit_id
    WHERE s.status<>'cancelled' AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.sale_id=s.id)`).all();
  const insContract = db.prepare(`INSERT INTO contracts (code, client_id, project_id, unit_id, sale_id, reservation_id, contract_date, start_date, amount, discount, net_amount, deposit_amount, status, signed_at, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  salesNoContract.forEach(s => {
    const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE sale_id=? AND status='confirmed' AND deleted_at IS NULL`).get(s.id).v;
    const net = num(s.net_price, num(s.sale_price) - num(s.discount));
    const status = paid >= net - 0.01 ? 'completed' : (s.status === 'completed' ? 'completed' : 'active');
    const cid = insContract.run(code('CON', 'contracts'), s.client_id, s.project_id, s.unit_id, s.id, s.reservation_id, s.sale_date, s.sale_date,
      num(s.sale_price), num(s.discount), net, paid, status, s.sale_date, 'عقد مُرحَّل من عملية بيع قائمة', s.created_by || uid).lastInsertRowid;
    db.prepare('UPDATE sales SET contract_id=? WHERE id=?').run(cid, s.id);
  });

  // 3.7 جدول الأقساط للعمليات القائمة
  salesNoContract.forEach(s => {
    const exists = db.prepare('SELECT COUNT(*) c FROM payment_schedule WHERE sale_id=?').get(s.id).c;
    if (exists) return;
    const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE sale_id=? AND status='confirmed' AND deleted_at IS NULL`).get(s.id).v;
    const net = num(s.net_price);
    const contract = db.prepare('SELECT id FROM contracts WHERE sale_id=? LIMIT 1').get(s.id);
    const insSched = db.prepare(`INSERT INTO payment_schedule (code, sale_id, reservation_id, contract_id, client_id, unit_id, project_id, seq, label, due_date, amount, paid_amount, status, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    if (paid > 0) insSched.run(code('SCH', 'payment_schedule'), s.id, s.reservation_id, contract?.id || null, s.client_id, s.unit_id, s.project_id, 1, 'المدفوع (ترحيل)', s.sale_date, paid, paid, 'paid', s.created_by || uid);
    const remaining = Math.max(0, net - paid);
    if (remaining > 0.01) {
      const months = 12, each = Math.round((remaining / months) * 100) / 100;
      let acc = 0;
      for (let i = 1; i <= months; i++) {
        const amt = i === months ? Math.round((remaining - acc) * 100) / 100 : each;
        acc += amt;
        const due = TT.addMonths(i, s.sale_date || TT.today());
        insSched.run(code('SCH', 'payment_schedule'), s.id, s.reservation_id, contract?.id || null, s.client_id, s.unit_id, s.project_id, i + 1,
          `قسط ${i}`, due, amt, 0, 'upcoming', s.created_by || uid);
      }
    }
  });

  // 3.8 سجل حالة الوحدات الابتدائي
  db.prepare(`SELECT id, status FROM units`).all().forEach(u => {
    if (!has('SELECT id FROM unit_status_history WHERE unit_id=? LIMIT 1', u.id)) {
      db.prepare('INSERT INTO unit_status_history (unit_id, from_status, to_status, reason, user_id) VALUES (?,?,?,?,?)')
        .run(u.id, '', u.status, 'الحالة الابتدائية عند الترحيل', uid);
    }
  });

  // 3.9 مراحل العملاء المستنتجة من البيانات الفعلية
  db.prepare(`SELECT id, status FROM clients WHERE deleted_at IS NULL`).all().forEach(c => {
    if (has('SELECT id FROM client_stage_history WHERE client_id=? LIMIT 1', c.id)) return;
    const sale = has('SELECT id FROM sales WHERE client_id=? AND status<>\'cancelled\' LIMIT 1', c.id);
    const res = has('SELECT id FROM reservations WHERE client_id=? AND status=\'active\' LIMIT 1', c.id);
    const quote = has('SELECT id FROM quotations WHERE client_id=? LIMIT 1', c.id);
    const comm = has('SELECT id FROM communications WHERE client_id=? LIMIT 1', c.id);
    const stage = sale ? 'sold' : res ? 'reserved' : quote ? 'quotation' : comm ? 'contacted' : c.status === 'potential' ? 'lead' : 'contacted';
    db.prepare('UPDATE clients SET pipeline_stage=COALESCE(NULLIF(pipeline_stage,\'\'),?), stage_changed_at=COALESCE(stage_changed_at, ?) WHERE id=?')
      .run(stage, TT.nowStr(), c.id);
    db.prepare('INSERT INTO client_stage_history (client_id, from_stage, to_stage, note, user_id) VALUES (?,?,?,?,?)')
      .run(c.id, '', stage, 'مرحلة مستنتجة من البيانات القائمة', uid);
  });

  // 3.10 اهتمامات مستنتجة من مصدر العميل/الملاحظات (للعملاء المحتملين)
  db.prepare(`SELECT id, source, notes FROM clients WHERE deleted_at IS NULL AND status IN ('potential','vip','active')`).all().forEach(c => {
    if (has('SELECT id FROM client_interests WHERE client_id=? LIMIT 1', c.id)) return;
    db.prepare(`INSERT INTO client_interests (code, client_id, property_type, budget_min, budget_max, rooms, purpose, notes, sales_notes, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(code('INT', 'client_interests'), c.id, 'apartment', 0, 0, 0, 'residence', c.notes || '', 'اهتمام مستنتج آليًا — يُرجى تحديثه', uid);
  });

  // 3.11 إعادة احتساب أرصدة الحسابات من الحركات الفعلية
  db.prepare('SELECT id FROM accounts WHERE deleted_at IS NULL').all().forEach(a => {
    const b = db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) v FROM transactions
      WHERE deleted_at IS NULL AND status IN ('confirmed','cleared') AND (account_id=? OR (to_account_id=? AND direction='in'))`).get(a.id, a.id).v;
    const acc = db.prepare('SELECT opening_balance FROM accounts WHERE id=?').get(a.id);
    db.prepare('UPDATE accounts SET current_balance=? WHERE id=?').run(Math.round((num(acc.opening_balance) + num(b)) * 100) / 100, a.id);
  });
}


// =====================================================================
// 4) تحديث اهتمامات العملاء والوحدات: ربط الدور (floor_id) للاهتمام،
//    أسماء الأدوار، فهارس الفلترة، صلاحيات قسم الاهتمامات، وقوالب الرسائل.
// =====================================================================
function m4_interests_units() {
  const has = (sql, ...a) => { try { return !!db.prepare(sql).get(...a); } catch { return false; } };

  // ---- أعمدة جديدة في جدول اهتمامات العملاء (إضافة فقط — لا حذف ولا إعادة بناء)
  ensureCol('client_interests', 'floor_id', 'INTEGER REFERENCES floors(id)');
  ensureCol('client_interests', 'updated_by', 'INTEGER REFERENCES users(id)');
  ensureCol('client_interests', 'archived_at', 'TEXT');

  // ---- تعبئة أسماء الأدوار الفارغة (بلا تغيير لأي نوع دور موجود)
  const T = { ground: 'الأرضي', mezzanine: 'الميزانين', roof: 'روف', terrace: 'السطح', basement: 'القبو', normal: '', other: '' };
  const floors = db.prepare("SELECT * FROM floors WHERE COALESCE(display_name,'')='' OR COALESCE(name,'')=''").all();
  const upd = db.prepare("UPDATE floors SET name=?, display_name=? WHERE id=?");
  floors.forEach(f => {
    const type = T[f.type] !== undefined ? f.type : 'normal';
    const base = f.name && f.name.trim() ? f.name.trim() : (type === 'roof' ? `الدور ${f.number} — روف` : (T[type] ? `الدور ${f.number} — ${T[type]}` : `الدور ${f.number}`));
    const display = type === 'roof' && !/روف/.test(base) ? `${base} — روف` : base;
    upd.run(base, display, f.id);
  });

  // ---- وحدات قديمة بلا عدد غرف: لا نحذفها ولا نستنتج لها رقمًا (نتركها 0 = غير محدد)
  try { db.exec("UPDATE units SET rooms=0 WHERE rooms IS NULL"); } catch {}

  // ---- مزامنة روف الوحدات مع نوع الدور (بيانات قائمة فقط، تُحفظ كما هي)
  try {
    db.exec(`UPDATE units SET has_roof=1 WHERE floor_id IN (SELECT id FROM floors WHERE type='roof') AND COALESCE(has_roof,0)=0`);
  } catch {}

  // ---- فهارس الفلترة الجديدة
  db.exec(`
CREATE INDEX IF NOT EXISTS idx_int_floor ON client_interests(floor_id);
CREATE INDEX IF NOT EXISTS idx_int_bath ON client_interests(bathrooms);
CREATE INDEX IF NOT EXISTS idx_int_area ON client_interests(area_min, area_max);
CREATE INDEX IF NOT EXISTS idx_int_delivery ON client_interests(delivery_status);
CREATE INDEX IF NOT EXISTS idx_int_city ON client_interests(city);
CREATE INDEX IF NOT EXISTS idx_int_active ON client_interests(is_active, deleted_at);
CREATE INDEX IF NOT EXISTS idx_comm_interest ON communications(interest_id);
CREATE INDEX IF NOT EXISTS idx_comm_kind ON communications(kind, created_at);
`);

  // ---- صلاحيات قسم اهتمامات العملاء (إضافية فقط)
  const ALL = ['view', 'create', 'edit', 'delete', 'export', 'print', 'approve', 'manage', 'contact'];
  const roles = db.prepare('SELECT id, name FROM roles').all();
  roles.forEach(r => {
    let acts;
    if (r.name === 'admin') acts = ALL;
    else if (r.name === 'accountant') acts = ['view', 'create', 'edit', 'export', 'print', 'contact'];
    else if (r.name === 'secretary') acts = ['view', 'create', 'edit', 'export', 'print', 'contact'];
    else if (has('SELECT id FROM role_permissions WHERE role_id=? AND module=?', r.id, 'interests')) acts = ['view', 'create', 'edit', 'export', 'print', 'contact'];
    else acts = [];
    acts.forEach(a => { try { db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, module, action) VALUES (?,?,?)').run(r.id, 'interests', a); } catch {} });
  });

  // ---- إعدادات افتراضية لقسم الاهتمامات (لا تستبدل أي إعداد موجود)
  const setting = (k, v, label) => { try { db.prepare('INSERT OR IGNORE INTO settings (key, value, label) VALUES (?,?,?)').run(k, v, label); } catch { try { db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)').run(k, v); } catch {} } };
  setting('interest_message_template', 'السلام عليكم {{اسم العميل}}\nلدينا وحدة قد تناسب اهتمامك.\n\nالمشروع: {{اسم المشروع}}\nنوع العقار: {{نوع العقار}}\nعدد الغرف: {{عدد الغرف}}\nالسعر: {{السعر}}\n\nإذا كنت مهتمًا يسعدنا التواصل معك.', 'قالب رسالة اهتمامات العملاء (واتساب)');
  setting('interest_rooms_include_unspecified', '0', 'تضمين الاهتمامات غير محددة عدد الغرف في فلترة الغرف');

  // ---- سجل الترحيل
  try { push?.(null, 'migrate', 'interests', 'm4', null, 'ترحيل الدور والفهارس والصلاحيات'); } catch {}
}


// =====================================================================
// 5) إصلاحات تدقيق 2026-09-19:
//    أ) قيد التحويل المزدوج (transfer_group) + تحويل الحركات القديمة إلى رجلين
//    ب) فهرس فريد يمنع أكثر من حجز نشط للوحدة الواحدة
//    ج) إصلاح بيانات الحجوزات المكررة / حجز على وحدة مباعة
//    د) مزامنة كاش العربون مع الدفعات (payments = مصدر الحقيقة)
//    هـ) Project → Units: إلغاء إلزام المبنى/الدور
//    و) إعدادات مالية جديدة + إيقاف وضع الديمو
//    كل إصلاح يُسجَّل في data_repairs ولا يحذف أي بيانات مالية.
// =====================================================================
function m5_audit_fixes() {
  db.exec(`CREATE TABLE IF NOT EXISTS data_repairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration TEXT NOT NULL,
    issue TEXT NOT NULL,
    entity TEXT DEFAULT '',
    entity_id INTEGER,
    action_taken TEXT NOT NULL,
    detail TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  const repair = (issue, entity, entityId, action, detail = '') => {
    try { db.prepare('INSERT INTO data_repairs (migration, issue, entity, entity_id, action_taken, detail) VALUES (?,?,?,?,?,?)')
      .run('m5_audit_fixes', issue, entity, entityId, action, String(detail).slice(0, 500)); } catch {}
  };

  // ---------- أ) عمود مجموعة التحويل ----------
  ensureCol('transactions', 'transfer_group', "TEXT DEFAULT ''");
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_txn_transfer_group ON transactions(transfer_group)'); } catch {}

  // تحويل أي تحويل قديم برجل واحد (out مع to_account_id) إلى قيد مزدوج بإضافة الرجل الوارد
  try {
    const legacy = db.prepare(`SELECT * FROM transactions WHERE kind='transfer' AND direction='out' AND to_account_id IS NOT NULL
      AND deleted_at IS NULL AND COALESCE(transfer_group,'')=''`).all();
    let seq = 0;
    legacy.forEach(t => {
      const group = 'TRF-MIG5-' + String(t.id).padStart(6, '0');
      db.prepare("UPDATE transactions SET transfer_group=? WHERE id=?").run(group, t.id);
      const exists = db.prepare("SELECT id FROM transactions WHERE transfer_group=? AND direction='in'").get(group);
      if (!exists) {
        db.prepare(`INSERT INTO transactions (code, txn_date, kind, direction, amount, account_id, to_account_id, method, reference_no, status, notes, user_id, created_at, transfer_group)
          VALUES (?,?,?,?,?, ?,?, ?,?, ?,?,?, datetime('now','localtime'), ?)`)
          .run('TXN-MIG5-' + String(t.id).padStart(6, '0'), t.txn_date, 'transfer', 'in', t.amount, t.to_account_id, t.account_id,
            t.method || 'transfer', t.reference_no || '', t.status || 'confirmed',
            `[ترحيل] الرجل الوارد لتحويل ${t.code}`, t.user_id, group);
        seq++;
      }
      if (seq) repair('C-04 تحويل برجل واحد لا يظهر في الحساب الوجهة', 'transaction', t.id, 'إضافة الرجل الوارد وربط الرجلين بمجموعة ' + group, `${t.code} ${t.amount}`);
    });
  } catch (e) { console.warn('[migrate5] legacy transfer fix:', e.message); }

  // ---------- ج) إصلاح الحجوزات ----------
  try {
    const dupUnits = db.prepare(`SELECT unit_id, COUNT(*) c FROM reservations WHERE status='active' GROUP BY unit_id HAVING c > 1`).all();
    dupUnits.forEach(d => {
      const rows = db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM payments p WHERE p.reservation_id=r.id AND p.deleted_at IS NULL) pay_count,
          (SELECT id FROM sales s WHERE s.reservation_id=r.id AND s.status<>'cancelled') sale_id
        FROM reservations r WHERE r.unit_id=? AND r.status='active' ORDER BY sale_id IS NULL, pay_count DESC, id DESC`).all(d.unit_id);
      const keep = rows[0];
      rows.slice(1).forEach(r => {
        db.prepare(`UPDATE reservations SET status='cancelled', cancel_reason=?, updated_at=datetime('now','localtime') WHERE id=?`)
          .run('إصلاح تلقائي (تدقيق 2026-09): حجز مكرر لنفس الوحدة — تم الإبقاء على ' + keep.code, r.id);
        repair('C-08 حجوزات نشطة مكررة لنفس الوحدة', 'reservation', r.id, 'إلغاء الحجز المكرر ' + r.code, `وحدة ${d.unit_id} — أُبقي على ${keep.code} (له ${keep.pay_count || 0} دفعة)`);
      });
    });
    // حجز نشط على وحدة مباعة
    const soldConflicts = db.prepare(`SELECT r.id, r.code, r.unit_id, u.status unit_status,
        (SELECT id FROM sales s WHERE s.unit_id=r.unit_id AND s.status<>'cancelled' LIMIT 1) sale_id,
        (SELECT reservation_id FROM sales s WHERE s.unit_id=r.unit_id AND s.status<>'cancelled' LIMIT 1) sale_resv_id
      FROM reservations r JOIN units u ON u.id=r.unit_id WHERE r.status='active' AND u.status='sold'`).all();
    soldConflicts.forEach(r => {
      if (r.sale_resv_id && Number(r.sale_resv_id) === Number(r.id)) {
        db.prepare("UPDATE reservations SET status='completed', updated_at=datetime('now','localtime') WHERE id=?").run(r.id);
        repair('C-09 حجز نشط على وحدة مباعة', 'reservation', r.id, 'تحويل الحجز إلى completed لأنه مرتبط بالبيع', `${r.code} — وحدة ${r.unit_id} — بيع ${r.sale_id}`);
      } else {
        db.prepare(`UPDATE reservations SET status='cancelled', cancel_reason=?, updated_at=datetime('now','localtime') WHERE id=?`)
          .run('إصلاح تلقائي (تدقيق 2026-09): الوحدة مباعة بعملية أخرى', r.id);
        repair('C-09 حجز نشط على وحدة مباعة', 'reservation', r.id, 'إلغاء الحجز', `${r.code} — وحدة ${r.unit_status} — بيع ${r.sale_id}`);
      }
    });
    // وحدة بحالة reserved بلا حجز نشط → إعادة تقييم الحالة من المبيعات/الحجوزات
    const orphans = db.prepare(`SELECT u.id, u.code FROM units u WHERE u.status='reserved' AND u.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.unit_id=u.id AND r.status='active')`).all();
    orphans.forEach(u => {
      const sold = db.prepare("SELECT id FROM sales WHERE unit_id=? AND status<>'cancelled'").get(u.id);
      const next = sold ? 'sold' : 'available';
      db.prepare("UPDATE units SET status=?, updated_at=datetime('now','localtime') WHERE id=?").run(next, u.id);
      repair('حالة وحدة غير متسقة (reserved بلا حجز نشط)', 'unit', u.id, `تغيير الحالة إلى ${next}`, u.code);
    });
  } catch (e) { console.warn('[migrate5] reservation repair:', e.message); }

  // ---------- ب) فهرس فريد: حجز نشط واحد لكل وحدة ----------
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_reservations_unit_active ON reservations(unit_id) WHERE status='active'");
  } catch (e) { console.warn('[migrate5] unique active reservation index:', e.message); }
  // بيع نشط واحد لكل وحدة
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_unit_active ON sales(unit_id) WHERE status IN ('active','completed')");
  } catch (e) { console.warn('[migrate5] unique active sale index:', e.message); }

  // ---------- د) مزامنة كاش العربون ----------
  try {
    const rows = db.prepare(`SELECT r.id, r.code, r.deposit,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.reservation_id=r.id AND p.deleted_at IS NULL AND p.status='confirmed'),0) paid
      FROM reservations r`).all();
    rows.forEach(r => {
      if (Math.abs(num(r.deposit) - num(r.paid)) > 0.009) {
        db.prepare("UPDATE reservations SET deposit=?, updated_at=datetime('now','localtime') WHERE id=?").run(num(r.paid), r.id);
        repair('H-04 كاش العربون غير متزامن مع الدفعات', 'reservation', r.id, `تحديث deposit من ${num(r.deposit)} إلى ${num(r.paid)}`, r.code);
      }
    });
  } catch (e) { console.warn('[migrate5] deposit sync:', e.message); }

  // ---------- H-01) بيع بطريقة تحويل بلا مرجع ----------
  try {
    const rows = db.prepare(`SELECT s.id, s.code, s.payment_method, s.reference_no,
        (SELECT p.reference_no FROM payments p WHERE p.sale_id=s.id AND p.deleted_at IS NULL AND COALESCE(p.reference_no,'')<>'' ORDER BY p.id LIMIT 1) pay_ref,
        (SELECT p.method FROM payments p WHERE p.sale_id=s.id AND p.deleted_at IS NULL AND p.status='confirmed' ORDER BY p.id LIMIT 1) pay_method
      FROM sales s WHERE s.status<>'cancelled' AND LOWER(COALESCE(s.payment_method,'')) IN ('transfer','online') AND COALESCE(TRIM(s.reference_no),'')=''`).all();
    rows.forEach(s => {
      if (s.pay_ref) {
        db.prepare("UPDATE sales SET reference_no=?, updated_at=datetime('now','localtime') WHERE id=?").run(s.pay_ref, s.id);
        repair('H-01 بيع بتحويل بلا مرجع', 'sale', s.id, `نسخ المرجع من الدفعة الفعلية: ${s.pay_ref}`, s.code);
      } else if (s.pay_method && s.pay_method !== 'transfer' && s.pay_method !== 'online') {
        db.prepare("UPDATE sales SET payment_method=?, updated_at=datetime('now','localtime') WHERE id=?").run(s.pay_method, s.id);
        repair('H-01 طريقة دفع البيع لا تطابق الدفعات الفعلية', 'sale', s.id, `تصحيح payment_method من ${s.payment_method} إلى ${s.pay_method} (الدفعات هي مصدر الحقيقة)`, s.code);
      } else {
        repair('H-01 بيع بتحويل بلا مرجع', 'sale', s.id, 'لم يُعدَّل — يحتاج إدخال المرجع البنكي يدويًا', s.code);
      }
    });
  } catch (e) { console.warn('[migrate5] sale reference repair:', e.message); }

  // ---------- توحيد نموذج العكس المالي (قيد مزدوج) ----------
  // النموذج الصحيح: الحركة الأصلية تبقى بحالتها المؤثرة، وتُنشأ حركة معاكسة (reversal_of) تُصفّرها،
  // وتُعلَّم الأصل بـ reversed_by. الصفوف القديمة التي حُددت status='reversed' مع وجود حركة معاكسة
  // كانت تُحذف من الرصيد ويُحتسب العكس وحده (أو العكس) — نُعيدها لحالتها المؤثرة.
  try {
    const fixed = db.prepare(`UPDATE transactions SET status = CASE WHEN check_status='cleared' THEN 'cleared' ELSE 'confirmed' END
      WHERE status='reversed' AND (reversed_by IS NOT NULL
        OR EXISTS (SELECT 1 FROM (SELECT reversal_of FROM transactions WHERE reversal_of IS NOT NULL) r WHERE r.reversal_of = transactions.id))`).run();
    if (num(fixed.changes) > 0) repair('نموذج العكس المالي غير متسق', 'transaction', null, `إعادة ${fixed.changes} حركة من reversed إلى حالتها المؤثرة (يوجد لها قيد معاكس)`, '');
  } catch (e) { console.warn('[migrate5] reversal normalization:', e.message); }
  // حركات معاكسة بلا أصل مرتبط → نربطها
  try {
    db.prepare(`UPDATE transactions SET reversal_of=(SELECT id FROM transactions o WHERE o.reversed_by=transactions.id LIMIT 1)
      WHERE kind='reversal' AND reversal_of IS NULL AND EXISTS (SELECT 1 FROM transactions o WHERE o.reversed_by=transactions.id)`).run();
  } catch {}

  // ---------- إعادة احتساب أرصدة الحسابات ----------
  try {
    db.prepare("SELECT id FROM accounts").all().forEach(a => {
      const moves = db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) v
        FROM transactions WHERE deleted_at IS NULL AND status IN ('confirmed','cleared') AND account_id=?`).get(a.id).v;
      const open = num(db.prepare('SELECT opening_balance FROM accounts WHERE id=?').get(a.id).opening_balance);
      const bal = Math.round((open + num(moves)) * 100) / 100;
      db.prepare("UPDATE accounts SET current_balance=?, updated_at=datetime('now','localtime') WHERE id=?").run(bal, a.id);
    });
    repair('C-06 أرصدة حسابات غير محدثة', 'account', null, 'إعادة احتساب كل الأرصدة من الحركات المؤكدة/المحصّلة', '');
  } catch (e) { console.warn('[migrate5] balance recompute:', e.message); }

  // ---------- هـ) Project → Units: المبنى/الدور اختياري ----------
  try {
    db.exec("UPDATE projects SET require_building=0 WHERE require_building=1");
    db.exec("UPDATE projects SET require_floor=0 WHERE require_floor=1");
    // تغيير القيمة الافتراضية للأعمدة (SQLite: إعادة بناء الجدول غير آمنة هنا — نضبطها عبر فحص عند الإنشاء)
    repair('H-05 المشروع مبني على المبنى/الدور', 'project', null, 'إلغاء إلزام المبنى والدور لكل المشاريع القائمة', 'Project → Units');
  } catch (e) { console.warn('[migrate5] project/units:', e.message); }

  // ---------- و) إعدادات ----------
  const setIfMissing = (k, v) => { try { db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)').run(k, v); } catch {} };
  setIfMissing('finance_allow_negative_balance', '0');
  setIfMissing('finance_allow_overpayment', '0');
  setIfMissing('finance_require_transfer_reference', '1');
  setIfMissing('ai_total_timeout_sec', '28');
  setIfMissing('ai_provider_timeout_sec', '10');
  setIfMissing('ai_max_attempts', '3');
  setIfMissing('app_timezone', 'Asia/Riyadh');
  setIfMissing('security_password_min_length', '10');
  setIfMissing('files_ticket_ttl_sec', '120');
  // إيقاف وضع الديمو (يُفعَّل يدويًا عند الحاجة)
  try {
    const dm = db.prepare("SELECT value FROM settings WHERE key='demo_mode_enabled'").get();
    if (dm && dm.value === '1') {
      db.prepare("UPDATE settings SET value='0' WHERE key='demo_mode_enabled'").run();
      repair('H-12 وضع الديمو مفعّل', 'setting', null, 'إيقاف demo_mode_enabled', 'يُفعَّل يدويًا من الإعدادات عند الحاجة');
    }
  } catch {}

  // ---------- صلاحيات AI: إضافة actions المفقودة للأدوار القياسية ----------
  try {
    db.prepare("SELECT id, name FROM roles").all().forEach(r => {
      const has = (m, a) => { try { return !!db.prepare('SELECT 1 FROM role_permissions WHERE role_id=? AND module=? AND action=?').get(r.id, m, a); } catch { return false; } };
      // لا نمنح صلاحيات جديدة تلقائيًا — resolver الذكاء الاصطناعي يترجم search→view و execute→edit
    });
  } catch {}

  console.log('[migrate] m5: إصلاحات التدقيق مطبَّقة (data_repairs يسجّل كل تغيير)');
}

const MIGRATIONS = [
  { id: 1, name: 'schema_v2_finance_crm', up: m1_schema },
  { id: 2, name: 'defaults_accounts_categories_pipeline_permissions', up: m2_defaults },
  { id: 3, name: 'backfill_deposits_contracts_schedule_stages', up: m3_backfill },
  { id: 4, name: 'interests_floor_link_filters_permissions', up: m4_interests_units },
  { id: 5, name: 'audit_fixes_2026_09_19', up: m5_audit_fixes }
];

function runMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  const done = new Set(db.prepare('SELECT id FROM migrations').all().map(r => r.id));
  const applied = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    try {
      m.up();
      db.prepare('INSERT INTO migrations (id, name) VALUES (?,?)').run(m.id, m.name);
      applied.push(m.name);
      console.log(`[migrate] applied #${m.id} ${m.name}`);
    } catch (e) {
      console.error(`[migrate] FAILED #${m.id} ${m.name}:`, e.message);
      throw e;
    }
  }
  try { flush(); } catch {}
  return applied;
}

module.exports = { runMigrations, MIGRATIONS, ensureCol, tableCols };
