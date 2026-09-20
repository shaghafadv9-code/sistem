// Smart Secretary — إدارة الأسرار (JWT + AI master key)
// القواعد:
//  1) الأسرار لا تعيش داخل مستودع الكود. تُنشأ عند أول تشغيل داخل DATA_DIR (في الإنتاج: %APPDATA%/Smart Secretary/data).
//  2) يمكن تجاوزها بمتغيرات بيئة (SS_JWT_SECRET / SS_AI_MASTER_KEY) — تُستخدم للتشغيل المؤقت/الخوادم.
//  3) صلاحيات الملفات 0600، ولا تُطبع قيمتها في أي سجل.
//  4) إذا اكتُشف أن ملف السر يقع داخل شجرة المستودع (أو أنه مُتتبَّع في git) يُعتبر compromised
//     ويُرفع تحذير صريح + يُطلب تدويره من شاشة الإدارة أو scripts/rotate-secrets.js.
//  5) تدوير مفتاح AI الرئيسي يعيد تغليف (re-seal) المفاتيح المخزنة في ai_providers تلقائيًا.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

const SPECS = {
  jwt: { file: '.jwt-secret', env: 'SS_JWT_SECRET', bytes: 48, label: 'مفتاح جلسات الدخول (JWT)' },
  ai_master: { file: '.ai-master-key', env: 'SS_AI_MASTER_KEY', bytes: 32, label: 'المفتاح الرئيسي لتشفير مفاتيح الذكاء الاصطناعي' }
};

function pathOf(name) { return path.join(DATA_DIR, SPECS[name].file); }

function gen(name) { return crypto.randomBytes(SPECS[name].bytes).toString('hex'); }

function writeSecretFile(name, value) {
  const p = pathOf(name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, value, { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch {}
  return p;
}

function isInsideRepo(p) {
  // شجرة المستودع = المجلد الذي يحتوي .git صعودًا من مجلد المشروع
  let dir = path.resolve(p);
  for (let i = 0; i < 8; i++) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    if (fs.existsSync(path.join(parent, '.git'))) return true;
    dir = parent;
  }
  return false;
}

function isGitTracked(p) {
  try {
    const { execFileSync } = require('child_process');
    const rel = path.relative(process.cwd(), p);
    if (!rel || rel.startsWith('..')) return false;
    const out = execFileSync('git', ['ls-files', '--error-unmatch', rel], { stdio: ['ignore', 'pipe', 'ignore'] });
    return out.toString().trim().length > 0;
  } catch { return false; }
}

/**
 * جلب السر (أو إنشاؤه عند أول تشغيل).
 * @param {'jwt'|'ai_master'} name
 */
function getSecret(name) {
  const spec = SPECS[name];
  if (!spec) throw new Error('سر غير معروف: ' + name);
  const env = process.env[spec.env];
  if (env && env.trim().length >= 16) return env.trim();
  const p = pathOf(name);
  if (fs.existsSync(p)) {
    const v = fs.readFileSync(p, 'utf8').trim();
    if (v) return v;
  }
  const fresh = gen(name);
  writeSecretFile(name, fresh);
  console.log(`[secrets] تم إنشاء ${spec.label} لأول مرة داخل مجلد البيانات (خارج المستودع)`);
  return fresh;
}

function getMasterKeyBuffer() {
  const hex = getSecret('ai_master');
  const b = Buffer.from(hex, 'hex');
  return b.length === 32 ? b : crypto.createHash('sha256').update(hex).digest();
}

/** حالة الأسرار للتشخيص — بدون كشف أي قيمة */
function status() {
  return Object.keys(SPECS).map((name) => {
    const spec = SPECS[name];
    const p = pathOf(name);
    const fromEnv = !!(process.env[spec.env] && process.env[spec.env].trim().length >= 16);
    const exists = fs.existsSync(p);
    let mode = null;
    try { mode = (fs.statSync(p).mode & 0o777).toString(8).padStart(3, '0'); } catch {}
    const inRepo = exists && isInsideRepo(p);
    const tracked = exists && isGitTracked(p);
    return {
      name, label: spec.label, path: p, exists, from_env: fromEnv, file_mode: mode,
      inside_repo: inRepo, git_tracked: tracked,
      compromised: tracked || (inRepo && !fromEnv),
      rotated_at: (() => { try { return exists ? fs.statSync(p).mtime.toISOString() : null; } catch { return null; } })()
    };
  });
}

/** تدوير سر واحد. إعادة تغليف مفاتيح AI تتم عند تدوير ai_master. */
function rotate(name, { reseal = null } = {}) {
  if (!SPECS[name]) throw new Error('سر غير معروف: ' + name);
  if (process.env[SPECS[name].env]) throw new Error(`لا يمكن تدوير ${SPECS[name].label} لأنه مضبوط عبر متغير البيئة ${SPECS[name].env}`);
  const old = fs.existsSync(pathOf(name)) ? fs.readFileSync(pathOf(name), 'utf8').trim() : null;
  const next = gen(name);
  writeSecretFile(name, next);
  let resealed = 0;
  if (name === 'ai_master' && old && typeof reseal === 'function') resealed = reseal(old, next);
  return { rotated: true, name, resealed };
}

module.exports = { getSecret, getMasterKeyBuffer, rotate, status, pathOf, SPECS, isInsideRepo, isGitTracked };
