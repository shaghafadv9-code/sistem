import React, { useEffect, useState, useCallback } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtD, L, badge, todayStr } from '../lib/format.js';
import { I, Btn, Badge, Empty, Skeleton, ErrBox, PageHead, Modal, Field, SearchInp, Confirm, Tabs, Stat } from '../components/ui.jsx';
import TimelineView from '../components/TimelineView.jsx';
import AttachFiles from '../components/AttachFiles.jsx';

const FLOOR_TYPE_ICON = { roof: 'layers', ground: 'home', mezzanine: 'grid', terrace: 'sun', basement: 'box', normal: 'bldg', other: 'grid' };
const ROOM_QUICK = [
  { k: '', t: 'الكل' }, { k: '1', t: 'غرفة واحدة' }, { k: '2', t: 'غرفتان' }, { k: '3', t: '3 غرف' },
  { k: '4', t: '4 غرف' }, { k: '5', t: '5 غرف' }, { k: '6+', t: '6 غرف أو أكثر' }
];
const emptyFilters = {
  building_id: '', floor_id: '', floor_type: '', roof: '', unit_type: '', status: '',
  rooms_quick: '', rooms_op: 'eq', rooms: '', rooms_max: '', price_min: '', price_max: '',
  area_min: '', area_max: '', q: ''
};
const DEFAULT_TPL = 'السلام عليكم {{اسم العميل}}\nلدينا وحدة قد تناسب اهتمامك.\n\nالمشروع: {{اسم المشروع}}\nنوع العقار: {{نوع العقار}}\nعدد الغرف: {{عدد الغرف}}\nالسعر: {{السعر}}\n\nإذا كنت مهتمًا يسعدنا التواصل معك.';

