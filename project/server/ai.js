// Smart Secretary — طبقة مزودي الذكاء الاصطناعي (تجريد قابل للتوسعة + فحص + تشخيص + تبديل تلقائي)
// القواعد: المفاتيح مشفرة في الخادم فقط، لا تظهر في أي رد/سجل/خطأ. الأخطاء مصنفة ومقنّعة.
// إصدار 2.1 — إضافة إدارة مركزية + تبديل تلقائي + سجل واضح + دعم الجلسات المتعددة
const { db } = require('./db');
const { openSecret, maskKey } = require('./security');

const PROVIDER_TYPES = {
  openai:    { label: 'OpenAI',        base: 'https://api.openai.com/v1',                    key: true,  list: 'openai' },
  openrouter:{ label: 'OpenRouter',    base: 'https://openrouter.ai/api/v1',                 key: true,  list: 'openai' },
  anthropic: { label: 'Anthropic',     base: 'https://api.anthropic.com',                    key: true,  list: 'none' },
  gemini:    { label: 'Google Gemini', base: 'https://generativelanguage.googleapis.com',    key: true,  list: 'gemini' },
  ollama:    { label: 'Ollama (محلي)', base: 'http://127.0.0.1:11434',                       key: false, list: 'ollama' },
  custom:    { label: 'متوافق مخصص',   base: '',                                             key: true,  list: 'openai' },
};

