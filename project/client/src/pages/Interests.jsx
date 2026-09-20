import React, { useState, useEffect } from 'react';
import { api, q, exportFile } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtD, fmtDT, todayStr, L, badge } from '../lib/format.js';
import { I, Btn, Badge, Field, Modal, PageHead, Confirm, Empty } from '../components/ui.jsx';
import { useList, useFetch, Kpis, Table, ExcelBtn } from '../components/fin.jsx';

const emptyInt = {
  client_id: '', property_type: 'apartment', preferred_project_id: '', preferred_area: '', city: '',
  budget_min: '', budget_max: '', rooms: '', bathrooms: '', floor_pref: '', floor_id: '', wants_roof: 0,
  area_min: '', area_max: '', parking: '', delivery_status: 'any', purpose: 'residence', priority: 'normal',
  notes: '', special_requests: '', sales_notes: '', is_active: 1
};
const emptyFilters = {
  q: '', property_type: '', project_id: '', city: '', area: '', rooms_quick: '', rooms_op: 'eq', rooms: '', rooms_max: '',
  bathrooms: '', budget_min: '', budget_max: '', area_min: '', area_max: '', floor_pref: '', floor_id: '',
  wants_roof: '', purpose: '', delivery_status: '', client_id: '', employee_id: '', source: '', stage: '',
  rooms_include_unspecified: '', open_units_min: ''
};
const ROOM_QUICK = [
  { k: '', t: 'الكل' }, { k: '1', t: 'غرفة واحدة' }, { k: '2', t: 'غرفتان' }, { k: '3', t: '3 غرف' },
  { k: '4', t: '4 غرف' }, { k: '5', t: '5 غرف' }, { k: '6+', t: '6 غرف أو أكثر' }
];
const DEFAULT_TPL = 'السلام عليكم {{اسم العميل}}\nلدينا وحدة قد تناسب اهتمامك.\n\nالمشروع: {{اسم المشروع}}\nنوع العقار: {{نوع العقار}}\nعدد الغرف: {{عدد الغرف}}\nالسعر: {{السعر}}\n\nإذا كنت مهتمًا يسعدنا التواصل معك.';

