import React, { useEffect, useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtDT, L, todayStr } from '../lib/format.js';
import { I, Btn, Badge, Empty, Skeleton, ErrBox, PageHead, Modal, Field, SearchInp, Pagination, Confirm, Tabs } from '../components/ui.jsx';

const RC = { answered: 'b-green', missed: 'b-red', busy: 'b-amber', no_answer: 'b-gray', follow_up: 'b-amber', deal: 'b-purple', other: 'b-gray' };

export default function Calls() {
  const { can, toast } = useStore();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [fDir, setFDir] = useState('');
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [conv, setConv] = useState(null);
  const [clients, setClients] = useState([]);

  const load = () => {
    setBusy(true); setErr('');
    api('/calls' + q({ page, limit: 15, q: search, direction: fDir, sort: 'started_at' }))
      .then(r => { setRows(r.data); setTotal(r.total); setBusy(false); }).catch(e => { setErr(e.message); setBusy(false); });
  };
  useEffect(() => { setPage(1); }, [search, fDir]);
  useEffect(load, [page, search, fDir]);
  useEffect(() => {
    api('/clients' + q({ limit: 300 })).then(r => setClients(r.data || [])).catch(() => {});
    if (sessionStorage.getItem('ss_quick') === 'new-call') { sessionStorage.removeItem('ss_quick'); setEdit({}); }
  }, []);

  const save = async (f) => {
    if (!f.contact_name?.trim() || !f.phone?.trim()) { toast('الاسم والرقم مطلوبان', 'error'); return; }
    try {
      const body = { ...f, started_at: f.started_at || (todayStr() + ' ' + new Date().toTimeString().slice(0, 5)), user_id: useStore.getState().user.id };
      if (f.id) await api('/calls/' + f.id, { method: 'PUT', body });
      else await api('/calls', { method: 'POST', body });
      toast('تم تسجيل الاتصال'); setEdit(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const convert = async (to, extra) => {
    try {
      await api(`/calls/${conv.id}/convert`, { method: 'POST', body: { to, ...extra } });
      toast(to === 'task' ? 'تم إنشاء مهمة من الاتصال' : 'تم إنشاء موعد من الاتصال');
      setConv(null);
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title="سجل الاتصالات" sub="وارد وصادر مع المتابعة والتحويل لمهام ومواعيد"
        actions={<>
          <Tabs tabs={[{ k: '', t: 'الكل' }, { k: 'in', t: 'وارد' }, { k: 'out', t: 'صادر' }]} val={fDir} onChange={setFDir} />
          {can('calls', 'create') && <Btn onClick={() => setEdit({})}><I n="plus" s={16} /> تسجيل اتصال</Btn>}
        </>} />

      <div className="card p-3.5 mb-4 anim-in"><SearchInp value={search} onChange={setSearch} ph="بحث بالاسم أو الرقم..." /></div>

      {err && <ErrBox msg={err} retry={load} />}
      {busy && <Skeleton n={5} />}
      {!busy && !err && rows.length === 0 && <div className="card"><Empty icon="phone" title="لا توجد اتصالات" /></div>}

      {!busy && !err && (
        <div className="card overflow-x-auto anim-in">
          <table className="tbl min-w-[820px]">
            <thead><tr><th>جهة الاتصال</th><th>الرقم</th><th>الاتجاه</th><th>التاريخ</th><th>المدة</th><th>النتيجة</th><th>متابعة</th><th></th></tr></thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td><b>{c.contact_name}</b>{c.client_name && <div className="text-[11.5px]" style={{ color: 'var(--ink3)' }}>{c.client_name}</div>}</td>
                  <td className="num">{c.phone}</td>
                  <td><Badge c={c.direction === 'in' ? 'b-green' : 'b-blue'}>{L.callDir[c.direction]}</Badge></td>
                  <td className="num text-[12.5px]">{fmtDT(c.started_at)}</td>
                  <td className="num">{c.duration_sec ? `${Math.floor(c.duration_sec / 60)}:${String(c.duration_sec % 60).padStart(2, '0')}` : '—'}</td>
                  <td><Badge c={RC[c.result]}>{L.callResult[c.result]}</Badge></td>
                  <td className="text-[12px] num">{c.follow_up_at ? fmtDT(c.follow_up_at) : '—'}</td>
                  <td><div className="flex gap-1">
                    {can('calls', 'edit') && <button className="icon-btn" title="تحويل لمهمة/موعد" onClick={() => setConv(c)}><I n="link" s={17} /></button>}
                    {can('calls', 'edit') && <button className="icon-btn" title="تعديل" onClick={() => setEdit(c)}><I n="edit" s={17} /></button>}
                    {can('calls', 'delete') && <button className="icon-btn" title="حذف" onClick={() => setDel(c)}><I n="trash" s={17} /></button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={Math.ceil(total / 15)} total={total} onGo={setPage} />

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل الاتصال' : 'تسجيل اتصال'} w={600}
        actions={<><Btn onClick={() => save(edit)}><I n="check" s={15} /> حفظ</Btn><Btn v="g" onClick={() => setEdit(null)}>إلغاء</Btn></>}>
        {edit && <CallForm f={edit} set={setEdit} clients={clients} />}
      </Modal>

      <Modal open={!!conv} onClose={() => setConv(null)} title="تحويل الاتصال" w={440}
        actions={<><Btn v="g" onClick={() => setConv(null)}>إغلاق</Btn></>}>
        {conv && <ConvertBox call={conv} onGo={convert} can={can} />}
      </Modal>

      <Confirm open={!!del} onClose={() => setDel(null)} title="حذف الاتصال" msg="سيتم حذف هذا السجل" okText="حذف"
        onOk={async () => { try { await api('/calls/' + del.id, { method: 'DELETE' }); toast('تم الحذف'); setDel(null); load(); } catch (e) { toast(e.message, 'error'); } }} />
    </>
  );
}

function CallForm({ f, set, clients }) {
  const S = (k, v) => set(x => ({ ...x, [k]: v }));
  useEffect(() => { if (!f.direction) S('direction', 'out'); if (!f.result) S('result', 'answered'); }, []);
  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="الاسم *"><input className="inp" value={f.contact_name || ''} onChange={e => S('contact_name', e.target.value)} /></Field>
        <Field label="الرقم *"><input className="inp num" value={f.phone || ''} onChange={e => S('phone', e.target.value)} /></Field>
        <Field label="الاتجاه"><select className="inp" value={f.direction || 'out'} onChange={e => S('direction', e.target.value)}><option value="in">وارد</option><option value="out">صادر</option></select></Field>
        <Field label="العميل المرتبط"><select className="inp" value={f.client_id || ''} onChange={e => S('client_id', e.target.value || null)}><option value="">— بدون —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="التاريخ والوقت"><input className="inp" type="datetime-local" value={(f.started_at || '').replace(' ', 'T').slice(0, 16)} onChange={e => S('started_at', e.target.value.replace('T', ' '))} /></Field>
        <Field label="المدة بالثواني"><input className="inp num" type="number" min={0} value={f.duration_sec || 0} onChange={e => S('duration_sec', +e.target.value)} /></Field>
        <Field label="النتيجة"><select className="inp" value={f.result || 'answered'} onChange={e => S('result', e.target.value)}>{Object.entries(L.callResult).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="متابعة بتاريخ"><input className="inp" type="datetime-local" value={(f.follow_up_at || '').replace(' ', 'T').slice(0, 16)} onChange={e => S('follow_up_at', e.target.value ? e.target.value.replace('T', ' ') : null)} /></Field>
      </div>
      <Field label="ملاحظات"><textarea className="inp" rows={2} value={f.notes || ''} onChange={e => S('notes', e.target.value)} /></Field>
    </div>
  );
}

function ConvertBox({ call, onGo, can }) {
  const [to, setTo] = useState('task');
  const [title, setTitle] = useState(`متابعة: ${call.contact_name}`);
  const [due, setDue] = useState(todayStr());
  return (
    <div className="space-y-3">
      <Tabs tabs={[{ k: 'task', t: 'مهمة' }, { k: 'appointment', t: 'موعد' }]} val={to} onChange={setTo} />
      <Field label="العنوان"><input className="inp" value={title} onChange={e => setTitle(e.target.value)} /></Field>
      {to === 'task'
        ? <Field label="الاستحقاق"><input type="date" className="inp" value={due} onChange={e => setDue(e.target.value)} /></Field>
        : <div className="grid grid-cols-2 gap-2"><Field label="التاريخ"><input type="date" className="inp" value={due} onChange={e => setDue(e.target.value)} /></Field><Field label="الوقت"><input type="time" className="inp" defaultValue="10:00" id="conv_time" /></Field></div>}
      <Btn className="w-full" disabled={to === 'task' ? !can('tasks', 'create') : !can('appointments', 'create')}
        onClick={() => to === 'task' ? onGo('task', { title, due_date: due }) : onGo('appointment', { title, date: due, start_time: document.getElementById('conv_time')?.value || '10:00' })}>
        تحويل إلى {to === 'task' ? 'مهمة' : 'موعد'}
      </Btn>
    </div>
  );
}
