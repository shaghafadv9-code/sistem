// Smart Secretary — API الذكاء الاصطناعي (مقدمون/موديلات/فحص/ملعب/مساعد/تقارير)
// لا يخرج أي مفتاح API في أي رد — تُعرض نسخة مقنعة فقط.
// 2.1 — إدارة مركزية + تبديل تلقائي + دعم الجلسات المتعددة + رسائل خطأ واضحة
const express = require('express');
const { db, nextUniqueCode } = require('./db');
const { auth, requirePerm: P, audit } = require('./auth');
const { idParam, need, aiLimiter, sealSecret, maskKey } = require('./security');
const AI = require('./ai');

const R = express.Router();
const pushAudit = (req, action, details, entity = 'ai', id = null) => audit({ ...req.user, ip: req.ip }, action, 'ai', entity, id, details);
const pub = (p) => ({
  id: p.id,
  code: p.code || `SUPPLIER-${String(p.id).padStart(4, '0')}`,
  name: p.name,
  ptype: p.ptype,
  base_url: AI.effBase(p),
  has_key: !!AI.apiKeyOf(p),
  key_masked: p.api_key_enc ? maskKey('x'.repeat(20)) && maskKey(AI.apiKeyOf(p)) : '',
  enabled: !!p.enabled,
  is_default: !!p.is_default,
  timeout_sec: p.timeout_sec,
  created_at: p.created_at,
  updated_at: p.updated_at
});

function validBase(ptype, base) {
  const def = AI.PROVIDER_TYPES[ptype]?.base || '';
  const b = (base || def).trim().replace(/\/+$/, '');
  if (ptype === 'custom' && !b) return { ok: false, error: 'الرابط الأساسي مطلوب للمزود المخصص' };
  if (!b) return { ok: true, base: '' };
  let u;
  try { u = new URL(b); } catch { return { ok: false, error: 'الرابط الأساسي غير صالح' }; }
  if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, error: 'الرابط يجب أن يبدأ بـ http(s)' };
  if (u.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname))
    return { ok: false, error: 'http مسموح للشبكة المحلية فقط — استخدم https' };
  return { ok: true, base: b };
}

