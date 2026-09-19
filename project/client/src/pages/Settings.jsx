import React, { useEffect, useRef, useState } from 'react';
import { api, getToken } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtDT, fmtD } from '../lib/format.js';
import { I, Btn, Badge, Empty, Skeleton, PageHead, Field, Tabs, Confirm, Modal } from '../components/ui.jsx';
import AISettings from './AISettings.jsx';

// ================= الإعدادات =================
export function Settings() {
  const { can, toast, theme, toggleTheme, setCompany, user } = useStore();
  const [s, setS] = useState(null);
  const [tab, setTab] = useState('company');
  const [pw, setPw] = useState({ current: '', next: '' });
  const isAdmin = user?.role === 'admin';

  useEffect(() => { api('/settings').then(setS).catch(() => {}); }, []);
  const save = async () => {
    try { const r = await api('/settings', { method: 'PUT', body: s }); setS(r); setCompany(r); toast('تم حفظ الإعدادات'); } catch (e) { toast(e.message, 'error'); }
  };
  const changePw = async () => {
    try { await api('/auth/change-password', { method: 'POST', body: pw }); toast('تم تغيير كلمة المرور'); setPw({ current: '', next: '' }); }
    catch (e) { toast(e.message, 'error'); }
  };

  if (!s) return <><PageHead title="الإعدادات" /><Skeleton n={4} /></>;
  const ro = !can('settings', 'manage');
  const tabs = [
    { k: 'company', t: 'الشركة' },
    ...(can('branding') ? [{ k: 'branding', t: 'الهوية البصرية' }] : []),
    ...(can('templates') ? [{ k: 'templates', t: 'القوالب' }] : []),
    ...(can('ai') ? [{ k: 'ai', t: 'الذكاء الاصطناعي' }] : []),
    ...(isAdmin ? [{ k: 'demo', t: 'البيانات التجريبية' }] : []),
    ...(isAdmin ? [{ k: 'maint', t: 'الصيانة' }] : []),
    { k: 'health', t: 'صحة النظام' },
    { k: 'system', t: 'النظام والمظهر' },
    { k: 'security', t: 'الأمان' },
  ];
  return (
    <>
      <PageHead title="مركز الإعدادات" sub="الشركة، الهوية، القوالب، الذكاء الاصطناعي، والنظام"
        actions={tab === 'company' && !ro && <Btn onClick={save}><I n="check" s={15} /> حفظ الإعدادات</Btn>} />
      <Tabs tabs={tabs} val={tab} onChange={setTab} />
      <div className="mt-4 anim-in" style={['company', 'system', 'security'].includes(tab) ? { maxWidth: 720 } : {}}>
        {tab === 'company' && (
          <div className="card p-5"><div className="space-y-3.5">
            <Field label="اسم الشركة"><input className="inp" disabled={ro} value={s.company_name || ''} onChange={e => setS({ ...s, company_name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="هاتف الشركة"><input className="inp num" disabled={ro} value={s.company_phone || ''} onChange={e => setS({ ...s, company_phone: e.target.value })} /></Field>
              <Field label="جوال الشركة"><input className="inp num" disabled={ro} value={s.company_mobile || ''} onChange={e => setS({ ...s, company_mobile: e.target.value })} /></Field>
              <Field label="البريد"><input className="inp" disabled={ro} value={s.company_email || ''} onChange={e => setS({ ...s, company_email: e.target.value })} /></Field>
              <Field label="العملة"><input className="inp" disabled={ro} value={s.currency || ''} onChange={e => setS({ ...s, currency: e.target.value })} /></Field>
            </div>
            <Field label="العنوان"><input className="inp" disabled={ro} value={s.company_address || ''} onChange={e => setS({ ...s, company_address: e.target.value })} /></Field>
            <Field label="تذييل التقارير"><input className="inp" disabled={ro} value={s.reports_footer || ''} onChange={e => setS({ ...s, reports_footer: e.target.value })} /></Field>
          </div></div>
        )}
        {tab === 'branding' && <BrandingTab />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'ai' && <AISettings />}
        {tab === 'demo' && <DemoTab />}
        {tab === 'maint' && <MaintenanceTab />}
        {tab === 'health' && <HealthTab />}
        {tab === 'system' && (
          <div className="card p-5"><div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="اللغة"><select className="inp" disabled={ro} value={s.system_language || 'ar'} onChange={e => setS({ ...s, system_language: e.target.value })}><option value="ar">العربية</option><option value="en" disabled>الإنجليزية (قريبًا)</option></select></Field>
              <Field label="الخط"><select className="inp" disabled={ro} value={s.system_font || 'plex'} onChange={e => setS({ ...s, system_font: e.target.value })}><option value="plex">IBM Plex Sans Arabic</option></select></Field>
            </div>
            <Field label="المظهر">
              <div className="flex gap-2">
                <Btn v={theme === 'light' ? 'p' : 'g'} size="sm" onClick={() => theme === 'dark' && toggleTheme()}><I n="sun" s={15} /> فاتح</Btn>
                <Btn v={theme === 'dark' ? 'p' : 'g'} size="sm" onClick={() => theme === 'light' && toggleTheme()}><I n="moon" s={15} /> داكن</Btn>
              </div>
            </Field>
            <div className="rounded-xl p-4 text-[13px] leading-7" style={{ background: 'var(--card2)' }}>
              <b>معلومات النظام</b><br />الإصدار: <b className="num">2.0.0</b> — قاعدة البيانات: <b>SQLite محلية (WASM — بدون أي ترجمة)</b><br />النسخ الاحتياطي: من صفحة النسخ الاحتياطي — الجلسات: JWT مشفرة تنتهي خلال 24 ساعة
            </div>
          </div></div>
        )}
        {tab === 'security' && (
          <div className="card p-5"><div className="space-y-3.5">
            <b className="text-[14px]">تغيير كلمة المرور</b>
            <Field label="كلمة المرور الحالية"><input type="password" className="inp" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="كلمة المرور الجديدة (6 أحرف على الأقل)"><input type="password" className="inp" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} /></Field>
            <Btn v="p" size="sm" onClick={changePw}>تغيير كلمة المرور</Btn>
            <div className="rounded-xl p-4 text-[13px] leading-7" style={{ background: 'var(--card2)' }}>
              <b>سياسات الأمان المفعلة:</b> تشفير كلمات المرور (bcrypt) — جلسات JWT تنتهي خلال 24 ساعة — فحص الصلاحيات في الخادم على كل طلب — سجل تدقيق شامل — حد 5 جلسات نشطة — تحديد معدل الطلبات — منع الملفات التنفيذية — مفاتيح AI مشفرة (AES-256-GCM) في الخادم فقط.
            </div>
          </div></div>
        )}
      </div>
    </>
  );
}

// ================= الهوية البصرية =================
function BrandingTab() {
  const { can, toast, setCompany } = useStore();
  const [b, setB] = useState(null);
  const [busy, setBusy] = useState(false);
  const inp = useRef();
  const ro = !can('branding', 'manage');
  useEffect(() => { api('/brand').then(setB).catch(() => {}); }, []);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('/brand', { method: 'PUT', body: b });
      setB(r); setCompany({ company_name: r.company_name, currency: r.currency, logo: r.brand_logo ? `/api/public/brand-file/${r.brand_logo}` : '', footer: r.brand_footer });
      if (r.brand_primary) document.documentElement.style.setProperty('--brand', r.brand_primary);
      toast('تم حفظ الهوية وتطبيقها فورًا');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const upLogo = async (f) => {
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('logo', f);
      const res = await fetch('/api/brand/logo', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken() }, body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'فشل الرفع');
      setB({ ...b, brand_logo: j.logo });
      setCompany({ ...(useStore.getState().company || {}), logo: j.url });
      toast('تم رفع الشعار');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  if (!b) return <Skeleton n={3} />;
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="card p-5 space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="اسم الشركة"><input className="inp" disabled={ro} value={b.company_name || ''} onChange={e => setB({ ...b, company_name: e.target.value })} /></Field>
          <Field label="السطر التعريفي"><input className="inp" disabled={ro} value={b.brand_tagline || ''} onChange={e => setB({ ...b, brand_tagline: e.target.value })} placeholder="مثال: للعقارات والمقاولات" /></Field>
          <Field label="اللون الأساسي"><div className="flex gap-2"><input type="color" disabled={ro} value={/^#[0-9a-fA-F]{6}$/.test(b.brand_primary || '') ? b.brand_primary : '#7c3aed'} onChange={e => setB({ ...b, brand_primary: e.target.value })} className="w-12 h-10 rounded-lg cursor-pointer" /><input className="inp num" dir="ltr" disabled={ro} value={b.brand_primary || ''} onChange={e => setB({ ...b, brand_primary: e.target.value })} /></div></Field>
          <Field label="اللون الثانوي"><div className="flex gap-2"><input type="color" disabled={ro} value={/^#[0-9a-fA-F]{6}$/.test(b.brand_secondary || '') ? b.brand_secondary : '#1d61f5'} onChange={e => setB({ ...b, brand_secondary: e.target.value })} className="w-12 h-10 rounded-lg cursor-pointer" /><input className="inp num" dir="ltr" disabled={ro} value={b.brand_secondary || ''} onChange={e => setB({ ...b, brand_secondary: e.target.value })} /></div></Field>
          <Field label="الخط"><select className="inp" disabled={ro} value={b.brand_font || 'plex'} onChange={e => setB({ ...b, brand_font: e.target.value })}><option value="plex">Plex</option><option value="cairo">Cairo</option><option value="tajawal">Tajawal</option><option value="ibm">IBM</option><option value="system">النظام</option></select></Field>
          <Field label="العملة"><input className="inp" disabled={ro} value={b.currency || ''} onChange={e => setB({ ...b, currency: e.target.value })} /></Field>
        </div>
        <Field label="التذييل"><input className="inp" disabled={ro} value={b.brand_footer || ''} onChange={e => setB({ ...b, brand_footer: e.target.value })} /></Field>
        <Field label="الشعار"><div className="flex gap-2 items-center">
          <input ref={inp} type="file" accept="image/*" className="hidden" onChange={e => { upLogo(e.target.files[0]); e.target.value = ''; }} />
          <Btn v="g" size="sm" disabled={ro || busy} onClick={() => inp.current.click()}><I n="ul" s={14} /> رفع شعار (PNG/JPG/SVG حتى 2MB)</Btn>
          {b.brand_logo && <span className="text-[12px] num" style={{ color: 'var(--ok)' }}>مرفوع ✓</span>}
        </div></Field>
        {!ro && <Btn onClick={save} disabled={busy}><I n="check" s={15} /> {busy ? 'جارٍ الحفظ...' : 'حفظ وتطبيق الهوية'}</Btn>}
      </div>
      <div className="card p-5">
        <b className="text-[14px]">معاينة حية</b>
        <div className="rounded-2xl overflow-hidden mt-3" style={{ border: '1px solid var(--line)' }}>
          <div className="p-4 flex items-center gap-3" style={{ background: b.brand_primary || '#7c3aed', color: '#fff' }}>
            {b.brand_logo ? <img src={`/api/public/brand-file/${b.brand_logo}`} alt="" className="w-11 h-11 rounded-xl object-contain" style={{ background: '#fff' }} /> : <span className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center"><I n="spark" s={22} /></span>}
            <div><b>{b.company_name || 'اسم الشركة'}</b><div className="text-[12px] opacity-85">{b.brand_tagline || 'السطر التعريفي'}</div></div>
          </div>
          <div className="p-4 text-[13px]" style={{ color: 'var(--ink2)' }}>هكذا ستظهر هويتك في القائمة الجانبية، صفحة الدخول، التقارير المطبوعة، وملفات Excel.</div>
          <div className="p-3 text-center text-[12px]" style={{ background: 'var(--card2)', color: 'var(--ink3)' }}>{b.brand_footer || b.company_name}</div>
        </div>
      </div>
    </div>
  );
}

// ================= القوالب =================
const KIND_AR = { whatsapp: 'واتساب', sms: 'SMS', email: 'بريد', print: 'مطبوعات', other: 'أخرى' };
function TemplatesTab() {
  const { can, toast } = useStore();
  const [rows, setRows] = useState([]);
  const [vars, setVars] = useState([]);
  const [edit, setEdit] = useState(null);
  const [preview, setPreview] = useState(null);
  const [pVars, setPVars] = useState({});
  const [pOut, setPOut] = useState(null);
  const [del, setDel] = useState(null);
  const mgmt = can('templates', 'create');
  const load = () => { api('/templates').then(r => setRows(r.data || [])).catch(() => {}); api('/templates/variables').then(r => setVars(r.vars || [])).catch(() => {}); };
  useEffect(load, []);
  const save = async () => {
    if (!edit.name?.trim() || !edit.body?.trim()) { toast('الاسم والنص مطلوبان', 'error'); return; }
    try {
      if (edit.id) await api('/templates/' + edit.id, { method: 'PUT', body: edit });
      else await api('/templates', { method: 'POST', body: edit });
      toast('تم حفظ القالب'); setEdit(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const render = async () => {
    try { const r = await api(`/templates/${preview.id}/render`, { method: 'POST', body: { vars: pVars } }); setPOut(r); } catch (e) { toast(e.message, 'error'); }
  };
  const insertVar = (v) => setEdit({ ...edit, body: (edit.body || '') + `{{${v}}}` });
  return (
    <div className="card p-5 anim-in">
      <div className="flex items-center justify-between mb-3">
        <b className="text-[15px]">مدير القوالب <span className="text-[12px] font-semibold" style={{ color: 'var(--ink3)' }}>— استخدم المتغيرات بصيغة {`{{اسم_المتغير}}`}</span></b>
        {mgmt && <Btn size="sm" onClick={() => setEdit({ kind: 'whatsapp' })}><I n="plus" s={14} /> قالب جديد</Btn>}
      </div>
      {rows.length === 0 && <Empty icon="template" title="لا توجد قوالب" />}
      <div className="grid md:grid-cols-2 gap-3">
        {rows.map(t => (
          <div key={t.id} className="rounded-xl p-3.5" style={{ background: 'var(--card2)' }}>
            <div className="flex items-center gap-2"><b className="text-[14px]">{t.name}</b><Badge c="b-blue">{KIND_AR[t.kind]}</Badge>{t.is_default && <Badge c="b-purple">افتراضي</Badge>}</div>
            <div className="text-[12.5px] mt-1.5 leading-6 line-clamp-2" style={{ color: 'var(--ink2)' }}>{t.body}</div>
            <div className="flex gap-1.5 mt-2.5">
              <Btn v="g" size="xs" onClick={() => { setPreview(t); setPVars({}); setPOut(null); }}><I n="eye" s={13} /> معاينة وتجربة</Btn>
              {can('templates', 'edit') && <Btn v="g" size="xs" onClick={() => setEdit(t)}><I n="edit" s={13} /> تعديل</Btn>}
              {can('templates', 'delete') && <Btn v="d" size="xs" onClick={() => setDel(t)}><I n="trash" s={13} /></Btn>}
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل القالب' : 'قالب جديد'} w={640}
        actions={<><Btn onClick={save}>حفظ القالب</Btn><Btn v="g" onClick={() => setEdit(null)}>إلغاء</Btn></>}>
        {edit && <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="الاسم *"><input className="inp" value={edit.name || ''} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="النوع"><select className="inp" value={edit.kind || 'whatsapp'} onChange={e => setEdit({ ...edit, kind: e.target.value })}>{Object.entries(KIND_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </div>
          {(edit.kind === 'email') && <Field label="الموضوع"><input className="inp" value={edit.subject || ''} onChange={e => setEdit({ ...edit, subject: e.target.value })} /></Field>}
          <Field label="النص *"><textarea className="inp" rows={5} value={edit.body || ''} onChange={e => setEdit({ ...edit, body: e.target.value })} placeholder="مرحبًا {{client_name}}..." /></Field>
          <div>
            <div className="text-[12.5px] font-semibold mb-1.5" style={{ color: 'var(--ink2)' }}>إدراج متغير (اضغط للإضافة):</div>
            <div className="flex gap-1.5 flex-wrap">{vars.map(v => <button key={v} className="text-[11.5px] px-2 py-1 rounded-lg num" style={{ background: 'var(--bg2)', color: 'var(--brand)' }} onClick={() => insertVar(v)} dir="ltr">{`{{${v}}}`}</button>)}</div>
          </div>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!edit.is_default} onChange={e => setEdit({ ...edit, is_default: e.target.checked ? 1 : 0 })} /> قالب افتراضي لهذا النوع</label>
        </div>}
      </Modal>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={`تجربة القالب — ${preview?.name}`} w={600}>
        {preview && <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(JSON.parse(preview.vars_json || '[]')).map(v => (
              <Field key={v} label={v}><input className="inp" value={pVars[v] || ''} onChange={e => setPVars({ ...pVars, [v]: e.target.value })} /></Field>
            ))}
          </div>
          <Btn size="sm" onClick={render}><I n="play" s={14} /> عرض النتيجة</Btn>
          {pOut && <div className="rounded-xl p-3.5 text-[13.5px] leading-7 whitespace-pre-wrap" style={{ background: 'var(--card2)' }}>
            {pOut.subject && <><b>{pOut.subject}</b><br /></>}{pOut.text}
            {pOut.missing?.length > 0 && <div className="text-[12px] mt-2" style={{ color: 'var(--warn)' }}>متغيرات ناقصة: {pOut.missing.join(', ')}</div>}
          </div>}
        </div>}
      </Modal>
      <Confirm open={!!del} onClose={() => setDel(null)} title="حذف القالب" msg={`سيتم حذف "${del?.name}"`} okText="حذف"
        onOk={async () => { try { await api('/templates/' + del.id, { method: 'DELETE' }); toast('تم الحذف'); setDel(null); load(); } catch (e) { toast(e.message, 'error'); } }} />
    </div>
  );
}

// ================= إدارة البيانات التجريبية =================
function DemoTab() {
  const { toast } = useStore();
  const [st, setSt] = useState(null);
  const [word, setWord] = useState('');
  const [mode, setMode] = useState(null); // 'delete' | 'reset' | 'generate'
  const [busy, setBusy] = useState(false);

  const load = () => api('/admin/demo-stats').then(setSt).catch(() => {});
  useEffect(load, []);

  const toggleDemoMode = async (enabled) => {
    try {
      await api('/admin/demo-toggle', { method: 'POST', body: { enabled } });
      toast(enabled ? 'تم تفعيل وضع البيانات التجريبية' : 'تم تعطيل وضع البيانات التجريبية');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const handleGenerate = async () => {
    setBusy(true);
    try {
      const r = await api('/admin/demo-generate', { method: 'POST' });
      toast(r.message || 'تم توليد البيانات التجريبية بنجاح');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const runConfirmAction = async () => {
    setBusy(true);
    try {
      const endpoint = mode === 'delete' ? '/admin/demo-delete' : '/admin/demo-reset';
      const confirmWord = mode === 'delete' ? 'DELETE' : 'RESET';
      const r = await api(endpoint, { method: 'POST', body: { confirm: confirmWord } });
      toast(r.message || (mode === 'delete' ? `تم حذف ${r.deleted} سجلًا تجريبيًا بنجاح` : 'تمت إعادة ضبط البيانات التجريبية بنجاح'));
      setMode(null);
      setWord('');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!st) return <Skeleton n={3} />;
  const total = st.total_demo ?? st.tables.reduce((a, t) => a + t.demo, 0);

  return (
    <div className="space-y-4">
      {/* القسم الرئيسي: إدارة البيانات التجريبية */}
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap pb-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <div>
            <div className="flex items-center gap-2">
              <I n="database" s={18} className="text-primary" />
              <b className="text-[16px]">إدارة البيانات التجريبية</b>
            </div>
            <p className="text-[12.5px] mt-1" style={{ color: 'var(--ink2)' }}>
              التحكم في توليد وحذف وإعادة ضبط البيانات التجريبية (Demo Data) المميزة بعلامة <code className="px-1.5 py-0.5 rounded text-[11px] bg-slate-100 font-mono">is_demo = true</code> دون المساس بالبيانات الحقيقية.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {st.has_demo ? (
              <Badge c="b-amber">توجد بيانات تجريبية ({total} سجل)</Badge>
            ) : (
              <Badge c="b-green">نظام نظيف إنتاجي (0 سجل تجريبي)</Badge>
            )}
            {st.seeded_at && (
              <span className="text-[11.5px] num" style={{ color: 'var(--ink3)' }}>
                آخر بذر: {fmtDT(st.seeded_at)}
              </span>
            )}
          </div>
        </div>

        {/* أزرار العمليات الأربعة المطلوبة */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          {/* 1. تفعيل / تعطيل البيانات التجريبية */}
          <div className="rounded-xl p-3.5 flex flex-col justify-between" style={{ background: 'var(--card2)', border: '1px solid var(--line)' }}>
            <div>
              <div className="font-bold text-[13px] flex items-center gap-1.5">
                <I n="sliders" s={15} /> تفعيل البيانات التجريبية
              </div>
              <p className="text-[11.5px] mt-1 leading-5" style={{ color: 'var(--ink2)' }}>
                تفعيل أو تعطيل وضع البيانات التجريبية في النظام.
              </p>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={!!st.demo_mode_enabled}
                  onChange={e => toggleDemoMode(e.target.checked)}
                />
                <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
              </label>
              <span className="text-[12px] font-semibold">
                {st.demo_mode_enabled ? 'مفعّل' : 'معطّل'}
              </span>
            </div>
          </div>

          {/* 2. إضافة / توليد بيانات تجريبية */}
          <div className="rounded-xl p-3.5 flex flex-col justify-between" style={{ background: 'var(--card2)', border: '1px solid var(--line)' }}>
            <div>
              <div className="font-bold text-[13px] flex items-center gap-1.5">
                <I n="plus" s={15} /> توليد بيانات تجريبية
              </div>
              <p className="text-[11.5px] mt-1 leading-5" style={{ color: 'var(--ink2)' }}>
                إنشاء مجموعة نموذجية من العقارات والعملاء والحجوزات والمصروفات التجريبية.
              </p>
            </div>
            <div className="mt-3">
              <Btn v="p" size="sm" onClick={handleGenerate} disabled={busy} className="w-full justify-center">
                <I n="refresh" s={14} /> {busy ? 'جارٍ التوليد...' : 'توليد بيانات تجريبية'}
              </Btn>
            </div>
          </div>

          {/* 3. حذف جميع البيانات التجريبية */}
          <div className="rounded-xl p-3.5 flex flex-col justify-between" style={{ background: 'var(--card2)', border: '1px solid var(--line)' }}>
            <div>
              <div className="font-bold text-[13px] flex items-center gap-1.5 text-rose-600">
                <I n="trash" s={15} /> حذف جميع البيانات التجريبية
              </div>
              <p className="text-[11.5px] mt-1 leading-5" style={{ color: 'var(--ink2)' }}>
                حذف آمن لجميع السجلات التجريبية وعلاقاتها مع الحفاظ على البيانات الحقيقية.
              </p>
            </div>
            <div className="mt-3">
              <Btn v="d" size="sm" disabled={!st.has_demo || busy} onClick={() => setMode('delete')} className="w-full justify-center">
                <I n="trash" s={14} /> حذف التجريبي ({total})
              </Btn>
            </div>
          </div>

          {/* 4. إعادة ضبط البيانات التجريبية */}
          <div className="rounded-xl p-3.5 flex flex-col justify-between" style={{ background: 'var(--card2)', border: '1px solid var(--line)' }}>
            <div>
              <div className="font-bold text-[13px] flex items-center gap-1.5">
                <I n="rotate-ccw" s={15} /> إعادة ضبط البيانات التجريبية
              </div>
              <p className="text-[11.5px] mt-1 leading-5" style={{ color: 'var(--ink2)' }}>
                حذف التجريبي الحالي وتوليد مجموعة نظيفة جديدة بتواريخ اليوم.
              </p>
            </div>
            <div className="mt-3">
              <Btn v="g" size="sm" disabled={busy} onClick={() => setMode('reset')} className="w-full justify-center">
                <I n="refresh" s={14} /> إعادة ضبط التجريبي
              </Btn>
            </div>
          </div>
        </div>

        {/* إحصائيات السجلات تفصيلياً */}
        <div className="mt-5">
          <div className="text-[13px] font-bold mb-2">إحصائيات الجداول (التجريبية مقابل الحقيقية):</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {st.tables.map(t => (
              <div key={t.table} className="rounded-xl p-2.5 text-center transition-all"
                style={{
                  background: t.demo > 0 ? 'rgba(217,119,6,.08)' : 'var(--card2)',
                  border: t.demo > 0 ? '1px solid rgba(217,119,6,.2)' : '1px solid var(--line)'
                }}>
                <div className="text-[12px] font-bold truncate">{t.title || t.table}</div>
                <div className="text-[11px] num mt-1" style={{ color: 'var(--ink2)' }}>
                  تجريبي: <b className={t.demo > 0 ? 'text-amber-600' : ''}>{t.demo}</b>
                </div>
                <div className="text-[10.5px] num" style={{ color: 'var(--ink3)' }}>
                  حقيقي: <b>{t.production}</b>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* تنبيه الأمان والعزل التام */}
        <div className="rounded-xl p-3.5 mt-4 text-[12.5px] leading-6" style={{ background: 'rgba(29,97,245,.06)', color: 'var(--ink2)' }}>
          <div className="font-bold text-[13px] text-primary mb-1 flex items-center gap-1.5">
            <I n="shield" s={15} /> حماية البيانات الحقيقية:
          </div>
          جميع البيانات التجريبية معزولة داخلياً برمز <code className="px-1 py-0.5 rounded bg-white text-[11px] font-mono">is_demo = 1</code>. عند الحذف أو التصفير، يتم حذف السجلات التجريبية وعلاقاتها فقط، ولا يتم المساس بأي عميل أو حجز أو دفعة أو حساب قام المستخدم بإضافته فعلياً.
        </div>
      </div>

      {/* نافذة التأكيد القوية قبل الحذف أو التصفير */}
      <Modal
        open={!!mode}
        onClose={() => { setMode(null); setWord(''); }}
        title={mode === 'delete' ? 'تأكيد قوي: حذف جميع البيانات التجريبية' : 'تأكيد قوي: إعادة ضبط البيانات التجريبية'}
        w={480}
        actions={
          <>
            <Btn
              v={mode === 'delete' ? 'd' : 'p'}
              disabled={word !== (mode === 'delete' ? 'DELETE' : 'RESET') || busy}
              onClick={runConfirmAction}>
              {busy ? 'جارٍ التنفيذ...' : (mode === 'delete' ? 'نعم، احذف البيانات التجريبية' : 'تأكيد إعادة الضبط')}
            </Btn>
            <Btn v="g" onClick={() => { setMode(null); setWord(''); }}>إلغاء وتراجع</Btn>
          </>
        }>
        <div className="space-y-3">
          <div className="p-3 rounded-xl text-[12.5px] leading-6" style={{ background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.2)', color: '#991b1b' }}>
            {mode === 'delete' ? (
              <>
                ⚠️ <b>تنبيه أمان:</b> سيتم حذف <b>{total}</b> سجل تجريبي نهائياً (الحجوزات، الدفعات، الوحدات، العملاء التجريبيين).
                لن تتأثر أي بيانات حقيقية قمت بإضافتها نهائياً.
              </>
            ) : (
              <>
                ⚠️ سيتم حذف السجلات التجريبية الحالية وإعادة توليد مجموعة بيانات تجريبية جديدة بتواريخ حديثة.
              </>
            )}
          </div>
          <p className="text-[13px]">
            لتأكيد العملية، يرجى كتابة الكلمة التالية بالإنجليزية:
            <span className="mr-2 font-mono font-bold text-[14px] text-rose-600 bg-rose-50 px-2 py-0.5 rounded" dir="ltr">
              {mode === 'delete' ? 'DELETE' : 'RESET'}
            </span>
          </p>
          <input
            className="inp num mt-1 text-center font-bold tracking-wider"
            dir="ltr"
            value={word}
            onChange={e => setWord(e.target.value)}
            placeholder={mode === 'delete' ? 'DELETE' : 'RESET'}
            autoFocus
          />
        </div>
      </Modal>
    </div>
  );
}

// ================= الصيانة =================
function MaintenanceTab() {
  const { toast } = useStore();
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/settings').then(s => { setOn(s.maintenance === '1'); setMsg(s.maintenance_msg || ''); }).catch(() => {}); }, []);
  const save = async (v) => {
    setBusy(true);
    try { const r = await api('/admin/maintenance', { method: 'PUT', body: { enabled: v, message: msg } }); setOn(r.maintenance); toast(v ? 'تم تفعيل وضع الصيانة' : 'تم إيقاف وضع الصيانة'); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <div className="card p-5" style={{ maxWidth: 640 }}>
      <b className="text-[15px]">وضع الصيانة</b>
      <p className="text-[13px] mt-1 leading-7" style={{ color: 'var(--ink2)' }}>عند التفعيل: يُحجب النظام عن جميع المستخدمين برسالة مخصصة، ويبقى <b>المدير</b> قادرًا على العمل وتسجيل الدخول.</p>
      <div className="mt-3"><Field label="رسالة الصيانة"><input className="inp" value={msg} onChange={e => setMsg(e.target.value)} placeholder="النظام قيد الصيانة — نعود بعد قليل" /></Field></div>
      <div className="flex gap-2 mt-3">
        {!on ? <Btn v="d" disabled={busy} onClick={() => save(true)}><I n="wrench" s={15} /> تفعيل الصيانة</Btn>
          : <Btn v="ok" disabled={busy} onClick={() => save(false)}><I n="check" s={15} /> إيقاف الصيانة — النظام يعمل</Btn>}
        {on && <Badge c="b-red">مفعّل الآن</Badge>}
      </div>
    </div>
  );
}

// ================= صحة النظام =================
function HealthTab() {
  const [h, setH] = useState(null);
  const [ai, setAi] = useState(null);
  const load = () => { api('/system/health').then(setH).catch(() => {}); api('/ai/status').then(setAi).catch(() => setAi(null)); };
  useEffect(load, []);
  if (!h) return <Skeleton n={3} />;
  const up = Math.floor(h.uptime_sec / 3600) + 'h ' + Math.floor((h.uptime_sec % 3600) / 60) + 'm';
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3.5">
      {[['قاعدة البيانات', `${h.db.mb} MB`, 'db', '#1d61f5'], ['الملفات', `${h.files.count} ملف — ${h.files.mb} MB`, 'folder', '#7c3aed'], ['الذاكرة', `${h.mem.heap_mb} MB (RSS ${h.mem.rss_mb})`, 'heart', '#dc2626'], ['مدة التشغيل', up, 'clock', '#16a34a'], ['الجداول', h.tables, 'grid', '#d97706'], ['الذكاء الاصطناعي', ai ? (ai.verdict === 'CONNECTED' ? 'متصل ✓' : ai.verdict === 'NOT_CONFIGURED' ? 'غير مُعد' : ai.verdict) : '—', 'bot', '#0284c7']].map(([l, v, icon, c]) => (
        <div key={l} className="card p-4 flex items-center gap-3">
          <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${c}1a`, color: c }}><I n={icon} s={22} /></span>
          <div><div className="text-[12px]" style={{ color: 'var(--ink2)' }}>{l}</div><div className="text-[16px] font-bold num">{v}</div></div>
        </div>
      ))}
      <div className="card p-4"><Btn v="g" size="sm" onClick={load}><I n="refresh" s={14} /> تحديث القراءات</Btn><div className="text-[11.5px] num mt-2" style={{ color: 'var(--ink3)' }}>{fmtDT(h.time)}</div></div>
    </div>
  );
}

// ================= النسخ الاحتياطي =================
export function Backup() {
  const { can, toast } = useStore();
  const [rows, setRows] = useState([]);
  const [auto, setAuto] = useState(false);
  const [keep, setKeep] = useState(7);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState(null);

  const load = () => api('/backups').then(r => { setRows(r.data || []); setAuto(r.auto); setKeep(r.keep); }).catch(() => {});
  useEffect(load, []);

  const create = async () => {
    setBusy(true);
    try { const r = await api('/backups', { method: 'POST' }); toast(`تم إنشاء النسخة ${r.name}`); load(); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const saveSched = async () => {
    try { await api('/backups/settings', { method: 'PUT', body: { auto, keep } }); toast('تم حفظ إعدادات الجدولة'); load(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title="مركز النسخ الاحتياطي" sub="نسخ يدوية وتلقائية مجدولة مع إدارة الاحتفاظ"
        actions={can('backup', 'create') && <Btn onClick={create} disabled={busy}><I n="db" s={16} /> {busy ? 'جارٍ الإنشاء...' : 'إنشاء نسخة الآن'}</Btn>} />
      {can('backup', 'manage') && (
        <div className="card p-4 mb-4 flex items-center gap-3 flex-wrap anim-in">
          <b className="text-[13.5px]">الجدولة التلقائية:</b>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="w-[17px] h-[17px] accent-blue-600" checked={auto} onChange={e => setAuto(e.target.checked)} /> نسخة يومية تلقائية</label>
          <span className="text-[13px]">الاحتفاظ بآخر</span>
          <input type="number" min={1} max={30} className="inp num" style={{ width: 80 }} value={keep} onChange={e => setKeep(+e.target.value)} />
          <span className="text-[13px]">نسخ</span>
          <Btn v="g" size="sm" onClick={saveSched}>حفظ الجدولة</Btn>
        </div>
      )}
      <div className="card p-5 anim-in">
        {rows.length === 0 && <Empty icon="db" title="لا توجد نسخ بعد" sub="أنشئ أول نسخة احتياطية الآن" />}
        <div className="space-y-2.5">
          {rows.map(b => (
            <div key={b.name} className="flex items-center gap-3 rounded-xl p-3" style={{ background: 'var(--card2)' }}>
              <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(29,97,245,.12)', color: 'var(--brand)' }}><I n="db" s={19} /></span>
              <div className="flex-1"><b className="num text-[13.5px]">{b.name}</b><div className="text-[11.5px] num" style={{ color: 'var(--ink3)' }}>{(b.size / 1024).toFixed(0)} KB — {fmtD(b.at)}</div></div>
              {can('backup', 'export') && <a className="btn btn-g btn-sm" href={`/api/backup/${b.name}/download`} onClick={async (e) => {
                e.preventDefault();
                const r = await fetch(`/api/backup/${b.name}/download`, { headers: { Authorization: 'Bearer ' + getToken() } });
                const blob = await r.blob();
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = b.name; a.click();
              }}><I n="dl" s={15} /> تنزيل</a>}
              {can('backup', 'manage') && <Btn v="d" size="sm" onClick={() => setRestore(b)}>استعادة</Btn>}
            </div>
          ))}
        </div>
        <div className="rounded-xl p-4 mt-4 text-[12.5px] leading-7" style={{ background: 'rgba(217,119,6,.08)', color: 'var(--ink2)' }}>
          تنبيه: الاستعادة تستبدل قاعدة البيانات الحالية بالكامل وتتطلب إعادة تشغيل التطبيق. يُنصح بإنشاء نسخة من الوضع الحالي قبل الاستعادة.
        </div>
      </div>
      <Confirm open={!!restore} onClose={() => setRestore(null)} title="استعادة النسخة" msg={`سيتم استبدال البيانات الحالية بنسخة "${restore?.name}" — أعد تشغيل التطبيق بعدها. هل أنت متأكد؟`} okText="استعادة"
        onOk={async () => { try { await api(`/backup/${restore.name}/restore`, { method: 'POST' }); toast('تم تجهيز الاستعادة — أعد تشغيل التطبيق'); setRestore(null); } catch (e) { toast(e.message, 'error'); } }} />
    </>
  );
}
