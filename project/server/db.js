// Smart Secretary — Database layer (SQLite عبر sql.js/WASM — صفر ترجمة، يعمل على أي Node وأي نظام)
// نفس الملف القياسي (.db) — يُفتح بأي متصفح SQLite. الحفظ فوري ومتزامن بعد كل كتابة (ذري عبر ملف مؤقت).
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'smart-secretary.db');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const MODULES = ['dashboard','tasks','appointments','clients','calls','notes','files','notifications','users','roles','audit','settings','reports','projects','units','reservations','sales','finance','backup','brokers','templates','branding','ai','assistant','accounts','expenses','schedule','contracts','quotations','interests','pipeline','commissions','approvals','statements','communications'];
const ACTIONS = ['view','create','edit','delete','export','print','approve','manage','contact'];

let raw = null; // sql.js Database

function wasmPath(file) {
  const cands = [
    path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', file),
    path.join(process.resourcesPath || '', 'app', 'node_modules', 'sql.js', 'dist', file)
  ];
  for (const c of cands) { try { if (c && fs.existsSync(c)) return c; } catch {} }
  return file;
}

function flush() {
  if (!raw) return;
  const data = raw.export();
  try { raw.exec('PRAGMA foreign_keys = ON'); } catch {} // export() في sql.js يُصفّر FK — إعادة التفعيل إلزامية
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(data));
  fs.renameSync(tmp, DB_PATH);
}
process.on('beforeExit', () => { try { flush(); } catch {} });

// جملة متوافقة مع واجهة better-sqlite3: prepare().get/all/run
class Stmt {
  constructor(sql) { this.sql = sql; }
  _guard() { if (!raw) throw new Error('قاعدة البيانات غير مهيأة بعد'); }
  get(...params) {
    this._guard();
    const s = raw.prepare(this.sql);
    try {
      if (params.length) s.bind(params);
      return s.step() ? s.getAsObject() : undefined;
    } finally { s.free(); }
  }
  all(...params) {
    this._guard();
    const s = raw.prepare(this.sql);
    try {
      if (params.length) s.bind(params);
      const rows = [];
      while (s.step()) rows.push(s.getAsObject());
      return rows;
    } finally { s.free(); }
  }
  run(...params) {
    this._guard();
    const s = raw.prepare(this.sql);
    try {
      if (params.length) s.bind(params);
      s.step();
      let lastInsertRowid = 0;
      try {
        const r = raw.exec('SELECT last_insert_rowid() AS id');
        if (r.length && r[0].values.length) lastInsertRowid = r[0].values[0][0];
      } catch {}
      return { lastInsertRowid, changes: raw.getRowsModified() };
    } finally { s.free(); flush(); }
  }
}