// ---------- المزودون ----------
R.get('/providers', auth, P('ai', 'view'), (req, res) => {
  let sql = 'SELECT * FROM ai_providers WHERE 1=1';
  const params = [];
  if (req.query.q) {
    sql += ' AND (name LIKE ? OR code LIKE ? OR ptype LIKE ?)';
    const l = `%${req.query.q}%`;
    params.push(l, l, l);
  }
  if (req.query.ptype) {
    sql += ' AND ptype=?';
    params.push(req.query.ptype);
  }
  if (req.query.enabled !== undefined && req.query.enabled !== '') {
    sql += ' AND enabled=?';
    params.push(req.query.enabled === '1' ? 1 : 0);
  }
  sql += ' ORDER BY is_default DESC, id';
  res.json(db.prepare(sql).all(...params).map(pub));
});
R.post('/providers', auth, P('ai', 'manage'), need('name', 'ptype'), (req, res) => {
  const { name, ptype, base_url = '', api_key = '', timeout_sec = 30, enabled = 1 } = req.body;
  if (!AI.PROVIDER_TYPES[ptype]) return res.status(400).json({ error: 'نوع مزود غير معروف' });
  const v = validBase(ptype, base_url);
  if (!v.ok) return res.status(400).json({ error: v.error });
  if (AI.PROVIDER_TYPES[ptype].key && api_key && String(api_key).length < 8) return res.status(400).json({ error: 'المفتاح قصير جدًا' });

  // توليد كود المزود تلقائياً
  const code = nextUniqueCode('SUPPLIER', 'ai_providers', 'code');
  const hasDefault = db.prepare('SELECT COUNT(*) c FROM ai_providers WHERE is_default=1').get().c > 0;
  const isDef = hasDefault ? 0 : 1;

  const info = db.prepare('INSERT INTO ai_providers (code, name, ptype, base_url, api_key_enc, timeout_sec, enabled, is_default) VALUES (?,?,?,?,?,?,?,?)')
    .run(code, String(name).slice(0, 80), ptype, v.base, api_key ? sealSecret(String(api_key)) : '', Math.min(120, Math.max(5, +timeout_sec || 30)), enabled ? 1 : 0, isDef);

  const newProvider = AI.getProvider(info.lastInsertRowid);

  // تسجيل موديل افتراضي فوري للمزود ليتعرف عليه النظام فوراً ويكون متاحاً للاستخدام
  const defaultModelNames = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-sonnet',
    gemini: 'gemini-1.5-flash',
    ollama: 'llama3.1',
    openrouter: 'meta-llama/llama-3.1-8b-instruct:free',
    custom: 'custom-model'
  };
  const defModel = defaultModelNames[ptype] || 'default-model';
  try {
    db.prepare('INSERT OR IGNORE INTO ai_models (provider_id, model_id, alias, enabled, is_default, capabilities, last_status) VALUES (?,?,?,1,?,?,\'unknown\')')
      .run(newProvider.id, defModel, `${newProvider.name} Default`, isDef ? 1 : 0, 'chat');
  } catch {}

  pushAudit(req, 'create', `إضافة مزود AI: ${name} (${code})`, 'ai_provider', info.lastInsertRowid);
  res.status(201).json(pub(newProvider));
});
R.put('/providers/:id', auth, P('ai', 'manage'), idParam, (req, res) => {
  const p = AI.getProvider(req.params.id);
  if (!p) return res.status(404).json({ error: 'المزود غير موجود' });
  const { name, base_url, api_key, timeout_sec, enabled } = req.body || {};
  let base = p.base_url;
  if (base_url !== undefined) { const v = validBase(p.ptype, base_url); if (!v.ok) return res.status(400).json({ error: v.error }); base = v.base; }
  db.prepare('UPDATE ai_providers SET name=?, base_url=?, api_key_enc=?, timeout_sec=?, enabled=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
    .run(name ? String(name).slice(0, 80) : p.name, base, api_key ? sealSecret(String(api_key)) : p.api_key_enc,
      timeout_sec ? Math.min(120, Math.max(5, +timeout_sec)) : p.timeout_sec, enabled === undefined ? p.enabled : (enabled ? 1 : 0), p.id);
  pushAudit(req, 'update', `تعديل مزود AI: ${p.name}${api_key ? ' (تم تحديث المفتاح)' : ''}`, 'ai_provider', p.id);
  res.json(pub(AI.getProvider(p.id)));
});
R.delete('/providers/:id', auth, P('ai', 'manage'), idParam, (req, res) => {
  const p = AI.getProvider(req.params.id);
  if (!p) return res.status(404).json({ error: 'المزود غير موجود' });
  db.prepare('DELETE FROM ai_providers WHERE id=?').run(p.id);
  pushAudit(req, 'delete', `حذف مزود AI: ${p.name}`, 'ai_provider', p.id);
  res.json({ ok: true });
});
R.post('/providers/:id/default', auth, P('ai', 'manage'), idParam, (req, res) => {
  const p = AI.getProvider(req.params.id);
  if (!p) return res.status(404).json({ error: 'المزود غير موجود' });
  db.prepare('UPDATE ai_providers SET is_default=0').run();
  db.prepare('UPDATE ai_providers SET is_default=1 WHERE id=?').run(p.id);
  pushAudit(req, 'update', `تعيين المزود الافتراضي: ${p.name}`, 'ai_provider', p.id);
  res.json({ ok: true });
});
// اختبار الاتصال: مزامنة + فحص أول موديل
R.post('/providers/:id/test', auth, P('ai', 'manage'), idParam, (req, res) => {
  (async () => {
    const p = AI.getProvider(req.params.id);
    if (!p) return res.status(404).json({ error: 'المزود غير موجود' });
    try {
      let synced = 0, note = '';
      try { const s = await AI.syncModels(p); synced = s.synced; note = s.note || ''; } catch (e) {
        const m = /HTTP (\d+)/.exec(e.message || '');
        const cat = e.cat || AI.categorize(m ? Number(m[1]) : 0, e.message);
        pushAudit(req, 'test', `فشل اختبار المزود ${p.name}: ${cat.ar}`, 'ai_provider', p.id);
        return res.json({ ok: false, error: cat.ar, code: cat.code, detail: AI.scrub(e.message).slice(0, 160) });
      }
      const models = db.prepare('SELECT * FROM ai_models WHERE provider_id=? AND enabled=1 ORDER BY id LIMIT 5').all(p.id);
      if (!models.length) {
        pushAudit(req, 'test', `اختبار المزود ${p.name}: لا توجد موديلات — ${note || 'أضف موديلًا يدويًا'}`, 'ai_provider', p.id);
        return res.json({ ok: true, connected: true, synced, note: note || 'متصل — لا توجد موديلات، أضف موديلًا يدويًا ثم افحصه' });
      }
      const chk = await AI.checkModel(p, models[0]);
      pushAudit(req, 'test', `اختبار المزود ${p.name}: ${chk.ok ? 'ناجح' : 'فاشل — ' + chk.error} (${models[0].model_id})`, 'ai_provider', p.id);
      res.json({ ok: chk.ok, connected: true, synced, model: models[0].model_id, latency: chk.latency, error: chk.error, code: chk.code });
    } catch (e) { res.json({ ok: false, error: AI.scrub(e.message) }); }
  })();
});
R.post('/providers/:id/sync-models', auth, P('ai', 'manage'), idParam, (req, res) => {
  (async () => {
    const p = AI.getProvider(req.params.id);
    if (!p) return res.status(404).json({ error: 'المزود غير موجود' });
    try {
      const s = await AI.syncModels(p);
      pushAudit(req, 'update', `مزامنة موديلات ${p.name}: ${s.synced} موديل`, 'ai_provider', p.id);
      res.json({ ok: true, ...s });
    } catch (e) {
      const m = /HTTP (\d+)/.exec(e.message || '');
      const cat = e.cat || AI.categorize(m ? Number(m[1]) : 0, e.message);
      pushAudit(req, 'update', `فشل مزامنة ${p.name}: ${cat.ar}`, 'ai_provider', p.id);
      res.json({ ok: false, error: cat.ar, code: cat.code });
    }
  })();
});

// ---------- الموديلات ----------
R.get('/models', auth, P('ai', 'view'), (req, res) => {
  // الفلترة على الخادم اختيارية — الأساسية على الواجهة بدون إعادة تحميل
  // لكن ندعم باراميترات للتوافق: ?provider_id=&q=&status=&cap=
  let sql = `SELECT m.*, p.name pname, p.ptype, p.enabled penabled FROM ai_models m JOIN ai_providers p ON p.id=m.provider_id WHERE 1=1`;
  const ps = [];
  if (req.query.provider_id && /^\d+$/.test(req.query.provider_id)) { sql += ' AND m.provider_id=?'; ps.push(req.query.provider_id); }
  if (req.query.q) { sql += ' AND (m.model_id LIKE ? OR COALESCE(m.alias,\'\') LIKE ? OR p.name LIKE ?)'; const like = `%${req.query.q}%`; ps.push(like, like, like); }
  if (req.query.status) { sql += ' AND m.last_status=?'; ps.push(req.query.status); }
  if (req.query.cap) { sql += ' AND COALESCE(m.capabilities,\'\') LIKE ?'; ps.push(`%${req.query.cap}%`); }
  sql += ' ORDER BY m.is_default DESC, p.name, m.model_id';
  res.json(db.prepare(sql).all(...ps));
});
R.post('/models', auth, P('ai', 'manage'), need('provider_id', 'model_id'), (req, res) => {
  const { provider_id, model_id, alias = '' } = req.body;
  const p = AI.getProvider(provider_id);
  if (!p) return res.status(404).json({ error: 'المزود غير موجود' });
  if (!/^[\w.\-:/+]{1,120}$/.test(String(model_id))) return res.status(400).json({ error: 'اسم موديل غير صالح' });
  try {
    const info = db.prepare('INSERT INTO ai_models (provider_id, model_id, alias) VALUES (?,?,?)').run(p.id, String(model_id), String(alias).slice(0, 80));
    pushAudit(req, 'create', `إضافة موديل ${model_id} للمزود ${p.name}`, 'ai_model', info.lastInsertRowid);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch { res.status(400).json({ error: 'الموديل مسجل مسبقًا لهذا المزود' }); }
});
R.put('/models/:id', auth, P('ai', 'manage'), idParam, (req, res) => {
  const m = AI.getModel(req.params.id);
  if (!m) return res.status(404).json({ error: 'الموديل غير موجود' });
  const { alias, enabled, capabilities } = req.body || {};
  db.prepare('UPDATE ai_models SET alias=?, enabled=?, capabilities=? WHERE id=?')
    .run(alias !== undefined ? String(alias).slice(0, 80) : m.alias, enabled === undefined ? m.enabled : (enabled ? 1 : 0), capabilities !== undefined ? String(capabilities).slice(0, 200) : m.capabilities, m.id);
  pushAudit(req, 'update', `تعديل الموديل ${m.model_id}`, 'ai_model', m.id);
  res.json({ ok: true });
});
R.delete('/models/:id', auth, P('ai', 'manage'), idParam, (req, res) => {
  const m = AI.getModel(req.params.id) || db.prepare('SELECT * FROM ai_models WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'الموديل غير موجود' });
  db.prepare('DELETE FROM ai_models WHERE id=?').run(m.id);
  pushAudit(req, 'delete', `حذف الموديل ${m.model_id}`, 'ai_model', m.id);
  res.json({ ok: true });
});
// تعيين الافتراضي — مشروط بفحص ناجح (للحفاظ على الاستقرار) مع السماح بالتجاوز إذا كان التبديل التلقائي نشط
R.post('/models/:id/default', auth, P('ai', 'manage'), idParam, (req, res) => {
  const m = AI.getModel(req.params.id);
  if (!m) return res.status(404).json({ error: 'الموديل غير موجود' });
  if (m.last_status !== 'healthy') return res.status(400).json({ error: 'لا يمكن الاعتماد — افحص الموديل بنجاح أولًا (الحالة: ' + ({ failed: 'فاشل', unknown: 'غير مفحوص', degraded: 'متدهور' }[m.last_status] || m.last_status) + ')' });
  db.prepare('UPDATE ai_models SET is_default=0').run();
  db.prepare('UPDATE ai_models SET is_default=1, enabled=1 WHERE id=?').run(m.id);
  pushAudit(req, 'update', `اعتماد الموديل الافتراضي: ${m.model_id}`, 'ai_model', m.id);
  res.json({ ok: true });
});
R.post('/models/:id/check', auth, P('ai', 'manage'), idParam, (req, res) => {
  (async () => {
    const m = AI.getModel(req.params.id);
    if (!m) return res.status(404).json({ error: 'الموديل غير موجود' });
    const p = AI.getProvider(m.provider_id);
    const r = await AI.checkModel(p, m);
    AI.logUsage({ userId: req.user.id, providerId: p.id, model: m.model_id, purpose: 'health', latency: r.latency || 0, ok: r.ok, error: r.error || '' });
    pushAudit(req, 'test', `فحص الموديل ${m.model_id}: ${r.ok ? 'سليم' : 'فاشل — ' + r.error}`, 'ai_model', m.id);
    res.json(r);
  })();
});
R.post('/models/check-all', auth, P('ai', 'manage'), (req, res) => {
  (async () => {
    const models = db.prepare(`SELECT m.*, p.name pname FROM ai_models m JOIN ai_providers p ON p.id=m.provider_id WHERE m.enabled=1 AND p.enabled=1`).all();
    const results = [];
    for (const m of models) {
      const p = AI.getProvider(m.provider_id);
      const r = await AI.checkModel(p, m);
      AI.logUsage({ userId: req.user.id, providerId: p.id, model: m.model_id, purpose: 'health', latency: r.latency || 0, ok: r.ok, error: r.error || '' });
      results.push({ id: m.id, model: m.model_id, provider: m.pname, ...r });
    }
    const okN = results.filter(r => r.ok).length;
    pushAudit(req, 'test', `فحص شامل للموديلات: ${okN}/${results.length} سليم`, 'ai_model', null);
    res.json({ total: results.length, healthy: okN, results });
  })();
});

// ---------- الحالة والتشخيص ----------
R.get('/status', auth, P('ai', 'view'), (req, res) => {
  const providers = db.prepare('SELECT COUNT(*) c FROM ai_providers WHERE enabled=1').get().c;
  const byStatus = {};
  db.prepare('SELECT last_status s, COUNT(*) c FROM ai_models GROUP BY last_status').all().forEach(r => { byStatus[r.s || 'unknown'] = r.c; });
  const total = db.prepare('SELECT COUNT(*) c FROM ai_models').get().c;
  const { model, fallback } = AI.getDefaultModel();
  const today = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(tokens_in+tokens_out),0) t FROM ai_usage WHERE substr(created_at,1,10)=substr(datetime('now','localtime'),1,10)`).get();
  const verdict = !total ? 'NOT_CONFIGURED' : (model && model.last_status === 'healthy' && !fallback ? 'CONNECTED' : (model ? 'DEGRADED' : 'FAILED'));
  res.json({
    verdict,
    providers_enabled: providers,
    models: { total, healthy: byStatus.healthy || 0, failed: byStatus.failed || 0, degraded: byStatus.degraded || 0, unknown: byStatus.unknown || 0 },
    def: model ? { id: model.id, model: model.model_id, alias: model.alias, provider: model.pname, status: model.last_status, fallback } : null,
    usage_today: { calls: today.c, tokens: today.t }
  });
});
R.get('/usage', auth, P('ai', 'view'), (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1), limit = Math.min(100, parseInt(req.query.limit) || 20);
  const total = db.prepare('SELECT COUNT(*) c FROM ai_usage').get().c;
  const data = db.prepare(`SELECT u.*, s.name uname FROM ai_usage u LEFT JOIN users s ON s.id=u.user_id ORDER BY u.id DESC LIMIT ? OFFSET ?`).all(limit, (page - 1) * limit);
  res.json({ data, total, page, pages: Math.ceil(total / limit) || 1 });
});
R.get('/diagnostics', auth, P('ai', 'manage'), (req, res) => {
  const providers = db.prepare('SELECT * FROM ai_providers ORDER BY id').all().map(p => ({
    id: p.id, name: p.name, ptype: p.ptype, base: AI.effBase(p), has_key: !!AI.apiKeyOf(p),
    enabled: !!p.enabled, is_default: !!p.is_default, timeout_sec: p.timeout_sec,
    models: db.prepare('SELECT COUNT(*) c FROM ai_models WHERE provider_id=?').get(p.id).c,
    healthy: db.prepare(`SELECT COUNT(*) c FROM ai_models WHERE provider_id=? AND last_status='healthy'`).get(p.id).c,
    last_error: (db.prepare(`SELECT last_error e FROM ai_models WHERE provider_id=? AND last_error<>'' ORDER BY last_check DESC LIMIT 1`).get(p.id) || {}).e || ''
  }));
  res.json({ node: process.version, fetch: typeof fetch === 'function', time: new Date().toISOString(), providers });
});

// ---------- سياق المساعد (مفلتر بالصلاحيات — إحصاءات إجمالية فقط) ----------
function assistantContext(user) {
  const c = (mod) => !!user.perms[`${mod}:view`];
  const ctx = { date: new Date().toISOString().slice(0, 10), user: user.name, role: user.role_ar || user.role, modules: [] };
  const num = (sql, ...p) => { try { return db.prepare(sql).get(...p)?.c ?? 0; } catch { return 0; } };
  if (c('tasks')) { ctx.modules.push('tasks'); ctx.tasks = num(`SELECT COUNT(*) c FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled')`); ctx.tasks_overdue = num(`SELECT COUNT(*) c FROM tasks WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled') AND due_date < date('now','localtime')`); }
  if (c('appointments')) { ctx.modules.push('appointments'); ctx.appt_today = num(`SELECT COUNT(*) c FROM appointments WHERE deleted_at IS NULL AND date=date('now','localtime') AND status='scheduled'`); }
  if (c('clients')) { ctx.modules.push('clients'); ctx.clients = num(`SELECT COUNT(*) c FROM clients WHERE deleted_at IS NULL`); }
  if (c('reservations')) { ctx.modules.push('reservations'); ctx.res_active = num(`SELECT COUNT(*) c FROM reservations WHERE status='active'`); }
  if (c('units')) { ctx.modules.push('units'); ctx.units_avail = num(`SELECT COUNT(*) c FROM units WHERE deleted_at IS NULL AND status='available'`); }
  if (c('sales')) { ctx.modules.push('sales'); ctx.sales = num(`SELECT COUNT(*) c FROM sales WHERE status<>'cancelled'`); }
  if (c('finance')) { ctx.modules.push('finance'); try { ctx.revenue = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments`).get().s; } catch { ctx.revenue = 0; } }
  ctx.unread = num(`SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0`, user.id);
  return ctx;
}
function localFallback(message, ctx) {
  const m = message || '';
  const parts = [`أنت: ${ctx.user} (${ctx.role}) — التاريخ ${ctx.date}`];
  const L = [];
  if (ctx.tasks !== undefined) L.push(`مهام مفتوحة: ${ctx.tasks} (متأخرة: ${ctx.tasks_overdue})`);
  if (ctx.appt_today !== undefined) L.push(`مواعيد اليوم: ${ctx.appt_today}`);
  if (ctx.clients !== undefined) L.push(`العملاء: ${ctx.clients}`);
  if (ctx.res_active !== undefined) L.push(`حجوزات نشطة: ${ctx.res_active}`);
  if (ctx.units_avail !== undefined) L.push(`وحدات متاحة: ${ctx.units_avail}`);
  if (ctx.sales !== undefined) L.push(`مبيعات: ${ctx.sales}`);
  if (ctx.revenue !== undefined) L.push(`إجمالي المحصل: ${Number(ctx.revenue).toLocaleString('en')}`);
  L.push(`إشعارات غير مقروءة: ${ctx.unread}`);
  if (/مهم|مهام|متأخر/.test(m) && ctx.tasks !== undefined) return `لديك ${ctx.tasks} مهمة مفتوحة منها ${ctx.tasks_overdue} متأخرة. افتح صفحة المهام للمتابعة.`;
  if (/موعد|مواعيد|اليوم/.test(m) && ctx.appt_today !== undefined) return `مواعيد اليوم المجدولة: ${ctx.appt_today}. راجع صفحة المواعيد للتفاصيل.`;
  if (/مبيع|إيراد|مالي|تحصيل/.test(m)) {
    if (ctx.revenue === undefined) return 'لا تملك صلاحية عرض البيانات المالية.';
    return `إجمالي المبيعات: ${ctx.sales} — إجمالي المحصل: ${Number(ctx.revenue).toLocaleString('en')}. (وضع محلي — فعّل مفتاح AI من الإعدادات لتحليل أعمق)`;
  }
  parts.push(...L);
  parts.push('(وضع محلي — فعّل مفتاح AI من الإعدادات لإجابات ذكية)');
  return parts.join('\n');
}

