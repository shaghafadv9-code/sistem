// Smart Secretary — مشغّل الاختبارات الكامل (يشغّل الخادم على قاعدة بيانات مؤقتة ثم ينفّذ الأجنحة)
// الاستخدام: npm test
//   QA_KEEP=1  → لا يحذف مجلد البيانات المؤقت (للتشخيص)
//   QA_ONLY=regression|core → تشغيل جناح واحد
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.QA_PORT || 3899);
const HOST = '127.0.0.1';
const API = `http://${HOST}:${PORT}/api`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-qa-'));
const DATA_DIR = path.join(TMP, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// نبدأ من نسخة القاعدة المرفوعة إن وُجدت (لأن ترحيل m5 يصلح بياناتها)، وإلا ننشئ قاعدة جديدة
const seedDb = path.join(ROOT, 'data', 'smart-secretary.db');
if (fs.existsSync(seedDb)) fs.copyFileSync(seedDb, path.join(DATA_DIR, 'smart-secretary.db'));

function log(...a) { console.log('[qa]', ...a); }

async function waitHealthy(timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(API + '/health');
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

function runSuite(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', file)], {
      cwd: ROOT, env: { ...process.env, API, QA_ADMIN_PASS: process.env.QA_ADMIN_PASS || 'admin123' }, stdio: 'inherit'
    });
    child.on('exit', (code) => resolve(code || 0));
  });
}

(async () => {
  log('DATA_DIR =', DATA_DIR);
  log('PORT =', PORT);
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    // SS_SKIP_CREDENTIAL_ROTATION: الاختبارات تعمل على نسخة مؤقتة تُرمى بعد التشغيل،
    // وتدوير كلمات المرور فيها يكسر تسجيل الدخول الثابت (admin123) الذي تعتمد عليه الأجنحة.
    // التدوير يبقى مفعّلًا دائمًا في أي تشغيل حقيقي.
    env: { ...process.env, DATA_DIR, PORT: String(PORT), HOST, NODE_ENV: 'test', LOG: '0', SS_SKIP_CREDENTIAL_ROTATION: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  server.stdout.on('data', d => { serverLog += d; if (process.env.QA_VERBOSE) process.stdout.write(d); });
  server.stderr.on('data', d => { serverLog += d; if (process.env.QA_VERBOSE) process.stderr.write(d); });

  const up = await waitHealthy();
  if (!up) {
    console.error('[qa] الخادم لم يستجب — آخر 40 سطرًا من السجل:');
    console.error(serverLog.split('\n').slice(-40).join('\n'));
    server.kill('SIGKILL');
    process.exit(2);
  }
  log('الخادم جاهز');

  const only = process.env.QA_ONLY || '';
  const suites = [];
  if (!only || only === 'core') suites.push('test.js');
  if (!only || only === 'regression') suites.push('regression.js');
  // جناح الأمان يشغّل خادمه الخاص على قاعدة مؤقتة (بدون تعطيل تدوير الاعتمادات)
  if (!only || only === 'security') suites.push('security.js');

  const codes = {};
  for (const s of suites) {
    console.log('\n=====================================================');
    console.log('  جناح: ' + s);
    console.log('=====================================================');
    codes[s] = await runSuite(s);
  }

  server.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 800));
  try { server.kill('SIGKILL'); } catch {}
  if (!process.env.QA_KEEP) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} }
  else log('تم الإبقاء على البيانات في', DATA_DIR);

  const failed = Object.entries(codes).filter(([, c]) => c !== 0);
  console.log('\n===================== الملخص =====================');
  Object.entries(codes).forEach(([s, c]) => console.log(`  ${c === 0 ? '✓' : '✗'} ${s} → exit ${c}`));
  if (failed.length) {
    console.log('\nأجنحة فاشلة. سجل الخادم (آخر 60 سطرًا):');
    console.log(serverLog.split('\n').slice(-60).join('\n'));
  }
  process.exit(failed.length ? 1 : 0);
})();
