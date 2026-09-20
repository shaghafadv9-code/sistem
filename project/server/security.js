// Smart Secretary — أمان: تحديد معدل، بوابة صيانة، تحقق، إعدادات، تشفير مفاتيح AI
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { db, DATA_DIR } = require('./db');
const { JWT_SECRET } = require('./auth');

// ---------- settings helpers ----------
function getSetting(key, def = '') {
  try {
    const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return r ? r.value : def;
  } catch { return def; }
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value ?? ''));
}
function settingsObj() {
  const o = {};
  try { db.prepare('SELECT key, value FROM settings').all().forEach(r => { o[r.key] = r.value; }); } catch {}
  return o;
}

// ---------- rate limiting (in-memory) ----------
const buckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60000).unref?.();

function rateLimit({ windowMs = 15 * 60 * 1000, max = 600, keyFn = (req) => req.ip, message = 'طلبات كثيرة جدًا — انتظر قليلًا' }) {
  return (req, res, next) => {
    const k = keyFn(req);
    const now = Date.now();
    let b = buckets.get(k);
    if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(k, b); }
    b.count++;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - b.count));
    if (b.count > max) return res.status(429).json({ error: message });
    next();
  };
}
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 3000 });
const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 200, keyFn: (req) => 'login:' + req.ip, message: 'محاولات دخول كثيرة — انتظر 10 دقائق' });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyFn: (req) => 'ai:' + (req.user?.id || req.ip), message: 'طلبات ذكاء اصطناعي كثيرة — انتظر دقيقة' });

// ---------- maintenance gate ----------
function maintenanceGate(req, res, next) {
  let on = '0';
  try { on = getSetting('maintenance', '0'); } catch {}
  if (on !== '1') return next();
  const p = req.path || '';
  if (p === '/health' || p === '/auth/login' || p === '/settings/public' || p === '/brand/public' || p.startsWith('/public/brand-file/')) return next();
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(h.slice(7), JWT_SECRET);
      const u = db.prepare('SELECT r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?').get(payload.uid);
      if (u && u.role === 'admin') return next(); // المدير يعمل أثناء الصيانة
    } catch {}
  }
  res.status(503).json({ maintenance: true, error: 'النظام في وضع الصيانة حاليًا', message: getSetting('maintenance_msg', '') });
}

// ---------- validation ----------
function idParam(req, res, next) {
  for (const k of Object.keys(req.params)) {
    if (k === 'id' && !/^\d+$/.test(String(req.params[k]))) return res.status(400).json({ error: 'معرف غير صالح' });
  }
  next();
}
function need(...fields) {
  return (req, res, next) => {
    for (const f of fields) {
      const v = req.body?.[f];
      if (v === undefined || v === null || String(v).trim() === '') return res.status(400).json({ error: `الحقل مطلوب: ${f}` });
    }
    next();
  };
}
function money(v, field = 'amount') {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new Error(`قيمة مالية غير صالحة: ${field}`);
  return Math.round(n * 100) / 100;
}
const escLike = (s) => String(s ?? '').replace(/[\\%_]/g, (m) => '\\' + m).slice(0, 120);
const LIKE_ESC = "ESCAPE '\\'";

// ---------- AI keys encryption (AES-256-GCM — المفتاح الرئيسي تديره وحدة secrets خارج المستودع) ----------
const secrets = require('./secrets');
function masterKey() { return secrets.getMasterKeyBuffer(); }
function sealSecret(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'gcm:' + iv.toString('hex') + ':' + c.getAuthTag().toString('hex') + ':' + enc.toString('hex');
}
function openSecret(sealed) {
  if (!sealed || !String(sealed).startsWith('gcm:')) return '';
  const [, iv, tag, data] = String(sealed).split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([d.update(Buffer.from(data, 'hex')), d.final()]).toString('utf8');
}
/** إعادة تغليف كل مفاتيح AI المخزنة بعد تدوير المفتاح الرئيسي. تُرجع عدد المفاتيح المعاد تغليفها. */
function resealAllSecrets(oldMasterHex, newMasterHex) {
  const oldBuf = Buffer.from(oldMasterHex, 'hex');
  const newBuf = Buffer.from(newMasterHex, 'hex');
  const openWith = (buf, sealed) => {
    const [, iv, tag, data] = String(sealed).split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', buf, Buffer.from(iv, 'hex'));
    d.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([d.update(Buffer.from(data, 'hex')), d.final()]).toString('utf8');
  };
  const sealWith = (buf, plain) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', buf, iv);
    const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return 'gcm:' + iv.toString('hex') + ':' + c.getAuthTag().toString('hex') + ':' + enc.toString('hex');
  };
  let n = 0, failed = 0;
  try {
    const rows = db.prepare("SELECT id, api_key_enc FROM ai_providers WHERE api_key_enc LIKE 'gcm:%'").all();
    for (const r of rows) {
      try {
        const plain = openWith(oldBuf.length === 32 ? oldBuf : crypto.createHash('sha256').update(oldMasterHex).digest(), r.api_key_enc);
        db.prepare('UPDATE ai_providers SET api_key_enc=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run(sealWith(newBuf.length === 32 ? newBuf : crypto.createHash('sha256').update(newMasterHex).digest(), plain), r.id);
        n++;
      } catch { failed++; }
    }
  } catch {}
  return { resealed: n, failed };
}
// ---------- سياسة كلمات المرور ----------
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'pass1234', '123456', '1234567', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'abc123', 'abc12345', 'admin', 'admin123', 'admin1234', 'administrator', 'root', 'toor',
  'letmein', 'welcome', 'welcome1', 'iloveyou', '111111', '000000', '123123', '654321', '112233', '121212',
  'sara1234', 'acc12345', 'res12345', 'smartsecretary', 'secretary', 'secret', 'changeme', 'test', 'test1234',
  'p@ssw0rd', 'passw0rd', 'qwer1234', 'asdf1234', 'zxcv1234', 'google', 'facebook', 'samsung', 'iphone'
]);
/**
 * فحص قوة كلمة المرور.
 * @returns {{ok:boolean, error?:string}}
 */
