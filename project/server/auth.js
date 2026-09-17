// Smart Secretary — Auth, permissions, audit
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('./db');

const SECRET_FILE = path.join(DATA_DIR, '.jwt-secret');
function getSecret() {
  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(SECRET_FILE, 'utf8').trim();
}
const JWT_SECRET = getSecret();

function audit(user, action, module, entity = '', entityId = null, details = '') {
  try {
    db.prepare('INSERT INTO audit_logs (user_id, username, action, module, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?,?,?)')
      .run(user?.id || null, user?.username || '', action, module, entity, entityId, typeof details === 'string' ? details : JSON.stringify(details), user?.ip || '');
  } catch {}
}

function getPermissions(roleId) {
  const rows = db.prepare('SELECT module, action FROM role_permissions WHERE role_id=?').all(roleId);
  const map = {};
  rows.forEach(r => { map[`${r.module}:${r.action}`] = true; });
  return map;
}
function can(perms, module, action) { return !!perms[`${module}:${action}`]; }

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'غير مصرح — سجل الدخول أولًا' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare(`SELECT u.id, u.name, u.username, u.email, u.phone, u.role_id, u.status, r.name role, r.name_ar role_ar
      FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.deleted_at IS NULL`).get(payload.uid);
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'الحساب غير نشط' });
    const sess = db.prepare('SELECT id FROM sessions WHERE user_id=? AND token_hash=? AND expires_at > datetime(\'now\',\'localtime\')')
      .get(user.id, crypto.createHash('sha256').update(token).digest('hex'));
    if (!sess) return res.status(401).json({ error: 'انتهت الجلسة — سجل الدخول مجددًا' });
    user.perms = getPermissions(user.role_id);
    user.ip = req.ip;
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'جلسة غير صالحة' });
  }
}

function requirePerm(module, action) {
  return (req, res, next) => {
    if (!can(req.user.perms, module, action)) {
      audit(req.user, 'denied', module, '', null, `محاولة ${action} مرفوضة`);
      return res.status(403).json({ error: 'صلاحية مرفوضة: لا تملك إذن ' + action + ' على ' + module });
    }
    next();
  };
}

function signToken(user) {
  const token = jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '24h' });
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO sessions (user_id, token_hash, ip, expires_at) VALUES (?,?,?,datetime(\'now\',\'+1 day\'))')
    .run(user.id, hash, '');
  // تنظيف الجلسات المنتهية + حد أقصى 5 جلسات نشطة
  try { db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now','localtime')`).run(); } catch {}
  // حد أقصى 5 جلسات نشطة
  db.prepare(`DELETE FROM sessions WHERE user_id=? AND id NOT IN
    (SELECT id FROM sessions WHERE user_id=? ORDER BY id DESC LIMIT 5)`).run(user.id, user.id);
  return token;
}

module.exports = { auth, requirePerm, signToken, audit, getPermissions, can, JWT_SECRET };
