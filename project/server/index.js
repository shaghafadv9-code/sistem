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
const { globalLimiter, maintenanceGate, passwordChangeGate, idParam } = require('./security');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);

// ---------- CORS مقيّد (بدل الفتح العالمي) ----------
// الافتراضي: نفس الأصل + أصول التطوير المحلية. للتخصيص: CORS_ORIGINS="https://a.com,https://b.com"
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173', 'app://.', 'file://'];
const ALLOWED_ORIGINS = new Set([
  ...DEV_ORIGINS,
  ...String(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
]);
app.use(cors({
  origin(origin, cb) {
    // الطلبات بدون Origin (تطبيق سطح المكتب، نفس الأصل، curl) مسموحة
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.has(origin) || ALLOWED_ORIGINS.has('*')) return cb(null, true);
    // السماح بأي أصل محلي (localhost/127.0.0.1) في وضع التطوير فقط
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
    // رفض صامت: لا يُضاف رأس ACAO فيتولى المتصفح المنع (بدل رمي 500)
    if (process.env.LOG === '1') console.warn('[CORS] أصل مرفوض:', origin);
    return cb(null, false);
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 600
}));
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => { const t = Date.now(); res.on('finish', () => { if (process.env.LOG === '1') console.log(req.method, req.url, res.statusCode, Date.now() - t + 'ms'); }); next(); });
app.use('/api', globalLimiter, maintenanceGate, passwordChangeGate);
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

// قائمة بيضاء (whitelist) للامتدادات المسموح رفعها — أأمن من الاعتماد على blacklist فقط.
const ALLOWED_EXT = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.csv', '.txt', '.md', '.rtf',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.heic', '.avif',
  '.mp3', '.wav', '.m4a', '.ogg', '.oga', '.flac', '.aac', '.wma',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wmv', '.3gp',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.dwg', '.dxf', '.skp', '.ifc', '.json', '.xml'
]);
// امتدادات قابلة للتنفيذ/الضارة — ممنوعة قطعًا
const BLOCKED_EXT = new Set(['.exe', '.bat', '.cmd', '.ps1', '.msi', '.js', '.jse', '.mjs', '.cjs', '.vbs', '.vbe', '.jar', '.com', '.scr', '.pif', '.reg', '.dll', '.hta', '.wsf', '.cpl', '.gadget', '.sh', '.bash', '.apk', '.app', '.msix', '.lnk', '.iso', '.img', '.sys', '.ocx', '.jspx', '.php', '.phtml', '.asp', '.aspx', '.jsp', '.py', '.rb', '.pl', '.svg', '.html', '.htm', '.xhtml', '.shtml', '.swf']);
// أنواع يُسمح بعرضها inline داخل التطبيق — أي شيء آخر يُنزَّل كمرفق (يمنع Stored XSS)
const INLINE_SAFE_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.txt', '.md', '.csv', '.mp3', '.wav', '.m4a', '.ogg', '.mp4', '.webm', '.mov']);
const INLINE_SAFE_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/avif', 'text/plain', 'text/markdown', 'text/csv', 'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'video/mp4', 'video/webm', 'video/quicktime']);
// أنواع خطرة حتى لو تظاهرت بامتداد آمن — تُقدَّم دائمًا كمرفق مع CSP صارم
const ALWAYS_ATTACHMENT_MIME = new Set(['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', 'application/xml', 'application/javascript', 'text/javascript', 'application/x-shockwave-flash']);

