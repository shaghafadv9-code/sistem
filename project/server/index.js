// Smart Secretary — Server entry
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const jwt = require('jsonwebtoken');

const DATA_BASE = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const RESTORE = path.join(DATA_BASE, 'smart-secretary.db.restore');
const DBF = process.env.DB_PATH || path.join(DATA_BASE, 'smart-secretary.db');
if (fs.existsSync(RESTORE)) {
  try {
    if (fs.existsSync(DBF)) fs.copyFileSync(DBF, DBF + '.before-restore-' + Date.now());
    fs.copyFileSync(RESTORE, DBF);
    fs.unlinkSync(RESTORE);
    console.log('[DB] restored from backup');
  } catch (e) { console.error('[DB] restore failed', e.message); }
}

const { db, init, DATA_DIR } = require('./db');
const { auth, requirePerm: P, audit, JWT_SECRET } = require('./auth');
const { globalLimiter, maintenanceGate, idParam } = require('./security');

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => { const t = Date.now(); res.on('finish', () => { if (process.env.LOG === '1') console.log(req.method, req.url, res.statusCode, Date.now() - t + 'ms'); }); next(); });
app.use('/api', globalLimiter, maintenanceGate);
// رؤوس أمان أساسية
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.removeHeader('X-Powered-By');
  next();
});

// ---------- file uploads ----------
const FILES_DIR = path.join(DATA_DIR, 'files');
if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
const BLOCKED_EXT = new Set(['.exe', '.bat', '.cmd', '.ps1', '.msi', '.js', '.jse', '.vbs', '.vbe', '.jar', '.com', '.scr', '.pif', '.reg', '.dll', '.hta', '.wsf', '.cpl', '.gadget']);
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const d = path.join(FILES_DIR, new Date().toISOString().slice(0, 7));
    fs.mkdirSync(d, { recursive: true });
    cb(null, d);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + path.extname(file.originalname || '').slice(0, 10))
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (BLOCKED_EXT.has(ext)) return cb(new Error('نوع الملف غير مسموح لأسباب أمنية'));
    cb(null, true);
  }
});

