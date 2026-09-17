import React, { useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtD, fmtDT, todayStr, L } from '../lib/format.js';
import { I, Btn, Badge, Field, Modal, PageHead, Tabs, Empty } from '../components/ui.jsx';
import { useList, useFetch, Kpis, FilterBar, Table, ExcelBtn } from '../components/fin.jsx';

export default function Communications() {
  const { can, toast } = useStore();
  const [tab, setTab] = useState('log');
  const [f, setF] = useState({ kind: '', employee_id: '', client_id: '', from: '', to: '', q: '' });
  const [page, setPage] = useState(1);
  const params = { page, limit: 20, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) };
  const { rows, meta, busy, err, reload } = useList('/communications', tab === 'log' ? params : params);
  const { data: upcoming, } = useFetch('/communications/upcoming?days=30');
  const { data: clients } = useFetch('/clients?limit=300');
  const { data: users } = useFetch('/users?limit=100');
  const [form, setForm] = useState(null);
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      if (form.id) await api('/communications/' + form.id, { method: 'PUT', body: form });
      else await api('/communications', { method: 'POST', body: form });
      toast('تم حفظ سجل التواصل'); setForm(null); reload();
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };
  const del = async (r) => {
    try { await api('/communications/' + r.id, { method: 'DELETE' }); toast('تم حذف السجل'); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  const up = upcoming?.data || [];

  return (
    <>
      <PageHead title="سجل التواصل والمتابعات" sub="كل تواصل بتاريخه ونوعه وموظفه ونتيجته وموعد المتابعة القادم"
        actions={<ExcelBtn path="/reports/not_followed_up/excel" filters={{ days: 30 }} name="غير-المتابعين.xlsx" label="تصدير غير المتابعين" can={can('interests', 'export')} />} />

      <Kpis items={[
        { icon: 'chat', label: 'سجلات التواصل', value: String(meta.total || 0) },
        { icon: 'clock', label: 'متابعات قادمة (30 يوم)', value: String(up.length), color: '#b45309' },
        { icon: 'alert', label: 'متابعات متأخرة', value: String(up.filter(u => u.next_follow_up && u.next_follow_up < todayStr()).length), color: '#b91c1c' },
      ]} />

      <div className="mb-3 no-print"><Tabs tabs={[{ k: 'log', t: 'كل السجلات' }, { k: 'upcoming', t: 'المتابعات القادمة' }]} val={tab} onChange={setTab} /></div>

      {tab === 'log' && <>
        <FilterBar search={f.q} setSearch={v => setF({ ...f, q: v })} ph="بحث في نص التواصل أو النتيجة..." onReload={reload}
          right={can('communications', 'create') && <Btn v="g" size="sm" onClick={() => setForm({ client_id: '', kind: 'call', direction: 'out', body: '', result: '', occurred_at: todayStr(), next_follow_up: '', subject: '' })}><I n="plus" s={14} /> تسجيل تواصل</Btn>}>
          <Field label="النوع"><select className="inp" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="">الكل</option>{Object.entries(L.commKind).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
          <Field label="الموظف"><select className="inp" value={f.employee_id} onChange={e => setF({ ...f, employee_id: e.target.value })}><option value="">الكل</option>{(users?.data || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          <Field label="من"><input type="date" className="inp num" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="إلى"><input type="date" className="inp num" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
        </FilterBar>

        <Table rows={rows} busy={busy} err={err} empty="لا يوجد سجل تواصل"
          cols={[
            { k: 'occurred_at', t: 'التاريخ', r: r => fmtDT(r.occurred_at) },
            { k: 'client_name', t: 'العميل', r: r => <><b>{r.client_name}</b><div className="text-[11.5px] num" style={{ color: 'var(--ink3)' }}>{r.client_phone}</div></> },
            { k: 'kind', t: 'النوع', r: r => <Badge c="b-sky">{L.commKind[r.kind] || r.kind}</Badge> },
            { k: 'direction', t: 'الاتجاه', r: r => r.direction === 'in' ? 'وارد' : 'صادر' },
            { k: 'body', t: 'نص التواصل' },
            { k: 'result', t: 'النتيجة' },
            { k: 'employee_name', t: 'الموظف', r: r => r.employee_name || '—' },
            { k: 'next_follow_up', t: 'المتابعة القادمة', r: r => r.next_follow_up ? <Badge c={r.next_follow_up < todayStr() ? 'b-red' : 'b-amber'}>{fmtD(r.next_follow_up)}</Badge> : '—' },
            {
              t: 'إجراءات', center: true, r: r => (
                <div className="flex gap-1 justify-center" onClick={e => e.stopPropagation()}>
                  {can('communications', 'edit') && <button className="icon-btn" title="تعديل" onClick={() => setForm(r)}><I n="edit" s={15} /></button>}
                  {can('communications', 'delete') && <button className="icon-btn" title="حذف" onClick={() => del(r)}><I n="trash" s={15} /></button>}
                </div>
              )
            },
          ]} />
        <div className="flex items-center justify-between mt-3 text-[13px] no-print" style={{ color: 'var(--ink2)' }}>
          <div>{meta.total} سجل</div>
          <div className="flex gap-2"><Btn v="o" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</Btn><Btn v="o" size="sm" disabled={page >= (meta.pages || 1)} onClick={() => setPage(page + 1)}>التالي</Btn></div>
        </div>
      </>}

      {tab === 'upcoming' && (
        <>
          {up.length === 0 ? <div className="card"><Empty icon="clock" title="لا توجد متابعات مقررة" /></div> : (
            <div className="grid md:grid-cols-2 gap-3">
              {up.map(u => (
                <div key={u.id} className="card p-3.5">
                  <div className="flex items-center justify-between">
                    <b>{u.client_name}</b>
                    <Badge c={u.next_follow_up < todayStr() ? 'b-red' : 'b-amber'}>{fmtD(u.next_follow_up)}</Badge>
                  </div>
                  <div className="text-[12.5px]" style={{ color: 'var(--ink2)' }}>{L.commKind[u.kind]} — {u.result || u.body || ''}</div>
                  <div className="flex gap-1.5 mt-2">
                    {u.client_phone && <a className="btn btn-o btn-sm" href={`https://wa.me/${String(u.client_phone).replace(/^0/, '966')}`} target="_blank" rel="noreferrer"><I n="chat" s={14} /> واتساب</a>}
                    {can('communications', 'create') && <Btn v="o" size="sm" onClick={() => setForm({ client_id: u.client_id, kind: 'call', direction: 'out', body: '', result: '', occurred_at: todayStr(), next_follow_up: '' })}><I n="plus" s={14} /> تسجيل نتيجة</Btn>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'تعديل سجل تواصل' : 'تسجيل تواصل'} w={560}
        actions={<><Btn v="o" onClick={() => setForm(null)}>إلغاء</Btn><Btn v="g" disabled={saving} onClick={save}><I n="check" s={15} /> حفظ</Btn></>}>
        {form && (
          <div className="space-y-3">
            <Field label="العميل *">
              <select className="inp" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                <option value="">— اختر —</option>{(clients?.data || []).map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
              </select>
            </Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="النوع"><select className="inp" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{Object.entries(L.commKind).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
              <Field label="الاتجاه"><select className="inp" value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })}><option value="out">صادر</option><option value="in">وارد</option></select></Field>
              <Field label="التاريخ"><input type="datetime-local" className="inp num" value={String(form.occurred_at || '').replace(' ', 'T').slice(0, 16)} onChange={e => setForm({ ...form, occurred_at: e.target.value.replace('T', ' ') })} /></Field>
              <Field label="المتابعة القادمة"><input type="date" className="inp num" value={form.next_follow_up || ''} onChange={e => setForm({ ...form, next_follow_up: e.target.value })} /></Field>
            </div>
            <Field label="الموضوع"><input className="inp" value={form.subject || ''} onChange={e => setForm({ ...form, subject: e.target.value })} /></Field>
            <Field label="نص التواصل"><textarea className="inp" rows={2} value={form.body || ''} onChange={e => setForm({ ...form, body: e.target.value })} /></Field>
            <Field label="النتيجة"><input className="inp" value={form.result || ''} onChange={e => setForm({ ...form, result: e.target.value })} /></Field>
            <div className="text-[12px]" style={{ color: 'var(--ink3)' }}>أول تواصل مع عميل مرحلته «عميل محتمل» ينقله تلقائيًا إلى «تم التواصل» ويحدّث تاريخ آخر تواصل.</div>
          </div>
        )}
      </Modal>
    </>
  );
}