function effBase(p) {
  const b = (p.base_url || PROVIDER_TYPES[p.ptype]?.base || '').replace(/\/+$/, '');
  return b;
}
function apiKeyOf(p) {
  try { return openSecret(p.api_key_enc || ''); } catch { return ''; }
}
// تعقيم أي نص من آثار المفاتيح قبل التخزين/الإرجاع
function scrub(s) {
  return String(s || '')
    .replace(/sk-\S{4,}/g, 'sk-••••')
    .replace(/Bearer \S+/gi, 'Bearer ••••')
    .replace(/xox[a-z]-[A-Za-z0-9-]+/g, 'xox-••••')
    .replace(/AIza[A-Za-z0-9_\-]{8,}/g, 'AIza••••')
    .replace(/key[=:]\\s*['\"]?[A-Za-z0-9_\-./+]{12,}['\"]?/gi, 'key=••••')
    .slice(0, 400);
}
function categorize(status, msg) {
  const m = String(msg || '').toLowerCase();
  if (status === 401 || status === 403 || m.includes('unauthorized') || m.includes('invalid api key') || m.includes('incorrect api key') || m.includes('authentication'))
    return { code: 'AUTH', ar: 'المفتاح مرفوض (401/403) — تحقق من المفتاح وصلاحياته' };
  if (status === 404 || m.includes('not found') || m.includes('no such model') || m.includes('does not exist'))
    return { code: 'NOT_FOUND', ar: 'الموديل أو العنوان غير موجود (404)' };
  if (status === 429 || m.includes('rate limit') || m.includes('quota') || m.includes('overloaded'))
    return { code: 'RATE_LIMIT', ar: 'تجاوز الحد/الحصة (429) — انتظر أو راجع الخطة' };
  if (status === 400 || m.includes('bad request') || m.includes('invalid_request'))
    return { code: 'BAD_REQUEST', ar: 'طلب غير صالح (400) — تحقق من اسم الموديل' };
  if (m.includes('abort') || m.includes('timeout') || m.includes('timed out') || m.includes('aborted'))
    return { code: 'TIMEOUT', ar: 'انتهت المهلة — الخادم بطيء أو الشبكة ضعيفة' };
  if (m.includes('fetch failed') || m.includes('econnrefused') || m.includes('enotfound') || m.includes('network') || status === 0)
    return { code: 'NETWORK', ar: 'تعذر الوصول للمزود — تحقق من الرابط والشبكة' };
  if (status >= 500) return { code: 'SERVER', ar: `خطأ من طرف المزود (${status})` };
  return { code: 'UNKNOWN', ar: scrub(msg) || 'خطأ غير مصنف' };
}

async function httpJson(url, { method = 'GET', headers = {}, body = null, timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text: text.slice(0, 1000), latency: Date.now() - t0 };
  } catch (e) {
    // تحويل أخطاء الـ fetch إلى رسالة واضحة لتجنب تجمد الواجهة
    if (e.name === 'AbortError' || /abort/i.test(e.message)) {
      const err = new Error('Timeout');
      err.cause = e;
      throw err;
    }
    throw e;
  } finally { clearTimeout(t); }
}

function toAnthropicMsgs(messages) {
  let system = '';
  const ms = [];
  for (const m of messages) {
    if (m.role === 'system') system += (system ? '\n' : '') + m.content;
    else ms.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  return { system, ms };
}
function toGeminiContents(messages) {
  return [{ parts: [{ text: messages.map(m => (m.role === 'system' ? '[تعليمات] ' : m.role === 'assistant' ? '[مساعد] ' : '[مستخدم] ') + m.content).join('\n\n') }] }];
}

// محادثة موحدة — تُرجع { text, tokensIn, tokensOut, latency }
async function chat(providerRow, modelId, messages, { maxTokens = 800, purpose = 'chat' } = {}) {
  const t = providerRow.ptype;
  const base = effBase(providerRow);
  const key = apiKeyOf(providerRow);
  const timeoutMs = Math.min(120, Math.max(5, providerRow.timeout_sec || 30)) * 1000;
  if (PROVIDER_TYPES[t]?.key && !key) throw Object.assign(new Error('لا يوجد مفتاح API لهذا المزود'), { cat: { code: 'NO_KEY', ar: 'لا يوجد مفتاح API — أدخل المفتاح أولًا' } });
  if (!base) throw Object.assign(new Error('لا يوجد رابط أساسي'), { cat: { code: 'NO_BASE', ar: 'لا يوجد رابط أساسي للمزود المخصص' } });

  let r;
  try {
    if (t === 'anthropic') {
      const { system, ms } = toAnthropicMsgs(messages);
      r = await httpJson(base + '/v1/messages', {
        method: 'POST', timeoutMs,
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: modelId, max_tokens: maxTokens, ...(system ? { system } : {}), messages: ms })
      });
      if (r.status < 200 || r.status >= 300) throw new Error(r.json?.error?.message || ('HTTP ' + r.status));
      const text = (r.json?.content || []).map(c => c.text || '').join('');
      return { text, tokensIn: r.json?.usage?.input_tokens || 0, tokensOut: r.json?.usage?.output_tokens || 0, latency: r.latency };
    }
    if (t === 'gemini') {
      r = await httpJson(`${base}/v1beta/models/${encodeURIComponent(modelId)}:generateContent`, {
        method: 'POST', timeoutMs,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: toGeminiContents(messages), generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 } })
      });
      if (r.status < 200 || r.status >= 300) throw new Error(r.json?.error?.message || ('HTTP ' + r.status));
      const text = (r.json?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
      return { text, tokensIn: r.json?.usageMetadata?.promptTokenCount || 0, tokensOut: r.json?.usageMetadata?.candidatesTokenCount || 0, latency: r.latency };
    }
    if (t === 'ollama') {
      r = await httpJson(base + '/api/chat', {
        method: 'POST', timeoutMs,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId, stream: false, messages: messages.map(m => ({ role: m.role, content: m.content })) })
      });
      if (r.status < 200 || r.status >= 300) throw new Error(r.json?.error || ('HTTP ' + r.status));
      return { text: r.json?.message?.content || '', tokensIn: r.json?.prompt_eval_count || 0, tokensOut: r.json?.eval_count || 0, latency: r.latency };
    }
    // openai / openrouter / custom (متوافق مع OpenAI)
    r = await httpJson(base + '/chat/completions', {
      method: 'POST', timeoutMs,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: modelId, messages, max_tokens: maxTokens, temperature: 0.3 })
    });
    if (r.status < 200 || r.status >= 300) throw new Error(r.json?.error?.message || ('HTTP ' + r.status));
    const ch = r.json?.choices?.[0]?.message?.content || '';
    return { text: ch, tokensIn: r.json?.usage?.prompt_tokens || 0, tokensOut: r.json?.usage?.completion_tokens || 0, latency: r.latency };
  } catch (e) {
    if (e.cat) throw e;
    const m = /HTTP (\d+)/.exec(e.message || '');
    const cat = categorize(m ? Number(m[1]) : 0, e.message);
    throw Object.assign(new Error(cat.ar), { cat, detail: scrub(e.message) });
  }
}