const ALLOW_UPLOAD_EXT = (() => {
  // يمكن توسيع القائمة البيضاء من الإعدادات (مفصولة بفواصل) — لا يمكن إزالة الممنوعات
  const extra = String(process.env.FILES_EXTRA_EXT || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return new Set([...ALLOWED_EXT, ...extra]);
})();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const d = path.join(FILES_DIR, new Date().toISOString().slice(0, 7));
    fs.mkdirSync(d, { recursive: true });
    cb(null, d);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + path.extname(file.originalname || '').slice(0, 10).toLowerCase().replace(/[^.a-z0-9]/g, ''))
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (BLOCKED_EXT.has(ext)) return cb(new Error('نوع الملف غير مسموح لأسباب أمنية'));
    if (!ALLOW_UPLOAD_EXT.has(ext)) return cb(new Error(`امتداد الملف غير مدعوم (${ext || 'بدون امتداد'}) — الأنواع المسموحة: مستندات، صور، صوت، فيديو، أرشيفات`));
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
// ---------- روابط تنزيل/معاينة مؤقتة وموقّعة (بدل تمرير JWT في الرابط) ----------
const TICKET_TTL_SEC = Math.min(600, Math.max(15, parseInt(process.env.FILE_TICKET_TTL || '120', 10) || 120));
const ticketKey = () => crypto.createHash('sha256').update(JWT_SECRET + '|file-tickets').digest();
const sessFingerprint = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');
function signTicket({ fileId, uid, sess, exp, dl }) {
  const payload = `${fileId}.${uid}.${sess}.${exp}.${dl ? 1 : 0}`;
  const sig = crypto.createHmac('sha256', ticketKey()).update(payload).digest('base64url');
  return Buffer.from(`${payload}.${sig}`, 'utf8').toString('base64url');
}
function verifyTicket(rawTicket) {
  if (!rawTicket || typeof rawTicket !== 'string' || rawTicket.length > 400) return null;
  let decoded;
  try { decoded = Buffer.from(rawTicket, 'base64url').toString('utf8'); } catch { return null; }
  const parts = decoded.split('.');
  if (parts.length !== 6) return null;
  const [fileId, uid, sess, exp, dl, sig] = parts;
  if (!/^\d+$/.test(fileId) || !/^\d+$/.test(uid) || !/^\d+$/.test(exp) || !/^[0-9a-f]{16}$/.test(sess)) return null;
  const expected = crypto.createHmac('sha256', ticketKey()).update(`${fileId}.${uid}.${sess}.${exp}.${dl}`).digest('base64url');
  const a = Buffer.from(String(sig)), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) * 1000 < Date.now()) return null;
  return { fileId: Number(fileId), uid: Number(uid), sess, exp: Number(exp), dl: dl === '1' };
}
/**
 * الجلسة ما زالت فعّالة ولم تُلغَ — التذكرة مرتبطة ببصمة التوكن،
 * فإلغاء الجلسة/انتهاء صلاحيتها يُبطل كل التذاكر الصادرة عنها فورًا.
 */
function sessionActiveFor(userId, tokenHash) {
  try {
    return !!db.prepare('SELECT id FROM sessions WHERE user_id=? AND token_hash=? AND expires_at > datetime(\'now\',\'localtime\')')
      .get(userId, tokenHash);
  } catch { return false; }
}

app.get('/api/files/:id/ticket', auth, P('files', 'view'), idParam, (req, res) => {
  const f = db.prepare('SELECT id FROM files WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'الملف غير موجود' });
  const dl = req.query.dl === '1' || req.query.dl === 'true';
  const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_SEC;
  const hash = sessFingerprint(req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
  const ticket = signTicket({ fileId: f.id, uid: req.user.id, sess: hash.slice(0, 16), exp, dl });
  res.json({ url: `/api/files/${f.id}/raw?ft=${ticket}${dl ? '&dl=1' : ''}`, ticket, ttl_sec: TICKET_TTL_SEC, expires_at: new Date(exp * 1000).toISOString(), download: dl });
});

// تحميل/معاينة: Authorization header أو تذكرة موقّعة قصيرة العمر. لا يُقبل JWT داخل الرابط إطلاقًا.
app.get('/api/files/:id/raw', idParam, (req, res, next) => {
  if (req.query.token) {
    return res.status(401).json({ error: 'لم يعد تمرير رمز الدخول داخل الرابط مدعومًا — استخدم رابط التنزيل المؤقت من GET /api/files/:id/ticket' });
  }
  if (req.query.ft) {
    const t = verifyTicket(req.query.ft);
    if (!t) return res.status(401).json({ error: 'رابط التنزيل غير صالح أو منتهي — أعد فتح الملف' });
    if (t.fileId !== Number(req.params.id)) return res.status(401).json({ error: 'الرابط لا يطابق الملف المطلوب' });
    const user = db.prepare('SELECT id, status FROM users WHERE id=? AND deleted_at IS NULL').get(t.uid);
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'الحساب غير نشط' });
    const hash = db.prepare('SELECT token_hash FROM sessions WHERE user_id=? AND expires_at > datetime(\'now\',\'localtime\') ORDER BY id DESC').all(t.uid)
      .find(r => r.token_hash && r.token_hash.startsWith(t.sess));
    if (!hash) return res.status(401).json({ error: 'انتهت الجلسة أو أُلغيت — أعد تسجيل الدخول' });
    return serveFile(req, res, { uid: t.uid, dl: t.dl || req.query.dl === '1' });
  }
  // المسار الافتراضي: جلسة حقيقية + صلاحية files:view
  return auth(req, res, (e1) => {
    if (e1) return next(e1);
    return P('files', 'view')(req, res, (e2) => {
      if (e2) return next(e2);
      serveFile(req, res, { uid: req.user.id, dl: req.query.dl === '1' });
    });
  });
});

