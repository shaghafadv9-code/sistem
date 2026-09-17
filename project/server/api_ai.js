// Smart Secretary — API الذكاء الاصطناعي (مقدمون/موديلات/فحص/ملعب/مساعد/تقارير)
// لا يخرج أي مفتاح API في أي رد — تُعرض نسخة مقنعة فقط.
const express = require('express');
const { db } = require('./db');
const { auth, requirePerm: P, audit } = require('./auth');
const { idParam, need, aiLimiter, sealSecret, maskKey } = require('./security');
const AI = require('./ai');

const R = express.Router();
const pushAudit = (req, action, details, entity = 'ai', id = null) => audit({ ...req.user, ip: req.ip }, action, 'ai', entity, id, details);
const pub = (p) => ({ id: p.id, name: p.name, ptype: p.ptype, base_url: AI.effBase(p), has_key: !!AI.apiKeyOf(p), key_masked: p.api_key_enc ? maskKey('x'.repeat(20)) && maskKey(AI.apiKeyOf(p)) : '', enabled: !!p.enabled, is_default: !!p.is_default, timeout_sec: p.timeout_sec, created_at: p.created_at, updated_at: p.updated_at });

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
  res.json(db.prepare('SELECT * FROM ai_providers ORDER BY is_default DESC, id').all().map(pub));
});
R.post('/providers', auth, P('ai', 'manage'), need('name', 'ptype'), (req, res) => {
  const { name, ptype, base_url = '', api_key = '', timeout_sec = 30, enabled = 1 } = req.body;
  if (!AI.PROVIDER_TYPES[ptype]) return res.status(400).json({ error: 'نوع مزود غير معروف' });
  const v = validBase(ptype, base_url);
  if (!v.ok) return res.status(400).json({ error: v.error });
  if (AI.PROVIDER_TYPES[ptype].key && api_key && String(api_key).length < 8) return res.status(400).json({ error: 'المفتاح قصير جدًا' });
  const info = db.prepare('INSERT INTO ai_providers (name, ptype, base_url, api_key_enc, timeout_sec, enabled) VALUES (?,?,?,?,?,?)')
    .run(String(name).slice(0, 80), ptype, v.base, api_key ? sealSecret(String(api_key)) : '', Math.min(120, Math.max(5, +timeout_sec || 30)), enabled ? 1 : 0);
  pushAudit(req, 'create', `إضافة مزود AI: ${name} (${ptype})`, 'ai_provider', info.lastInsertRowid);
  res.status(201).json(pub(AI.getProvider(info.lastInsertRowid)));
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
  res.json(db.prepare(`SELECT m.*, p.name pname, p.ptype FROM ai_models m JOIN ai_providers p ON p.id=m.provider_id ORDER BY m.is_default DESC, p.name, m.model_id`).all());
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
// تعيين الافتراضي — مشروط بفحص ناجح
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
    verdict, // CONNECTED | DEGRADED | FAILED | NOT_CONFIGURED
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

R.post('/assistant', auth, P('assistant', 'view'), aiLimiter, (req, res) => {
  (async () => {
    const message = String(req.body?.message || '').slice(0, 2000);
    if (!message.trim()) return res.status(400).json({ error: 'اكتب سؤالك أولًا' });
    const ctx = assistantContext(req.user);
    const { model, fallback } = AI.getDefaultModel();
    if (!model) return res.json({ reply: localFallback(message, ctx), mode: 'local', configured: false });
    const sys = `أنت مساعد ذكي داخل نظام Smart Secretary (إدارة عقارات ومبيعات). أجب بالعربية باختصار ووضوح.
المستخدم: ${ctx.user} (${ctx.role}) — التاريخ: ${ctx.date}.
الوحدات المصرح له بها: ${ctx.modules.join(', ') || 'لا شيء'} — لا تذكر أي بيانات عن وحدات غير مصرح بها.
ملخص الأرقام الحالية: ${JSON.stringify(ctx)}.
قواعد: قراءة وتحليل فقط — لا تدّع تنفيذ عمليات (حذف/تعديل/حجز). إن طُلب منك بيانات تفصيلية (أسماء/أرقام) وجّه المستخدم للصفحة المناسبة.`;
    try {
      const t0 = Date.now();
      const r = await AI.chat(model, model.model_id, [{ role: 'system', content: sys }, { role: 'user', content: message }], { maxTokens: 600, purpose: 'assistant' });
      AI.logUsage({ userId: req.user.id, providerId: model.provider_id, model: model.model_id, purpose: 'assistant', tokensIn: r.tokensIn, tokensOut: r.tokensOut, latency: Date.now() - t0, ok: 1 });
      res.json({ reply: r.text, mode: 'ai', model: model.model_id, fallback });
    } catch (e) {
      AI.logUsage({ userId: req.user.id, providerId: model.provider_id, model: model.model_id, purpose: 'assistant', ok: 0, error: e.cat?.ar || e.message });
      res.json({ reply: localFallback(message, ctx) + `\n(تعذر الاتصال بالنموذج: ${e.cat?.ar || 'خطأ'})`, mode: 'local', configured: true, ai_error: e.cat?.ar });
    }
  })();
});

// ---------- الملعب ----------
R.post('/playground', auth, P('ai', 'view'), aiLimiter, (req, res) => {
  (async () => {
    const msgs = Array.isArray(req.body?.messages) ? req.body.messages.slice(-20) : [];
    if (!msgs.length) return res.status(400).json({ error: 'لا توجد رسائل' });
    for (const m of msgs) {
      if (!['user', 'assistant', 'system'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 4000)
        return res.status(400).json({ error: 'رسالة غير صالحة' });
    }
    let model;
    const canManage = !!req.user.perms['ai:manage'];
    if (canManage && req.body?.model_id) {
      model = AI.getModel(req.body.model_id);
      if (!model || !model.enabled || !model.penabled) return res.status(400).json({ error: 'الموديل غير متاح' });
    } else {
      const d = AI.getDefaultModel();
      model = d.model;
      if (!model) return res.status(400).json({ error: 'لا يوجد موديل افتراضي مُعد — أضف مزودًا وموديلًا أولًا' });
    }
    const p = AI.getProvider(model.provider_id);
    try {
      const t0 = Date.now();
      const r = await AI.chat(p, model.model_id, msgs, { maxTokens: 1000, purpose: 'playground' });
      AI.logUsage({ userId: req.user.id, providerId: p.id, model: model.model_id, purpose: 'playground', tokensIn: r.tokensIn, tokensOut: r.tokensOut, latency: Date.now() - t0, ok: 1 });
      res.json({ reply: r.text, model: model.model_id, tokens: r.tokensIn + r.tokensOut, latency: Date.now() - t0 });
    } catch (e) {
      AI.logUsage({ userId: req.user.id, providerId: p.id, model: model.model_id, purpose: 'playground', ok: 0, error: e.cat?.ar || e.message });
      res.status(502).json({ error: 'فشل استدعاء النموذج: ' + (e.cat?.ar || 'خطأ'), code: e.cat?.code });
    }
  })();
});

// ---------- توليد تقرير بالذكاء (قراءة فقط — إحصاءات إجمالية) ----------
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
    const sys = `أنت محلل أعمال. اكتب تقريرًا إداريًا موجزًا بالعربية (عناوين + نقاط) بناءً على الأرقام التالية فقط — لا تخترع أرقامًا.
السياق: ${JSON.stringify({ ...ctx, monthly })}.
اختم بتوصيتين عمليتين. التقرير للقراءة فقط ولا ينفذ أي عملية.`;
    try {
      const t0 = Date.now();
      const r = await AI.chat(d.model, d.model.model_id, [{ role: 'system', content: sys }, { role: 'user', content: prompt }], { maxTokens: 1200, purpose: 'report' });
      AI.logUsage({ userId: req.user.id, providerId: d.model.provider_id, model: d.model.model_id, purpose: 'report', tokensIn: r.tokensIn, tokensOut: r.tokensOut, latency: Date.now() - t0, ok: 1 });
      res.json({ markdown: r.text, model: d.model.model_id });
    } catch (e) {
      AI.logUsage({ userId: req.user.id, providerId: d.model.provider_id, model: d.model.model_id, purpose: 'report', ok: 0, error: e.cat?.ar || e.message });
      res.status(502).json({ error: 'تعذر توليد التقرير: ' + (e.cat?.ar || 'خطأ') });
    }
  })();
});

module.exports = R;
