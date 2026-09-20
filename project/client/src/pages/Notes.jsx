import React, { useEffect, useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtD } from '../lib/format.js';
import { I, Btn, Empty, Skeleton, ErrBox, PageHead, Modal, Field, SearchInp, Confirm } from '../components/ui.jsx';

const COLORS = { default: 'var(--card)', yellow: '#fef9c3', green: '#dcfce7', blue: '#dbeafe', pink: '#fce7f3', purple: '#ede9fe' };

export default function Notes() {
  const { can, toast } = useStore();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [clients, setClients] = useState([]);

  const load = () => {
    setBusy(true); setErr('');
    api('/notes' + q({ limit: 100, q: search, sort: 'is_pinned', dir: 'DESC' }))
      .then(r => { setRows(r.data || []); setBusy(false); }).catch(e => { setErr(e.message); setBusy(false); });
  };
  useEffect(load, [search]);
  useEffect(() => {
    api('/clients' + q({ limit: 300 })).then(r => setClients(r.data || [])).catch(() => {});
    if (sessionStorage.getItem('ss_quick') === 'new-note') { sessionStorage.removeItem('ss_quick'); setEdit({}); }
  }, []);

  const save = async (f) => {
    if (!f.title?.trim() && !f.body?.trim()) { toast('اكتب عنوانًا أو نصًا', 'error'); return; }
    try {
      const body = { ...f, user_id: useStore.getState().user.id };
      if (f.id) await api('/notes/' + f.id, { method: 'PUT', body });
      else await api('/notes', { method: 'POST', body });
      toast('تم حفظ الملاحظة'); setEdit(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const togglePin = async (n) => {
    try { await api('/notes/' + n.id, { method: 'PUT', body: { is_pinned: n.is_pinned ? 0 : 1 } }); load(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title="الملاحظات" sub="تدوين سريع مع تثبيت ووسوم وربط بالعملاء"
        actions={can('notes', 'create') && <Btn onClick={() => setEdit({})}><I n="plus" s={16} /> ملاحظة جديدة</Btn>} />
      <div className="card p-3.5 mb-4 anim-in"><SearchInp value={search} onChange={setSearch} ph="بحث في الملاحظات..." /></div>

      {err && <ErrBox msg={err} retry={load} />}
      {busy && <Skeleton n={3} />}
      {!busy && !err && rows.length === 0 && <div className="card"><Empty icon="note" title="لا توجد ملاحظات" /></div>}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3.5 anim-in">
        {rows.map(n => {
          let tags = [];
          try { tags = JSON.parse(n.tags || '[]'); } catch {}
          return (
            <div key={n.id} className="card card-h p-4 dark:!bg-[var(--card)]" style={{ background: COLORS[n.color] || COLORS.default }}>
              <div className="flex items-start justify-between gap-2">
                <b className="text-[14.5px] dark:!text-[var(--ink)]" style={{ color: '#1a2233' }}>{n.title || 'بدون عنوان'}</b>
                <div className="flex gap-0.5 shrink-0">
                  {can('notes', 'edit') && <button className="icon-btn !w-8 !h-8" onClick={() => togglePin(n)} title={n.is_pinned ? 'إلغاء التثبيت' : 'تثبيت'}><I n="pin" s={16} c={n.is_pinned ? '!text-amber-500' : ''} /></button>}
                  {can('notes', 'edit') && <button className="icon-btn !w-8 !h-8" onClick={() => setEdit(n)}><I n="edit" s={16} /></button>}
                  {can('notes', 'delete') && <button className="icon-btn !w-8 !h-8" onClick={() => setDel(n)}><I n="trash" s={16} /></button>}
                </div>
              </div>
              <p className="text-[13px] leading-6 mt-1.5 whitespace-pre-wrap dark:!text-[var(--ink2)]" style={{ color: '#3c445c' }}>{(n.body || '').slice(0, 260)}</p>
              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                {n.is_pinned ? <span className="badge b-amber">مثبتة</span> : null}
                {tags.map((t, i) => <span key={i} className="badge b-gray">#{t}</span>)}
                {n.client_name && <span className="badge b-blue">{n.client_name}</span>}
                <span className="mr-auto text-[11px] num" style={{ color: '#8b93a7' }}>{fmtD(n.updated_at)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل الملاحظة' : 'ملاحظة جديدة'} w={560}
        actions={<><Btn onClick={() => save(edit)}><I n="check" s={15} /> حفظ</Btn><Btn v="g" onClick={() => setEdit(null)}>إلغاء</Btn></>}>
        {edit && <NoteForm f={edit} set={setEdit} clients={clients} />}
      </Modal>
      <Confirm open={!!del} onClose={() => setDel(null)} title="حذف الملاحظة" msg="سيتم حذف هذه الملاحظة" okText="حذف"
        onOk={async () => { try { await api('/notes/' + del.id, { method: 'DELETE' }); toast('تم الحذف'); setDel(null); load(); } catch (e) { toast(e.message, 'error'); } }} />
    </>
  );
}

function NoteForm({ f, set, clients }) {
  const S = (k, v) => set(x => ({ ...x, [k]: v }));
  const [tagInp, setTagInp] = useState('');
  let tags = [];
  try { tags = JSON.parse(f.tags || '[]'); } catch {}
  return (
    <div className="space-y-3.5">
      <Field label="العنوان"><input className="inp" value={f.title || ''} onChange={e => S('title', e.target.value)} /></Field>
      <Field label="النص"><textarea className="inp" rows={5} value={f.body || ''} onChange={e => S('body', e.target.value)} placeholder="اكتب ملاحظتك... (للقوائم: سطر لكل بند)" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="النوع"><select className="inp" value={f.type || 'text'} onChange={e => S('type', e.target.value)}><option value="text">نص</option><option value="checklist">قائمة مهام</option></select></Field>
        <Field label="اللون"><select className="inp" value={f.color || 'default'} onChange={e => S('color', e.target.value)}><option value="default">افتراضي</option><option value="yellow">أصفر</option><option value="green">أخضر</option><option value="blue">أزرق</option><option value="pink">وردي</option><option value="purple">بنفسجي</option></select></Field>
      </div>
      <Field label="ربط بعميل"><select className="inp" value={f.client_id || ''} onChange={e => S('client_id', e.target.value || null)}><option value="">— بدون —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="الوسوم">
        <div className="flex gap-2">
          <input className="inp" value={tagInp} onChange={e => setTagInp(e.target.value)} placeholder="أضف وسمًا واضغط Enter" onKeyDown={e => { if (e.key === 'Enter' && tagInp.trim()) { S('tags', JSON.stringify([...tags, tagInp.trim()])); setTagInp(''); } }} />
        </div>
        <div className="flex gap-1.5 mt-2 flex-wrap">{tags.map((t, i) => <span key={i} className="badge b-blue cursor-pointer" onClick={() => S('tags', JSON.stringify(tags.filter((_, j) => j !== i)))}>#{t} ✕</span>)}</div>
      </Field>
    </div>
  );
}