// أداة لتنظيف وتطبيع مصفوفة الرسائل (لدعم الجلسات المتعددة)
function normalizeMessages(raw, sysContent) {
  const out = [];
  if (sysContent) out.push({ role: 'system', content: sysContent });
  if (!Array.isArray(raw)) return out;
  for (const m of raw) {
    if (!m || typeof m.content !== 'string') continue;
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user';
    if (role === 'system') continue; // النظام يأتي من sysContent فقط لتجنب التكرار
    const content = String(m.content).slice(0, 4000).trim();
    if (!content) continue;
    out.push({ role, content });
  }
  // حد أقصى 14 رسالة (نظام + 13) لتفادي تجاوز حد الرموز
  if (out.length > 14) return [out[0], ...out.slice(-13)];
  return out;
}

// ---------- المساعد الذكي — مساعد تنفيذي حقيقي مع تبديل تلقائي ودعم الجلسة والصلاحيات ----------
const { processAssistantRequest } = require('./assistant_engine');

R.post('/assistant', auth, P('assistant', 'view'), aiLimiter, (req, res) => {
  (async () => {
    const message = String(req.body?.message || req.body?.text || '').slice(0, 2000);
    const confirmed = !!req.body?.confirmed;
    const pending = req.body?.pending;
    let history = [];
    if (Array.isArray(req.body?.messages)) history = req.body.messages;
    else if (Array.isArray(req.body?.history)) history = req.body.history;

    // حالة عدم وجود رسالة ولا سجل ولا تأكيد
    if (!message.trim() && !history.length && !confirmed) {
      return res.status(400).json({ error: 'اكتب سؤالك أولًا' });
    }

    try {
      const result = await processAssistantRequest({
        text: message,
        messages: history,
        confirmed,
        pending,
        user: req.user
      });
      res.json(result);
    } catch (e) {
      console.warn('[AI Assistant error]:', e.message);
      res.status(500).json({
        reply: '⚠️ حدث خطأ أثناء تنفيذ طلب المساعد: ' + e.message,
        isError: true
      });
    }
  })();
});