// مزامنة قائمة الموديلات من المزود + تحقق من الشكل
async function syncModels(providerRow) {
  const t = providerRow.ptype;
  const base = effBase(providerRow);
  const key = apiKeyOf(providerRow);
  const timeoutMs = 20000;
  const kind = PROVIDER_TYPES[t]?.list || 'openai';
  if (kind === 'none') return { synced: 0, models: [], note: 'هذا المزود لا يوفر API لسرد الموديلات — أضف الموديل يدويًا ثم افحصه' };
  if (PROVIDER_TYPES[t]?.key && !key) throw Object.assign(new Error('NO_KEY'), { cat: { code: 'NO_KEY', ar: 'لا يوجد مفتاح API' } });
  let ids = [];
  if (kind === 'ollama') {
    const r = await httpJson(base + '/api/tags', { timeoutMs });
    if (r.status !== 200) throw new Error('HTTP ' + r.status + ' ' + scrub(r.text));
    ids = (r.json?.models || []).map(m => m.name).filter(Boolean);
  } else if (kind === 'gemini') {
    const r = await httpJson(base + '/v1beta/models?pageSize=100', { timeoutMs, headers: { 'x-goog-api-key': key } });
    if (r.status !== 200) throw new Error('HTTP ' + r.status + ' ' + (r.json?.error?.message || ''));
    ids = (r.json?.models || []).map(m => String(m.name || '').replace(/^models\//, '')).filter(Boolean);
  } else {
    const r = await httpJson(base + '/models', { timeoutMs, headers: { Authorization: 'Bearer ' + key } });
    if (r.status !== 200) throw new Error('HTTP ' + r.status + ' ' + (r.json?.error?.message || ''));
    const data = r.json?.data;
    if (!Array.isArray(data)) throw new Error('استجابة غير متوقعة من المزود');
    ids = data.map(m => m.id).filter(Boolean);
  }
  ids = [...new Set(ids)].slice(0, 200);
  const up = db.prepare(`INSERT INTO ai_models (provider_id, model_id) VALUES (?,?)
    ON CONFLICT(provider_id, model_id) DO UPDATE SET last_check=datetime('now','localtime')`);
  ids.forEach(id => { try { up.run(providerRow.id, id); } catch {} });
  return { synced: ids.length, models: ids.slice(0, 50) };
}

// فحص موديل واحد وتحديث حالته
async function checkModel(providerRow, modelRow) {
  const t0 = Date.now();
  try {
    const r = await chat(providerRow, modelRow.model_id, [{ role: 'user', content: 'Reply with exactly: OK' }], { maxTokens: 10, purpose: 'health' });
    const ok = /ok/i.test(r.text || '');
    db.prepare(`UPDATE ai_models SET last_check=datetime('now','localtime'), last_status=?, last_latency_ms=?, last_error='' WHERE id=?`)
      .run(ok ? 'healthy' : 'degraded', Date.now() - t0, modelRow.id);
    return { ok, degraded: !ok, latency: Date.now() - t0, reply: (r.text || '').slice(0, 60) };
  } catch (e) {
    db.prepare(`UPDATE ai_models SET last_check=datetime('now','localtime'), last_status='failed', last_latency_ms=?, last_error=? WHERE id=?`)
      .run(Date.now() - t0, scrub(e.cat?.ar || e.message), modelRow.id);
    return { ok: false, error: e.cat?.ar || 'فشل الفحص', code: e.cat?.code || 'UNKNOWN' };
  }
}

function getProvider(id) { return db.prepare('SELECT * FROM ai_providers WHERE id=?').get(id); }
function getModel(id) {
  return db.prepare(`SELECT m.*, p.name pname, p.ptype, p.base_url, p.api_key_enc, p.enabled penabled, p.timeout_sec
    FROM ai_models m JOIN ai_providers p ON p.id=m.provider_id WHERE m.id=?`).get(id);
}

// ——— إدارة مركزية للنماذج ———
// قائمة مرتبة حسب الأولوية: الافتراضي أولًا، ثم السليم، ثم المتدهور، ثم غير المفحوص، ثم الفاشل آخرًا
function getOrderedModels() {
  try {
    return db.prepare(`
      SELECT m.*, p.name pname, p.ptype, p.base_url, p.api_key_enc, p.enabled penabled, p.timeout_sec
      FROM ai_models m JOIN ai_providers p ON p.id=m.provider_id
      WHERE m.enabled=1 AND p.enabled=1
      ORDER BY
        m.is_default DESC,
        CASE m.last_status WHEN 'healthy' THEN 0 WHEN 'degraded' THEN 1 WHEN 'unknown' THEN 2 WHEN 'failed' THEN 3 ELSE 4 END,
        COALESCE(m.last_latency_ms, 99999) ASC,
        m.id ASC
    `).all();
  } catch (e) {
    console.warn('[AI] getOrderedModels failed', e.message);
    return [];
  }
}

// الموديل الافتراضي + البديل التلقائي (محافظة على التوافق)
function getDefaultModel() {
  const ordered = getOrderedModels();
  if (!ordered.length) return { model: null, fallback: false };
  // حاول الافتراضي أولًا إن كان سليمًا أو غير مفحوص
  const def = ordered.find(m => m.is_default === 1 && m.last_status !== 'failed');
  if (def) return { model: def, fallback: false };
  // وإلا أول سليم
  const healthy = ordered.find(m => m.last_status === 'healthy');
  if (healthy) return { model: healthy, fallback: true };
  // ثم أي متاح (حتى لو غير مفحوص)
  return { model: ordered[0], fallback: true };
}

function setDefaultModel(modelId) {
  try {
    db.prepare('UPDATE ai_models SET is_default=0').run();
    db.prepare('UPDATE ai_models SET is_default=1, enabled=1 WHERE id=?').run(modelId);
    console.log(`[AI] setDefaultModel id=${modelId}`);
    return true;
  } catch (e) {
    console.error('[AI] setDefaultModel failed', e.message);
    return false;
  }
}

function logUsage({ userId, providerId, model, purpose, tokensIn = 0, tokensOut = 0, latency = 0, ok = 1, error = '' }) {
  try {
    db.prepare('INSERT INTO ai_usage (user_id, provider_id, model, purpose, tokens_in, tokens_out, latency_ms, ok, error) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(userId || null, providerId || null, model || '', purpose || '', tokensIn, tokensOut, latency, ok ? 1 : 0, scrub(error));
  } catch {}
}

// سجل مفصل للمحاولات (للتشخيص)
function logAttempt({ purpose, provider, model, attempt, latency, ok, error, code }) {
  const ts = new Date().toISOString();
  const status = ok ? '✓' : '✗';
  console.log(`[AI ${purpose}] ${status} attempt ${attempt}: ${provider}/${model} latency=${latency}ms ${ok ? '' : `error=${error||''} code=${code||''}` } @${ts}`);
}

// ——— التبديل التلقائي المركزي ———
// يحاول النماذج بالترتيب حتى ينجح أحدها، بدون تكرار لنفس الطلب بشكل مكرر (طلب واحد فقط لكل نموذج)
// يعيد { text, tokensIn, tokensOut, latency, model, provider, providerId, modelRow, attempts, fallback }
async function chatWithFallback(messages, { preferredModelId = null, maxTokens = 900, purpose = 'chat', userId = null } = {}) {
  const allOrdered = getOrderedModels();
  if (!allOrdered.length) {
    const err = new Error('لا يوجد أي نموذج متاح — أضف مزودًا وموديلًا أولًا');
    err.cat = { code: 'NO_MODELS', ar: 'لا يوجد أي نموذج متاح' };
    throw err;
  }

  // بناء قائمة المرشحين: المفضل أولًا ثم البقية مرتبة
  let candidates = [];
  let preferred = null;
  if (preferredModelId) {
    preferred = db.prepare(`SELECT m.*, p.name pname, p.ptype, p.base_url, p.api_key_enc, p.enabled penabled, p.timeout_sec
      FROM ai_models m JOIN ai_providers p ON p.id=m.provider_id WHERE m.id=? AND m.enabled=1 AND p.enabled=1`).get(preferredModelId);
    if (preferred) {
      candidates.push(preferred);
    } else {
      console.warn(`[AI Fallback] preferredModelId ${preferredModelId} not found or disabled — fallback to ordered list`);
    }
  }
  for (const m of allOrdered) {
    if (preferred && m.id === preferred.id) continue;
    candidates.push(m);
  }
  // إزالة التكرار (نفس المزود+الموديل)
  const seen = new Set();
  candidates = candidates.filter(c => {
    const k = `${c.provider_id}:${c.model_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // تحديد حد أقصى للمحاولات لتجنب إطالة زمن الاستجابة (حتى 4 نماذج كحد أقصى لكل طلب لتفادي تجاوز مهلة الواجهة)
  const MAX_ATTEMPTS = Math.min(4, candidates.length);
  candidates = candidates.slice(0, MAX_ATTEMPTS);

  console.log(`[AI Fallback] start purpose=${purpose} preferred=${preferred ? preferred.model_id : 'auto'} candidates=${candidates.map(c=>`${c.pname}/${c.model_id}`).join(' → ')}`);

  let lastError = null;
  let lastCat = null;
  const attempts = [];

  for (let i = 0; i < candidates.length; i++) {
    const mod = candidates[i];
    const provider = getProvider(mod.provider_id);
    if (!provider || !provider.enabled) {
      attempts.push({ model: mod.model_id, provider: mod.pname || '?', ok: false, error: 'المزود معطل', code: 'DISABLED', latency: 0 });
      continue;
    }
    const t0 = Date.now();
    try {
      const r = await chat(provider, mod.model_id, messages, { maxTokens, purpose });
      const latency = Date.now() - t0;
      // تحديث الحالة لناجح
      try { db.prepare(`UPDATE ai_models SET last_check=datetime('now','localtime'), last_status='healthy', last_latency_ms=?, last_error='' WHERE id=?`).run(latency, mod.id); } catch {}
      logUsage({ userId, providerId: provider.id, model: mod.model_id, purpose, tokensIn: r.tokensIn, tokensOut: r.tokensOut, latency, ok: 1 });
      logAttempt({ purpose, provider: mod.pname, model: mod.model_id, attempt: i+1, latency, ok: true });

      const isFallback = !!(preferred && mod.id !== preferred.id);
      // حفظ النموذج الناجح كافتراضي للمرة القادمة إذا كان تبديلًا تلقائيًا
      if (isFallback) {
        // احفظ كافتراضي فقط إذا كان المفضل فشل — حتى لا نكتب في كل رسالة
        setDefaultModel(mod.id);
      } else if (!preferred && i > 0) {
        // إذا لم يكن هناك مفضل وكان أول نموذج فشل، احفظ الناجح كافتراضي ضمنيًا
        setDefaultModel(mod.id);
      }

      return {
        text: r.text,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        latency,
        model: mod.model_id,
        provider: mod.pname,
        providerId: provider.id,
        modelRow: mod,
        attempts,
        fallback: isFallback,
        attemptIndex: i
      };
    } catch (e) {
      const latency = Date.now() - t0;
      const cat = e.cat || categorize(0, e.message);
      lastError = e;
      lastCat = cat;
      attempts.push({ model: mod.model_id, provider: mod.pname, ok: false, error: cat.ar, code: cat.code, latency, detail: scrub(e.message) });
      logAttempt({ purpose, provider: mod.pname, model: mod.model_id, attempt: i+1, latency, ok: false, error: cat.ar, code: cat.code });
      try { db.prepare(`UPDATE ai_models SET last_check=datetime('now','localtime'), last_status='failed', last_latency_ms=?, last_error=? WHERE id=?`).run(latency, scrub(cat.ar), mod.id); } catch {}
      logUsage({ userId, providerId: provider.id, model: mod.model_id, purpose, latency, ok: 0, error: cat.ar });

      // فاصل قصير قبل المحاولة التالية لتجنب الضغط على الشبكة (بدون تكرار نفس الطلب)
      if (i < candidates.length - 1) {
        await new Promise(r => setTimeout(r, 180));
      }
      continue;
    }
  }

  // فشل جميع المحاولات
  const err = new Error(lastCat ? lastCat.ar : 'فشل جميع النماذج المتاحة — تحقق من المفاتيح والشبكة');
  err.cat = lastCat || { code: 'ALL_FAILED', ar: 'فشل جميع النماذج' };
  err.attempts = attempts;
  err.detail = lastError ? scrub(lastError.message) : '';
  console.error(`[AI Fallback] all ${candidates.length} attempts failed purpose=${purpose}`, attempts);
  throw err;
}

module.exports = { PROVIDER_TYPES, effBase, apiKeyOf, maskKey, scrub, categorize, chat, chatWithFallback, syncModels, checkModel, getProvider, getModel, getDefaultModel, getOrderedModels, setDefaultModel, logUsage, logAttempt };