function validatePassword(pw, { username = '', min = null } = {}) {
  const s = String(pw ?? '');
  const minLen = min !== null ? Number(min) : Number(getSetting('security_password_min_length', '10') || 10);
  if (!s) return { ok: false, error: 'كلمة المرور مطلوبة' };
  if (s.length < minLen) return { ok: false, error: `كلمة المرور ${minLen} أحرف على الأقل (الحالية ${s.length})` };
  if (s.length > 200) return { ok: false, error: 'كلمة المرور طويلة جدًا' };
  const lower = s.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return { ok: false, error: 'كلمة المرور شائعة جدًا — اختر كلمة أقوى' };
  if (username && lower.includes(String(username).toLowerCase()) && String(username).length >= 4) {
    return { ok: false, error: 'كلمة المرور لا يجب أن تحتوي اسم المستخدم' };
  }
  // تكرار/تسلسل بسيط
  if (/^(.)\1+$/.test(s)) return { ok: false, error: 'كلمة المرور لا يجب أن تكون حرفًا مكررًا' };
  if (/^(0123456789|9876543210|abcdefghijklmnopqrstuvwxyz|zyxwvutsrqponmlkjihgfedcba)/i.test(lower)) {
    return { ok: false, error: 'كلمة المرور لا يجب أن تكون تسلسلًا' };
  }
  let classes = 0;
  if (/[a-z]/.test(s)) classes++;
  if (/[A-Z]/.test(s)) classes++;
  if (/\d/.test(s)) classes++;
  if (/[^A-Za-z0-9]/.test(s)) classes++;
  if (classes < 2) return { ok: false, error: 'كلمة المرور يجب أن تجمع بين فئتين على الأقل (حروف/أرقام/رموز)' };
  return { ok: true };
}

// ---------- بوابة تغيير كلمة المرور الإلزامي (أول تشغيل) ----------
const PW_GATE_ALLOW = ['/health', '/auth/login', '/auth/me', '/auth/change-password', '/auth/logout', '/settings/public', '/brand/public'];
function passwordChangeGate(req, res, next) {
  if (process.env.SS_SKIP_PASSWORD_CHANGE === '1') return next();
  const p = req.path || '';
  if (PW_GATE_ALLOW.some(a => p === a) || p.startsWith('/public/')) return next();
  let must = 0;
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return next();
    const payload = jwt.verify(h.slice(7), JWT_SECRET);
    must = Number(db.prepare('SELECT COALESCE(must_change_password,0) m FROM users WHERE id=?').get(payload.uid)?.m || 0);
  } catch { return next(); }
  if (must === 1) {
    return res.status(403).json({
      error: 'يجب تغيير كلمة المرور الأولية قبل استخدام النظام',
      must_change_password: true,
      hint: 'افتح /auth/change-password أو شاشة تغيير كلمة المرور'
    });
  }
  next();
}

const maskKey = (k) => { const s = String(k || ''); return s.length <= 8 ? '••••' : s.slice(0, 4) + '••••••••' + s.slice(-4); };

module.exports = { getSetting, setSetting, settingsObj, validatePassword, COMMON_PASSWORDS, rateLimit, globalLimiter, loginLimiter, aiLimiter, maintenanceGate, passwordChangeGate, idParam, need, money, escLike, LIKE_ESC, sealSecret, openSecret, maskKey, resealAllSecrets, secrets };