function serveFile(req, res, { uid, dl }) {
  const f = db.prepare('SELECT * FROM files WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'الملف غير موجود' });
  const fp = path.resolve(path.join(FILES_DIR, f.stored_name || ''));
  if (!fp.startsWith(path.resolve(FILES_DIR) + path.sep) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
    return res.status(404).json({ error: 'الملف غير موجود على القرص' });
  }
  const ext = path.extname(f.original_name || f.stored_name || '').toLowerCase();
  const mime = String(f.mime || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const safeInline = !dl && INLINE_SAFE_EXT.has(ext) && INLINE_SAFE_MIME.has(mime) && !ALWAYS_ATTACHMENT_MIME.has(mime);
  const fname = encodeURIComponent(f.original_name || 'file');
  if (safeInline) {
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${fname}`);
    // معاينات PDF/الصور تعمل في iframe/img داخل نفس الأصل
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  } else {
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fname}`);
    // أي نوع غير موثوق (html/svg/xml/...) يُنزَّل ولا يُعرض — يمنع Stored XSS وسرقة الجلسة
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(fs.statSync(fp).size));
    return fs.createReadStream(fp).pipe(res);
  }
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', String(fs.statSync(fp).size));
  try { audit({ id: uid }, 'download', 'files', 'file', f.id, f.original_name); } catch {}
  fs.createReadStream(fp).pipe(res);
}

app.use('/api', require('./api'));
app.use('/api', require('./api2'));
app.use('/api', require('./api_ops'));
app.use('/api', require('./api_finance'));
app.use('/api', require('./api_crm'));
app.use('/api/ai', require('./api_ai'));

app.get('/api/health', (req, res) => res.json({ ok: true, version: '2.0.0', time: new Date().toISOString() }));

// ---------- أدوات النظام: الأسرار، الوقت، إصلاحات البيانات، فحص صلاحيات AI ----------
const secrets = require('./secrets');
const TT = require('./time');
const { resealAllSecrets } = require('./security');
const AIP = require('./ai_permissions');
const requireAdminish = (permModule, permAction) => (req, res, next) => {
  if (req.user.role === 'admin' || req.user.perms['*:*']) return next();
  if (permModule && req.user.perms[`${permModule}:${permAction}`]) return next();
  return res.status(403).json({ error: 'هذه العملية مقتصرة على مدير النظام' });
};
// حالة الأسرار — بدون كشف أي قيمة
app.get('/api/system/secrets', auth, P('settings', 'view'), requireAdminish('settings', 'manage'), (req, res) => {
  res.json({ secrets: secrets.status(), policy: { env_override: 'SS_JWT_SECRET / SS_AI_MASTER_KEY', file_mode: '0600', stored_in: DATA_DIR } });
});
// تدوير الأسرار — يُبطل كل الجلسات الحالية (JWT) ويعيد تغليف مفاتيح AI
app.post('/api/system/secrets/rotate', auth, P('settings', 'manage'), requireAdminish('settings', 'manage'), (req, res) => {
  const which = (req.body || {}).target || 'all';
  const out = [];
  try {
    if (which === 'all' || which === 'jwt') {
      out.push(secrets.rotate('jwt'));
      try { db.prepare("DELETE FROM sessions").run(); } catch {}
    }
    if (which === 'all' || which === 'ai_master') {
      const before = secrets.getSecret('ai_master');
      const r = secrets.rotate('ai_master', { reseal: (oldHex, newHex) => resealAllSecrets(oldHex, newHex).resealed });
      out.push({ ...r, note: 'تمت إعادة تغليف مفاتيح AI بالمفتاح الجديد' });
    }
    audit({ ...req.user, ip: req.ip }, 'rotate', 'settings', 'secrets', null, `تدوير: ${which}`);
    res.json({ ok: true, rotated: out, warning: which === 'all' || which === 'jwt' ? 'تم إنهاء كل الجلسات — يلزم تسجيل الدخول مجددًا' : '' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// الوقت الموحّد — للتحقق من تطابق JS مع SQLite
app.get('/api/system/time', auth, (req, res) => {
  let sqliteToday = null, sqliteNow = null;
  try {
    const r = db.prepare("SELECT date('now','localtime') d, datetime('now','localtime') n").get();
    sqliteToday = r.d; sqliteNow = r.n;
  } catch {}
  res.json({ timezone: TT.TZ, today: TT.today(), now: TT.nowStr(), sqlite_today: sqliteToday, sqlite_now: sqliteNow, match: TT.today() === sqliteToday });
});
// سجل إصلاحات الترحيل
app.get('/api/system/data-repairs', auth, P('audit', 'view'), (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM data_repairs ORDER BY id DESC LIMIT 500').all();
    res.json({ data: rows, total: rows.length });
  } catch { res.json({ data: [], total: 0, note: 'لا يوجد سجل إصلاحات' }); }
});
// فحص موحّد لصلاحيات أدوات الذكاء الاصطناعي (تشخيص)
app.get('/api/system/ai-permission-check', auth, requireAdminish('ai', 'manage'), (req, res) => {
  const r = AIP.resolveAIPermission(String(req.query.module || ''), String(req.query.action || 'view'), req.user);
  res.json(r);
});
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