export default function Interests() {
  const { can, toast, company } = useStore();
  const cur = company.currency || 'ر.س';
  const [f, setF] = useState({ ...emptyFilters });
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(true);
  const [selIds, setSelIds] = useState([]);
  const [selAll, setSelAll] = useState(false);

  const params = { page, limit: 20, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v !== null)) };
  const { rows, meta, busy, err, reload } = useList('/interests', params);
  const { data: meta2 } = useFetch('/interests/meta');
  const { data: clients } = useFetch('/clients?limit=300');
  const [form, setForm] = useState(null);
  const [clientInfo, setClientInfo] = useState(null);
  const [saving, setSaving] = useState(false);
  const [unitsFor, setUnitsFor] = useState(null);
  const [clientUnits, setClientUnits] = useState(null);
  const [msgBox, setMsgBox] = useState(null);
  const [delRow, setDelRow] = useState(null);
  const [clientProfile, setClientProfile] = useState(null);
  const [allIds, setAllIds] = useState([]);

  const opts = meta2 || { projects: [], stages: [], floor_types: [], property_types: [], purposes: [], employees: [], floors: [], sources: [], buildings: [] };

  // كل معرّفات نتائج الفلترة الحالية (لزر «تحديد الكل»)
  useEffect(() => {
    if (!meta) return;
    const total = Number(meta.total || 0);
    if (total <= rows.length) { setAllIds(rows.map(r => r.id)); return; }
    api('/interests' + q({ ...params, page: 1, limit: Math.min(5000, total) }))
      .then(r => setAllIds((r.data || []).map(x => x.id))).catch(() => setAllIds(rows.map(r => r.id)));
  }, [meta.total, rows.length, JSON.stringify(params)]);

  // بيانات العميل تظهر تلقائيًا عند اختياره (من جدول العملاء — بلا تكرار)
  useEffect(() => {
    if (!form?.client_id) { setClientInfo(null); return; }
    api('/clients/' + form.client_id).then(r => setClientInfo(r)).catch(() => setClientInfo(null));
  }, [form?.client_id]);

  const setFilter = (k, v) => { setF(x => ({ ...x, [k]: v })); setPage(1); };
  const clearFilters = () => { setF({ ...emptyFilters }); setPage(1); setSelIds([]); };

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form };
      ['budget_min', 'budget_max', 'rooms', 'bathrooms', 'area_min', 'area_max', 'parking'].forEach(k => { if (body[k] === '' || body[k] === undefined) body[k] = 0; else body[k] = Number(body[k]); });
      body.wants_roof = body.wants_roof ? 1 : 0;
      for (const k of ['preferred_project_id', 'client_id', 'floor_id']) if (!body[k]) body[k] = null;
      if (body.id) await api('/interests/' + body.id, { method: 'PUT', body });
      else await api('/interests', { method: 'POST', body });
      toast('تم حفظ اهتمام العميل'); setForm(null); reload();
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };

  const doDelete = async () => {
    try { await api('/interests/' + delRow.id, { method: 'DELETE' }); toast('تم أرشفة الاهتمام'); setDelRow(null); reload(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const loadUnitsFor = async (interest) => {
    setClientUnits({ interest, busy: true, units: [] });
    try {
      const r = await api('/interests/match-units' + q({ client_id: interest.client_id, limit: 50 }));
      setClientUnits({ interest, busy: false, units: r.units || [] });
    } catch (e) { toast(e.message, 'error'); setClientUnits(null); }
  };

  // مراسلة: تجهيز النص ← فتح واتساب ← تسجيل «تم فتح واتساب للمراسلة» في السجل
  const openMessages = async (unit = null, idsOverride = null) => {
    const ids = idsOverride || (selIds.length ? selIds : []);
    if (!ids.length) return toast('حدد اهتمامًا واحدًا على الأقل', 'error');
    try {
      const r = await api('/interests/messages', { method: 'POST', body: { interest_ids: ids, template: DEFAULT_TPL, unit_id: unit?.id || null } });
      setMsgBox(r);
    } catch (e) { toast(e.message, 'error'); }
  };

  const openWhatsApp = async (msg, unitId = null) => {
    try {
      await api('/interests/log-contact', { method: 'POST', body: { interest_ids: [msg.interest_id], unit_id: unitId, note: 'فتح واتساب من شاشة اهتمامات العملاء' } });
      toast('تم تسجيل «تم فتح واتساب للمراسلة» في سجل العميل');
    } catch (e) { /* التسجيل لا يمنع فتح واتساب */ }
    window.open(msg.wa_link, '_blank');
  };

  const bulkWhatsApp = async () => {
    if (!selIds.length) return toast('حدد عميلًا واحدًا على الأقل', 'error');
    await openMessages();
  };

  const exportFiltered = async () => {
    try { await exportFile('/interests/excel', f, 'العملاء-المهتمون.xlsx'); toast('تم تصدير نتائج الفلترة الحالية'); }
    catch (e) { toast(e.message, 'error'); }
  };

  const toggle = (id) => setSelIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const selectAll = () => { setSelIds(allIds.length ? allIds : rows.map(r => r.id)); setSelAll(true); };
  const clearSel = () => { setSelIds([]); setSelAll(false); };

  const roomsText = (r) => r.rooms > 0 ? `${r.rooms} غرف` : 'غير محدد';
  const areaText = (r) => (Number(r.area_min) || Number(r.area_max)) ? `${fmtN(r.area_min)} — ${fmtN(r.area_max)} م²` : 'غير محدد';
  const budgetText = (r) => (Number(r.budget_min) || Number(r.budget_max)) ? `${fmtN(r.budget_min)} — ${fmtN(r.budget_max)}` : 'غير محدد';
  const floorText = (r) => r.floor_display || r.floor_name || (r.floor_pref ? (L.floorType[r.floor_pref] || r.floor_pref) : 'غير محدد');

  return (
    <>
      <PageHead title="اهتمامات العملاء" sub="جدول اهتمامات مستقل مرتبط بالعملاء: النوع/المشروع/المنطقة/السعر/الغرف/الحمامات/المساحة/الدور/الروف/الغرض — أكثر من اهتمام للعميل الواحد"
        actions={<>
          <ExcelBtn path="/interests/excel" filters={f} name="العملاء-المهتمون.xlsx" label="تصدير Excel" can={can('interests', 'export')} />
          <Btn v="o" onClick={() => setShowFilters(v => !v)}><I n="filter" s={15} /> {showFilters ? 'إخفاء الفلاتر' : 'الفلاتر المتقدمة'}</Btn>
          {can('interests', 'create') && <Btn v="g" onClick={() => { setForm({ ...emptyInt }); setClientInfo(null); }}><I n="plus" s={15} /> اهتمام جديد</Btn>}
        </>} />

      <Kpis items={[
        { icon: 'target', label: 'عدد النتائج (حسب الفلاتر)', value: String(meta.total) },
        { icon: 'users', label: 'عملاء في النتائج', value: String(new Set(rows.map(r => r.client_id)).size) },
        { icon: 'coins', label: 'متوسط أعلى ميزانية', value: fmtN(rows.length ? rows.reduce((a, r) => a + (Number(r.budget_max) || 0), 0) / rows.length : 0) + ' ' + cur },
        { icon: 'box', label: 'وحدات متاحة مطابقة', value: fmtN(rows.reduce((a, r) => a + Number(r.open_units || 0), 0)) },
      ]} />

      {/* شريط البحث + الإجراءات الجماعية */}
      <div className="card p-3.5 mb-4 anim-in no-print">
        <div className="flex gap-2.5 flex-wrap items-center">
          <input className="inp flex-1 min-w-[220px]" placeholder="بحث باسم العميل / الجوال / البريد / الملاحظات..." value={f.q} onChange={e => setFilter('q', e.target.value)} />
          <Btn v="o" size="sm" onClick={selectAll}><I n="check" s={14} /> تحديد الكل ({allIds.length})</Btn>
          {selIds.length > 0 && <Btn v="o" size="sm" onClick={clearSel}><I n="ban" s={14} /> إلغاء تحديد الكل</Btn>}
          <Btn v="o" size="sm" disabled={!selIds.length || !can('interests', 'export')} onClick={exportFiltered}><I n="dl" s={14} /> تصدير Excel {selIds.length ? `(${selIds.length} محدد)` : ''}</Btn>
          <Btn v="g" size="sm" disabled={!selIds.length || !can('interests', 'contact')} onClick={bulkWhatsApp}><I n="chat" s={14} /> مراسلة WhatsApp {selIds.length ? `(${selIds.length})` : ''}</Btn>
          <Btn v="o" size="sm" onClick={reload}><I n="refresh" s={14} /> تحديث النتائج</Btn>
        </div>
        <div className="text-[12px] mt-2" style={{ color: 'var(--ink3)' }}>
          النتائج: <b className="num">{meta.total}</b> اهتمام — محدد: <b className="num">{selIds.length}</b>
          {selAll && selIds.length ? ' (كل نتائج الفلترة الحالية)' : ''} — التصدير يعتمد على الفلاتر المطبقة والنتائج المعروضة.
        </div>
      </div>

      {/* الفلاتر المتقدمة */}
      {showFilters && (
        <div className="card p-4 mb-4 anim-in no-print">
          <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <Field label="نوع العقار"><select className="inp" value={f.property_type} onChange={e => setFilter('property_type', e.target.value)}><option value="">الكل</option>{(opts.property_types || []).map(t => <option key={t.k} value={t.k}>{t.t}</option>)}</select></Field>
            <Field label="المشروع"><select className="inp" value={f.project_id} onChange={e => setFilter('project_id', e.target.value)}><option value="">الكل</option>{(opts.projects || []).map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
            <Field label="المدينة"><select className="inp" value={f.city} onChange={e => setFilter('city', e.target.value)}><option value="">الكل</option>{(opts.cities || []).map((c, i) => <option key={i} value={c}>{c}</option>)}</select></Field>
            <Field label="المنطقة/الحي"><input className="inp" value={f.area} onChange={e => setFilter('area', e.target.value)} placeholder="أي منطقة" /></Field>

            <Field label="عدد الغرف"><select className="inp" value={f.rooms_quick} onChange={e => setFilter('rooms_quick', e.target.value)}>{ROOM_QUICK.map(r => <option key={r.k} value={r.k}>{r.t}</option>)}</select></Field>
            <Field label="غرف — بحث متقدم">
              <div className="flex gap-1">
                <select className="inp" style={{ width: 78 }} value={f.rooms_op} onChange={e => setFilter('rooms_op', e.target.value)} disabled={!!f.rooms_quick}>
                  <option value="eq">=</option><option value="gt">&gt;</option><option value="gte">≥</option><option value="lt">&lt;</option><option value="lte">≤</option><option value="between">بين</option>
                </select>
                <input type="number" className="inp num" placeholder="3" value={f.rooms} onChange={e => { setF(x => ({ ...x, rooms: e.target.value, rooms_quick: '' })); setPage(1); }} />
                {f.rooms_op === 'between' && <input type="number" className="inp num" placeholder="إلى" value={f.rooms_max} onChange={e => setFilter('rooms_max', e.target.value)} />}
              </div>
            </Field>
            <Field label="تضمين «غير محدد» بالغرف">
              <select className="inp" value={f.rooms_include_unspecified} onChange={e => setFilter('rooms_include_unspecified', e.target.value)}>
                <option value="">لا — القيمة غير المحددة لا تظهر</option>
                <option value="1">نعم — أضف من لم يحدد عدد الغرف</option>
              </select>
            </Field>
            <Field label="عدد الحمامات"><input type="number" className="inp num" value={f.bathrooms} onChange={e => setFilter('bathrooms', e.target.value)} /></Field>

            <Field label="أقل ميزانية"><input type="number" className="inp num" value={f.budget_min} onChange={e => setFilter('budget_min', e.target.value)} /></Field>
            <Field label="أعلى ميزانية"><input type="number" className="inp num" value={f.budget_max} onChange={e => setFilter('budget_max', e.target.value)} /></Field>
            <Field label="أقل مساحة"><input type="number" className="inp num" value={f.area_min} onChange={e => setFilter('area_min', e.target.value)} /></Field>
            <Field label="أعلى مساحة"><input type="number" className="inp num" value={f.area_max} onChange={e => setFilter('area_max', e.target.value)} /></Field>

            <Field label="الدور المطلوب (نوع)"><select className="inp" value={f.floor_pref} onChange={e => setFilter('floor_pref', e.target.value)}><option value="">الكل</option>{(opts.floor_types || []).map(t => <option key={t.k} value={t.k}>{t.t}</option>)}</select></Field>
            <Field label="دور محدد (مشروع/مبنى)"><select className="inp" value={f.floor_id} onChange={e => setFilter('floor_id', e.target.value)}><option value="">الكل</option>{(opts.floors || []).map(fl => <option key={fl.id} value={fl.id}>{fl.display_name || fl.name}{fl.type === 'roof' ? ' — روف' : ''}</option>)}</select></Field>
            <Field label="روف"><select className="inp" value={f.wants_roof} onChange={e => setFilter('wants_roof', e.target.value)}><option value="">الكل</option><option value="1">يريد روف</option><option value="0">لا يريد</option></select></Field>
            <Field label="الغرض"><select className="inp" value={f.purpose} onChange={e => setFilter('purpose', e.target.value)}><option value="">الكل</option>{(opts.purposes || []).map(t => <option key={t.k} value={t.k}>{t.t}</option>)}</select></Field>

            <Field label="حالة العقار"><select className="inp" value={f.delivery_status} onChange={e => setFilter('delivery_status', e.target.value)}><option value="">الكل</option><option value="ready">جاهز</option><option value="under_construction">تحت الإنشاء</option><option value="any">لا يهم</option></select></Field>
            <Field label="موظف المبيعات"><select className="inp" value={f.employee_id} onChange={e => setFilter('employee_id', e.target.value)}><option value="">الكل</option>{(opts.employees || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <Field label="مصدر العميل"><select className="inp" value={f.source} onChange={e => setFilter('source', e.target.value)}><option value="">الكل</option>{(opts.sources || []).map((s, i) => <option key={i} value={s}>{s}</option>)}</select></Field>
            <Field label="مرحلة العميل"><select className="inp" value={f.stage} onChange={e => setFilter('stage', e.target.value)}><option value="">الكل</option>{(opts.stages || []).map(t => <option key={t.k} value={t.k}>{t.name}</option>)}</select></Field>

            <Field label="العميل"><select className="inp" value={f.client_id} onChange={e => setFilter('client_id', e.target.value)}><option value="">الكل</option>{(clients?.data || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <div className="flex items-end gap-2">
              <Btn v="o" size="sm" onClick={clearFilters}><I n="refresh" s={14} /> مسح الفلاتر</Btn>
              <Btn v="o" size="sm" onClick={async () => {
                try {
                  const r = await api('/interests/match-units' + q({ ...f, limit: 100 }));
                  setUnitsFor({ interest: { client_name: 'وحدات مناسبة لنتائج الفلترة', code: `${r.interests_count} اهتمام` }, busy: false, units: r.units || [] });
                } catch (e) { toast(e.message, 'error'); }
              }}><I n="target" s={14} /> وحدات مناسبة</Btn>
            </div>
          </div>
        </div>
      )}

      {/* الجدول */}
      <Table rows={rows} busy={busy} err={err} empty="لا توجد اهتمامات مطابقة"
        cols={[
          {
            t: '', w: 34, center: true, r: r => (
              <input type="checkbox" checked={selIds.includes(r.id)} onClick={e => e.stopPropagation()} onChange={() => toggle(r.id)} />
            )
          },
          { k: 'client_name', t: 'العميل', r: r => <><b>{r.client_name}</b><div className="text-[11.5px] num" style={{ color: 'var(--ink3)' }}>{r.client_phone}{r.client_phone2 ? ` / ${r.client_phone2}` : ''}</div></> },
          { k: 'client_email', t: 'البريد', r: r => r.client_email || '—' },
          { k: 'property_type', t: 'نوع العقار', r: r => <>{L.propertyType[r.property_type] || r.property_type}{Number(r.wants_roof) ? <Badge c="b-purple">روف</Badge> : null}</> },
          { k: 'project_name', t: 'المشروع', r: r => r.project_name || (r.preferred_area ? `منطقة: ${r.preferred_area}` : 'أي مشروع') },
          { k: 'budget', t: 'الميزانية', r: r => <span className="num">{budgetText(r)}</span> },
          { k: 'rooms', t: 'الغرف', center: true, r: r => <Badge c={Number(r.rooms) ? 'b-blue' : 'b-gray'}>{roomsText(r)}</Badge> },
          { k: 'bathrooms', t: 'الحمامات', center: true, r: r => r.bathrooms > 0 ? <span className="num">{r.bathrooms}</span> : 'غير محدد' },
          { k: 'floor', t: 'الدور', r: r => floorText(r) },
          { k: 'wants_roof', t: 'روف', center: true, r: r => Number(r.wants_roof) ? <Badge c="b-purple">نعم</Badge> : '—' },
          { k: 'area', t: 'المساحة', r: r => <span className="num">{areaText(r)}</span> },
          { k: 'purpose', t: 'الغرض', r: r => L.purpose[r.purpose] || r.purpose },
          { k: 'delivery_status', t: 'حالة العقار', r: r => ({ ready: 'جاهز', under_construction: 'تحت الإنشاء' }[r.delivery_status] || 'لا يهم') },
          { k: 'last_contact_at', t: 'آخر تواصل', r: r => r.last_contact_at ? fmtD(r.last_contact_at) : <span style={{ color: 'var(--ink3)' }}>لا يوجد</span> },
          { k: 'employee_name', t: 'الموظف', r: r => r.employee_name || '—' },
          { k: 'client_source', t: 'المصدر', r: r => r.client_source || '—' },
          { k: 'open_units', t: 'وحدات متاحة', center: true, r: r => <Badge c={Number(r.open_units) ? 'b-green' : 'b-gray'}>{r.open_units}</Badge> },
          {
            t: 'إجراءات', center: true, r: r => (
              <div className="flex gap-1 justify-center" onClick={e => e.stopPropagation()}>
                <button className="icon-btn" title="فتح ملف العميل" onClick={() => setClientProfile(r)}><I n="user" s={15} /></button>
                <button className="icon-btn" title="مراسلة واتساب" onClick={() => openMessages(null, [r.id])}><I n="chat" s={15} /></button>
                <button className="icon-btn" title="وحدات مناسبة للعميل" onClick={() => loadUnitsFor(r)}><I n="target" s={15} /></button>
                {can('interests', 'edit') && <button className="icon-btn" title="تعديل" onClick={() => { setForm({ ...emptyInt, ...r }); setClientInfo(null); }}><I n="edit" s={15} /></button>}
                {can('interests', 'delete') && <button className="icon-btn" title="أرشفة الاهتمام" onClick={() => setDelRow(r)}><I n="trash" s={15} /></button>}
              </div>
            )
          },
        ]} />

      <div className="flex items-center justify-between mt-3 text-[13px] no-print" style={{ color: 'var(--ink2)' }}>
        <div>{meta.total} اهتمام {selIds.length ? `— محدد ${selIds.length}` : ''}</div>
        <div className="flex gap-2">
          <Btn v="o" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</Btn>
          <span className="self-center num">{page} / {meta.pages || 1}</span>
          <Btn v="o" size="sm" disabled={page >= (meta.pages || 1)} onClick={() => setPage(page + 1)}>التالي</Btn>
        </div>
      </div>

      {/* نموذج اهتمام */}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'تعديل اهتمام' : 'اهتمام جديد'} w={780}
        actions={<><Btn v="o" onClick={() => setForm(null)}>إلغاء</Btn><Btn v="g" disabled={saving} onClick={save}><I n="check" s={15} /> حفظ</Btn></>}>
        {form && (
          <div className="space-y-3">
            <Field label="العميل *">
              <select className="inp" value={form.client_id || ''} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                <option value="">— اختر العميل —</option>{(clients?.data || []).map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
              </select>
            </Field>
            {clientInfo && (
              <div className="rounded-xl p-3 text-[12.5px] grid sm:grid-cols-3 gap-2" style={{ background: 'var(--card2)' }}>
                <div>الاسم: <b>{clientInfo.name}</b></div>
                <div>الجوال: <b className="num">{clientInfo.phone || '—'}</b></div>
                <div>جوال بديل: <b className="num">{clientInfo.phone2 || '—'}</b></div>
                <div>البريد: <b>{clientInfo.email || '—'}</b></div>
                <div>المدينة: <b>{clientInfo.city || '—'}</b></div>
                <div>موظف المبيعات: <b>{clientInfo.employee_name || clientInfo.assigned_name || '—'}</b></div>
                <div>مصدر العميل: <b>{clientInfo.source || '—'}</b></div>
                <div>الحالة: <b>{L.clientStatus[clientInfo.status] || clientInfo.status || '—'}</b></div>
                <div>المرحلة: <b>{L.stage[clientInfo.pipeline_stage] || '—'}</b></div>
                <div className="sm:col-span-3" style={{ color: 'var(--ink3)' }}>هذه البيانات من ملف العميل نفسه — لا تُكرَّر في جدول الاهتمامات.</div>
              </div>
            )}

            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="نوع العقار"><select className="inp" value={form.property_type} onChange={e => setForm({ ...form, property_type: e.target.value })}>{(opts.property_types || []).map(t => <option key={t.k} value={t.k}>{t.t}</option>)}</select></Field>
              <Field label="الغرض"><select className="inp" value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })}>{(opts.purposes || []).map(t => <option key={t.k} value={t.k}>{t.t}</option>)}</select></Field>
              <Field label="المشروع المفضل"><select className="inp" value={form.preferred_project_id || ''} onChange={e => setForm({ ...form, preferred_project_id: e.target.value, floor_id: '' })}><option value="">أي مشروع</option>{(opts.projects || []).map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
              <Field label="المنطقة/الحي المفضل"><input className="inp" value={form.preferred_area || ''} onChange={e => setForm({ ...form, preferred_area: e.target.value })} /></Field>
              <Field label="المدينة"><input className="inp" value={form.city || ''} onChange={e => setForm({ ...form, city: e.target.value })} /></Field>
              <Field label="حالة العقار"><select className="inp" value={form.delivery_status || 'any'} onChange={e => setForm({ ...form, delivery_status: e.target.value })}><option value="any">لا يهم</option><option value="ready">جاهز</option><option value="under_construction">تحت الإنشاء</option></select></Field>

              <Field label="الحد الأدنى للسعر"><input type="number" className="inp num" value={form.budget_min} onChange={e => setForm({ ...form, budget_min: e.target.value })} /></Field>
              <Field label="الحد الأعلى للسعر"><input type="number" className="inp num" value={form.budget_max} onChange={e => setForm({ ...form, budget_max: e.target.value })} /></Field>
              <Field label="عدد الغرف (اتركه فارغًا = غير محدد)"><input type="number" className="inp num" value={form.rooms} onChange={e => setForm({ ...form, rooms: e.target.value })} placeholder="غير محدد" /></Field>
              <Field label="عدد الحمامات"><input type="number" className="inp num" value={form.bathrooms} onChange={e => setForm({ ...form, bathrooms: e.target.value })} placeholder="غير محدد" /></Field>
              <Field label="الحد الأدنى للمساحة"><input type="number" className="inp num" value={form.area_min} onChange={e => setForm({ ...form, area_min: e.target.value })} /></Field>
              <Field label="الحد الأعلى للمساحة"><input type="number" className="inp num" value={form.area_max} onChange={e => setForm({ ...form, area_max: e.target.value })} /></Field>

              <Field label="الدور المطلوب (نوع)"><select className="inp" value={form.floor_pref || ''} onChange={e => setForm({ ...form, floor_pref: e.target.value })}><option value="">أي دور</option>{(opts.floor_types || []).map(t => <option key={t.k} value={t.k}>{t.t}</option>)}</select></Field>
              <Field label="دور محدد داخل مشروع"><select className="inp" value={form.floor_id || ''} onChange={e => setForm({ ...form, floor_id: e.target.value })}>
                <option value="">أي دور</option>
                {(opts.floors || []).filter(fl => !form.preferred_project_id || Number(fl.project_id) === Number(form.preferred_project_id)).map(fl => (
                  <option key={fl.id} value={fl.id}>{fl.display_name || fl.name}{fl.type === 'roof' ? ' — روف' : ''}</option>
                ))}
              </select></Field>
              <Field label="مواقف السيارات"><input type="number" className="inp num" value={form.parking} onChange={e => setForm({ ...form, parking: e.target.value })} placeholder="غير محدد" /></Field>
              <Field label="الأولوية"><select className="inp" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>{Object.entries(L.priority).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
            </div>

            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!Number(form.wants_roof)} onChange={e => setForm({ ...form, wants_roof: e.target.checked ? 1 : 0 })} /> يريد روف / سطح خاص</label>

            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="ملاحظات العميل"><textarea className="inp" rows={2} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
              <Field label="طلبات خاصة"><textarea className="inp" rows={2} value={form.special_requests || ''} onChange={e => setForm({ ...form, special_requests: e.target.value })} /></Field>
              <Field label="ملاحظات الموظف (داخلية)"><textarea className="inp" rows={2} value={form.sales_notes || ''} onChange={e => setForm({ ...form, sales_notes: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </Modal>

      {/* وحدات مناسبة لعميل / لنتائج الفلترة */}
      <Modal open={!!clientUnits} onClose={() => setClientUnits(null)} title={`وحدات مناسبة — ${clientUnits?.interest?.client_name || ''}`} w={980}>
        {clientUnits && (
          <div className="space-y-2">
            {clientUnits.busy && <div className="text-[13px]">جارٍ البحث...</div>}
            {!clientUnits.busy && (clientUnits.units || []).length === 0 && <Empty icon="home" title="لا توجد وحدات مطابقة حاليًا" />}
            {!clientUnits.busy && (clientUnits.units || []).length > 0 && (
              <Table rows={clientUnits.units} busy={false} err="" cols={[
                { k: 'code', t: 'الوحدة' },
                { k: 'project_name', t: 'المشروع' },
                { k: 'building_name', t: 'المبنى', r: r => r.building_name || '—' },
                { k: 'floor', t: 'الدور', r: r => r.floor_display || r.floor_name || '—' },
                { k: 'type', t: 'النوع', r: r => L.propertyType[r.type] || r.type },
                { k: 'rooms', t: 'الغرف', center: true, r: r => r.rooms > 0 ? r.rooms : 'غير محدد' },
                { k: 'area', t: 'المساحة', r: r => <span className="num">{fmtN(r.area)}</span> },
                { k: 'price', t: 'السعر', r: r => <b className="num">{fmtN(r.price)}</b> },
                { k: 'status', t: 'الحالة', r: r => <Badge c={badge.unitStatus[r.status]}>{L.unitStatus[r.status]}</Badge> },
                { k: 'for_client', t: 'لصالح عميل', r: r => r.for_client || '—' },
                { t: 'مراسلة', center: true, r: r => <button className="icon-btn" title="مراسلة بهذه الوحدة" onClick={() => openMessages(r)}><I n="chat" s={15} /></button> },
              ]} />
            )}
            {!clientUnits.busy && (clientUnits.units || []).length > 0 && (
              <div className="text-[12px]" style={{ color: 'var(--ink3)' }}>الوحدات المعروضة تستبعد الشروط غير المحددة في الاهتمام (المشروع/الميزانية/الغرف/المساحة/الدور) فلا يُستبعد عميل بسبب معلومة غير محددة.</div>
            )}
          </div>
        )}
      </Modal>

      {/* رسائل واتساب الجاهزة */}
      <Modal open={!!msgBox} onClose={() => setMsgBox(null)} title="مراسلة واتساب — رسائل جاهزة (الإرسال يدوي من الموظف)" w={820}>
        {msgBox && (
          <div className="space-y-3">
            <div className="text-[12.5px] rounded-xl p-2.5" style={{ background: 'var(--bg2)', color: 'var(--ink2)' }}>{msgBox.note}</div>
            {(msgBox.messages || []).map((m, i) => (
              <div key={i} className="card p-3">
                <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
                  <b className="text-[13.5px]">{m.client_name} <span className="num text-[12px]" style={{ color: 'var(--ink3)' }}>— {m.phone}</span></b>
                  <div className="flex gap-1.5">
                    <button className="btn btn-g btn-sm" onClick={() => openWhatsApp(m, msgBox.unit_id || null)}><I n="chat" s={14} /> فتح واتساب</button>
                    {m.wa_link2 && <button className="btn btn-o btn-sm" onClick={() => openWhatsApp({ ...m, wa_link: m.wa_link2 }, msgBox.unit_id || null)}><I n="chat" s={14} /> الجوال البديل</button>}
                    <button className="btn btn-o btn-sm" onClick={() => { navigator.clipboard?.writeText(m.text); toast('تم نسخ الرسالة'); }}><I n="copy" s={14} /> نسخ</button>
                  </div>
                </div>
                <div className="text-[13px] whitespace-pre-wrap" style={{ color: 'var(--ink2)' }}>{m.text}</div>
                <div className="text-[11.5px] mt-1.5" style={{ color: 'var(--ink3)' }}>يُسجَّل في السجل: «تم فتح واتساب للمراسلة» — ولا يُسجَّل أن الرسالة أُرسلت إلا بتأكيد الموظف.</div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* ملف العميل السريع */}
      <Modal open={!!clientProfile} onClose={() => setClientProfile(null)} title="ملف العميل" w={560}
        actions={<><Btn v="o" onClick={() => { try { sessionStorage.setItem('ss_open_client', String(clientProfile.client_id)); } catch {} location.hash = '#/clients'; }}><I n="user" s={15} /> فتح الملف الكامل</Btn><Btn v="g" onClick={() => setClientProfile(null)}>إغلاق</Btn></>}>
        {clientProfile && (
          <div className="space-y-2 text-[13px]">
            <div className="rounded-xl p-3" style={{ background: 'var(--card2)' }}>
              <div className="text-[15px] font-bold mb-1">{clientProfile.client_name}</div>
              <div>الجوال: <b className="num">{clientProfile.client_phone || '—'}</b>{clientProfile.client_phone2 ? <span className="num"> / {clientProfile.client_phone2}</span> : null}</div>
              <div>البريد: <b>{clientProfile.client_email || '—'}</b></div>
              <div>المدينة: <b>{clientProfile.client_city || '—'}</b> — المصدر: <b>{clientProfile.client_source || '—'}</b></div>
              <div>موظف المبيعات: <b>{clientProfile.employee_name || '—'}</b></div>
              <div>المرحلة: <b>{L.stage[clientProfile.pipeline_stage] || '—'}</b> — آخر تواصل: <b className="num">{fmtD(clientProfile.last_contact_at)}</b></div>
            </div>
            <div className="rounded-xl p-3" style={{ background: 'var(--card2)' }}>
              <b>الاهتمام الحالي ({clientProfile.code})</b>
              <div>{L.propertyType[clientProfile.property_type]} — {roomsText(clientProfile)} — {areaText(clientProfile)} — {budgetText(clientProfile)}</div>
              <div>المشروع: {clientProfile.project_name || 'أي مشروع'} — الدور: {floorText(clientProfile)} — روف: {Number(clientProfile.wants_roof) ? 'نعم' : 'لا'}</div>
              {clientProfile.notes && <div style={{ color: 'var(--ink2)' }}>ملاحظات: {clientProfile.notes}</div>}
            </div>
            <Btn v="o" size="sm" onClick={() => { setClientUnits(null); loadUnitsFor(clientProfile); setClientProfile(null); }}><I n="target" s={14} /> وحدات مناسبة لهذا الاهتمام</Btn>
          </div>
        )}
      </Modal>

      <Confirm open={!!delRow} onClose={() => setDelRow(null)} title="أرشفة الاهتمام"
        msg={`سيتم أرشفة اهتمام العميل «${delRow?.client_name}» (لا حذف نهائي — يمكن الرجوع للبيانات)`}
        onOk={doDelete} okText="أرشفة" />
    </>
  );
}