const db = {
  prepare: (sql) => new Stmt(sql),
  exec: (sql) => { if (!raw) throw new Error('قاعدة البيانات غير مهيأة بعد'); raw.exec(sql); flush(); },
  pragma: (str) => {
    if (!raw) throw new Error('قاعدة البيانات غير مهيأة بعد');
    const m = /^\s*(\w+)\s*=\s*(.+?)\s*$/.exec(str);
    if (m && m[1].toLowerCase() === 'journal_mode') return; // ذاكرة داخلية — لا حاجة لـ WAL
    raw.exec('PRAGMA ' + str + ';');
  }
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_system INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  PRIMARY KEY (role_id, module, action)
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  phone TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','locked')),
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  company TEXT DEFAULT '',
  job_title TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  phone2 TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  category TEXT DEFAULT 'general',
  status TEXT DEFAULT 'active' CHECK (status IN ('active','potential','inactive','vip','blocked')),
  source TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  assignee_id INTEGER REFERENCES users(id),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status TEXT DEFAULT 'new' CHECK (status IN ('new','in_progress','paused','completed','cancelled')),
  start_date TEXT,
  due_date TEXT,
  completed_at TEXT,
  category TEXT DEFAULT 'general',
  client_id INTEGER REFERENCES clients(id),
  project_id INTEGER REFERENCES projects(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id),
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_min INTEGER DEFAULT 30,
  location TEXT DEFAULT '',
  attendees TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  reminder_min INTEGER DEFAULT 30,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','done','cancelled','postponed')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  started_at TEXT NOT NULL,
  duration_sec INTEGER DEFAULT 0,
  result TEXT DEFAULT 'answered' CHECK (result IN ('answered','missed','busy','no_answer','follow_up','deal','other')),
  notes TEXT DEFAULT '',
  follow_up_at TEXT,
  follow_up_done INTEGER DEFAULT 0,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_calls_date ON calls(started_at);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT DEFAULT '',
  body TEXT DEFAULT '',
  type TEXT DEFAULT 'text' CHECK (type IN ('text','checklist')),
  tags TEXT DEFAULT '[]',
  is_pinned INTEGER DEFAULT 0,
  color TEXT DEFAULT 'default',
  client_id INTEGER REFERENCES clients(id),
  task_id INTEGER REFERENCES tasks(id),
  appointment_id INTEGER REFERENCES appointments(id),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  category TEXT DEFAULT 'general',
  tags TEXT DEFAULT '[]',
  client_id INTEGER REFERENCES clients(id),
  task_id INTEGER REFERENCES tasks(id),
  appointment_id INTEGER REFERENCES appointments(id),
  project_id INTEGER REFERENCES projects(id),
  unit_id INTEGER REFERENCES units(id),
  sale_id INTEGER REFERENCES sales(id),
  reservation_id INTEGER REFERENCES reservations(id),
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_files_cat ON files(category);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type TEXT DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  link TEXT DEFAULT '',
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT DEFAULT '',
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  entity TEXT DEFAULT '',
  entity_id INTEGER,
  details TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  city TEXT DEFAULT '',
  address TEXT DEFAULT '',
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'active' CHECK (status IN ('active','upcoming','completed','paused')),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS buildings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  floors_count INTEGER DEFAULT 1,
  notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS floors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  name TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  building_id INTEGER REFERENCES buildings(id),
  floor_id INTEGER REFERENCES floors(id),
  type TEXT DEFAULT 'apartment',
  rooms INTEGER DEFAULT 3,
  area REAL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
  status TEXT DEFAULT 'available' CHECK (status IN ('available','reserved','sold','resale','blocked')),
  description TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_units_project ON units(project_id, status);
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  unit_id INTEGER NOT NULL REFERENCES units(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  price REAL NOT NULL CHECK (price >= 0),
  discount REAL DEFAULT 0 CHECK (discount >= 0),
  deposit REAL DEFAULT 0 CHECK (deposit >= 0),
  deposit_method TEXT DEFAULT 'cash',
  deposit_ref TEXT DEFAULT '',
  reservation_date TEXT NOT NULL,
  expiry_date TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','cancelled','expired')),
  employee_id INTEGER REFERENCES users(id),
  notes TEXT DEFAULT '',
  cancel_reason TEXT DEFAULT '',
  refund_amount REAL DEFAULT 0,
  deducted_amount REAL DEFAULT 0,
  refund_status TEXT DEFAULT 'none',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_res_status ON reservations(status);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  reservation_id INTEGER REFERENCES reservations(id),
  unit_id INTEGER NOT NULL REFERENCES units(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  sale_price REAL NOT NULL CHECK (sale_price >= 0),
  discount REAL DEFAULT 0 CHECK (discount >= 0),
  net_price REAL NOT NULL DEFAULT 0,
  down_payment REAL DEFAULT 0,
  commission REAL DEFAULT 0,
  commission_due REAL DEFAULT 0,
  broker_id INTEGER REFERENCES brokers(id),
  broker_name TEXT DEFAULT '',
  settlement REAL DEFAULT 0,
  payment_method TEXT DEFAULT 'transfer',
  reference_no TEXT DEFAULT '',
  sale_date TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  method TEXT DEFAULT 'transfer',
  reference_no TEXT DEFAULT '',
  paid_at TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pay_sale ON payments(sale_id);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  sale_id INTEGER REFERENCES sales(id),
  client_id INTEGER REFERENCES clients(id),
  amount REAL NOT NULL DEFAULT 0,
  issued_at TEXT NOT NULL,
  status TEXT DEFAULT 'issued',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS brokers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  commission_rate REAL DEFAULT 0,
  total_paid REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  is_demo INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT DEFAULT 'whatsapp' CHECK (kind IN ('whatsapp','sms','email','print','other')),
  subject TEXT DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  vars_json TEXT DEFAULT '[]',
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS ai_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ptype TEXT NOT NULL DEFAULT 'openai' CHECK (ptype IN ('openai','anthropic','gemini','openrouter','ollama','custom')),
  base_url TEXT DEFAULT '',
  api_key_enc TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  is_default INTEGER DEFAULT 0,
  timeout_sec INTEGER DEFAULT 30,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS ai_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  alias TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  is_default INTEGER DEFAULT 0,
  capabilities TEXT DEFAULT '',
  last_check TEXT,
  last_status TEXT DEFAULT 'unknown',
  last_latency_ms INTEGER,
  last_error TEXT DEFAULT '',
  UNIQUE(provider_id, model_id)
);
CREATE INDEX IF NOT EXISTS idx_aimodels_provider ON ai_models(provider_id);
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  provider_id INTEGER,
  model TEXT DEFAULT '',
  purpose TEXT DEFAULT '',
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  ok INTEGER DEFAULT 1,
  error TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_aiusage_date ON ai_usage(created_at);
CREATE TABLE IF NOT EXISTS dashboard_widgets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  widget TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  position INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, widget)
);
`;

async function init() {
  if (raw) return;
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: (f) => wasmPath(f) });
  let bytes = null;
  try {
    if (fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 0) bytes = new Uint8Array(fs.readFileSync(DB_PATH));
  } catch {}
  raw = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // ترحيلات آمنة (idempotent)
  for (const t of ['projects', 'units']) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
      if (!cols.includes('deleted_at')) db.exec(`ALTER TABLE ${t} ADD COLUMN deleted_at TEXT`);
    } catch {}
  }
  const ensureCol = (t, col, ddl) => {
    try {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
      if (!cols.includes(col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${ddl}`);
    } catch {}
  };
  ensureCol('files', 'sale_id', 'INTEGER REFERENCES sales(id)');
  ensureCol('files', 'reservation_id', 'INTEGER REFERENCES reservations(id)');
  ensureCol('sales', 'broker_id', 'INTEGER REFERENCES brokers(id)');
  for (const t of ['clients','projects','buildings','floors','units','reservations','sales','payments','invoices','tasks','appointments','calls','notes','files','brokers']) ensureCol(t, 'is_demo', 'INTEGER DEFAULT 0');
  // منح الوحدات الجديدة لدور المدير في القواعد القائمة
  try {
    const admin = db.prepare(`SELECT id FROM roles WHERE name='admin'`).get();
    if (admin) for (const m of ['brokers','templates','branding','ai']) for (const a of ACTIONS) {
      try { db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, module, action) VALUES (?,?,?)').run(admin.id, m, a); } catch {}
    }
  } catch {}
  const hasUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (!hasUsers) seed();
  // ترحيلات مُرقّمة (versioned) — تُطبَّق مرة واحدة وتُسجَّل في جدول migrations
  try {
    if (process.env.SKIP_MIGRATIONS !== '1') { const { runMigrations } = require('./migrations'); runMigrations(); }
  } catch (e) {
    console.error('[DB] migrations error:', e.message);
    throw e;
  }
  flush();
}