// ---------- الملعب — مع تبديل تلقائي وعدم تكرار الطلب ----------
R.post('/playground', auth, P('ai', 'view'), aiLimiter, (req, res) => {
  (async () => {
    const msgs = Array.isArray(req.body?.messages) ? req.body.messages.slice(-20) : [];
    if (!msgs.length) return res.status(400).json({ error: 'لا توجد رسائل' });
    for (const m of msgs) {
      if (!['user', 'assistant', 'system'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 4000)
        return res.status(400).json({ error: 'رسالة غير صالحة' });
    }
    const canManage = !!req.user.perms['ai:manage'];
    let preferredId = null;
    if (canManage && req.body?.model_id) {
      const mm = AI.getModel(req.body.model_id);
      if (!mm || !mm.enabled || !mm.penabled) return res.status(400).json({ error: 'الموديل المحدد غير متاح' });
      preferredId = mm.id;
    } else {
      const d = AI.getDefaultModel();
      if (!d.model) return res.status(400).json({ error: 'لا يوجد موديل افتراضي مُعد — أضف مزودًا وموديلًا أولًا' });
      preferredId = d.model.id;
    }

    try {
      const r = await AI.chatWithFallback(msgs, { preferredModelId: preferredId, maxTokens: 1100, purpose: 'playground', userId: req.user.id });
      res.json({ reply: r.text, model: r.model, provider: r.provider, tokens: (r.tokensIn||0)+(r.tokensOut||0), latency: r.latency, fallback: r.fallback, attempts: r.attempts });
    } catch (e) {
      // رسالة خطأ واضحة بدل تجميد الواجهة
      const cat = e.cat || { ar: 'خطأ' , code: 'UNKNOWN'};
      res.status(502).json({ error: 'فشل استدعاء النماذج: ' + cat.ar, code: cat.code, detail: AI.scrub(e.detail||e.message||'').slice(0,220), attempts: e.attempts||[] });
    }
  })();
});

// ---------- توليد تقرير بالذكاء (قراءة فقط — مع تبديل تلقائي) ----------
R.post('/report', auth, P('reports', 'view'), aiLimiter, (req, res) => {
  (async () => {
    const prompt = String(req.body?.prompt || '').slice(0, 1000);
    if (!prompt.trim()) return res.status(400).json({ error: 'اكتب موضوع التقرير' });
    const d = AI.getDefaultModel();
    if (!d.model) return res.status(400).json({ error: 'لا يوجد موديل افتراضي مُعد' });
    const ctx = assistantContext(req.user);
    let monthly = [];
    if (req.user.perms['finance:view'] || req.user.perms['sales:view']) {
      try { monthly = db.prepare(`SELECT substr(sale_date,1,7) m, COUNT(*) n, ROUND(SUM(net_price),2) total FROM sales WHERE status<>'cancelled' GROUP BY m ORDER BY m DESC LIMIT 6`).all(); } catch {}
    }
    const sys = `أنت محلل أعمال. اكتب تقريرًا إداريًا موجزًا بالعربية (عناوين + نقاط) بناءً على الأرقام التالية فقط — لا تخترع أرقامًا.\nالسياق: ${JSON.stringify({ ...ctx, monthly })}.\nاختم بتوصيتين عمليتين. التقرير للقراءة فقط ولا ينفذ أي عملية.`;
    const msgs = [{ role: 'system', content: sys }, { role: 'user', content: prompt }];
    try {
      const r = await AI.chatWithFallback(msgs, { preferredModelId: d.model.id, maxTokens: 1300, purpose: 'report', userId: req.user.id });
      res.json({ markdown: r.text, model: r.model, provider: r.provider, fallback: r.fallback });
    } catch (e) {
      const cat = e.cat || { ar: 'خطأ' };
      res.status(502).json({ error: 'تعذر توليد التقرير: ' + cat.ar, code: cat.code, attempts: e.attempts||[] });
    }
  })();
});

// ---------- نظام صلاحيات الذكاء الاصطناعي (مستقل عن الإعدادات ومحمي بالكامل) ----------
const { AI_MODULES, AI_ACTIONS, canAI, seedAIPermissions } = require('./db');

R.get('/permissions', auth, (req, res) => {
  try {
    seedAIPermissions();
    const rows = db.prepare('SELECT module, action, enabled FROM ai_permissions').all();
    const map = {};
    for (const r of rows) {
      if (!map[r.module]) map[r.module] = {};
      map[r.module][r.action] = r.enabled === 1;
    }

    for (const m of AI_MODULES) {
      if (!map[m.key]) map[m.key] = {};
      for (const a of AI_ACTIONS) {
        if (map[m.key][a.key] === undefined) {
          map[m.key][a.key] = true;
        }
      }
    }

    // استبعاد الإعدادات تماماً من الرد
    delete map['settings'];
    delete map['users'];
    delete map['roles'];
    delete map['backup'];
    delete map['ai_permissions'];

    res.json({
      modules: AI_MODULES,
      actions: AI_ACTIONS,
      permissions: map
    });
  } catch (e) {
    res.status(500).json({ error: 'فشل تحميل الصلاحيات: ' + e.message });
  }
});

R.put('/permissions', auth, (req, res) => {
  const isAdmin = req.user.role === 'admin' || req.user.perms['ai:manage'] || req.user.perms['roles:manage'];
  if (!isAdmin) {
    return res.status(403).json({ error: 'صلاحية إدارة صلاحيات الذكاء الاصطناعي مقتصرة على الإدارة' });
  }

  const { enable_all, disable_all, toggle_module, permissions } = req.body || {};
  const validModules = new Set(AI_MODULES.map(m => m.key));
  const validActions = new Set(AI_ACTIONS.map(a => a.key));

  try {
    if (enable_all) {
      for (const m of AI_MODULES) {
        for (const a of AI_ACTIONS) {
          db.prepare(`
            INSERT INTO ai_permissions (module, action, enabled, updated_at)
            VALUES (?, ?, 1, datetime('now','localtime'))
            ON CONFLICT(module, action) DO UPDATE SET enabled=1, updated_at=datetime('now','localtime')
          `).run(m.key, a.key);
        }
      }
      pushAudit(req, 'update', 'تفعيل جميع صلاحيات الذكاء الاصطناعي لكافة الأقسام', 'ai_permissions');
      return res.json({ ok: true, message: 'تم تفعيل جميع صلاحيات الذكاء الاصطناعي بنجاح' });
    }

    if (disable_all) {
      for (const m of AI_MODULES) {
        for (const a of AI_ACTIONS) {
          db.prepare(`
            INSERT INTO ai_permissions (module, action, enabled, updated_at)
            VALUES (?, ?, 0, datetime('now','localtime'))
            ON CONFLICT(module, action) DO UPDATE SET enabled=0, updated_at=datetime('now','localtime')
          `).run(m.key, a.key);
        }
      }
      pushAudit(req, 'update', 'تعطيل جميع صلاحيات الذكاء الاصطناعي لكافة الأقسام', 'ai_permissions');
      return res.json({ ok: true, message: 'تم تعطيل جميع صلاحيات الذكاء الاصطناعي بنجاح' });
    }

    if (toggle_module && toggle_module.module) {
      const mod = toggle_module.module;
      if (!validModules.has(mod) || mod === 'settings') {
        return res.status(400).json({ error: 'القسم المحدد غير متاح أو مستثنى من صلاحيات الذكاء الاصطناعي' });
      }
      const val = toggle_module.enabled ? 1 : 0;
      for (const a of AI_ACTIONS) {
        db.prepare(`
          INSERT INTO ai_permissions (module, action, enabled, updated_at)
          VALUES (?, ?, ?, datetime('now','localtime'))
          ON CONFLICT(module, action) DO UPDATE SET enabled=excluded.enabled, updated_at=datetime('now','localtime')
        `).run(mod, a.key, val);
      }
      pushAudit(req, 'update', `${val ? 'تفعيل' : 'تعطيل'} صلاحيات قسم ${mod} بالكامل`, 'ai_permissions');
      return res.json({ ok: true, message: `تم ${val ? 'تفعيل' : 'تعطيل'} قسم ${mod} بالكامل` });
    }

    if (permissions && typeof permissions === 'object') {
      const stmt = db.prepare(`
        INSERT INTO ai_permissions (module, action, enabled, updated_at)
        VALUES (?, ?, ?, datetime('now','localtime'))
        ON CONFLICT(module, action) DO UPDATE SET enabled=excluded.enabled, updated_at=datetime('now','localtime')
      `);

      if (Array.isArray(permissions)) {
        for (const p of permissions) {
          if (validModules.has(p.module) && validActions.has(p.action) && p.module !== 'settings') {
            stmt.run(p.module, p.action, p.enabled ? 1 : 0);
          }
        }
      } else {
        for (const [mod, acts] of Object.entries(permissions)) {
          if (validModules.has(mod) && mod !== 'settings' && typeof acts === 'object') {
            for (const [act, val] of Object.entries(acts)) {
              if (validActions.has(act)) {
                stmt.run(mod, act, val ? 1 : 0);
              }
            }
          }
        }
      }
      pushAudit(req, 'update', 'تحديث صلاحيات الذكاء الاصطناعي', 'ai_permissions');
      return res.json({ ok: true, message: 'تم حفظ صلاحيات الذكاء الاصطناعي بنجاح' });
    }

    res.status(400).json({ error: 'بيانات التحديث غير صالحة' });
  } catch (e) {
    res.status(500).json({ error: 'فشل حفظ الصلاحيات: ' + e.message });
  }
});

// ---------- مسارات إدارة محادثات وسياق المساعد (Conversation Context) ----------
R.get('/conversations', auth, (req, res) => {
  try {
    const list = db.prepare(`
      SELECT id, title, created_at, updated_at
      FROM assistant_conversations
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT 30
    `).all(req.user.id);
    res.json({ data: list });
  } catch (e) {
    res.json({ data: [] });
  }
});

R.post('/conversations', auth, (req, res) => {
  try {
    const id = 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const title = req.body?.title || 'محادثة جديدة';
    db.prepare(`
      INSERT INTO assistant_conversations (id, user_id, title, context_state, created_at, updated_at)
      VALUES (?, ?, ?, '{}', datetime('now','localtime'), datetime('now','localtime'))
    `).run(id, req.user.id, title);
    res.status(201).json({ id, title });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

R.get('/conversations/:id', auth, (req, res) => {
  try {
    const conv = db.prepare(`SELECT * FROM assistant_conversations WHERE id=? AND user_id=?`).get(req.params.id, req.user.id);
    if (!conv) return res.status(404).json({ error: 'المحادثة غير موجودة' });
    const messages = db.prepare(`
      SELECT role, content, cards, actions, pending, created_at
      FROM assistant_messages
      WHERE conversation_id=?
      ORDER BY id ASC
    `).all(req.params.id);

    res.json({
      id: conv.id,
      title: conv.title,
      context_state: JSON.parse(conv.context_state || '{}'),
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        cards: m.cards ? JSON.parse(m.cards) : [],
        actions: m.actions ? JSON.parse(m.actions) : [],
        pending: m.pending ? JSON.parse(m.pending) : null,
        created_at: m.created_at
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

R.delete('/conversations/:id', auth, (req, res) => {
  try {
    db.prepare(`DELETE FROM assistant_messages WHERE conversation_id=?`).run(req.params.id);
    db.prepare(`DELETE FROM assistant_conversations WHERE id=? AND user_id=?`).run(req.params.id, req.user.id);
    res.json({ ok: true, message: 'تم حذف المحادثة وسياقها بنجاح' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = R;