app.get('/api/files', auth, P('files', 'view'), (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1), limit = Math.min(100, parseInt(req.query.limit) || 24);
  let w = 'f.deleted_at IS NULL', ps = [];
  if (req.query.q) { w += ' AND (f.original_name LIKE ? OR f.category LIKE ?)'; ps.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.category) { w += ' AND f.category=?'; ps.push(req.query.category); }
  for (const fk of ['client_id', 'unit_id', 'project_id', 'sale_id', 'reservation_id', 'task_id', 'appointment_id',
    'contract_id', 'payment_id', 'expense_id', 'quotation_id', 'refund_id', 'interest_id', 'account_id']) {
    if (req.query[fk] && /^\d+$/.test(req.query[fk])) { w += ` AND f.${fk}=?`; ps.push(req.query[fk]); }
  }
  const total = db.prepare(`SELECT COUNT(*) c FROM files f WHERE ${w}`).get(...ps).c;
  const rows = db.prepare(`SELECT f.*, u.name uploader FROM files f LEFT JOIN users u ON u.id=f.uploaded_by WHERE ${w} ORDER BY f.id DESC LIMIT ? OFFSET ?`).all(...ps, limit, (page - 1) * limit);
  res.json({ data: rows, total, page, pages: Math.ceil(total / limit) || 1 });
});
app.post('/api/files/upload', auth, P('files', 'create'), (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'الملف أكبر من 50MB' : (err.message || 'فشل الرفع') });
    next();
  });
}, (req, res) => {
  const { category = 'general', tags = '[]', client_id, task_id, appointment_id, project_id, unit_id, sale_id, reservation_id,
    contract_id, payment_id, expense_id, quotation_id, refund_id, interest_id, account_id } = req.body || {};
  const num = (v) => /^\d+$/.test(String(v || '')) ? Number(v) : null;
  const ins = db.prepare(`INSERT INTO files (name, original_name, stored_name, mime, size, category, tags, client_id, task_id, appointment_id, project_id, unit_id, sale_id, reservation_id,
      contract_id, payment_id, expense_id, quotation_id, refund_id, interest_id, account_id, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const out = (req.files || []).map(f => {
    const info = ins.run(f.originalname, f.originalname, path.relative(FILES_DIR, f.path), f.mimetype, f.size, category, tags,
      num(client_id), num(task_id), num(appointment_id), num(project_id), num(unit_id), num(sale_id), num(reservation_id),
      num(contract_id), num(payment_id), num(expense_id), num(quotation_id), num(refund_id), num(interest_id), num(account_id), req.user.id);
    audit({ ...req.user, ip: req.ip }, 'create', 'files', 'file', info.lastInsertRowid, f.originalname);
    return { id: info.lastInsertRowid, name: f.originalname, size: f.size };
  });
  res.status(201).json({ files: out });
});
app.put('/api/files/:id', auth, P('files', 'edit'), idParam, (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'الملف غير موجود' });
  const { name, category, tags } = req.body || {};
  db.prepare('UPDATE files SET original_name=?, category=?, tags=? WHERE id=?').run(name || f.original_name, category || f.category, tags || f.tags, f.id);
  audit({ ...req.user, ip: req.ip }, 'update', 'files', 'file', f.id, name || '');
  res.json({ ok: true });
});
app.delete('/api/files/:id', auth, P('files', 'delete'), idParam, (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'الملف غير موجود' });
  db.prepare('UPDATE files SET deleted_at=datetime(\'now\',\'localtime\') WHERE id=?').run(f.id);
  audit({ ...req.user, ip: req.ip }, 'delete', 'files', 'file', f.id, f.original_name);
  res.json({ ok: true });
});
// تحميل/معاينة آمنة برمز مؤقت
app.get('/api/files/:id/raw', idParam, (req, res) => {
  try {
    const payload = jwt.verify(req.query.token || '', JWT_SECRET);
    const f = db.prepare('SELECT * FROM files WHERE id=? AND deleted_at IS NULL').get(req.params.id);
    if (!f) return res.status(404).send('غير موجود');
    const fp = path.join(FILES_DIR, f.stored_name);
    if (!fp.startsWith(FILES_DIR) || !fs.existsSync(fp)) return res.status(404).send('غير موجود');
    if (!payload || !payload.uid) return res.status(401).send('غير مصرح');
    if (req.query.dl === '1') res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
    else res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Content-Type', f.mime || 'application/octet-stream');
    fs.createReadStream(fp).pipe(res);
  } catch { res.status(401).send('غير مصرح'); }
});

app.use('/api', require('./api'));
app.use('/api', require('./api2'));
app.use('/api', require('./api_ops'));
app.use('/api', require('./api_finance'));
app.use('/api', require('./api_crm'));
app.use('/api/ai', require('./api_ai'));

app.get('/api/health', (req, res) => res.json({ ok: true, version: '2.0.0', time: new Date().toISOString() }));
app.get('/api/system/health', auth, P('settings', 'view'), (req, res) => {
  let dbSize = 0;
  try { dbSize = fs.statSync(require('./db').DB_PATH).size; } catch {}
  let filesSize = 0, filesCount = 0;
  try {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else { filesSize += fs.statSync(p).size; filesCount++; }
    });
    walk(FILES_DIR);
  } catch {}
  const mem = process.memoryUsage();
  res.json({
    ok: true, time: new Date().toISOString(), uptime_sec: Math.round(process.uptime()),
    db: { bytes: dbSize, mb: +(dbSize / 1048576).toFixed(2) },
    files: { count: filesCount, bytes: filesSize, mb: +(filesSize / 1048576).toFixed(2) },
    mem: { rss_mb: +(mem.rss / 1048576).toFixed(1), heap_mb: +(mem.heapUsed / 1048576).toFixed(1) },
    tables: (() => { try { return db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length; } catch { return 0; } })()
  });
});

// production: serve built client
const DIST = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(path.join(DIST, 'index.html'))) {
  app.use(express.static(DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'خطأ داخلي في الخادم' });
});

const PORT = process.env.PORT || 3847;
const HOST = process.env.HOST || '127.0.0.1';
init().then(() => {
  app.listen(PORT, HOST, () => console.log(`[API] Smart Secretary on http://${HOST}:${PORT}`));
}).catch((e) => { console.error('[DB] init failed:', e.message); process.exit(1); });