function seed() { seedCore(); seedDemo(); }

function seedCore() {
  const now = new Date();
  const d = (offset) => { const t = new Date(now); t.setDate(t.getDate() + offset); return t.toISOString().slice(0, 10); };
  const ts = (offset, h = 10, m = 0) => { const t = new Date(now); t.setDate(t.getDate() + offset); t.setHours(h, m, 0, 0); return t.toISOString().slice(0, 16).replace('T', ' '); };

  const addRole = db.prepare('INSERT INTO roles (name, name_ar, description, is_system) VALUES (?,?,?,?)');
  const adminR = addRole.run('admin', 'مدير النظام', 'صلاحيات كاملة على النظام', 1).lastInsertRowid;
  const accR = addRole.run('accountant', 'المحاسب', 'الصلاحيات المالية والتقارير', 1).lastInsertRowid;
  const resR = addRole.run('reservations', 'مسؤول الحجوزات', 'الحجوزات والوحدات والعملاء', 1).lastInsertRowid;
  const secR = addRole.run('secretary', 'سكرتير', 'المهام والمواعيد والاتصالات والملفات', 1).lastInsertRowid;

  const grant = db.prepare('INSERT INTO role_permissions (role_id, module, action) VALUES (?,?,?)');
  const grantAll = (r) => MODULES.forEach(m => ACTIONS.forEach(a => grant.run(r, m, a)));
  grantAll(adminR);
  ['dashboard','clients','files','reports','finance','sales','reservations','brokers','assistant','notifications','accounts','expenses','schedule','contracts','quotations','commissions','approvals','statements','communications'].forEach(m =>
    ['view','create','edit','export','print'].forEach(a => { try { grant.run(accR, m, a); } catch {} })
  );
  ['finance','sales'].forEach(m => ['delete','approve','manage'].forEach(a => { try { grant.run(accR, m, a); } catch {} }));
  ['dashboard','clients','projects','units','reservations','sales','brokers','calls','notes','files','reports','assistant','notifications','tasks','appointments','schedule','contracts','quotations','interests','pipeline','statements','commissions','communications'].forEach(m =>
    ['view','create','edit','export','print'].forEach(a => { try { grant.run(resR, m, a); } catch {} })
  );
  ['reservations','units'].forEach(m => ['approve','manage'].forEach(a => { try { grant.run(resR, m, a); } catch {} }));
  ['dashboard','tasks','appointments','clients','calls','notes','files','notifications','reports','assistant','projects','units','reservations','templates','interests','pipeline','quotations','statements','schedule','communications'].forEach(m =>
    ['view','create','edit','export','print'].forEach(a => { try { grant.run(secR, m, a); } catch {} })
  );

  const hash = (p) => bcrypt.hashSync(p, 10);
  const addUser = db.prepare('INSERT INTO users (name, username, email, phone, password_hash, role_id, status) VALUES (?,?,?,?,?,?,?)');
  const uAdmin = addUser.run('مدير النظام', 'admin', 'admin@company.sa', '0500000001', hash('admin123'), adminR, 'active').lastInsertRowid;
  const uAcc = addUser.run('محمد المحاسب', 'accountant', 'acc@company.sa', '0500000002', hash('acc12345'), accR, 'active').lastInsertRowid;
  const uRes = addUser.run('خالد الحجوزات', 'reservations', 'res@company.sa', '0500000003', hash('res12345'), resR, 'active').lastInsertRowid;
  const uSec = addUser.run('سارة السكرتيرة', 'sara', 'sara@company.sa', '0500000004', hash('sara1234'), secR, 'active').lastInsertRowid;

  const set = db.prepare('INSERT INTO settings (key, value) VALUES (?,?)');
  const settings = {
    company_name: 'شركة الأعمال الحديثة',
    company_phone: '012-3456789',
    company_mobile: '0500000000',
    company_email: 'info@company.sa',
    company_address: 'جدة، المملكة العربية السعودية',
    company_logo: '',
    system_language: 'ar',
    system_theme: 'light',
    system_font: 'plex',
    currency: 'ر.س',
    reports_footer: 'جميع الحقوق محفوظة — Smart Secretary'
  };
  Object.entries(settings).forEach(([k, v]) => set.run(k, v));
}

