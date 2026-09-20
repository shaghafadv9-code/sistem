// Smart Secretary — جناح الأمان (تدقيق 2026-09-19)
// يختبر المسار الحرج الذي لا يمكن اختباره داخل qa.js:
//   قاعدة البذر المرفوعة تحمل كلمات مرور معروفة علنًا (admin123 / sara1234).
//   عند أول إقلاع حقيقي يجب أن تُدوَّر تلقائيًا ويُجبر المستخدم على تغييرها.
//
// هذا الجناح يشغّل خادمه الخاص على قاعدة مؤقتة *بدون* SS_SKIP_CREDENTIAL_ROTATION،
// أي أنه يحاكي تثبيتًا حقيقيًا يسحب المستودع ويشغّله.
//
// الاستخدام: node scripts/security.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.SEC_PORT || 3877);
const API = `http://127.0.0.1:${PORT}/api`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sec-'));
const DATA_DIR = path.join(TMP, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const seedDb = path.join(ROOT, 'data', 'smart-secretary.db');
if (fs.existsSync(seedDb)) fs.copyFileSync(seedDb, path.join(DATA_DIR, 'smart-secretary.db'));
const CRED_FILE = path.join(DATA_DIR, '.initial-admin-password');

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  c ? pass++ : fail++;
  console.log((c ? '  ✓ ' : '  ✗ FAIL ') + n + (c ? '' : (extra ? ' → ' + extra : '')));
};
const section = (t) => console.log('\n— ' + t + ' —');

const J = async (p, o = {}, t) => {
  const r = await fetch(API + p, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined
  });
  let d; try { d = await r.json(); } catch { d = null; }
  return { s: r.status, d };
};

function readRotated() {
  if (!fs.existsSync(CRED_FILE)) return {};
  const out = {};
  for (const line of fs.readFileSync(CRED_FILE, 'utf8').split('\n')) {
    const [u, p] = line.split('\t');
    if (u && p) out[u.trim()] = p.trim();
  }
  return out;
}

