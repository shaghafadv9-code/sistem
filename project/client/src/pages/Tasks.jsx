import React, { useEffect, useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtD, L, badge, todayStr } from '../lib/format.js';
import { I, Btn, Badge, Empty, Skeleton, ErrBox, PageHead, Modal, Field, SearchInp, Tabs, Confirm, Avatar, Pagination, Stat } from '../components/ui.jsx';

const ST = ['new', 'in_progress', 'paused', 'completed'];

export default function Tasks() {
  const { can, toast } = useStore();
  const [view, setView] = useState('list');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fPri, setFPri] = useState('');
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null); // null | {} | task
  const [del, setDel] = useState(null);
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [detail, setDetail] = useState(null);
  const [comments, setComments] = useState([]);
  const [fu, setFu] = useState(null);
  const [cText, setCText] = useState('');

  const load = () => {
    setBusy(true); setErr('');
    api('/tasks' + q({ page, limit: view === 'list' ? 15 : 100, q: search, status: fStatus, priority: fPri, sort: 'due_date', dir: 'ASC' }))
      .then(r => { setRows(r.data); setTotal(r.total); setBusy(false); }).catch(e => { setErr(e.message); setBusy(false); });
  };
  useEffect(() => { setPage(1); }, [search, fStatus, fPri, view]);
  useEffect(load, [page, search, fStatus, fPri, view]);
  useEffect(() => {
    const onRefresh = () => load();
    window.addEventListener('app:refresh', onRefresh);
    window.addEventListener('assistant:action', onRefresh);
    return () => {
      window.removeEventListener('app:refresh', onRefresh);
      window.removeEventListener('assistant:action', onRefresh);
    };
  }, [page, search, fStatus, fPri, view]);
  useEffect(() => { api('/followups').then(setFu).catch(() => {}); }, []);
  useEffect(() => {
    api('/users/list').then(r => setUsers(r.data || [])).catch(() => {});
    api('/clients' + q({ limit: 200 })).then(r => setClients(r.data || [])).catch(() => {});
    if (sessionStorage.getItem('ss_quick') === 'new-task') { sessionStorage.removeItem('ss_quick'); setEdit({}); }
  }, []);

  const save = async (f) => {
    if (!f.title?.trim()) { toast('عنوان المهمة مطلوب', 'error'); return; }
    try {
      if (f.id) await api('/tasks/' + f.id, { method: 'PUT', body: f });
      else await api('/tasks', { method: 'POST', body: { ...f, created_by: useStore.getState().user.id } });
      toast(f.id ? 'تم حفظ المهمة' : 'تم إنشاء المهمة');
      setEdit(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const setStatus = async (t, st) => {
    try { await api(`/tasks/${t.id}/status`, { method: 'PUT', body: { status: st } }); toast('تم تحديث الحالة'); load(); if (detail?.id === t.id) setDetail({ ...detail, status: st }); }
    catch (e) { toast(e.message, 'error'); }
  };
  const openDetail = async (t) => {
    setDetail(t);
    try { const r = await api(`/tasks/${t.id}/comments`); setComments(r.data || []); } catch { setComments([]); }
  };
  const addComment = async () => {
    if (!cText.trim()) return;
    try { await api(`/tasks/${detail.id}/comments`, { method: 'POST', body: { body: cText } }); setCText(''); openDetail(detail); } catch (e) { toast(e.message, 'error'); }
  };

  // سحب وإفلات للكانبان
  const [drag, setDrag] = useState(null);
  const onDrop = (st) => { if (drag && drag.status !== st && can('tasks', 'edit')) setStatus(drag, st); setDrag(null); };

  return (
    <>
      <PageHead title="المهام" sub="إدارة مهام الفريق — قوائم، كانبان، وتقويم"
        actions={<>
          <Tabs tabs={[{ k: 'list', t: 'قائمة' }, { k: 'kanban', t: 'كانبان' }, { k: 'calendar', t: 'تقويم' }]} val={view} onChange={setView} />
          {can('tasks', 'create') && <Btn onClick={() => setEdit({})}><I n="plus" s={16} /> مهمة جديدة</Btn>}
        </>} />

      {fu && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4 anim-in">
          <Stat icon="alert" label="متأخرة" value={fu.overdue.length} color="#dc2626" onClick={() => { setFStatus(''); }} />
          <Stat icon="clock" label="مستحقة اليوم" value={fu.today.length} color="#d97706" />
          <Stat icon="cal" label="قادمة (7 أيام)" value={fu.upcoming.length} color="#1d61f5" />
          <Stat icon="phone" label="اتصالات تحتاج متابعة" value={fu.calls.length} color="#7c3aed" onClick={() => { location.hash = '#/calls'; }} />
          <Stat icon="key" label="حجوزات تنتهي" value={fu.expiring.length} color="#0284c7" onClick={() => { location.hash = '#/reservations'; }} />
        </div>
      )}

      <div className="card p-3.5 mb-4 flex gap-2.5 flex-wrap items-center anim-in">
        <SearchInp value={search} onChange={setSearch} ph="بحث في المهام..." className="flex-1 min-w-[200px]" />
        <select className="inp" style={{ width: 150 }} value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="">كل الحالات</option>{Object.entries(L.taskStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="inp" style={{ width: 140 }} value={fPri} onChange={e => setFPri(e.target.value)}>
          <option value="">كل الأولويات</option>{Object.entries(L.priority).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {err && <ErrBox msg={err} retry={load} />}
      {busy && <Skeleton n={5} />}
      {!busy && !err && rows.length === 0 && <div className="card"><Empty icon="check" title="لا توجد مهام" sub="أنشئ مهمتك الأولى وابدأ الإنجاز" action={can('tasks', 'create') && <Btn onClick={() => setEdit({})}><I n="plus" s={15} /> مهمة جديدة</Btn>} /></div>}

      {!busy && !err && rows.length > 0 && view === 'list' && (
        <div className="card overflow-x-auto anim-in">
          <table className="tbl min-w-[760px]">
            <thead><tr><th>المهمة</th><th>المسؤول</th><th>الأولوية</th><th>الحالة</th><th>الاستحقاق</th><th>العميل</th><th></th></tr></thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id}>
                  <td><span className="font-bold cursor-pointer hover:opacity-75" onClick={() => openDetail(t)}>{t.title}</span>{t.is_overdue && <Badge c="b-red">متأخرة</Badge>}</td>
                  <td>{t.assignee_name ? <span className="flex items-center gap-1.5"><Avatar name={t.assignee_name} s={26} /><span className="text-[13px]">{t.assignee_name}</span></span> : <span style={{ color: 'var(--ink3)' }}>—</span>}</td>
                  <td><Badge c={badge.priority[t.priority]}>{L.priority[t.priority]}</Badge></td>
                  <td>
                    {can('tasks', 'edit')
                      ? <select className="inp !py-1 !px-2 !text-[12px]" style={{ width: 120 }} value={t.status} onChange={e => setStatus(t, e.target.value)}>
                        {Object.entries(L.taskStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      : <Badge c={badge.taskStatus[t.status]}>{L.taskStatus[t.status]}</Badge>}
                  </td>
                  <td className="num text-[13px]">{fmtD(t.due_date)}</td>
                  <td className="text-[13px]">{t.client_name || '—'}</td>
                  <td><div className="flex gap-1">
                    <button className="icon-btn" title="التفاصيل" onClick={() => openDetail(t)}><I n="eye" s={17} /></button>
                    {can('tasks', 'edit') && <button className="icon-btn" title="تعديل" onClick={() => setEdit(t)}><I n="edit" s={17} /></button>}
                    {can('tasks', 'delete') && <button className="icon-btn" title="حذف" onClick={() => setDel(t)}><I n="trash" s={17} /></button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!busy && !err && rows.length > 0 && view === 'kanban' && (
        <div className="flex gap-3 overflow-x-auto pb-2 anim-in" style={{ maxHeight: 'calc(100vh - 300px)', minHeight: 300 }}>
          {ST.map(st => (
            <div key={st} className="kan-col" onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('over'); }} onDragLeave={e => e.currentTarget.classList.remove('over')} onDrop={e => { e.currentTarget.classList.remove('over'); onDrop(st); }}>
              <div className="p-3 flex items-center justify-between"><b className="text-[13.5px]">{L.taskStatus[st]}</b><Badge c="b-gray">{rows.filter(t => t.status === st).length}</Badge></div>
              <div className="flex-1 overflow-y-auto p-2.5 pt-0 space-y-2">
                {rows.filter(t => t.status === st).map(t => (
                  <div key={t.id} className={`kan-card ${drag?.id === t.id ? 'drag' : ''}`} draggable onDragStart={() => setDrag(t)} onClick={() => openDetail(t)}>
                    <div className="font-bold text-[13px] leading-5">{t.title}</div>
                    <div className="flex gap-1.5 mt-2 items-center flex-wrap">
                      <Badge c={badge.priority[t.priority]}>{L.priority[t.priority]}</Badge>
                      {t.due_date && <span className="text-[11px] num" style={{ color: t.is_overdue ? 'var(--danger)' : 'var(--ink3)' }}>{fmtD(t.due_date)}</span>}
                    </div>
                    {t.assignee_name && <div className="flex items-center gap-1.5 mt-2"><Avatar name={t.assignee_name} s={22} /><span className="text-[11.5px]" style={{ color: 'var(--ink2)' }}>{t.assignee_name}</span></div>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!busy && !err && rows.length > 0 && view === 'calendar' && <TaskCalendar rows={rows} onPick={openDetail} />}
      {view === 'list' && <Pagination page={page} pages={Math.ceil(total / 15)} total={total} onGo={setPage} />}

      {/* نموذج */}
      <TaskForm open={!!edit} init={edit} users={users} clients={clients} onClose={() => setEdit(null)} onSave={save} />

      {/* تفاصيل */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.title} w={600} actions={
        detail && can('tasks', 'edit') && <>{['new', 'in_progress', 'paused', 'completed'].map(s => <Btn key={s} v={detail.status === s ? 'p' : 'g'} size="sm" onClick={() => setStatus(detail, s)}>{L.taskStatus[s]}</Btn>)}</>
      }>
        {detail && (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap"><Badge c={badge.taskStatus[detail.status]}>{L.taskStatus[detail.status]}</Badge><Badge c={badge.priority[detail.priority]}>{L.priority[detail.priority]}</Badge>{detail.is_overdue && <Badge c="b-red">متأخرة</Badge>}</div>
            {detail.description && <p className="text-[13.5px] leading-7 rounded-xl p-3" style={{ background: 'var(--card2)' }}>{detail.description}</p>}
            <div className="grid grid-cols-2 gap-2 text-[13px]">
              <div>المسؤول: <b>{detail.assignee_name || '—'}</b></div>
              <div>العميل: <b>{detail.client_name || '—'}</b></div>
              <div>البداية: <b className="num">{fmtD(detail.start_date)}</b></div>
              <div>الاستحقاق: <b className="num">{fmtD(detail.due_date)}</b></div>
            </div>
            <div className="pt-2" style={{ borderTop: '1px solid var(--line)' }}>
              <b className="text-[13.5px]">التعليقات ({comments.length})</b>
              <div className="space-y-2 mt-2 max-h-[180px] overflow-y-auto">
                {comments.map(c => <div key={c.id} className="rounded-xl p-2.5 text-[13px]" style={{ background: 'var(--card2)' }}><b>{c.user_name}</b><div>{c.body}</div></div>)}
                {comments.length === 0 && <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>لا توجد تعليقات بعد</div>}
              </div>
              {can('tasks', 'edit') && <div className="flex gap-2 mt-2"><input className="inp" placeholder="اكتب تعليقًا..." value={cText} onChange={e => setCText(e.target.value)} onKeyDown={e => e.key === 'Enter' && addComment()} /><Btn size="sm" onClick={addComment}>إرسال</Btn></div>}
            </div>
          </div>
        )}
      </Modal>

      <Confirm open={!!del} onClose={() => setDel(null)} title="حذف المهمة" msg={`سيتم حذف "${del?.title}" — هل أنت متأكد؟`} okText="حذف"
        onOk={async () => { try { await api('/tasks/' + del.id, { method: 'DELETE' }); toast('تم حذف المهمة'); setDel(null); load(); } catch (e) { toast(e.message, 'error'); } }} />
    </>
  );
}

export function TaskForm({ open, init, users, clients, onClose, onSave }) {
  const [f, setF] = useState({});
  useEffect(() => { if (open) setF({ priority: 'medium', status: 'new', start_date: todayStr(), ...(init || {}) }); }, [open]);
  const S = (k, v) => setF(x => ({ ...x, [k]: v }));
  return (
    <Modal open={open} onClose={onClose} title={f.id ? 'تعديل المهمة' : 'مهمة جديدة'} w={620} actions={<><Btn onClick={() => onSave(f)}><I n="check" s={15} /> حفظ المهمة</Btn><Btn v="g" onClick={onClose}>إلغاء</Btn></>}>
      <div className="space-y-3.5">
        <Field label="عنوان المهمة *"><input className="inp" value={f.title || ''} onChange={e => S('title', e.target.value)} placeholder="مثال: متابعة العميل أحمد" /></Field>
        <Field label="الوصف"><textarea className="inp" rows={2} value={f.description || ''} onChange={e => S('description', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="المسؤول"><select className="inp" value={f.assignee_id || ''} onChange={e => S('assignee_id', e.target.value || null)}><option value="">— بدون —</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          <Field label="العميل"><select className="inp" value={f.client_id || ''} onChange={e => S('client_id', e.target.value || null)}><option value="">— بدون —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="الأولوية"><select className="inp" value={f.priority || 'medium'} onChange={e => S('priority', e.target.value)}>{Object.entries(L.priority).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="الحالة"><select className="inp" value={f.status || 'new'} onChange={e => S('status', e.target.value)}>{Object.entries(L.taskStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="تاريخ البداية"><input type="date" className="inp" value={f.start_date || ''} onChange={e => S('start_date', e.target.value)} /></Field>
          <Field label="تاريخ الاستحقاق"><input type="date" className="inp" value={f.due_date || ''} onChange={e => S('due_date', e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function TaskCalendar({ rows, onPick }) {
  const [cur, setCur] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const first = new Date(cur.y, cur.m, 1);
  const startPad = (first.getDay() + 1) % 7; // السبت أولًا
  const days = new Date(cur.y, cur.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(`${cur.y}-${String(cur.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  const WD = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
  return (
    <div className="anim-in">
      <div className="flex items-center justify-between mb-2.5">
        <Btn v="g" size="sm" onClick={() => setCur(c => c.m === 0 ? { y: c.y - 1, m: 11 } : { ...c, m: c.m - 1 })}>→ الشهر السابق</Btn>
        <b className="text-[15px]">{new Date(cur.y, cur.m).toLocaleDateString('ar', { month: 'long', year: 'numeric' })}</b>
        <Btn v="g" size="sm" onClick={() => setCur(c => c.m === 11 ? { y: c.y + 1, m: 0 } : { ...c, m: c.m + 1 })}>الشهر التالي ←</Btn>
      </div>
      <div className="cal-grid mb-1.5">{WD.map(w => <div key={w} className="text-center text-[12px] font-bold py-1" style={{ color: 'var(--ink3)' }}>{w}</div>)}</div>
      <div className="cal-grid">
        {cells.map((ds, i) => {
          if (!ds) return <div key={i} />;
          const evs = rows.filter(t => t.due_date === ds);
          return <div key={i} className={`cal-day ${ds === todayStr() ? 'today' : ''}`}>
            <div className="text-[12.5px] font-bold num">{Number(ds.slice(8))}</div>
            {evs.slice(0, 3).map(t => <div key={t.id} className="cal-ev" style={{ background: 'rgba(29,97,245,.12)', color: 'var(--brand)' }} onClick={() => onPick(t)}>{t.title}</div>)}
            {evs.length > 3 && <div className="text-[11px] mt-0.5" style={{ color: 'var(--ink3)' }}>+{evs.length - 3}</div>}
          </div>;
        })}
      </div>
    </div>
  );
}
