import React, { useEffect, useState, useMemo, useRef } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtDT } from '../lib/format.js';
import { I, Btn, Badge, Empty, Field, Modal, Confirm, Pagination } from '../components/ui.jsx';

const PT = { openai: 'OpenAI', openrouter: 'OpenRouter', anthropic: 'Anthropic', gemini: 'Google Gemini', ollama: 'Ollama (محلي)', custom: 'متوافق مخصص' };
const VINFO = {
  CONNECTED: ['متصل — الذكاء الاصطناعي يعمل', 'b-green'],
  DEGRADED: ['متصل جزئيًا — راجع الموديلات', 'b-amber'],
  FAILED: ['فشل الاتصال — راجع التشخيص', 'b-red'],
  NOT_CONFIGURED: ['غير مُعد — أضف مزودًا ومفتاحًا', 'b-gray']
};
const ST = { healthy: ['سليم', 'b-green'], failed: ['فاشل', 'b-red'], degraded: ['متدهور', 'b-amber'], unknown: ['غير مفحوص', 'b-gray'] };

export default function AISettings() {
  const { can, toast } = useStore();
  const mgmt = can('ai', 'manage');
  const [st, setSt] = useState(null);
  const [providers, setProviders] = useState([]);
  const [models, setModels] = useState([]);
  const [usage, setUsage] = useState({ data: [], total: 0, page: 1, pages: 1 });
  const [diag, setDiag] = useState(null);
  const [sub, setSub] = useState('providers');
  const [editP, setEditP] = useState(null);
  const [delP, setDelP] = useState(null);
  const [addM, setAddM] = useState(false);
  const [mForm, setMForm] = useState({});
  const [editM, setEditM] = useState(null);
  const [busy, setBusy] = useState('');
  const [testRes, setTestRes] = useState(null);

  // ——— فلترة النماذج (تعمل مباشرة بدون إعادة تحميل) ———
  const [filterQ, setFilterQ] = useState('');
  const [filterProvider, setFilterProvider] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterEnabled, setFilterEnabled] = useState('');
  const [filterCap, setFilterCap] = useState('');

  // ——— فلترة المزودين (بحث مباشر وتحديد سريع) ———
  const [filterPQ, setFilterPQ] = useState('');
  const [filterPType, setFilterPType] = useState('');
  const [filterPEnabled, setFilterPEnabled] = useState('');

  const load = async () => {
    try { setSt(await api('/ai/status')); } catch {}
    try { setProviders(await api('/ai/providers')); } catch {}
    try { setModels(await api('/ai/models')); } catch {}
    try { setUsage(await api('/ai/usage?limit=15')); } catch {}
    if (mgmt) { try { setDiag(await api('/ai/diagnostics')); } catch {} }
  };
  useEffect(() => { load(); }, []);

  const saveProvider = async () => {
    if (!editP.name?.trim()) { toast('اسم المزود مطلوب', 'error'); return; }
    try {
      if (editP.id) {
        const updated = await api('/ai/providers/' + editP.id, { method: 'PUT', body: editP });
        setProviders(prev => prev.map(p => p.id === updated.id ? updated : p));
      } else {
        const created = await api('/ai/providers', { method: 'POST', body: editP });
        setProviders(prev => [...prev, created]);
      }
      toast('تم حفظ المزود بنجاح'); setEditP(null); await load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const test = async (p) => {
    setBusy('test' + p.id); setTestRes(null);
    try { const r = await api(`/ai/providers/${p.id}/test`, { method: 'POST', timeout: 60000 }); setTestRes({ p: p.name, ...r }); toast(r.ok ? 'الاتصال ناجح' : ('فشل: ' + (r.error || '')), r.ok ? 'success' : 'error'); }
    catch (e) { setTestRes({ p: p.name, ok: false, error: e.message }); toast(e.message, 'error'); }
    setBusy(''); load();
  };
  const sync = async (p) => {
    setBusy('sync' + p.id);
    try { const r = await api(`/ai/providers/${p.id}/sync-models`, { method: 'POST', timeout: 60000 }); toast(r.ok ? `تمت مزامنة ${r.synced} موديل` : ('فشل: ' + r.error), r.ok ? 'success' : 'error'); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(''); load();
  };
  const check = async (m) => {
    setBusy('chk' + m.id);
    try { const r = await api(`/ai/models/${m.id}/check`, { method: 'POST', timeout: 90000 }); toast(r.ok ? 'الموديل سليم' : ('فشل: ' + r.error), r.ok ? 'success' : 'error'); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(''); load();
  };
  const checkAll = async () => {
    setBusy('all');
    try { const r = await api('/ai/models/check-all', { method: 'POST', timeout: 180000 }); toast(`سليم: ${r.healthy} / ${r.total}`); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(''); load();
  };
  const setDefP = async (p) => { try { await api(`/ai/providers/${p.id}/default`, { method: 'POST' }); toast('تم تعيين المزود الافتراضي'); load(); } catch (e) { toast(e.message, 'error'); } };
  const setDefM = async (m) => { try { await api(`/ai/models/${m.id}/default`, { method: 'POST' }); toast('تم اعتماد الموديل الافتراضي'); load(); } catch (e) { toast(e.message, 'error'); } };
  const toggleM = async (m) => { try { await api('/ai/models/' + m.id, { method: 'PUT', body: { enabled: !m.enabled } }); load(); } catch (e) { toast(e.message, 'error'); } };
  const saveModel = async () => {
    try {
      if (addM) {
        const pid = mForm.provider_id || providers[0]?.id;
        if (!pid) { toast('يرجى اختيار المزود أولاً', 'error'); return; }
        if (!mForm.model_id?.trim()) { toast('اسم الموديل مطلوب', 'error'); return; }
        await api('/ai/models', { method: 'POST', body: { ...mForm, provider_id: +pid } });
        toast('تمت إضافة الموديل بنجاح'); setAddM(false); setMForm({});
      }
      else { await api('/ai/models/' + editM.id, { method: 'PUT', body: { alias: editM.alias, capabilities: editM.capabilities } }); toast('تم الحفظ'); setEditM(null); }
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  // فلترة المزودين
  const filteredProviders = useMemo(() => {
    return providers.filter(p => {
      if (filterPType && p.ptype !== filterPType) return false;
      if (filterPEnabled !== '') {
        const en = filterPEnabled === '1';
        if (!!p.enabled !== en) return false;
      }
      if (filterPQ) {
        const q = filterPQ.toLowerCase();
        const hay = `${p.name} ${p.code || ''} ${p.base_url || ''} ${PT[p.ptype] || p.ptype}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [providers, filterPQ, filterPType, filterPEnabled]);

  const hasActivePFilter = !!(filterPQ || filterPType || filterPEnabled !== '');

  // فلترة مباشرة — بدون إعادة تحميل
  const filteredModels = useMemo(() => {
    return models.filter(m => {
      if (filterProvider && String(m.provider_id) !== String(filterProvider)) return false;
      if (filterStatus && String(m.last_status) !== String(filterStatus)) return false;
      if (filterEnabled !== '') {
        const en = filterEnabled === '1';
        if (!!m.enabled !== en) return false;
      }
      if (filterQ) {
        const q = filterQ.toLowerCase();
        const hay = `${m.model_id} ${m.alias || ''} ${m.pname || ''} ${PT[m.ptype] || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterCap) {
        const c = filterCap.toLowerCase();
        const cap = `${m.capabilities || ''} ${m.model_id}`.toLowerCase();
        // نوع النموذج أو قدراته — إن كانت البيانات متوفرة وإلا يطابق اسم الموديل
        if (!cap.includes(c)) return false;
      }
      return true;
    });
  }, [models, filterQ, filterProvider, filterStatus, filterEnabled, filterCap]);

  const hasActiveFilter = !!(filterQ || filterProvider || filterStatus || filterEnabled !== '' || filterCap);

  const v = st ? VINFO[st.verdict] : null;
  return (
    <div className="space-y-4">
      {/* الشريط العلوي */}
      <div className="card p-4 flex items-center gap-3 flex-wrap anim-in">
        {v && <Badge c={v[1]}>{v[0]}</Badge>}
        {st && <>
          <span className="text-[12.5px]" style={{ color: 'var(--ink2)' }}>المزودون: <b className="num">{st.providers_enabled}</b> — الموديلات: <b className="num">{st.models.total}</b> (سليم <b className="num" style={{ color: 'var(--ok)' }}>{st.models.healthy}</b> / فاشل <b className="num" style={{ color: 'var(--danger)' }}>{st.models.failed}</b>)</span>
          <span className="text-[12.5px]" style={{ color: 'var(--ink2)' }}>الافتراضي: <b>{st.def ? `${st.def.model} (${st.def.provider})${st.def.fallback ? ' — بديل تلقائي' : ''}` : '—'}</b></span>
          <span className="text-[12.5px] num" style={{ color: 'var(--ink2)' }}>استهلاك اليوم: {st.usage_today.calls} استدعاء / {st.usage_today.tokens} رمز</span>
        </>}
        <span className="mr-auto" />
        <Btn v="g" size="sm" onClick={load}><I n="refresh" s={14} /> تحديث</Btn>
        {mgmt && <Btn size="sm" onClick={checkAll} disabled={busy === 'all'}><I n="play" s={14} /> {busy === 'all' ? 'جارٍ الفحص...' : 'فحص كل الموديلات'}</Btn>}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {[['providers', 'المزودون'], ['models', 'الموديلات'], ['play', 'الملعب'], ['usage', 'الاستهلاك'], ...(mgmt ? [['diag', 'التشخيص']] : [])].map(([k, t]) => (
          <button key={k} className={`tab-it ${sub === k ? 'on' : ''}`} style={sub !== k ? { background: 'var(--card)', border: '1px solid var(--line)' } : {}} onClick={() => setSub(k)}>{t}</button>
        ))}
      </div>

      {/* المزودون */}
      {sub === 'providers' && (
        <div className="card p-4 anim-in">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <b className="text-[15px]">مزودو الذكاء الاصطناعي ({filteredProviders.length}{hasActivePFilter ? ` / ${providers.length}` : ''})</b>
            {mgmt && <Btn size="sm" onClick={() => setEditP({ ptype: 'openai', timeout_sec: 30, enabled: 1 })}><I n="plus" s={14} /> مزود جديد</Btn>}
          </div>

          {/* شريط بحث وفلترة المزودين */}
          <div className="rounded-xl p-3 mb-3 flex gap-2 flex-wrap items-end" style={{ background: 'var(--card2)', border: '1px solid var(--line)' }}>
            <div className="flex-1 min-w-[200px]">
              <Field label="بحث في المزودين"><input className="inp" placeholder="ابحث باسم المزود أو كوده (SUPPLIER-0001)..." value={filterPQ} onChange={e => setFilterPQ(e.target.value)} /></Field>
            </div>
            <div className="min-w-[160px]">
              <Field label="نوع المزود">
                <select className="inp" value={filterPType} onChange={e => setFilterPType(e.target.value)}>
                  <option value="">كل الأنواع</option>
                  {Object.entries(PT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
            </div>
            <div className="min-w-[130px]">
              <Field label="الحالة">
                <select className="inp" value={filterPEnabled} onChange={e => setFilterPEnabled(e.target.value)}>
                  <option value="">الكل</option>
                  <option value="1">مفعل</option>
                  <option value="0">معطل</option>
                </select>
              </Field>
            </div>
            {hasActivePFilter && <Btn v="g" size="sm" onClick={() => { setFilterPQ(''); setFilterPType(''); setFilterPEnabled(''); }}><I n="x" s={14} /> مسح الفلترة</Btn>}
          </div>

          {providers.length === 0 && <Empty icon="bot" title="لا يوجد مزودون" sub="أضف مزودًا (OpenAI / Anthropic / Gemini / Ollama...) ثم أدخل مفتاح API" />}
          {providers.length > 0 && filteredProviders.length === 0 && <Empty icon="filter" title="لا توجد نتائج" sub="جرّب تغيير عبارة البحث أو امسح الفلترة" />}

          {testRes && (
            <div className="rounded-xl p-3 mb-3 text-[13px]" style={{ background: testRes.ok ? 'rgba(22,163,74,.08)' : 'rgba(220,38,38,.08)' }}>
              <b>نتيجة اختبار {testRes.p}:</b> {testRes.ok ? `ناجح — الموديل ${testRes.model || ''} (${testRes.latency || '?'}ms) — زُامن ${testRes.synced || 0} موديل` : `${testRes.error || ''}${testRes.code ? ` [${testRes.code}]` : ''}`}
              {testRes.note && <div style={{ color: 'var(--ink2)' }}>{testRes.note}</div>}
              {testRes.detail && <div className="num text-[11.5px] mt-1" style={{ color: 'var(--ink3)' }} dir="ltr">{testRes.detail}</div>}
            </div>
          )}
          <div className="space-y-2.5">
            {filteredProviders.map(p => (
              <div key={p.id} className="rounded-xl p-3.5" style={{ background: 'var(--card2)' }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <b className="text-[14px]">{p.name}</b>
                  {p.code && <Badge c="b-purple">{p.code}</Badge>}
                  <span className="text-[11px] num font-medium px-1.5 py-0.5 rounded" style={{ background: 'var(--bg2)', color: 'var(--ink2)' }} dir="ltr">ID: {p.id}</span>
                  <Badge c="b-blue">{PT[p.ptype]}</Badge>
                  {p.is_default && <Badge c="b-purple">افتراضي</Badge>}
                  {!p.enabled && <Badge c="b-gray">معطل</Badge>}
                  {!p.has_key && <Badge c="b-amber">بدون مفتاح</Badge>}
                </div>
                <div className="text-[12px] num mt-1.5" style={{ color: 'var(--ink2)' }} dir="ltr">{p.base_url}</div>
                <div className="text-[12px] num mt-0.5" style={{ color: 'var(--ink3)' }}>المفتاح: <span dir="ltr">{p.key_masked || '—'}</span> (مشفر في الخادم — لا يظهر أبدًا)</div>
                {mgmt && <div className="flex gap-1.5 mt-2.5 flex-wrap">
                  <Btn v="p" size="xs" onClick={() => test(p)} disabled={busy === 'test' + p.id}><I n="play" s={13} /> {busy === 'test' + p.id ? 'جارٍ الاختبار...' : 'اختبار الاتصال'}</Btn>
                  <Btn v="g" size="xs" onClick={() => sync(p)} disabled={busy === 'sync' + p.id}><I n="refresh" s={13} /> مزامنة الموديلات</Btn>
                  <Btn v="g" size="xs" onClick={() => { setAddM(true); setMForm({ provider_id: p.id, model_id: '' }); }}><I n="plus" s={13} /> ربط موديل</Btn>
                  {!p.is_default && <Btn v="g" size="xs" onClick={() => setDefP(p)}>تعيين افتراضي</Btn>}
                  <Btn v="g" size="xs" onClick={() => setEditP({ ...p, api_key: '' })}><I n="edit" s={13} /> تعديل</Btn>
                  <Btn v="d" size="xs" onClick={() => setDelP(p)}><I n="trash" s={13} /></Btn>
                </div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* الموديلات — مع فلترة مباشرة */}
      {sub === 'models' && (
        <div className="card p-4 anim-in">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <b className="text-[15px]">الموديلات ({filteredModels.length}{hasActiveFilter ? ` / ${models.length}` : ''})</b>
            {mgmt && providers.length > 0 && <Btn size="sm" onClick={() => { setAddM(true); setMForm({ provider_id: providers[0].id }); }}><I n="plus" s={14} /> إضافة يدوية</Btn>}
          </div>

          {/* شريط الفلترة — يعمل مباشرة بدون إعادة تحميل */}
          <div className="rounded-xl p-3 mb-3 flex gap-2 flex-wrap items-end" style={{ background: 'var(--card2)', border: '1px solid var(--line)' }}>
            <div className="flex-1 min-w-[180px]">
              <Field label="بحث بالاسم"><input className="inp" placeholder="ابحث: gpt-4o, claude..." value={filterQ} onChange={e => setFilterQ(e.target.value)} /></Field>
            </div>
            <div className="min-w-[160px]">
              <Field label="الشركة / المزود">
                <select className="inp" value={filterProvider} onChange={e => setFilterProvider(e.target.value)}>
                  <option value="">الكل</option>
                  {providers.map(p => <option key={p.id} value={p.id}>{p.name} — {PT[p.ptype]}</option>)}
                </select>
              </Field>
            </div>
            <div className="min-w-[140px]">
              <Field label="الحالة">
                <select className="inp" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  <option value="">الكل</option>
                  <option value="healthy">سليم</option>
                  <option value="failed">فاشل</option>
                  <option value="degraded">متدهور</option>
                  <option value="unknown">غير مفحوص</option>
                </select>
              </Field>
            </div>
            <div className="min-w-[130px]">
              <Field label="التفعيل">
                <select className="inp" value={filterEnabled} onChange={e => setFilterEnabled(e.target.value)}>
                  <option value="">الكل</option>
                  <option value="1">مفعل</option>
                  <option value="0">معطل</option>
                </select>
              </Field>
            </div>
            <div className="min-w-[150px]">
              <Field label="النوع / القدرات"><input className="inp" placeholder="مثال: vision, chat" value={filterCap} onChange={e => setFilterCap(e.target.value)} /></Field>
            </div>
            {hasActiveFilter && <Btn v="g" size="sm" onClick={() => { setFilterQ(''); setFilterProvider(''); setFilterStatus(''); setFilterEnabled(''); setFilterCap(''); }}><I n="x" s={14} /> مسح الفلترة</Btn>}
            <span className="text-[12px] mr-auto" style={{ color: 'var(--ink3)' }}>{hasActiveFilter ? `يعرض ${filteredModels.length} من ${models.length}` : `${models.length} موديل`}</span>
          </div>

          {models.length === 0 && <Empty icon="spark" title="لا توجد موديلات" sub="زامن الموديلات من المزود أو أضف موديلًا يدويًا (ضروري لـ Anthropic)" />}
          {models.length > 0 && filteredModels.length === 0 && <Empty icon="filter" title="لا نتائج للفلترة" sub="جرّب تغيير معايير البحث أو امسح الفلترة" action={<Btn v="g" size="sm" onClick={() => { setFilterQ(''); setFilterProvider(''); setFilterStatus(''); setFilterEnabled(''); setFilterCap(''); }}>مسح الفلترة</Btn>} />}
          {filteredModels.length > 0 && (
            <div className="overflow-x-auto"><table className="tbl min-w-[860px]">
              <thead><tr><th>الموديل</th><th>الاسم المستعار</th><th>المزود</th><th>الحالة</th><th>القدرات</th><th>آخر فحص</th><th>مفعل</th><th></th></tr></thead>
              <tbody>
                {filteredModels.map(m => (
                  <tr key={m.id}>
                    <td><b className="num text-[12.5px]" dir="ltr">{m.model_id}</b> {m.is_default && <Badge c="b-purple">افتراضي</Badge>}</td>
                    <td className="text-[12.5px]">{m.alias || '—'}</td>
                    <td className="text-[12.5px]"><span className="font-semibold">{m.pname}</span><span className="text-[11px] mr-1" style={{ color: 'var(--ink3)' }}>{PT[m.ptype] || m.ptype}</span></td>
                    <td><Badge c={(ST[m.last_status] || ST.unknown)[1]}>{(ST[m.last_status] || ST.unknown)[0]}</Badge>{m.last_latency_ms ? <span className="text-[11px] num" style={{ color: 'var(--ink3)' }}> {m.last_latency_ms}ms</span> : ''}{m.last_error && <div className="text-[11px] mt-0.5" style={{ color: 'var(--danger)' }}>{m.last_error}</div>}</td>
                    <td className="text-[11.5px]" dir="ltr">{m.capabilities || '—'}</td>
                    <td className="num text-[12px]">{m.last_check ? fmtDT(m.last_check) : '—'}</td>
                    <td>{mgmt ? <input type="checkbox" className="w-[17px] h-[17px] accent-blue-600 cursor-pointer" checked={!!m.enabled} onChange={() => toggleM(m)} /> : (m.enabled ? 'نعم' : 'لا')}</td>
                    <td>{mgmt && <div className="flex gap-1">
                      <Btn v="p" size="xs" onClick={() => check(m)} disabled={busy === 'chk' + m.id}>{busy === 'chk' + m.id ? '...' : 'فحص'}</Btn>
                      {!m.is_default && <Btn v="g" size="xs" onClick={() => setDefM(m)} title="يتطلب فحصًا ناجحًا">اعتماد</Btn>}
                      <button className="icon-btn !w-7 !h-7" onClick={() => setEditM(m)}><I n="edit" s={14} /></button>
                      <button className="icon-btn !w-7 !h-7" onClick={async () => { try { await api('/ai/models/' + m.id, { method: 'DELETE' }); toast('تم الحذف'); load(); } catch (e) { toast(e.message, 'error'); } }}><I n="trash" s={14} /></button>
                    </div>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {sub === 'play' && <Playground models={models} mgmt={mgmt} providers={providers} />}
      {sub === 'usage' && (
        <div className="card p-4 anim-in">
          <b className="text-[15px]">سجل الاستهلاك</b>
          <div className="overflow-x-auto mt-2"><table className="tbl min-w-[680px]">
            <thead><tr><th>التاريخ</th><th>المستخدم</th><th>الموديل</th><th>الغرض</th><th>الرموز</th><th>الزمن</th><th>النتيجة</th></tr></thead>
            <tbody>
              {usage.data.map(u => (
                <tr key={u.id}>
                  <td className="num text-[12px]">{fmtDT(u.created_at)}</td>
                  <td className="text-[12.5px]">{u.uname || '—'}</td>
                  <td className="num text-[12px]" dir="ltr">{u.model}</td>
                  <td><Badge c="b-gray">{u.purpose}</Badge></td>
                  <td className="num">{u.tokens_in + u.tokens_out}</td>
                  <td className="num">{u.latency_ms}ms</td>
                  <td>{u.ok ? <Badge c="b-green">ناجح</Badge> : <span title={u.error}><Badge c="b-red">فاشل</Badge></span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <Pagination page={usage.page} pages={usage.pages} total={usage.total} onGo={(pg) => api(`/ai/usage?page=${pg}&limit=15`).then(setUsage).catch(() => {})} />
        </div>
      )}
      {sub === 'diag' && diag && (
        <div className="card p-4 anim-in space-y-2.5">
          <b className="text-[15px]">التشخيص التقني</b>
          <div className="rounded-xl p-3 text-[13px] num" style={{ background: 'var(--card2)' }} dir="ltr">node {diag.node} — fetch {diag.fetch ? 'OK' : 'MISSING'} — {diag.time}</div>
          {diag.providers.map(p => (
            <div key={p.id} className="rounded-xl p-3 text-[12.5px]" style={{ background: 'var(--card2)' }}>
              <b>{p.name}</b> <span style={{ color: 'var(--ink3)' }}>({PT[p.ptype]})</span>
              <div className="num mt-1" dir="ltr" style={{ color: 'var(--ink2)' }}>{p.base}</div>
              <div className="mt-1">مفتاح: <b>{p.has_key ? 'موجود (مشفر)' : 'غير موجود'}</b> — موديلات: <b className="num">{p.models}</b> — سليمة: <b className="num">{p.healthy}</b> — مهلة: <b className="num">{p.timeout_sec}s</b></div>
              {p.last_error && <div className="mt-1" style={{ color: 'var(--danger)' }}>آخر خطأ: {p.last_error}</div>}
            </div>
          ))}
        </div>
      )}

      {/* مودال مزود */}
      <Modal open={!!editP} onClose={() => setEditP(null)} title={editP?.id ? 'تعديل المزود' : 'مزود جديد'} w={560}
        actions={<><Btn onClick={saveProvider}>حفظ</Btn><Btn v="g" onClick={() => setEditP(null)}>إلغاء</Btn></>}>
        {editP && <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="الاسم *"><input className="inp" value={editP.name || ''} onChange={e => setEditP({ ...editP, name: e.target.value })} placeholder="OpenAI الرئيسي" /></Field>
            <Field label="النوع *"><select className="inp" value={editP.ptype} disabled={!!editP.id} onChange={e => setEditP({ ...editP, ptype: e.target.value })}>{Object.entries(PT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </div>
          <Field label="الرابط الأساسي (فارغ = الافتراضي)" hint={editP.ptype === 'ollama' ? 'مثال: http://127.0.0.1:11434' : editP.ptype === 'custom' ? 'مطلوب — يجب أن يكون متوافقًا مع OpenAI' : 'اتركه فارغًا للرابط الرسمي'}><input className="inp num" dir="ltr" value={editP.base_url || ''} onChange={e => setEditP({ ...editP, base_url: e.target.value })} placeholder="https://..." /></Field>
          <Field label={editP.id ? 'مفتاح API (اتركه فارغًا للإبقاء على الحالي)' : 'مفتاح API *'} hint="يُشفر بتقنية AES-256 ويُحفظ في الخادم فقط — لا يظهر لأي مستخدم أبدًا"><input type="password" className="inp num" dir="ltr" autoComplete="new-password" value={editP.api_key || ''} onChange={e => setEditP({ ...editP, api_key: e.target.value })} placeholder={editP.ptype === 'ollama' ? 'غير مطلوب للمحلي' : 'sk-...'} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="المهلة (ثانية)"><input type="number" min={5} max={120} className="inp num" value={editP.timeout_sec ?? 30} onChange={e => setEditP({ ...editP, timeout_sec: +e.target.value })} /></Field>
            <Field label="الحالة"><select className="inp" value={editP.enabled ? 1 : 0} onChange={e => setEditP({ ...editP, enabled: +e.target.value })}><option value={1}>مفعل</option><option value={0}>معطل</option></select></Field>
          </div>
        </div>}
      </Modal>
      <Confirm open={!!delP} onClose={() => setDelP(null)} title="حذف المزود" msg={`سيتم حذف "${delP?.name}" وكل موديلاته`} okText="حذف"
        onOk={async () => { try { await api('/ai/providers/' + delP.id, { method: 'DELETE' }); toast('تم الحذف'); setDelP(null); load(); } catch (e) { toast(e.message, 'error'); } }} />

      {/* مودال موديل */}
      <Modal open={addM} onClose={() => setAddM(false)} title="إضافة موديل يدويًا" w={480}
        actions={<><Btn onClick={saveModel}>إضافة</Btn><Btn v="g" onClick={() => setAddM(false)}>إلغاء</Btn></>}>
        <div className="space-y-3">
          <Field label="المزود"><select className="inp" value={mForm.provider_id || (providers[0]?.id || '')} onChange={e => setMForm({ ...mForm, provider_id: +e.target.value })}>{providers.map(p => <option key={p.id} value={p.id}>{p.name} {p.code ? `(${p.code})` : `(ID: ${p.id})`}</option>)}</select></Field>
          <Field label="اسم الموديل *" hint="مثال: gpt-4o-mini أو claude-sonnet-4-5 أو llama3.1"><input className="inp num" dir="ltr" value={mForm.model_id || ''} onChange={e => setMForm({ ...mForm, model_id: e.target.value })} /></Field>
          <Field label="اسم مستعار"><input className="inp" value={mForm.alias || ''} onChange={e => setMForm({ ...mForm, alias: e.target.value })} /></Field>
          <Field label="القدرات (اختياري)" hint="مثال: chat, vision, reasoning"><input className="inp" value={mForm.capabilities || ''} onChange={e => setMForm({ ...mForm, capabilities: e.target.value })} placeholder="chat, vision..." /></Field>
        </div>
      </Modal>
      <Modal open={!!editM} onClose={() => setEditM(null)} title="تعديل الموديل" w={480}
        actions={<><Btn onClick={saveModel}>حفظ</Btn><Btn v="g" onClick={() => setEditM(null)}>إلغاء</Btn></>}>
        {editM && <div className="space-y-3">
          <Field label="الاسم المستعار"><input className="inp" value={editM.alias || ''} onChange={e => setEditM({ ...editM, alias: e.target.value })} /></Field>
          <Field label="القدرات"><input className="inp" value={editM.capabilities || ''} onChange={e => setEditM({ ...editM, capabilities: e.target.value })} placeholder="chat, vision..." /></Field>
        </div>}
      </Modal>
    </div>
  );
}

function Playground({ models, mgmt, providers }) {
  const { toast } = useStore();
  const [mid, setMid] = useState('');
  const [text, setText] = useState('');
  const [msgs, setMsgs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [lastMeta, setLastMeta] = useState('');
  const boxRef = useRef();
  const msgsRef = useRef(msgs);
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);
  useEffect(() => { boxRef.current?.scrollTo(0, 99999); }, [msgs, busy]);

  const en = models.filter(m => m.enabled);
  // إصلاح إرسال عدة رسائل متتالية + التبديل التلقائي + عدم تكرار الطلب
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    // منع الإرسال المكرر لنفس النص المتتالي مباشرة
    const lastUser = msgs[msgs.length - 1];
    if (lastUser && lastUser.role === 'user' && lastUser.content === t) {
      // نسمح لكن ننبه — لا نمنع المستخدم إذا أراد التكرار عمدًا بعد فترة، فقط نتجنب الضغط المزدوج السريع
    }
    const history = [...msgs, { role: 'user', content: t }];
    setMsgs(history);
    setText('');
    setBusy(true);
    setLastMeta('جاري الإرسال...');
    try {
      // إرسال السجل كاملاً (يدعم الجلسة لعدة رسائل بدون تجمد)
      const payload = { messages: history.slice(-12).map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) })) };
      if (mgmt && mid) payload.model_id = +mid;
      const r = await api('/ai/playground', { method: 'POST', timeout: 120000, body: payload });
      let meta = `${r.model || ''}${r.provider ? ` (${r.provider})` : ''} — ${r.tokens || 0} رمز — ${r.latency || 0}ms`;
      if (r.fallback) meta = 'بديل تلقائي — ' + meta;
      setMsgs([...history, { role: 'assistant', content: r.reply, meta, fallback: r.fallback }]);
      setLastMeta(r.fallback ? `تم التبديل تلقائيًا إلى ${r.model}` : `تم الرد: ${r.model}`);
      // حفظ النموذج الناجح كافتراضي للمرة القادمة عند التبديل يتم في الخادم تلقائيًا
    } catch (e) {
      // رسالة خطأ واضحة بدل تجمد الواجهة + عدم إعادة الإرسال تلقائيًا
      const isTimeout = /مهلة|timeout/i.test(e.message);
      const detail = e.detail ? ` — ${e.detail}` : '';
      const attemptsInfo = e.attempts ? ` (جرّب ${e.attempts.length} نماذج)` : '';
      const msg = `⚠️ فشل: ${e.message}${detail}${attemptsInfo}${isTimeout ? ' — انتهت المهلة' : ''}`;
      toast(e.message, 'error');
      setMsgs([...history, { role: 'assistant', content: msg + '\n\nسيتم حفظ النموذج البديل تلقائيًا عند نجاحه في المرة القادمة. حاول مجددًا أو اختر موديلًا آخر.', isError: true }]);
      setLastMeta('فشل — حاول مجددًا');
    } finally {
      // التأكد من إلغاء حالة الانشغال حتى بعد مهلة/خطأ — لا يتوقف بعد أول رسالة
      setBusy(false);
      setTimeout(() => setLastMeta(''), 3500);
    }
  };

  const clearChat = () => { setMsgs([]); setLastMeta(''); toast('تم مسح المحادثة'); };

  return (
    <div className="card p-4 anim-in">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <b className="text-[15px]">ملعب التجربة</b>
        <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--card2)', color: 'var(--ink3)', border: '1px solid var(--line)' }}>يدعم الجلسة — عدة رسائل متتالية</span>
        {mgmt && en.length > 0 && <select className="inp" style={{ width: 260 }} value={mid} onChange={e => setMid(e.target.value)}><option value="">الموديل الافتراضي (تبديل تلقائي)</option>{en.map(m => <option key={m.id} value={m.id}>{m.model_id} ({m.pname}) — {(ST[m.last_status]||ST.unknown)[0]}</option>)}</select>}
        {!mgmt && <span className="text-[12px]" style={{ color: 'var(--ink3)' }}>يستخدم الموديل الافتراضي المعتمد — التبديل تلقائي عند الفشل</span>}
        <span className="mr-auto" />
        {msgs.length > 0 && <Btn v="g" size="xs" onClick={clearChat}><I n="trash" s={12} /> مسح</Btn>}
      </div>
      {lastMeta && <div className="text-[12px] mb-2 px-2 py-1 rounded-lg" style={{ background: 'rgba(29,97,245,.08)', color: 'var(--brand)' }}>{lastMeta}</div>}
      <div ref={boxRef} className="rounded-xl p-3 space-y-2 overflow-y-auto" style={{ background: 'var(--bg)', minHeight: 220, maxHeight: 420 }}>
        {msgs.length === 0 && <div className="text-[12.5px] text-center py-8" style={{ color: 'var(--ink3)' }}>اكتب رسالة لتجربة النموذج مباشرة — يمكنك إرسال عدة رسائل متتالية وسيتم الحفاظ على السياق. عند فشل النموذج سيتم التبديل تلقائيًا للبديل.</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
            <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-6 whitespace-pre-wrap" style={m.role === 'user' ? { background: 'linear-gradient(135deg,#1d61f5,#7c3aed)', color: '#fff' } : m.isError ? { background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.18)' } : m.fallback ? { background: 'rgba(245,158,11,.10)', border: '1px solid rgba(245,158,11,.25)' } : { background: 'var(--bg2)' }}>
              {m.fallback && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md ml-1" style={{ background: 'rgba(245,158,11,.18)', color: '#92400e' }}>بديل</span>}{m.content}
              {m.meta && <div className="text-[10.5px] num mt-1 opacity-70 flex items-center gap-1" dir="ltr">{m.meta}{m.fallback && <Badge c="b-amber">تبديل تلقائي</Badge>}</div>}
            </div>
          </div>
        ))}
        {busy && <div className="flex justify-end"><div className="rounded-2xl px-4 py-3 typing flex items-center gap-1.5" style={{ background: 'var(--bg2)' }}><span /><span /><span /><span className="text-[11px] mr-2" style={{ color: 'var(--ink3)' }}>جاري الاتصال...</span></div></div>}
      </div>
      <div className="flex gap-2 mt-3">
        <input className="inp" placeholder="اكتب رسالتك... (Enter للإرسال)" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} disabled={busy} />
        <Btn onClick={send} disabled={busy || !text.trim()}><I n="send" s={16} /></Btn>
      </div>
      <div className="text-[11px] mt-2" style={{ color: 'var(--ink3)' }}>• لا يتم إرسال نفس الطلب بشكل مكرر — المحاولة التالية تكون على النموذج البديل تلقائيًا • يتم حفظ النموذج الناجح كافتراضي للرسالة التالية</div>
    </div>
  );
}
