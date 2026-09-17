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
const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, keyFn: (req) => 'login:' + req.ip, message: 'محاولات دخول كثيرة — انتظر 10 دقائق' });
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

// ---------- AI keys encryption (AES-256-GCM, مفتاح على القرص بصلاحيات مقيدة) ----------
const AIKEY_FILE = path.join(DATA_DIR, '.ai-master-key');
function masterKey() {
  if (!fs.existsSync(AIKEY_FILE)) fs.writeFileSync(AIKEY_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(AIKEY_FILE, 'utf8').trim(), 'hex');
}
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
const maskKey = (k) => { const s = String(k || ''); return s.length <= 8 ? '••••' : s.slice(0, 4) + '••••••••' + s.slice(-4); };

module.exports = { getSetting, setSetting, settingsObj, rateLimit, globalLimiter, loginLimiter, aiLimiter, maintenanceGate, idParam, need, money, escLike, LIKE_ESC, sealSecret, openSecret, maskKey };