async function waitHealthy(timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(API + '/health'); if (r.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

(async () => {
  console.log('— Smart Secretary SECURITY (تدقيق 2026-09-19) —');
  console.log('  DATA_DIR =', DATA_DIR);

  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR, PORT: String(PORT), HOST: '127.0.0.1', NODE_ENV: 'production',
      // مفتاحا الجلسات والتشفير من البيئة — لا ملفات أسرار في هذا الاختبار
      SS_JWT_SECRET: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718',
      SS_AI_MASTER_KEY: 'f9e8d7c6b5a4039281706f5e4d3c2b1a',
      // التدوير هو موضوع الاختبار — يجب ألا يُعطَّل
      SS_SKIP_CREDENTIAL_ROTATION: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });

  if (!(await waitHealthy())) {
    console.error('الخادم لم يستجب:\n' + log.split('\n').slice(-40).join('\n'));
    server.kill('SIGKILL'); process.exit(2);
  }

  try {
    // ============ J — تدوير الاعتمادات المعلنة في قاعدة البذر ============
    section('J — تدوير كلمات المرور المعروفة علنًا عند أول إقلاع');
    const rotated = readRotated();
    ok('يُكتب ملف الاعتمادات الأولية', fs.existsSync(CRED_FILE), CRED_FILE);
    ok('يشمل الملف حساب المدير', !!rotated.admin, JSON.stringify(Object.keys(rotated)));
    if (fs.existsSync(CRED_FILE)) {
      const st = fs.statSync(CRED_FILE);
      ok('ملف الاعتمادات بصلاحيات 600', (st.mode & 0o777) === 0o600, '0' + (st.mode & 0o777).toString(8));
    }

    const oldAdmin = await J('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
    ok('كلمة المرور المعلنة admin123 لم تعد تعمل', oldAdmin.s === 401, 'status=' + oldAdmin.s);
    const oldSara = await J('/auth/login', { method: 'POST', body: { username: 'sara', password: 'sara1234' } });
    ok('كلمة المرور المعلنة sara1234 لم تعد تعمل', oldSara.s === 401, 'status=' + oldSara.s);

    const lg = await J('/auth/login', { method: 'POST', body: { username: 'admin', password: rotated.admin } });
    ok('الدخول بكلمة المرور المدوَّرة ينجح', lg.s === 200 && !!lg.d?.token, 'status=' + lg.s);
    const T = lg.d?.token;

    if (T) {
      const me = await J('/auth/me', {}, T);
      ok('must_change_password = true بعد التدوير', me.d?.must_change_password === true, JSON.stringify(me.d).slice(0, 120));

      section('J — البوابة تحجب النظام حتى تغيير كلمة المرور');
      const blockedRead = await J('/sales?limit=1', {}, T);
      ok('GET /sales محجوب (403)', blockedRead.s === 403, 'status=' + blockedRead.s);
      const blockedWrite = await J('/clients', { method: 'POST', body: { name: 'اختبار', phone: '0500000000' } }, T);
      ok('POST /clients محجوب (403)', blockedWrite.s === 403, 'status=' + blockedWrite.s);
      const blockedFin = await J('/accounts', { method: 'POST', body: { name: 'صندوق', type: 'cash' } }, T);
      ok('POST /accounts محجوب (403)', blockedFin.s === 403, 'status=' + blockedFin.s);
      ok('الاستجابة المحجوبة تحمل must_change_password ليستخدمها العميل',
        blockedRead.d?.must_change_password === true, JSON.stringify(blockedRead.d).slice(0, 120));

      const wl = ['/health', '/settings/public', '/brand/public', '/auth/me'];
      for (const p of wl) ok(`القائمة البيضاء: ${p} متاح`, (await J(p, {}, T)).s === 200, 'blocked');

      section('J — سياسة كلمة المرور مطبَّقة على التغيير');
      const short = await J('/auth/change-password', { method: 'POST', body: { current: rotated.admin, next: 'Ab1!' } }, T);
      ok('كلمة مرور قصيرة مرفوضة', short.s === 400, 'status=' + short.s);
      const known = await J('/auth/change-password', { method: 'POST', body: { current: rotated.admin, next: 'admin123' } }, T);
      ok('العودة إلى كلمة معلنة مرفوضة', known.s === 400, 'status=' + known.s);
      const samePw = await J('/auth/change-password', { method: 'POST', body: { current: rotated.admin, next: rotated.admin } }, T);
      ok('إعادة نفس الكلمة مرفوضة', samePw.s === 400, 'status=' + samePw.s);
      const wrongCur = await J('/auth/change-password', { method: 'POST', body: { current: 'Wrong-Current-99', next: 'Str0ng-Pass-778899' } }, T);
      ok('كلمة حالية خاطئة مرفوضة', wrongCur.s === 400, 'status=' + wrongCur.s);
      const withUser = await J('/auth/change-password', { method: 'POST', body: { current: rotated.admin, next: 'adminadminadmin1' } }, T);
      ok('كلمة تحتوي اسم المستخدم مرفوضة', withUser.s === 400, 'status=' + withUser.s + ' ' + JSON.stringify(withUser.d).slice(0, 80));

      const finalPass = 'Fin@l-Pass-' + Date.now().toString().slice(-6);
      const ch = await J('/auth/change-password', { method: 'POST', body: { current: rotated.admin, next: finalPass } }, T);
      ok('تغيير كلمة مرور قوية ينجح', ch.s === 200, 'status=' + ch.s + ' ' + JSON.stringify(ch.d).slice(0, 100));

      section('J — بعد التغيير: رفع الحجب وحذف الأثر');
      const lg2 = await J('/auth/login', { method: 'POST', body: { username: 'admin', password: finalPass } });
      ok('الدخول بالكلمة الجديدة ينجح', lg2.s === 200, 'status=' + lg2.s);
      const T2 = lg2.d?.token;
      const me2 = await J('/auth/me', {}, T2);
      ok('must_change_password صار false', me2.d?.must_change_password === false, JSON.stringify(me2.d).slice(0, 120));
      ok('القراءة عادت للعمل', (await J('/sales?limit=1', {}, T2)).s === 200, 'still blocked');
      ok('الكتابة عادت للعمل', (await J('/clients', { method: 'POST', body: { name: 'عميل بعد التغيير', phone: '05' + String(Date.now()).slice(-8) } }, T2)).s === 201, 'blocked');
      ok('ملف الاعتمادات الأولية حُذف بعد التغيير', !fs.existsSync(CRED_FILE), 'still exists');
      ok('الكلمة المدوَّرة القديمة لم تعد تعمل', (await J('/auth/login', { method: 'POST', body: { username: 'admin', password: rotated.admin } })).s === 401, 'still works');
    }

    // ============ إعادة الإقلاع: التدوير idempotent ============
    section('J — إعادة الإقلاع لا تدوّر كلمات المرور المغيَّرة');
    server.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 1200));
    try { server.kill('SIGKILL'); } catch {}

    const logBefore = log.length;
    const server2 = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
      cwd: ROOT,
      env: {
        ...process.env, DATA_DIR, PORT: String(PORT), HOST: '127.0.0.1', NODE_ENV: 'production',
        SS_JWT_SECRET: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718',
        SS_AI_MASTER_KEY: 'f9e8d7c6b5a4039281706f5e4d3c2b1a',
        SS_SKIP_CREDENTIAL_ROTATION: ''
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    server2.stdout.on('data', d => { log += d; });
    server2.stderr.on('data', d => { log += d; });
    if (await waitHealthy()) {
      ok('لا يُعاد تدوير كلمة غيّرها المستخدم', !log.slice(logBefore).includes('تنبيه أمني'), log.slice(logBefore).slice(0, 160));
      ok('لا يُعاد إنشاء ملف الاعتمادات', !fs.existsSync(CRED_FILE), 'recreated');
    } else {
      ok('أُعيد إقلاع الخادم', false, log.split('\n').slice(-20).join(' | '));
    }
    server2.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 800));
    try { server2.kill('SIGKILL'); } catch {}

    // ============ وضع الإنتاج ============
    section('J/H-12 — وضع الديمو ممنوع في الإنتاج');
    ok('الخادم اشتغل بـ NODE_ENV=production بدون أخطاء', !/UnhandledPromiseRejection|TypeError|ReferenceError/.test(log), log.slice(-200));
  } catch (e) {
    ok('لم يُرمَ استثناء أثناء جناح الأمان', false, e.stack || e.message);
    try { server.kill('SIGKILL'); } catch {}
  }

  if (!process.env.SEC_KEEP) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} }
  else console.log('  (أُبقيت البيانات في', DATA_DIR + ')');

  console.log(`\nالنتيجة: ${pass} ناجح / ${fail} فاشل`);
  process.exit(fail ? 1 : 0);
})();