export default function Projects() {
  const { can, user, toast, project: gProject, company } = useStore();
  const isAdmin = user?.role === 'admin';
  const [projects, setProjects] = useState([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);          // المشروع المفتوح
  const [tree, setTree] = useState(null);
  const [units, setUnits] = useState([]);
  const [uBusy, setUBusy] = useState(false);
  const [filters, setFilters] = useState({ ...emptyFilters });
  const [editP, setEditP] = useState(null);
  const [delP, setDelP] = useState(null);
  const [editU, setEditU] = useState(null);
  const [delU, setDelU] = useState(null);
  const [reserveU, setReserveU] = useState(null);
  const [unitView, setUnitView] = useState(null);
  const [buildings, setBuildings] = useState([]);
  const [floors, setFloors] = useState([]);
  const [formFloors, setFormFloors] = useState([]);
  const [floorTypes, setFloorTypes] = useState([]);
  const [matchesFor, setMatchesFor] = useState(null);
  const [editFloor, setEditFloor] = useState(null);
  const [newFloor, setNewFloor] = useState(null);
  const [addBuilding, setAddBuilding] = useState(null);
  const [clients, setClients] = useState([]);
  const cur = company.currency || 'ر.س';

  const load = () => {
    setBusy(true); setErr('');
    api('/projects' + q({ limit: 100 }))
      .then(r => { setProjects(r.data || []); setBusy(false); }).catch(e => { setErr(e.message); setBusy(false); });
  };
  useEffect(load, []);
  useEffect(() => { api('/clients' + q({ limit: 300 })).then(r => setClients(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { api('/floors/meta').then(r => setFloorTypes(r.floor_types || [])).catch(() => {}); }, []);

  const activeProjectId = sel?.id || gProject || null;

  // المباني: حسب المشروع المفتوح (أو كل المباني عند الفلترة العامة)
  useEffect(() => {
    const pid = filters.project_scope === 'all' ? null : activeProjectId;
    api('/buildings' + q(pid ? { project_id: pid } : {})).then(r => {
      setBuildings(r.data || []);
      if (r.floor_types) setFloorTypes(r.floor_types);
    }).catch(() => setBuildings([]));
  }, [activeProjectId, sel, filters.project_scope]);

  // الأدوار: حسب المبنى المختار في الفلاتر
  useEffect(() => {
    if (!filters.building_id) { setFloors([]); return; }
    api('/floors' + q({ building_id: filters.building_id })).then(r => setFloors(r.data || [])).catch(() => setFloors([]));
  }, [filters.building_id]);

  // الأدوار داخل نموذج الوحدة: حسب المبنى المختار في النموذج
  const formBuilding = editU?.building_id;
  useEffect(() => {
    if (!formBuilding) { setFormFloors([]); return; }
    api('/floors' + q({ building_id: formBuilding })).then(r => setFormFloors(r.data || [])).catch(() => setFormFloors([]));
  }, [formBuilding]);

  const buildUnitQuery = useCallback((pid) => {
    const f = filters;
    const rooms = f.rooms_quick === '6+' ? 6 : (f.rooms_quick || f.rooms);
    const op = f.rooms_quick === '6+' ? 'gte' : (f.rooms_quick ? 'eq' : f.rooms_op);
    return {
      limit: 300,
      project_id: pid || undefined,
      building_id: f.building_id || undefined,
      floor_id: f.floor_id || undefined,
      floor_type: f.floor_type || undefined,
      roof: f.roof || undefined,
      unit_type: f.unit_type || undefined,
      status: f.status || undefined,
      rooms: rooms || undefined,
      rooms_op: rooms ? op : undefined,
      rooms_max: (op === 'between' ? f.rooms_max : undefined) || undefined,
      price_min: f.price_min || undefined,
      price_max: f.price_max || undefined,
      area_min: f.area_min || undefined,
      area_max: f.area_max || undefined,
      q: f.q || undefined
    };
  }, [filters]);

  const loadUnits = useCallback((pid) => {
    const scope = filters.project_scope === 'all' ? null : (pid ?? null);
    setUBusy(true);
    api('/units' + q(buildUnitQuery(scope)))
      .then(r => { setUnits(r.data || []); setUBusy(false); }).catch(e => { setErr(e.message); setUBusy(false); });
  }, [buildUnitQuery, filters.project_scope]);

  useEffect(() => { if (sel || filters.project_scope === 'all') loadUnits(sel?.id); }, [sel, gProject, filters, loadUnits]);

  const S = (k, v) => setFilters(x => ({ ...x, [k]: v }));
  const setFilter = (k, v) => setFilters(x => {
    const n = { ...x, [k]: v };
    if (k === 'building_id') { n.floor_id = ''; n.floor_type = ''; }
    return n;
  });

  const openProject = async (p) => {
    setSel(p);
    setFilters(x => ({ ...x, project_scope: 'one' }));
    try { const r = await api(`/projects/${p.id}/tree`); setTree(r); } catch { setTree(null); }
  };
  const refreshTree = async () => { if (sel) { try { setTree(await api(`/projects/${sel.id}/tree`)); } catch {} } };

  const saveProject = async (f) => {
    if (!f.name?.trim()) { toast('اسم المشروع مطلوب', 'error'); return; }
    if (f.id && !isAdmin) { toast('صلاحية مرفوضة: تعديل المشاريع متاح لمدير النظام (Admin) فقط', 'error'); return; }
    try {
      if (f.id) await api('/projects/' + f.id, { method: 'PUT', body: f });
      else await api('/projects', { method: 'POST', body: f });
      toast('تم حفظ المشروع بنجاح'); setEditP(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const delProject = async (p) => {
    if (!isAdmin) { toast('صلاحية مرفوضة: حذف المشاريع متاح لمدير النظام (Admin) فقط', 'error'); return; }
    try {
      await api('/projects/' + p.id, { method: 'DELETE' });
      toast('تم حذف المشروع بنجاح');
      setDelP(null);
      setEditP(null);
      if (sel?.id === p.id) { setSel(null); setTree(null); }
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const saveUnit = async (f) => {
    if (!f.project_id || !(+f.price > 0)) { toast('المشروع وسعر صالح حقول مطلوبة', 'error'); return; }
    if (f.id && !isAdmin) { toast('صلاحية مرفوضة: تعديل الوحدات متاح لمدير النظام (Admin) فقط', 'error'); return; }
    try {
      const body = { ...f, building_id: f.building_id || null, floor_id: f.floor_id || null };
      if (body.id) await api('/units/' + body.id, { method: 'PUT', body });
      else await api('/units', { method: 'POST', body });
      toast('تم حفظ الوحدة بنجاح'); setEditU(null); loadUnits(sel?.id); load(); refreshTree();
    } catch (e) { toast(e.message, 'error'); }
  };

  const delUnit = async (u) => {
    if (!isAdmin) { toast('صلاحية مرفوضة: حذف الوحدات متاح لمدير النظام (Admin) فقط', 'error'); return; }
    try {
      await api('/units/' + u.id, { method: 'DELETE' });
      toast('تم حذف الوحدة بنجاح');
      setDelU(null);
      setEditU(null);
      loadUnits(sel?.id); load(); refreshTree();
    } catch (e) { toast(e.message, 'error'); }
  };

  const doReserve = async (f) => {
    try {
      const r = await api('/reservations', { method: 'POST', body: f });
      toast(`تم إنشاء الحجز ${r.code}`);
      setReserveU(null); loadUnits(sel?.id); load(); refreshTree();
    } catch (e) { toast(e.message, 'error'); }
  };

  const saveFloor = async (f) => {
    try {
      if (f.id) { await api('/floors/' + f.id, { method: 'PUT', body: f }); toast('تم تحديث الدور'); setEditFloor(null); }
      else { await api(`/buildings/${f.building_id}/floors`, { method: 'POST', body: f }); toast('تمت إضافة الدور'); setNewFloor(null); }
      refreshTree(); loadUnits(sel?.id);
    } catch (e) { toast(e.message, 'error'); }
  };
  const delFloor = async (f) => {
    try { await api('/floors/' + f.id, { method: 'DELETE' }); toast('تم حذف الدور'); refreshTree(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const saveBuilding = async (f) => {
    try {
      await api(`/projects/${f.project_id}/buildings`, { method: 'POST', body: { name: f.name, floors_count: +f.floors_count || 1 } });
      toast('تمت إضافة المبنى'); setAddBuilding(null); refreshTree();
    } catch (e) { toast(e.message, 'error'); }
  };

  // ---------- المطابقة: العملاء المهتمون بهذه الوحدة ----------
  const openMatches = async (u) => {
    setMatchesFor({ unit: u, busy: true, rows: [], minScore: 0 });
    try {
      const r = await api(`/units/${u.id}/matches?min_score=0&limit=100`);
      setMatchesFor({ unit: r.unit || u, busy: false, rows: r.matches || [], minScore: 0 });
    } catch (e) { toast(e.message, 'error'); setMatchesFor({ unit: u, busy: false, rows: [], err: e.message }); }
  };

  const waForMatch = async (m) => {
    try {
      const r = await api('/interests/messages', { method: 'POST', body: { interest_ids: [m.id], template: DEFAULT_TPL, unit_id: matchesFor.unit.id } });
      const msg = (r.messages || [])[0];
      if (!msg) return toast('لا يمكن تجهيز الرسالة', 'error');
      await api('/interests/log-contact', { method: 'POST', body: { interest_ids: [m.id], unit_id: matchesFor.unit.id, note: `مراسلة بخصوص الوحدة ${matchesFor.unit.code}` } });
      navigator.clipboard?.writeText(msg.text).catch(() => {});
      toast('تم تجهيز الرسالة وتسجيل فتح واتساب');
      window.open(msg.wa_link, '_blank');
    } catch (e) { toast(e.message, 'error'); }
  };
  const openClientFile = (m) => {
    try { sessionStorage.setItem('ss_open_client', String(m.client_id)); } catch {}
    location.hash = '#/clients';
  };

  const floorLabel = (u) => u.floor_display || u.floor_name || (u.floor_type ? (L.floorType[u.floor_type] || '') : '') || '—';

  return (
    <>
      <PageHead title="المشاريع والوحدات" sub="مشاريع ← مباني ← أدوار (بنوع الدور) ← وحدات مع عدد الغرف — فلاتر متقدمة ومطابقة العملاء المهتمين"
        actions={<>
          <Btn v="o" onClick={() => { setFilters({ ...emptyFilters, project_scope: 'all' }); setSel(null); setTree(null); }}><I n="search" s={15} /> بحث في كل الوحدات</Btn>
          {can('projects', 'create') && <Btn v="g" onClick={() => setEditP({})}><I n="plus" s={15} /> مشروع جديد</Btn>}
        </>} />

      {err && <ErrBox msg={err} retry={load} />}
      {busy && <Skeleton n={3} />}

      {/* ============ قائمة المشاريع ============ */}
      {!busy && !err && !sel && filters.project_scope !== 'all' && (
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3.5 anim-in">
          {projects.map(p => {
            const pct = p.units_count ? Math.round((p.sold_count / p.units_count) * 100) : 0;
            return (
              <div key={p.id} className="card card-h p-4 cursor-pointer" onClick={() => openProject(p)}>
                <div className="flex items-center justify-between mb-2">
                  <span className="w-11 h-11 rounded-xl grad-bg text-white flex items-center justify-center font-bold text-[15px] num">{p.code}</span>
                  <Badge c={p.status === 'active' ? 'b-green' : 'b-gray'}>{p.status === 'active' ? 'نشط' : p.status === 'upcoming' ? 'قادم' : p.status === 'completed' ? 'مكتمل' : 'موقوف'}</Badge>
                </div>
                <b className="text-[15px]">{p.name}</b>
                <div className="text-[12px]" style={{ color: 'var(--ink2)' }}>{p.city}</div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div className="rounded-lg py-1.5" style={{ background: 'var(--card2)' }}><div className="font-bold num">{p.units_count || 0}</div><div className="text-[10.5px]" style={{ color: 'var(--ink3)' }}>وحدة</div></div>
                  <div className="rounded-lg py-1.5" style={{ background: 'rgba(22,163,74,.1)' }}><div className="font-bold num" style={{ color: 'var(--ok)' }}>{p.available_count || 0}</div><div className="text-[10.5px]" style={{ color: 'var(--ink3)' }}>متاح</div></div>
                  <div className="rounded-lg py-1.5" style={{ background: 'rgba(29,97,245,.1)' }}><div className="font-bold num" style={{ color: 'var(--brand)' }}>{p.sold_count || 0}</div><div className="text-[10.5px]" style={{ color: 'var(--ink3)' }}>مباع</div></div>
                </div>
                <div className="h-2 rounded-full mt-3" style={{ background: 'var(--bg2)' }}><div className="h-full rounded-full grad-bg transition-all" style={{ width: pct + '%' }} /></div>
                <div className="text-[11px] mt-1 num" style={{ color: 'var(--ink3)' }}>نسبة البيع {pct}%</div>
                {isAdmin && (
                  <div className="mt-2 flex gap-1.5" onClick={e => e.stopPropagation()}>
                    <Btn v="g" size="xs" onClick={() => setEditP(p)}><I n="edit" s={13} /> تعديل</Btn>
                    <Btn v="d" size="xs" onClick={() => setDelP(p)} title="حذف المشروع"><I n="trash" s={13} /></Btn>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ============ الوحدات + الفلاتر ============ */}
      {!busy && !err && (sel || filters.project_scope === 'all') && (
        <div className="anim-in">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Btn v="g" size="sm" onClick={() => { setSel(null); setTree(null); setFilters({ ...emptyFilters }); }}>→ عودة للمشاريع</Btn>
            <b className="text-[16px]">{sel ? `مشروع ${sel.code} — ${sel.name}` : 'كل الوحدات (كل المشاريع)'}</b>
            <div className="mr-auto flex gap-1.5">
              <select className="inp" style={{ width: 210 }} value={sel?.id || ''} onChange={e => {
                const p = projects.find(x => String(x.id) === e.target.value);
                if (p) openProject(p); else { setSel(null); setFilters(x => ({ ...x, project_scope: 'all', building_id: '', floor_id: '' })); setTree(null); }
              }}>
                <option value="">كل المشاريع</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </select>
              {can('units', 'create') && <Btn size="sm" onClick={() => setEditU({ project_id: sel?.id || '', status: 'available', rooms: 3, type: 'apartment', building_id: '', floor_id: '' })}><I n="plus" s={14} /> وحدة جديدة</Btn>}
            </div>
          </div>

          <div className="card p-3.5 mb-4 anim-in">
            <div className="flex gap-2.5 flex-wrap items-center mb-3">
              <SearchInp value={filters.q} onChange={v => setFilter('q', v)} ph="بحث بكود الوحدة أو الوصف..." className="flex-1 min-w-[180px]" />
              <Tabs tabs={[{ k: '', t: 'كل الحالات' }, ...Object.entries(L.unitStatus).map(([k, t]) => ({ k, t }))]} val={filters.status} onChange={v => setFilter('status', v)} />
              {(Object.values(filters).some(v => v !== '' && v !== 'eq')) && <Btn v="o" size="sm" onClick={() => setFilters({ ...emptyFilters, project_scope: filters.project_scope })}><I n="refresh" s={14} /> مسح الفلاتر</Btn>}
            </div>

            <div className="grid sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">
              <Field label="المبنى">
                <select className="inp" value={filters.building_id} onChange={e => setFilter('building_id', e.target.value)}>
                  <option value="">كل المباني</option>
                  {buildings.map(b => <option key={b.id} value={b.id}>{b.name}{b.project_code ? ` (${b.project_code})` : ''}</option>)}
                </select>
              </Field>
              <Field label="الدور">
                <select className="inp" value={filters.floor_id} onChange={e => setFilter('floor_id', e.target.value)} disabled={!filters.building_id}>
                  <option value="">{filters.building_id ? 'كل الأدوار' : 'اختر المبنى أولًا'}</option>
                  {floors.map(f => <option key={f.id} value={f.id}>{f.display_name || f.name}</option>)}
                </select>
              </Field>
              <Field label="نوع الدور">
                <select className="inp" value={filters.floor_type} onChange={e => setFilter('floor_type', e.target.value)}>
                  <option value="">الكل</option>
                  {(floorTypes.length ? floorTypes : Object.entries(L.floorType).map(([k, t]) => ({ k, t }))).map(t => <option key={t.k} value={t.k}>{t.t}</option>)}
                </select>
              </Field>
              <Field label="روف">
                <select className="inp" value={filters.roof} onChange={e => setFilter('roof', e.target.value)}>
                  <option value="">الكل</option><option value="1">وحدات بروف</option><option value="0">بدون روف</option>
                </select>
              </Field>
              <Field label="عدد الغرف">
                <select className="inp" value={filters.rooms_quick} onChange={e => setFilter('rooms_quick', e.target.value)}>
                  {ROOM_QUICK.map(r => <option key={r.k} value={r.k}>{r.t}</option>)}
                </select>
              </Field>
              <Field label="نوع الوحدة">
                <select className="inp" value={filters.unit_type} onChange={e => setFilter('unit_type', e.target.value)}>
                  <option value="">الكل</option>
                  {Object.entries(L.propertyType).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                </select>
              </Field>

              <Field label="غرف — بحث متقدم">
                <div className="flex gap-1">
                  <select className="inp" style={{ width: 78 }} value={filters.rooms_op} onChange={e => setFilter('rooms_op', e.target.value)} disabled={!!filters.rooms_quick}>
                    <option value="eq">=</option><option value="gt">&gt;</option><option value="gte">≥</option><option value="lt">&lt;</option><option value="lte">≤</option><option value="between">بين</option>
                  </select>
                  <input type="number" className="inp num" placeholder="3" value={filters.rooms} onChange={e => { setFilter('rooms', e.target.value); setFilter('rooms_quick', ''); }} disabled={!!filters.rooms_quick} />
                  {filters.rooms_op === 'between' && <input type="number" className="inp num" placeholder="إلى" value={filters.rooms_max} onChange={e => setFilter('rooms_max', e.target.value)} />}
                </div>
              </Field>
              <Field label="السعر من"><input type="number" className="inp num" value={filters.price_min} onChange={e => setFilter('price_min', e.target.value)} placeholder="0" /></Field>
              <Field label="السعر إلى"><input type="number" className="inp num" value={filters.price_max} onChange={e => setFilter('price_max', e.target.value)} placeholder="0" /></Field>
              <Field label="المساحة من"><input type="number" className="inp num" value={filters.area_min} onChange={e => setFilter('area_min', e.target.value)} placeholder="0" /></Field>
              <Field label="المساحة إلى"><input type="number" className="inp num" value={filters.area_max} onChange={e => setFilter('area_max', e.target.value)} placeholder="0" /></Field>
            </div>
            <div className="text-[12px] mt-2" style={{ color: 'var(--ink3)' }}>
              النتائج: <b className="num">{units.length}</b> وحدة — الفلاتر تعمل مجتمعة (المشروع + المبنى + الدور + نوع الدور + روف + عدد الغرف + السعر + الحالة)
            </div>
          </div>

          {uBusy && <Skeleton n={3} />}
          {!uBusy && (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3.5">
              {units.map(u => (
                <div key={u.id} className="card card-h p-4">
                  <div className="flex items-center justify-between">
                    <b className="text-[15px] num">{u.code}</b>
                    <Badge c={badge.unitStatus[u.status]}>{L.unitStatus[u.status]}</Badge>
                  </div>
                  <div className="text-[12.5px] mt-1" style={{ color: 'var(--ink2)' }}>
                    {u.project_name ? `${u.project_name} — ` : ''}{u.building_name || 'بدون مبنى'}
                    {u.floor_type === 'roof' ? <Badge c="b-purple">روف</Badge> : null}
                  </div>
                  <div className="text-[12.5px] mt-1 flex items-center gap-1.5">
                    <I n={FLOOR_TYPE_ICON[u.floor_type] || 'layers'} s={14} />
                    <span>الدور: <b>{floorLabel(u)}</b></span>
                  </div>
                  <div className="flex gap-4 mt-2.5 text-[13px] flex-wrap">
                    <span><I n="grid" s={13} /> <b className="num">{u.rooms > 0 ? u.rooms : 'غير محدد'}</b> غرف</span>
                    <span>المساحة <b className="num">{fmtN(u.area)}</b> م²</span>
                    {u.bathrooms > 0 && <span>حمامات <b className="num">{u.bathrooms}</b></span>}
                  </div>
                  <div className="mt-2 text-[17px] font-bold num" style={{ color: 'var(--brand)' }}>{fmtN(u.price)} <span className="text-[12px] font-semibold" style={{ color: 'var(--ink3)' }}>{cur}</span></div>
                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    {(u.status === 'available' || u.status === 'resale') && can('reservations', 'create') && <Btn size="sm" onClick={() => setReserveU(u)}><I n="key" s={14} /> حجز</Btn>}
                    <Btn v="g" size="sm" onClick={() => openMatches(u)} title="العملاء المهتمون بهذه الوحدة"><I n="target" s={14} /> المهتمون</Btn>
                    <Btn v="g" size="sm" onClick={() => setUnitView(u)} title="السجل والمرفقات"><I n="eye" s={14} /> السجل</Btn>
                    {isAdmin && (
                      <>
                        <Btn v="g" size="sm" onClick={() => setEditU({ ...u, building_id: u.building_id || '', floor_id: u.floor_id || '' })} title="تعديل الوحدة"><I n="edit" s={14} /></Btn>
                        <Btn v="d" size="sm" onClick={() => setDelU(u)} title="حذف الوحدة"><I n="trash" s={14} /></Btn>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!uBusy && units.length === 0 && <div className="card mt-2"><Empty icon="home" title="لا توجد وحدات مطابقة" sub="عدّل الفلاتر أو أضف وحدة جديدة" /></div>}

          {/* تصنيف اختياري: المباني والأدوار (ليست محور الهيكلة — الوحدات هي المحور) */}
          {sel && tree && tree.buildings?.length > 0 && (
            <div className="card p-5 mt-5">
              <div className="flex items-center justify-between mb-2">
                <b className="text-[15px]">تصنيف اختياري — المباني والأدوار</b>
                {can('projects', 'create') && <Btn v="o" size="sm" onClick={() => setAddBuilding({ project_id: sel.id, name: '', floors_count: 1 })}><I n="plus" s={14} /> مبنى جديد</Btn>}
              </div>
              {tree.buildings.map(b => (
                <div key={b.id} className="mt-3 rounded-xl p-3" style={{ background: 'var(--card2)' }}>
                  <div className="flex items-center justify-between">
                    <b className="text-[13.5px]">مبنى {b.name} — {b.floors.length} أدوار</b>
                    {can('projects', 'create') && <button className="btn btn-o btn-sm" onClick={() => setNewFloor({ building_id: b.id, number: (b.floors.length || 0) + 1, type: 'normal', name: '' })}><I n="plus" s={13} /> دور</button>}
                  </div>
                  {b.floors.map(f => (
                    <div key={f.id} className="mt-2 mr-3 flex items-start gap-2 flex-wrap">
                      <span className="text-[12.5px] font-semibold" style={{ color: 'var(--ink2)' }}>
                        {f.display_name || f.name}
                        {f.type === 'roof' && !/روف/.test(f.display_name || f.name) ? ' — روف' : ''}
                      </span>
                      <Badge c={f.type === 'roof' ? 'b-purple' : 'b-gray'}>{L.floorType[f.type] || f.type}</Badge>
                      <span className="text-[12.5px]"> {f.units.map(u => u.code).join('، ') || 'لا وحدات'}</span>
                      {can('projects', 'edit') && <button className="icon-btn" title="تعديل الدور/نوعه" onClick={() => setEditFloor({ ...f })}><I n="edit" s={13} /></button>}
                      {can('projects', 'delete') && <button className="icon-btn" title="حذف الدور" onClick={() => delFloor(f)}><I n="trash" s={13} /></button>}
                    </div>
                  ))}
                  {b.direct_units?.length > 0 && <div className="mt-2 mr-3 text-[12px]" style={{ color: 'var(--ink3)' }}>وحدات بلا دور: {b.direct_units.map(u => u.code).join('، ')}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============ نماذج ============ */}
      <Modal open={!!editP} onClose={() => setEditP(null)} title={editP?.id ? 'تعديل المشروع' : 'مشروع جديد'} w={520}
        actions={<>
          <Btn onClick={() => saveProject(editP)}>حفظ</Btn>
          {isAdmin && editP?.id && <Btn v="d" onClick={() => { const p = editP; setEditP(null); setDelP(p); }}><I n="trash" s={14} /> حذف</Btn>}
          <Btn v="g" onClick={() => setEditP(null)}>إلغاء</Btn>
        </>}>
        {editP && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="كود المشروع" hint={editP.id ? 'كود المشروع' : 'تلقائي من النظام (PROJECT-0001)'}><input className="inp num" value={editP.code || ''} onChange={e => setEditP({ ...editP, code: e.target.value })} placeholder="PROJECT-0001 (تلقائي)" /></Field>
              <Field label="اسم المشروع *"><input className="inp" value={editP.name || ''} onChange={e => setEditP({ ...editP, name: e.target.value })} /></Field>
              <Field label="المدينة"><input className="inp" value={editP.city || ''} onChange={e => setEditP({ ...editP, city: e.target.value })} /></Field>
              <Field label="الحالة"><select className="inp" value={editP.status || 'active'} onChange={e => setEditP({ ...editP, status: e.target.value })}><option value="active">نشط</option><option value="upcoming">قادم</option><option value="completed">مكتمل</option><option value="paused">موقوف</option></select></Field>
            </div>
            <Field label="العنوان"><input className="inp" value={editP.address || ''} onChange={e => setEditP({ ...editP, address: e.target.value })} /></Field>
            <Field label="الوصف"><textarea className="inp" rows={2} value={editP.description || ''} onChange={e => setEditP({ ...editP, description: e.target.value })} /></Field>
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--card2)' }}>
              <div className="text-[12.5px] font-bold">هيكلة الوحدات</div>
              <p className="text-[11.5px]" style={{ color: 'var(--ink3)' }}>
                الافتراضي: الوحدات تتبع المشروع مباشرة. فعّل الخيارين فقط إذا كان هذا المشروع يحتاج إلزام المبنى/الدور.
              </p>
              <label className="flex items-center gap-2 text-[12.5px]">
                <input type="checkbox" checked={Number(editP.require_building) === 1} onChange={e => setEditP({ ...editP, require_building: e.target.checked ? 1 : 0 })} />
                إلزام تحديد المبنى قبل إضافة الوحدة
              </label>
              <label className="flex items-center gap-2 text-[12.5px]">
                <input type="checkbox" checked={Number(editP.require_floor) === 1} onChange={e => setEditP({ ...editP, require_floor: e.target.checked ? 1 : 0 })} />
                إلزام تحديد الدور قبل إضافة الوحدة
              </label>
            </div>
          </div>
        )}
      </Modal>

      {/* وحدة: مشروع ← وحدة (المبنى/الدور اختياريان) */}
      <Modal open={!!editU} onClose={() => setEditU(null)} title={editU?.id ? 'تعديل الوحدة' : 'وحدة جديدة'} w={620}
        actions={<>
          <Btn onClick={() => saveUnit(editU)}>حفظ الوحدة</Btn>
          {isAdmin && editU?.id && <Btn v="d" onClick={() => { const u = editU; setEditU(null); setDelU(u); }}><I n="trash" s={14} /> حذف</Btn>}
          <Btn v="g" onClick={() => setEditU(null)}>إلغاء</Btn>
        </>}>
        {editU && (
          <div className="space-y-3">
            <div className="rounded-xl p-2.5 text-[12.5px]" style={{ background: 'var(--card2)', color: 'var(--ink2)' }}>
              التسلسل الأساسي: <b>المشروع ← الوحدة</b>. اختر المشروع ثم أدخل بيانات الوحدة مباشرة.
              المبنى والدور <b>اختياريان</b> للتصنيف فقط — لا يُشترطان لإنشاء الوحدة.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="كود الوحدة" hint={editU.id ? 'كود الوحدة' : 'تلقائي من النظام (UNIT-0001)'}><input className="inp num" value={editU.code || ''} onChange={e => setEditU({ ...editU, code: e.target.value })} placeholder="UNIT-0001 (تلقائي)" /></Field>
              <Field label="المشروع *">
                <select className="inp" value={editU.project_id || ''} onChange={e => { const pid = +e.target.value; setEditU({ ...editU, project_id: pid, building_id: '', floor_id: '' }); api('/buildings' + q({ project_id: pid })).then(r => setBuildings(r.data || [])).catch(() => {}); }}>
                  <option value="">— اختر المشروع —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                </select>
              </Field>
              <Field label={`المبنى (اختياري)${Number(editU.require_building) === 1 ? ' — مطلوب في هذا المشروع' : ''}`}>
                <select className="inp" value={editU.building_id || ''} onChange={e => setEditU({ ...editU, building_id: +e.target.value || '', floor_id: '' })} disabled={!editU.project_id}>
                  <option value="">{editU.project_id ? '— بدون مبنى —' : 'اختر المشروع أولًا'}</option>
                  {buildings.filter(b => !editU.project_id || b.project_id === +editU.project_id).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <Field label={`الدور (اختياري)${Number(editU.require_floor) === 1 ? ' — مطلوب في هذا المشروع' : ''}`}>
                <select className="inp" value={editU.floor_id || ''} onChange={e => setEditU({ ...editU, floor_id: +e.target.value || '' })} disabled={!editU.building_id}>
                  <option value="">{editU.building_id ? '— بدون دور —' : 'اختر مبنى أولًا (اختياري)'}</option>
                  {formFloors.map(f => <option key={f.id} value={f.id}>{(f.display_name || f.name)}{f.type === 'roof' && !/روف/.test(f.display_name || f.name) ? ' — روف' : ''}</option>)}
                </select>
              </Field>
              <Field label="النوع"><select className="inp" value={editU.type || 'apartment'} onChange={e => setEditU({ ...editU, type: e.target.value })}>{Object.entries(L.propertyType).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
              <Field label="الحالة"><select className="inp" value={editU.status || 'available'} onChange={e => setEditU({ ...editU, status: e.target.value })}>{Object.entries(L.unitStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="عدد الغرف"><input type="number" min={0} className="inp num" value={editU.rooms ?? 3} onChange={e => setEditU({ ...editU, rooms: +e.target.value })} /></Field>
              <Field label="عدد الحمامات"><input type="number" min={0} className="inp num" value={editU.bathrooms || 0} onChange={e => setEditU({ ...editU, bathrooms: +e.target.value })} /></Field>
              <Field label="المساحة م²"><input type="number" min={0} className="inp num" value={editU.area || 0} onChange={e => setEditU({ ...editU, area: +e.target.value })} /></Field>
              <Field label="مواقف السيارات"><input type="number" min={0} className="inp num" value={editU.parking || 0} onChange={e => setEditU({ ...editU, parking: +e.target.value })} /></Field>
              <Field label="حالة التسليم"><select className="inp" value={editU.delivery_status || 'ready'} onChange={e => setEditU({ ...editU, delivery_status: e.target.value })}><option value="ready">جاهزة للتسليم</option><option value="under_construction">تحت الإنشاء</option><option value="off_plan">على الخارطة</option></select></Field>
              <Field label="يوجد روف"><select className="inp" value={Number(editU.has_roof) ? '1' : '0'} onChange={e => setEditU({ ...editU, has_roof: e.target.value === '1' ? 1 : 0 })}><option value="0">لا</option><option value="1">نعم</option></select></Field>
            </div>
            <Field label={`السعر (${cur}) *`}><input type="number" min={0} className="inp num" value={editU.price || 0} onChange={e => setEditU({ ...editU, price: +e.target.value })} /></Field>
            <Field label="وصف"><input className="inp" value={editU.description || ''} onChange={e => setEditU({ ...editU, description: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      {/* مبنى جديد */}
      <Modal open={!!addBuilding} onClose={() => setAddBuilding(null)} title="مبنى جديد" w={460}
        actions={<><Btn onClick={() => saveBuilding(addBuilding)}>حفظ المبنى</Btn><Btn v="g" onClick={() => setAddBuilding(null)}>إلغاء</Btn></>}>
        {addBuilding && (
          <div className="space-y-3">
            <Field label="اسم المبنى *"><input className="inp" value={addBuilding.name} onChange={e => setAddBuilding({ ...addBuilding, name: e.target.value })} placeholder="المبنى A" /></Field>
            <Field label="عدد الأدوار"><input type="number" min={1} className="inp num" value={addBuilding.floors_count} onChange={e => setAddBuilding({ ...addBuilding, floors_count: e.target.value })} /></Field>
            <div className="text-[12px]" style={{ color: 'var(--ink3)' }}>سيتم إنشاء أدوار عادية، ويمكنك بعدها تحديد نوع أي دور (روف/سطح/ميزانين...).</div>
          </div>
        )}
      </Modal>

      {/* إضافة/تعديل دور */}
      <Modal open={!!newFloor || !!editFloor} onClose={() => { setNewFloor(null); setEditFloor(null); }} title={editFloor ? 'تعديل الدور ونوعه' : 'إضافة دور'} w={480}
        actions={<><Btn onClick={() => saveFloor(newFloor || editFloor)}>حفظ</Btn><Btn v="g" onClick={() => { setNewFloor(null); setEditFloor(null); }}>إلغاء</Btn></>}>
        {(newFloor || editFloor) && (() => {
          const f = newFloor || editFloor;
          const setF = (k, v) => (newFloor ? setNewFloor({ ...f, [k]: v }) : setEditFloor({ ...f, [k]: v }));
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="رقم الدور *"><input type="number" className="inp num" value={f.number} onChange={e => setF('number', +e.target.value)} /></Field>
                <Field label="نوع الدور *">
                  <select className="inp" value={f.type || 'normal'} onChange={e => setF('type', e.target.value)}>
                    {(floorTypes.length ? floorTypes : Object.entries(L.floorType).map(([k, t]) => ({ k, t }))).map(t => <option key={t.k} value={t.k}>{t.t}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="اسم الدور (اختياري)"><input className="inp" value={f.name || ''} onChange={e => setF('name', e.target.value)} placeholder="اتركه فارغًا ليُسمّى تلقائيًا — مثال: الدور 5 — روف" /></Field>
              <div className="text-[12.5px] rounded-xl p-2.5" style={{ background: 'var(--card2)', color: 'var(--ink2)' }}>
                نوع الدور يُحدَّد لكل دور على حدة: يمكن أن يكون الدور الخامس «روف» في مشروع، ودورًا عاديًا في مشروع آخر. النظام لا يفترض ذلك تلقائيًا.
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* العملاء المهتمون بالوحدة */}
      <Modal open={!!matchesFor} onClose={() => setMatchesFor(null)} title={`العملاء المهتمون بالوحدة ${matchesFor?.unit?.code || ''}`} w={1000}
        actions={<>
          {matchesFor && <Btn v="o" onClick={() => window.open(`/api/units/${matchesFor.unit.id}/matches/excel?min_score=0`, '_blank')}><I n="dl" s={15} /> Excel</Btn>}
          <Btn v="g" onClick={() => setMatchesFor(null)}>إغلاق</Btn>
        </>}>
        {matchesFor && (
          <div className="space-y-3">
            <div className="rounded-xl p-3 text-[13px]" style={{ background: 'var(--card2)' }}>
              <b>الوحدة:</b> {matchesFor.unit.code} — {matchesFor.unit.project_name || ''} — {matchesFor.unit.building_name || 'بدون مبنى'} —{' '}
              الدور: <b>{matchesFor.unit.floor_label || matchesFor.unit.floor_display || matchesFor.unit.floor_name || 'غير محدد'}</b> —{' '}
              {L.propertyType[matchesFor.unit.type] || matchesFor.unit.type} — <b className="num">{matchesFor.unit.rooms}</b> غرف —{' '}
              <b className="num">{fmtN(matchesFor.unit.area)}</b> م² — <b className="num">{fmtN(matchesFor.unit.price)}</b> {cur}
              {matchesFor.unit.has_roof || matchesFor.unit.floor_type === 'roof' ? ' — يوجد روف' : ''}
            </div>
            {matchesFor.busy && <Skeleton n={2} />}
            {!matchesFor.busy && matchesFor.rows.length === 0 && <Empty icon="users" title="لا يوجد عملاء مطابقون حاليًا" sub="لم تُطابق اهتمامات أي عميل مع مواصفات هذه الوحدة" />}
            {!matchesFor.busy && matchesFor.rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="tbl min-w-[900px]">
                  <thead><tr>
                    {['العميل', 'الجوال', 'نوع الاهتمام', 'المشروع المطلوب', 'الميزانية', 'الغرف', 'المساحة', 'الدور', 'روف', 'آخر تواصل', 'الموظف', 'التوافق', 'إجراءات'].map(h => <th key={h}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {matchesFor.rows.map(m => (
                      <tr key={m.id}>
                        <td><b>{m.client_name}</b><div className="text-[11px] num" style={{ color: 'var(--ink3)' }}>{m.code}</div></td>
                        <td className="num">{m.client_phone || '—'}</td>
                        <td>{L.propertyType[m.property_type] || m.property_type}</td>
                        <td>{m.project_name || 'أي مشروع'}</td>
                        <td className="num">{fmtN(m.budget_min)} — {fmtN(m.budget_max)}</td>
                        <td className="center num">{m.rooms > 0 ? m.rooms : 'غير محدد'}</td>
                        <td className="num">{(m.area_min || m.area_max) ? `${fmtN(m.area_min)} — ${fmtN(m.area_max)}` : 'غير محدد'}</td>
                        <td>{m.floor_label || (m.floor_pref ? (L.floorType[m.floor_pref] || m.floor_pref) : 'غير محدد')}</td>
                        <td className="center">{Number(m.wants_roof) ? <Badge c="b-purple">نعم</Badge> : '—'}</td>
                        <td className="num">{fmtD(m.last_contact_at)}</td>
                        <td>{m.employee_name || '—'}</td>
                        <td className="center"><Badge c={m.score >= 70 ? 'b-green' : m.score >= 45 ? 'b-amber' : 'b-gray'}>{m.score}%</Badge></td>
                        <td className="center">
                          <div className="flex gap-1 justify-center">
                            <button className="icon-btn" title="فتح ملف العميل" onClick={() => openClientFile(m)}><I n="user" s={14} /></button>
                            <button className="icon-btn" title="مراسلة واتساب" onClick={() => waForMatch(m)}><I n="chat" s={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!matchesFor.busy && matchesFor.rows.length > 0 && (
              <div className="text-[12px]" style={{ color: 'var(--ink3)' }}>
                أسباب التوافق: {matchesFor.rows.slice(0, 1).map(m => (m.reasons || []).join('، ')).join('')} — يُحسب التوافق من نوع العقار والمشروع والسعر والغرف والحمامات والمساحة والدور/الروف، والقيمة غير المحددة لا تُمنع المطابقة.
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* حجز */}
      <ReserveModal open={!!reserveU} unit={reserveU} clients={clients} cur={cur} onClose={() => setReserveU(null)} onSave={doReserve} />

      {/* سجل الوحدة + المرفقات */}
      <Modal open={!!unitView} onClose={() => setUnitView(null)} title={`ملف الوحدة ${unitView?.code}`} w={640}>
        {unitView && <div className="space-y-4">
          <div className="rounded-xl p-3 text-[13px] grid sm:grid-cols-2 gap-2" style={{ background: 'var(--card2)' }}>
            <div>المشروع: <b>{unitView.project_name || '—'}</b></div>
            <div>المبنى: <b>{unitView.building_name || '—'}</b></div>
            <div>الدور: <b>{floorLabel(unitView)}</b>{unitView.floor_type ? <Badge c={unitView.floor_type === 'roof' ? 'b-purple' : 'b-gray'}>{L.floorType[unitView.floor_type] || unitView.floor_type}</Badge> : null}</div>
            <div>رقم/كود الوحدة: <b className="num">{unitView.code}</b></div>
            <div>عدد الغرف: <b className="num">{unitView.rooms > 0 ? unitView.rooms : 'غير محدد'}</b></div>
            <div>الحمامات: <b className="num">{unitView.bathrooms || 0}</b> — المواقف: <b className="num">{unitView.parking || 0}</b></div>
            <div>المساحة: <b className="num">{fmtN(unitView.area)}</b> م²</div>
            <div>السعر: <b className="num" style={{ color: 'var(--brand)' }}>{fmtN(unitView.price)} {cur}</b></div>
          </div>
          <div className="flex gap-2">
            <Btn v="g" size="sm" onClick={() => openMatches(unitView)}><I n="target" s={14} /> العملاء المهتمون بهذه الوحدة</Btn>
            <Btn v="o" size="sm" onClick={() => window.open(`/api/units/${unitView.id}/matches/excel?min_score=0`, '_blank')}><I n="dl" s={14} /> تصدير المهتمين</Btn>
          </div>
          <TimelineView url={'/timeline/unit/' + unitView.id} />
          <div className="pt-2" style={{ borderTop: '1px solid var(--line)' }}><AttachFiles entity={{ unit_id: unitView.id }} /></div>
        </div>}
      </Modal>

      {/* تأكيد حذف المشروع للأدمن فقط */}
      <Confirm open={!!delP} onClose={() => setDelP(null)} title="حذف المشروع" msg={`هل أنت متأكد من حذف المشروع "${delP?.name}" (${delP?.code})؟ سيتم حذف المشروع ولا يمكن التراجع.`} okText="حذف المشروع" onOk={() => delProject(delP)} />

      {/* تأكيد حذف الوحدة للأدمن فقط */}
      <Confirm open={!!delU} onClose={() => setDelU(null)} title="حذف الوحدة" msg={`هل أنت متأكد من حذف الوحدة "${delU?.code}"؟ سيتم حذف الوحدة ولا يمكن التراجع.`} okText="حذف الوحدة" onOk={() => delUnit(delU)} />
    </>
  );
}

export function ReserveModal({ open, unit, clients, cur, onClose, onSave }) {
  const [f, setF] = useState({});
  useEffect(() => { if (open && unit) setF({ unit_id: unit.id, price: unit.price, discount: 0, deposit: 0, deposit_method: 'cash', reservation_date: todayStr(), expiry_date: '', client_id: '', notes: '' }); }, [open]);
  const S = (k, v) => setF(x => ({ ...x, [k]: v }));
  const net = (+f.price || 0) - (+f.discount || 0);
  return (
    <Modal open={open} onClose={onClose} title={`حجز الوحدة ${unit?.code}`} w={560}
      actions={<><Btn onClick={() => onSave(f)}><I n="key" s={15} /> تأكيد الحجز</Btn><Btn v="g" onClick={onClose}>إلغاء</Btn></>}>
      <div className="space-y-3">
        <div className="rounded-xl p-3 text-[13px]" style={{ background: 'rgba(29,97,245,.07)' }}>سعر الوحدة: <b className="num">{fmtN(unit?.price)} {cur}</b></div>
        <Field label="العميل *"><select className="inp" value={f.client_id || ''} onChange={e => S('client_id', +e.target.value)}><option value="">— اختر العميل —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}</select></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={`السعر (${cur})`}><input type="number" min={0} className="inp num" value={f.price || 0} onChange={e => S('price', +e.target.value)} /></Field>
          <Field label="الخصم"><input type="number" min={0} className="inp num" value={f.discount || 0} onChange={e => S('discount', +e.target.value)} /></Field>
          <Field label="الصافي"><input className="inp num" disabled value={fmtN(net)} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="العربون"><input type="number" min={0} className="inp num" value={f.deposit || 0} onChange={e => S('deposit', +e.target.value)} /></Field>
          <Field label="طريقة الدفع"><select className="inp" value={f.deposit_method || 'cash'} onChange={e => S('deposit_method', e.target.value)}>{Object.entries(L.payMethod).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="رقم المرجع"><input className="inp num" value={f.deposit_ref || ''} onChange={e => S('deposit_ref', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="تاريخ الحجز *"><input type="date" className="inp" value={f.reservation_date || ''} onChange={e => S('reservation_date', e.target.value)} /></Field>
          <Field label="ينتهي بتاريخ"><input type="date" className="inp" value={f.expiry_date || ''} onChange={e => S('expiry_date', e.target.value)} /></Field>
        </div>
        <Field label="ملاحظات"><input className="inp" value={f.notes || ''} onChange={e => S('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