function seedDemo() {
  const uid = (un) => { try { return db.prepare('SELECT id FROM users WHERE username=? AND deleted_at IS NULL').get(un).id; } catch { return null; } };
  const uAdmin = uid('admin'), uAcc = uid('accountant'), uRes = uid('reservations'), uSec = uid('sara');
  if (!uAdmin) throw new Error('لا يمكن بذر الديمو بدون حساب المدير');
  const now = new Date();
  const d = (offset) => { const t = new Date(now); t.setDate(t.getDate() + offset); return t.toISOString().slice(0, 10); };
  const ts = (offset, h = 10, m = 0) => { const t = new Date(now); t.setDate(t.getDate() + offset); t.setHours(h, m, 0, 0); return t.toISOString().slice(0, 16).replace('T', ' '); };

  const addP = db.prepare('INSERT INTO projects (code, name, city, address, status) VALUES (?,?,?,?,?)');
  const addB = db.prepare('INSERT INTO buildings (project_id, name, floors_count) VALUES (?,?,?)');
  const addF = db.prepare('INSERT INTO floors (building_id, number, name) VALUES (?,?,?)');
  const addU = db.prepare('INSERT INTO units (code, project_id, building_id, floor_id, type, rooms, area, price, status) VALUES (?,?,?,?,?,?,?,?,?)');
  const projectIds = [];
  const unitIds = [];
  const statuses = ['available', 'available', 'available', 'reserved', 'sold', 'resale', 'available', 'blocked'];
  for (let p = 101; p <= 108; p++) {
    const pid = addP.run(String(p), `مشروع ${p} السكني`, 'جدة', `حي الياسمين — مشروع ${p}`, p <= 106 ? 'active' : 'upcoming').lastInsertRowid;
    projectIds.push(pid);
    const bid = addB.run(pid, 'المبنى الرئيسي', 4).lastInsertRowid;
    const fids = [];
    for (let f = 1; f <= 4; f++) fids.push(addF.run(bid, f, `الدور ${f}`).lastInsertRowid);
    for (let u = 1; u <= 8; u++) {
      const fl = fids[(u - 1) % 4];
      const code = `${p}-A${u}`;
      const rooms = 2 + (u % 4);
      const area = 90 + u * 12 + (p % 3) * 5;
      const price = 320000 + u * 45000 + (p - 101) * 8000;
      const st = statuses[u - 1];
      unitIds.push({ id: addU.run(code, pid, bid, fl, u % 3 === 0 ? 'villa' : 'apartment', rooms, area, price, st).lastInsertRowid, status: st, price });
    }
  }

  const addC = db.prepare('INSERT INTO clients (code, name, company, job_title, phone, email, address, city, category, status, notes, assigned_to, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const clients = [
    ['C-1001', 'محمد عبدالله', 'مؤسسة النور', 'مدير عام', '0551111111', 'm@noor.sa', 'جدة — حي الروضة', 'جدة', 'buyer', 'vip', 'عميل مميز مهتم بمشروع 101', uSec, uAdmin],
    ['C-1002', 'أحمد الشمري', '', 'موظف', '0552222222', 'a.sh@hotmail.com', 'جدة — حي النزهة', 'جدة', 'buyer', 'active', 'يتابع وحدة إعادة بيع', uSec, uAdmin],
    ['C-1003', 'شركة الأفق العقارية', 'الأفق', 'إدارة', '0553333333', 'info@ofoq.sa', 'الرياض', 'الرياض', 'partner', 'active', 'شريك — عمولات شهرية', uRes, uAdmin],
    ['C-1004', 'فاطمة الزهراني', '', '—', '0554444444', '', 'جدة — حي الصفا', 'جدة', 'buyer', 'potential', 'طلبت عرض سعر لمشروع 102', uSec, uSec],
    ['C-1005', 'عبدالرحمن الغامدي', 'مكتب الوساطة الذهبية', 'وسيط', '0555555555', 'gold@broker.sa', 'جدة', 'جدة', 'broker', 'active', 'وسيط معتمد — عمولة 5%', uRes, uAdmin]
  ];
  const cids = clients.map(c => addC.run(...c).lastInsertRowid);

  const addBr = db.prepare('INSERT INTO brokers (code, name, phone, email, commission_rate, notes) VALUES (?,?,?,?,?,?)');
  const bGold = addBr.run('B-1001', 'مكتب الوساطة الذهبية', '0555555555', 'gold@broker.sa', 5, 'وسيط معتمد').lastInsertRowid;

  const addT = db.prepare('INSERT INTO tasks (title, description, assignee_id, priority, status, start_date, due_date, category, client_id, project_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  addT.run('متابعة العميل محمد عبدالله', 'الاتصال لتأكيد موعد توقيع العقد', uSec, 'high', 'new', d(0), d(0), 'followup', cids[0], projectIds[0], uAdmin);
  addT.run('تجهيز عرض سعر للعميلة فاطمة', 'وحدة 3 غرف في مشروع 102', uSec, 'medium', 'in_progress', d(-1), d(1), 'sales', cids[3], projectIds[1], uAdmin);
  addT.run('مراجعة الدفعات المتأخرة', 'تقرير شهري للإدارة', uAcc, 'urgent', 'new', d(0), d(-1), 'finance', null, null, uAdmin);
  addT.run('تأكيد حجوزات الأسبوع', 'مراجعة الحجوزات النشطة قبل انتهائها', uRes, 'medium', 'paused', d(-2), d(2), 'reservations', null, null, uAdmin);
  addT.run('أرشفة عقود المشروع 103', 'مسح ضوئي ورفع للملفات', uSec, 'low', 'completed', d(-5), d(-2), 'admin', null, projectIds[2], uAdmin);

  const addA = db.prepare('INSERT INTO appointments (title, client_id, date, start_time, end_time, duration_min, location, notes, reminder_min, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  addA.run('توقيع عقد — محمد عبدالله', cids[0], d(0), '11:00', '12:00', 60, 'المكتب الرئيسي', 'إحضار الهوية + العربون', 60, 'scheduled', uSec);
  addA.run('معاينة وحدة مشروع 102', cids[3], d(1), '17:00', '17:45', 45, 'موقع المشروع', 'الوحدة 102-A3', 30, 'scheduled', uSec);
  addA.run('اجتماع الإدارة الأسبوعي', null, d(2), '09:00', '10:00', 60, 'قاعة الاجتماعات', 'تقرير المبيعات', 15, 'scheduled', uAdmin);

  const addCall = db.prepare('INSERT INTO calls (contact_name, phone, client_id, direction, started_at, duration_sec, result, notes, user_id) VALUES (?,?,?,?,?,?,?,?,?)');
  addCall.run('محمد عبدالله', '0551111111', cids[0], 'out', ts(0, 9, 15), 320, 'answered', 'أكد الحضور غدًا للتوقيع', uSec);
  addCall.run('فاطمة الزهراني', '0554444444', cids[3], 'in', ts(-1, 14, 30), 180, 'follow_up', 'طلبت صور الوحدة على الواتساب', uSec);
  addCall.run('مجهول', '0559999999', null, 'in', ts(0, 8, 5), 0, 'missed', 'اتصال فائت — إعادة الاتصال', uSec);

  const addN = db.prepare('INSERT INTO notes (title, body, type, tags, is_pinned, client_id, user_id) VALUES (?,?,?,?,?,?,?)');
  addN.run('أولويات اليوم', '1- توقيع عقد محمد\n2- عرض سعر فاطمة\n3- مراجعة الحجوزات', 'checklist', JSON.stringify(['يومي', 'مهم']), 1, null, uSec);
  addN.run('ملاحظة عن مشروع 103', 'العميل يفضل الدور الأرضي مع حديقة', 'text', JSON.stringify(['مشروع 103']), 0, cids[1], uSec);

  const availUnits = unitIds.filter(u => u.status === 'available' || u.status === 'resale');
  const addR = db.prepare('INSERT INTO reservations (code, unit_id, client_id, price, discount, deposit, deposit_method, deposit_ref, reservation_date, expiry_date, status, employee_id, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const r1 = addR.run('R-2026-001', availUnits[0].id, cids[0], availUnits[0].price, 5000, 10000, 'transfer', 'TRX-88121', d(-3), d(4), 'active', uRes, 'حجز مبدئي — بانتظار استكمال الدفعة', uRes).lastInsertRowid;
  db.prepare('UPDATE units SET status=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run('reserved', availUnits[0].id);

  const net = availUnits[1].price - 10000;
  const addS = db.prepare('INSERT INTO sales (code, unit_id, client_id, sale_price, discount, net_price, down_payment, commission, commission_due, broker_id, broker_name, settlement, payment_method, reference_no, sale_date, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const s1 = addS.run('S-2026-001', availUnits[1].id, cids[1], availUnits[1].price, 10000, net, 50000, net * 0.05, net * 0.05, bGold, 'مكتب الوساطة الذهبية', net - net * 0.05, 'transfer', 'TRX-77001', d(-10), 'active', uAcc).lastInsertRowid;
  db.prepare('UPDATE units SET status=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run('sold', availUnits[1].id);
  db.prepare('INSERT INTO payments (sale_id, amount, method, reference_no, paid_at, notes, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(s1, 50000, 'transfer', 'TRX-77001', d(-10), 'الدفعة الأولى', uAcc);
  db.prepare('INSERT INTO invoices (code, sale_id, client_id, amount, issued_at, status) VALUES (?,?,?,?,?,?)')
    .run('INV-2026-001', s1, cids[1], net, d(-10), 'issued');

  const addNotif = db.prepare('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?,?,?,?,?)');
  addNotif.run(uSec, 'task', 'مهمة جديدة مسندة إليك', 'متابعة العميل محمد عبدالله — مستحقة اليوم', '/tasks');
  addNotif.run(uSec, 'appointment', 'موعد اليوم 11:00', 'توقيع عقد — محمد عبدالله', '/appointments');
  addNotif.run(uAcc, 'warning', 'دفعات متأخرة', 'يوجد دفعات تحتاج مراجعة', '/finance');
  addNotif.run(uRes, 'reservation', 'حجز يقترب من الانتهاء', 'R-2026-001 ينتهي خلال 4 أيام', '/reservations');
  addNotif.run(uAdmin, 'system', 'مرحبًا بك في Smart Secretary', 'تم تجهيز النظام بنجاح', '/dashboard');

  if (!db.prepare('SELECT COUNT(*) c FROM message_templates').get().c) {
  const addT2 = db.prepare('INSERT INTO message_templates (name, kind, subject, body, vars_json, is_default) VALUES (?,?,?,?,?,?)');
  addT2.run('تأكيد حجز', 'whatsapp', '', 'مرحبًا {{client_name}}، تم تأكيد حجزكم {{reservation_code}} للوحدة {{unit_code}} بمبلغ {{amount}} {{currency}}. {{company_name}}', JSON.stringify(['client_name','reservation_code','unit_code','amount','currency','company_name']), 1);
  addT2.run('إيصال دفعة', 'whatsapp', '', 'استلمنا دفعة بمبلغ {{amount}} {{currency}} من {{client_name}} بتاريخ {{date}} ({{reference_no}}). المتبقي: {{remaining}}. {{company_name}}', JSON.stringify(['amount','currency','client_name','date','reference_no','remaining','company_name']), 1);
  addT2.run('تذكير موعد', 'sms', '', 'تذكير: موعدكم {{appointment_title}} بتاريخ {{date}} الساعة {{time}} — {{company_name}}', JSON.stringify(['appointment_title','date','time','company_name']), 0);
  addT2.run('ترحيب بعميل', 'email', 'أهلًا بك في {{company_name}}', 'عزيزي {{client_name}}، يسعدنا انضمامك. رقم ملفك {{client_code}}.', JSON.stringify(['company_name','client_name','client_code']), 0);
  }

  // تعليم البيانات التجريبية + ختم تاريخ البذر
  for (const t of ['clients','projects','buildings','floors','units','reservations','sales','payments','invoices','tasks','appointments','calls','notes','brokers']) {
    try { db.prepare(`UPDATE ${t} SET is_demo=1`).run(); } catch {}
  }
  try { db.prepare(`INSERT INTO settings (key, value) VALUES ('demo_seeded_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(new Date().toISOString()); } catch {}

  db.prepare('INSERT INTO audit_logs (user_id, username, action, module, entity, details) VALUES (?,?,?,?,?,?)')
    .run(uAdmin, 'admin', 'seed', 'system', 'database', 'تهيئة النظام والبيانات الأولية');
}

module.exports = { db, init, flush, seedDemo, MODULES, ACTIONS, DATA_DIR, DB_PATH };
