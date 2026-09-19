import React, { useEffect, useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtD, fmtN, L, badge } from '../lib/format.js';
import { I, Btn, Badge, Empty, Skeleton, ErrBox, PageHead, Modal, Drawer, Field, SearchInp, Confirm, Avatar, Pagination } from '../components/ui.jsx';
import AttachFiles from '../components/AttachFiles.jsx';

const STC = { active: 'b-green', potential: 'b-amber', inactive: 'b-gray', vip: 'b-purple', blocked: 'b-red' };

export default function Clients() {
  const { can, toast } = useStore();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [profile, setProfile] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [users, setUsers] = useState([]);
  const [interests, setInterests] = useState(null);
  const [fin, setFin] = useState(null);
  const [intForm, setIntForm] = useState(null);
  const [meta, setMeta] = useState(null);

  const load = () => {
    setBusy(true); setErr('');
    api('/clients' + q({ page, limit: 12, q: search, status: fStatus }))
      .then(r => { setRows(r.data); setTotal(r.total); setBusy(false); }).catch(e => { setErr(e.message); setBusy(false); });
  };
  useEffect(() => { setPage(1); }, [search, fStatus]);
  useEffect(load, [page, search, fStatus]);
  useEffect(() => {
    api('/users/list').then(r => setUsers(r.data || [])).catch(() => {});
    api('/interests/meta').then(setMeta).catch(() => {});
    if (sessionStorage.getItem('ss_quick') === 'new-client') { sessionStorage.removeItem('ss_quick'); setEdit({}); }
    // فتح ملف عميل تلقائيًا عند القدوم من شاشة الوحدات/الاهتمامات
    const openId = sessionStorage.getItem('ss_open_client');
    if (openId) {
      sessionStorage.removeItem('ss_open_client');
      api('/clients/' + openId).then(c => { if (c?.id) openProfile(c); }).catch(() => {});
    }
  }, []);

  const openProfile = async (c) => {
    setProfile(c); setInterests(null); setFin(null);
    try { const r = await api(`/timeline/client/${c.id}`); setTimeline(r.events || []); } catch { setTimeline([]); }
    try { setInterests((await api(`/interests?client_id=${c.id}&limit=50`)).data || []); } catch { setInterests([]); }
    if (can('statements')) { try { setFin(await api(`/statements/client/${c.id}`)); } catch { setFin(null); } }
  };
  const saveInterest = async () => {
    try {
      const b = { ...intForm };
      ['budget_min', 'budget_max', 'rooms', 'bathrooms', 'area_min', 'area_max', 'parking'].forEach(k => { b[k] = Number(b[k] || 0); });
      b.wants_roof = b.wants_roof ? 1 : 0;
      if (b.id) await api('/interests/' + b.id, { method: 'PUT', body: b });
      else await api('/interests', { method: 'POST', body: b });
      toast('تم حفظ اهتمام العميل'); setIntForm(null);
      setInterests((await api(`/interests?client_id=${profile.id}&limit=50`)).data || []);
      load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const save = async (f) => {
    if (!f.name?.trim()) { toast('اسم العميل مطلوب', 'error'); return; }
    try {
      if (f.id) await api('/clients/' + f.id, { method: 'PUT', body: f });
      else await api('/clients', { method: 'POST', body: { ...f, code: f.code || ('C-' + Date.now().toString(36).toUpperCase()), created_by: useStore.getState().user.id } });
      toast('تم حفظ العميل'); setEdit(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title="إدارة العملاء" sub="ملف متكامل لكل عميل مع سجل تفاعلات زمني"
        actions={can('clients', 'create') && <Btn onClick={() => setEdit({})}><I n="plus" s={16} /> عميل جديد</Btn>} />

      <div className="card p-3.5 mb-4 flex gap-2.5 flex-wrap items-center anim-in">
        <SearchInp value={search} onChange={setSearch} ph="بحث بالاسم، الجوال، الشركة..." className="flex-1 min-w-[220px]" />
        <select className="inp" style={{ width: 150 }} value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="">كل الحالات</option>{Object.entries(L.clientStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {err && <ErrBox msg={err} retry={load} />}
      {busy && <Skeleton n={4} />}
      {!busy && !err && rows.length === 0 && <div className="card"><Empty icon="users" title="لا يوجد عملاء" sub="أضف عميلك الأول" action={can('clients', 'create') && <Btn onClick={() => setEdit({})}>عميل جديد</Btn>} /></div>}

      {!busy && !err && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3.5 anim-in">
          {rows.map(c => (
            <div key={c.id} className="card card-h p-4 cursor-pointer" onClick={() => openProfile(c)}>
              <div className="flex items-start gap-3">
                <Avatar name={c.name} s={46} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[15px] truncate">{c.name}</div>
                  <div className="text-[12.5px] truncate" style={{ color: 'var(--ink2)' }}>{c.company || c.job_title || c.city || '—'}</div>
                </div>
                <Badge c={STC[c.status] || 'b-gray'}>{L.clientStatus[c.status]}</Badge>
              </div>
              <div className="flex items-center gap-4 mt-3 text-[12.5px]" style={{ color: 'var(--ink2)' }}>
                {c.phone && <span className="flex items-center gap-1 num"><I n="phone" s={14} />{c.phone}</span>}
                {c.email && <span className="flex items-center gap-1 truncate"><I n="send" s={14} />{c.email}</span>}
              </div>
              <div className="grid grid-cols-3 gap-1.5 mt-3 text-center text-[11.5px]">
                <div className="rounded-lg py-1" style={{ background: 'var(--card2)' }}><div className="font-bold num">{c.interests_count ?? 0}</div><div style={{ color: 'var(--ink3)' }}>اهتمامات</div></div>
                <div className="rounded-lg py-1" style={{ background: 'var(--card2)' }}><div className="font-bold num">{fmtN(c.total_sales)}</div><div style={{ color: 'var(--ink3)' }}>مبيعات</div></div>
                <div className="rounded-lg py-1" style={{ background: 'var(--card2)' }}><div className="font-bold money-in num">{fmtN(c.total_paid)}</div><div style={{ color: 'var(--ink3)' }}>مدفوع</div></div>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
                <span className="text-[11.5px] num" style={{ color: 'var(--ink3)' }}>{c.code} — {fmtD(c.created_at)}</span>
                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                  {can('clients', 'edit') && <button className="icon-btn" onClick={() => setEdit(c)}><I n="edit" s={16} /></button>}
                  {can('clients', 'delete') && <button className="icon-btn" onClick={() => setDel(c)}><I n="trash" s={16} /></button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} pages={Math.ceil(total / 12)} total={total} onGo={setPage} />

      {/* نموذج */}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل العميل' : 'عميل جديد'} w={640}
        actions={<><Btn onClick={() => save(edit)}><I n="check" s={15} /> حفظ العميل</Btn><Btn v="g" onClick={() => setEdit(null)}>إلغاء</Btn></>}>
        {edit && <ClientForm f={edit} set={setEdit} users={users} />}
      </Modal>

      {/* الملف + التايم لاين */}
      <Drawer open={!!profile} onClose={() => setProfile(null)} title="ملف العميل" w={480}>
        {profile && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={profile.name} s={58} />
              <div><div className="font-bold text-[17px]">{profile.name}</div><div className="text-[12.5px]" style={{ color: 'var(--ink2)' }}>{profile.company} {profile.job_title ? `— ${profile.job_title}` : ''}</div></div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[13px] rounded-xl p-3" style={{ background: 'var(--card2)' }}>
              <div>الجوال: <b className="num">{profile.phone || '—'}</b></div>
              <div>البريد: <b>{profile.email || '—'}</b></div>
              <div>المدينة: <b>{profile.city || '—'}</b></div>
              <div>الحالة: <Badge c={STC[profile.status]}>{L.clientStatus[profile.status]}</Badge></div>
              <div className="col-span-2">العنوان: <b>{profile.address || '—'}</b></div>
              {profile.notes && <div className="col-span-2">ملاحظات: {profile.notes}</div>}
            </div>
            <div className="rounded-xl p-3" style={{ background: 'var(--card2)' }}>
              <div className="text-[13px]">المرحلة: <b>{L.stage[profile.pipeline_stage] || 'عميل محتمل'}</b> — آخر تواصل: <b className="num">{fmtD(profile.last_contact_at)}</b></div>
              {profile.interest_summary && <div className="text-[12.5px] mt-1" style={{ color: 'var(--ink2)' }}>ملخص الاهتمامات: {profile.interest_summary}</div>}
              {fin && <div className="grid grid-cols-3 gap-2 mt-2 text-[12px] text-center">
                <div><div className="font-bold num">{fmtN(fin.summary.net_sales)}</div><div style={{ color: 'var(--ink3)' }}>صافي المبيعات</div></div>
                <div><div className="font-bold money-in num">{fmtN(fin.summary.total_paid)}</div><div style={{ color: 'var(--ink3)' }}>المدفوع</div></div>
                <div><div className="font-bold money-due num">{fmtN(fin.summary.remaining_on_client)}</div><div style={{ color: 'var(--ink3)' }}>المتبقي</div></div>
              </div>}
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <b className="text-[14px]">اهتمامات العميل ({interests?.length ?? 0})</b>
                {can('interests', 'create') && <Btn v="o" size="sm" onClick={() => setIntForm({ client_id: profile.id, property_type: 'apartment', purpose: 'residence', priority: 'normal', is_active: 1, budget_min: '', budget_max: '', rooms: '', bathrooms: '', area_min: '', area_max: '', parking: '', wants_roof: 0 })}><I n="plus" s={14} /> إضافة اهتمام</Btn>}
              </div>
              {interests === null && <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>جارٍ التحميل...</div>}
              {interests && interests.length === 0 && <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>لا توجد اهتمامات مسجلة</div>}
              {interests && interests.length > 0 && (
                <div className="space-y-1.5">
                  {interests.map(i => (
                    <div key={i.id} className="rounded-xl p-2.5" style={{ background: 'var(--card2)' }}>
                      <div className="flex items-center justify-between">
                        <b className="text-[13px]">{L.propertyType[i.property_type] || i.property_type} — {i.rooms ? i.rooms + ' غرف' : 'أي غرف'}</b>
                        <span className="text-[11.5px] num" style={{ color: 'var(--ink3)' }}>{i.code}</span>
                      </div>
                      <div className="text-[12px]" style={{ color: 'var(--ink2)' }}>
                        {i.project_name ? i.project_name + ' — ' : ''}الميزانية: {fmtN(i.budget_min)} إلى {fmtN(i.budget_max)}
                        {i.preferred_area ? ' — ' + i.preferred_area : ''}{Number(i.wants_roof) ? ' — روف' : ''}
                      </div>
                      <div className="flex gap-1.5 mt-1.5">
                        {can('interests', 'edit') && <button className="btn btn-o btn-sm" onClick={() => setIntForm({ ...i })}><I n="edit" s={13} /> تعديل</button>}
                        {can('interests', 'view') && <button className="btn btn-o btn-sm" onClick={async () => {
                          try {
                            const r = await api('/interests/messages', { method: 'POST', body: { interest_ids: [i.id], template: 'السلام عليكم {{اسم العميل}}\nلدينا وحدات تناسب اهتمامك في {{اسم المشروع}} — {{عدد الغرف}} غرف بسعر {{السعر}}\n{{رابط الوحدة}}' } });
                            const m = r.messages[0];
                            navigator.clipboard?.writeText(m.text).catch(() => {});
                            toast('تم تجهيز الرسالة ونسخها — سيتم فتح واتساب');
                            window.open(m.wa_link, '_blank');
                          } catch (e) { toast(e.message, 'error'); }
                        }}><I n="chat" s={13} /> مراسلة</button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {profile && <AttachFiles entity={{ client_id: profile.id }} />}
            <div>
              <b className="text-[14px]">السجل الزمني للتفاعلات</b>
              <div className="mt-3 space-y-0 relative">
                {timeline.length === 0 && <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>لا توجد تفاعلات مسجلة بعد</div>}
                {timeline.map((t, i) => (
                  <div key={i} className="flex gap-3 pb-4 relative">
                    {i < timeline.length - 1 && <span className="absolute right-[15px] top-8 bottom-0 w-0.5" style={{ background: 'var(--line)' }} />}
                    <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10" style={{ background: 'var(--bg2)', color: 'var(--brand)' }}>
                      <I n={t.kind === 'task' ? 'check' : t.kind === 'appointment' ? 'cal' : t.kind === 'call' ? 'phone' : t.kind === 'reservation' ? 'key' : t.kind === 'sale' ? 'wallet' : t.kind === 'payment' ? 'money' : t.kind === 'invoice' ? 'file' : t.kind === 'file' ? 'folder' : 'note'} s={15} />
                    </span>
                    <div className="flex-1 rounded-xl p-2.5" style={{ background: 'var(--card2)' }}>
                      <div className="text-[13px] font-bold">{t.title}</div>
                      {t.sub && <div className="text-[12px]" style={{ color: 'var(--ink2)' }}>{t.sub}</div>}<div className="text-[11.5px] num" style={{ color: 'var(--ink3)' }}>{fmtD(t.date)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      <Modal open={!!intForm} onClose={() => setIntForm(null)} title={intForm?.id ? 'تعديل الاهتمام' : 'اهتمام جديد للعميل'} w={640}
        actions={<><Btn v="o" onClick={() => setIntForm(null)}>إلغاء</Btn><Btn v="g" onClick={saveInterest}><I n="check" s={15} /> حفظ</Btn></>}>
        {intForm && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="نوع العقار"><select className="inp" value={intForm.property_type} onChange={e => setIntForm({ ...intForm, property_type: e.target.value })}>{(meta?.property_types || []).map(t => <option key={t.k} value={t.k}>{t.t}</option>)}</select></Field>
              <Field label="المشروع المفضل"><select className="inp" value={intForm.preferred_project_id || ''} onChange={e => setIntForm({ ...intForm, preferred_project_id: e.target.value })}><option value="">أي مشروع</option>{(meta?.projects || []).map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
              <Field label="الغرض"><select className="inp" value={intForm.purpose} onChange={e => setIntForm({ ...intForm, purpose: e.target.value })}>{(meta?.purposes || []).map(t => <option key={t.k} value={t.k}>{t.t}</option>)}</select></Field>
              <Field label="أقل سعر"><input type="number" className="inp num" value={intForm.budget_min} onChange={e => setIntForm({ ...intForm, budget_min: e.target.value })} /></Field>
              <Field label="أعلى سعر"><input type="number" className="inp num" value={intForm.budget_max} onChange={e => setIntForm({ ...intForm, budget_max: e.target.value })} /></Field>
              <Field label="عدد الغرف"><input type="number" className="inp num" value={intForm.rooms} onChange={e => setIntForm({ ...intForm, rooms: e.target.value })} /></Field>
              <Field label="المنطقة"><input className="inp" value={intForm.preferred_area || ''} onChange={e => setIntForm({ ...intForm, preferred_area: e.target.value })} /></Field>
              <Field label="الدور"><select className="inp" value={intForm.floor_pref || ''} onChange={e => setIntForm({ ...intForm, floor_pref: e.target.value })}><option value="">أي دور</option>{(meta?.floor_types || []).map(t => <option key={t.k} value={t.k}>{t.t}</option>)}</select></Field>
              <Field label="الأولوية"><select className="inp" value={intForm.priority} onChange={e => setIntForm({ ...intForm, priority: e.target.value })}>{Object.entries(L.priority).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
            </div>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!Number(intForm.wants_roof)} onChange={e => setIntForm({ ...intForm, wants_roof: e.target.checked ? 1 : 0 })} /> يرغب بروف</label>
            <Field label="ملاحظات"><textarea className="inp" rows={2} value={intForm.notes || ''} onChange={e => setIntForm({ ...intForm, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <Confirm open={!!del} onClose={() => setDel(null)} title="حذف العميل" msg={`سيتم حذف "${del?.name}" وجميع روابطه`} okText="حذف"
        onOk={async () => { try { await api('/clients/' + del.id, { method: 'DELETE' }); toast('تم حذف العميل'); setDel(null); load(); } catch (e) { toast(e.message, 'error'); } }} />
    </>
  );
}

function ClientForm({ f, set, users }) {
  const S = (k, v) => set(x => ({ ...x, [k]: v }));
  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="اسم العميل *"><input className="inp" value={f.name || ''} onChange={e => S('name', e.target.value)} /></Field>
        <Field label="الشركة"><input className="inp" value={f.company || ''} onChange={e => S('company', e.target.value)} /></Field>
        <Field label="الوظيفة"><input className="inp" value={f.job_title || ''} onChange={e => S('job_title', e.target.value)} /></Field>
        <Field label="الجوال"><input className="inp num" value={f.phone || ''} onChange={e => S('phone', e.target.value)} placeholder="05xxxxxxxx" /></Field>
        <Field label="جوال إضافي"><input className="inp num" value={f.phone2 || ''} onChange={e => S('phone2', e.target.value)} /></Field>
        <Field label="البريد"><input className="inp" type="email" value={f.email || ''} onChange={e => S('email', e.target.value)} /></Field>
        <Field label="المدينة"><input className="inp" value={f.city || ''} onChange={e => S('city', e.target.value)} /></Field>
        <Field label="التصنيف"><select className="inp" value={f.category || 'general'} onChange={e => S('category', e.target.value)}><option value="general">عام</option><option value="buyer">مشترٍ</option><option value="seller">بائع</option><option value="broker">وسيط</option><option value="partner">شريك</option></select></Field>
        <Field label="الحالة"><select className="inp" value={f.status || 'active'} onChange={e => S('status', e.target.value)}>{Object.entries(L.clientStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="المسؤول"><select className="inp" value={f.assigned_to || ''} onChange={e => S('assigned_to', e.target.value || null)}><option value="">— بدون —</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
      </div>
      <Field label="العنوان"><input className="inp" value={f.address || ''} onChange={e => S('address', e.target.value)} /></Field>
      <Field label="ملاحظات"><textarea className="inp" rows={2} value={f.notes || ''} onChange={e => S('notes', e.target.value)} /></Field>
    </div>
  );
}
