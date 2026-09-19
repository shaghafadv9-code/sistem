import React, { useEffect, useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtD, L, todayStr } from '../lib/format.js';
import { I, Btn, Badge, Empty, Skeleton, ErrBox, PageHead, Modal, Field, Tabs, Confirm } from '../components/ui.jsx';

const WD = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const STC = { scheduled: 'b-blue', done: 'b-green', cancelled: 'b-red', postponed: 'b-amber' };

export default function Calendar() {
  const { can, toast } = useStore();
  const [view, setView] = useState('month');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [cur, setCur] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() }; });
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [clients, setClients] = useState([]);

  const load = () => {
    setBusy(true); setErr('');
    api('/appointments' + q({ limit: 500, sort: 'date', dir: 'ASC' }))
      .then(r => { setRows(r.data || []); setBusy(false); }).catch(e => { setErr(e.message); setBusy(false); });
  };
  useEffect(load, []);
  useEffect(() => {
    const onRefresh = () => load();
    window.addEventListener('app:refresh', onRefresh);
    window.addEventListener('assistant:action', onRefresh);
    return () => {
      window.removeEventListener('app:refresh', onRefresh);
      window.removeEventListener('assistant:action', onRefresh);
    };
  }, []);
  useEffect(() => {
    api('/clients' + q({ limit: 300 })).then(r => setClients(r.data || [])).catch(() => {});
    if (sessionStorage.getItem('ss_quick') === 'new-appt') { sessionStorage.removeItem('ss_quick'); setEdit({}); }
  }, []);

  const save = async (f) => {
    if (!f.title?.trim() || !f.date || !f.start_time) { toast('العنوان والتاريخ والوقت مطلوبة', 'error'); return; }
    const dur = f.start_time && f.end_time ? (new Date(`2000-01-01T${f.end_time}`) - new Date(`2000-01-01T${f.start_time}`)) / 60000 : 30;
    try {
      const body = { ...f, end_time: f.end_time || '10:30', duration_min: dur > 0 ? dur : 30, created_by: useStore.getState().user.id };
      if (f.id) await api('/appointments/' + f.id, { method: 'PUT', body });
      else await api('/appointments', { method: 'POST', body });
      toast(f.id ? 'تم حفظ الموعد' : 'تم إنشاء الموعد');
      setEdit(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const ds = `${cur.y}-${String(cur.m + 1).padStart(2, '0')}-${String(cur.d).padStart(2, '0')}`;
  const monthRows = rows.filter(a => (a.date || '').slice(0, 7) === ds.slice(0, 7));

  return (
    <>
      <PageHead title="المواعيد والتقويم" sub="جدولة المواعيد — يوم، أسبوع، شهر، وأجندة"
        actions={<>
          <Tabs tabs={[{ k: 'day', t: 'يوم' }, { k: 'week', t: 'أسبوع' }, { k: 'month', t: 'شهر' }, { k: 'agenda', t: 'أجندة' }]} val={view} onChange={setView} />
          {can('appointments', 'create') && <Btn onClick={() => setEdit({ date: ds })}><I n="plus" s={16} /> موعد جديد</Btn>}
        </>} />

      {err && <ErrBox msg={err} retry={load} />}
      {busy && <Skeleton n={4} h={90} />}

      {!busy && !err && (
        <div className="anim-in">
          <div className="flex items-center justify-between mb-3">
            <Btn v="g" size="sm" onClick={() => nav(-1, view, cur, setCur)}>→ السابق</Btn>
            <b className="text-[15px]">{view === 'day' ? fmtD(ds) : new Date(cur.y, cur.m).toLocaleDateString('ar', { month: 'long', year: 'numeric' })}</b>
            <Btn v="g" size="sm" onClick={() => nav(1, view, cur, setCur)}>التالي ←</Btn>
          </div>

          {view === 'month' && <MonthGrid cur={cur} rows={monthRows} onDay={(d) => { setCur({ y: +d.slice(0, 4), m: +d.slice(5, 7) - 1, d: +d.slice(8) }); setView('day'); }} onPick={setDetail} onNew={(d) => can('appointments', 'create') && setEdit({ date: d })} />}
          {view === 'day' && <DayList date={ds} rows={rows.filter(a => a.date === ds)} onPick={setDetail} onEdit={can('appointments', 'edit') ? setEdit : null} />}
          {view === 'week' && <WeekView cur={cur} setCur={setCur} rows={rows} onPick={setDetail} />}
          {view === 'agenda' && <Agenda rows={rows} onPick={setDetail} />}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل الموعد' : 'موعد جديد'} w={600}
        actions={<><Btn onClick={() => save(edit)}><I n="check" s={15} /> حفظ الموعد</Btn><Btn v="g" onClick={() => setEdit(null)}>إلغاء</Btn></>}>
        {edit && <ApptForm f={edit} set={setEdit} clients={clients} />}
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.title} w={520} actions={
        detail && <>{can('appointments', 'edit') && <Btn v="g" size="sm" onClick={() => { setEdit(detail); setDetail(null); }}><I n="edit" s={14} /> تعديل</Btn>}{can('appointments', 'delete') && <Btn v="d" size="sm" onClick={() => setDel(detail)}>حذف</Btn>}</>
      }>
        {detail && (
          <div className="space-y-2.5 text-[13.5px]">
            <Badge c={STC[detail.status]}>{L.apptStatus[detail.status]}</Badge>
            <div className="grid grid-cols-2 gap-2">
              <div>التاريخ: <b className="num">{fmtD(detail.date)}</b></div>
              <div>الوقت: <b className="num">{detail.start_time} — {detail.end_time}</b></div>
              <div>العميل: <b>{detail.client_name || '—'}</b></div>
              <div>المكان: <b>{detail.location || '—'}</b></div>
              <div>التذكير: <b>قبل {detail.reminder_min} دقيقة</b></div>
            </div>
            {detail.notes && <p className="rounded-xl p-3 leading-7" style={{ background: 'var(--card2)' }}>{detail.notes}</p>}
          </div>
        )}
      </Modal>

      <Confirm open={!!del} onClose={() => setDel(null)} title="حذف الموعد" msg={`سيتم حذف "${del?.title}"`} okText="حذف"
        onOk={async () => { try { await api('/appointments/' + del.id, { method: 'DELETE' }); toast('تم حذف الموعد'); setDel(null); setDetail(null); load(); } catch (e) { toast(e.message, 'error'); } }} />
    </>
  );
}

function nav(dir, view, cur, setCur) {
  const d = new Date(cur.y, cur.m, cur.d + (view === 'day' ? dir : view === 'week' ? dir * 7 : 0));
  if (view === 'month') { const m = cur.m + dir; setCur({ y: cur.y + (m > 11 ? 1 : m < 0 ? -1 : 0), m: (m + 12) % 12, d: 1 }); }
  else setCur({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate() });
}

function ApptForm({ f, set, clients }) {
  const S = (k, v) => set(x => ({ ...x, [k]: v }));
  return (
    <div className="space-y-3.5">
      <Field label="عنوان الموعد *"><input className="inp" value={f.title || ''} onChange={e => S('title', e.target.value)} placeholder="مثال: توقيع عقد" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="العميل"><select className="inp" value={f.client_id || ''} onChange={e => S('client_id', e.target.value || null)}><option value="">— بدون —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="المكان"><input className="inp" value={f.location || ''} onChange={e => S('location', e.target.value)} placeholder="المكتب / الموقع" /></Field>
        <Field label="التاريخ *"><input type="date" className="inp" value={f.date || ''} onChange={e => S('date', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="من *"><input type="time" className="inp" value={f.start_time || ''} onChange={e => S('start_time', e.target.value)} /></Field>
          <Field label="إلى"><input type="time" className="inp" value={f.end_time || ''} onChange={e => S('end_time', e.target.value)} /></Field>
        </div>
        <Field label="التذكير"><select className="inp" value={f.reminder_min ?? 30} onChange={e => S('reminder_min', +e.target.value)}><option value={0}>بدون</option><option value={15}>قبل 15 دقيقة</option><option value={30}>قبل 30 دقيقة</option><option value={60}>قبل ساعة</option><option value={1440}>قبل يوم</option></select></Field>
        <Field label="الحالة"><select className="inp" value={f.status || 'scheduled'} onChange={e => S('status', e.target.value)}>{Object.entries(L.apptStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </div>
      <Field label="ملاحظات"><textarea className="inp" rows={2} value={f.notes || ''} onChange={e => S('notes', e.target.value)} /></Field>
    </div>
  );
}

function MonthGrid({ cur, rows, onDay, onPick, onNew }) {
  const first = new Date(cur.y, cur.m, 1);
  const pad = (first.getDay() + 1) % 7;
  const days = new Date(cur.y, cur.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < pad; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(`${cur.y}-${String(cur.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  return (
    <>
      <div className="cal-grid mb-1.5">{WD.map(w => <div key={w} className="text-center text-[12px] font-bold py-1" style={{ color: 'var(--ink3)' }}>{w}</div>)}</div>
      <div className="cal-grid">
        {cells.map((ds, i) => {
          if (!ds) return <div key={i} />;
          const evs = rows.filter(a => a.date === ds);
          return (
            <div key={i} className={`cal-day ${ds === todayStr() ? 'today' : ''}`} onDoubleClick={() => onNew(ds)} onClick={() => evs.length === 0 && onNew(ds)}>
              <div className="text-[12.5px] font-bold num">{Number(ds.slice(8))}</div>
              {evs.slice(0, 3).map(a => <div key={a.id} className="cal-ev" style={{ background: a.status === 'done' ? 'rgba(22,163,74,.13)' : 'rgba(124,58,237,.13)', color: a.status === 'done' ? 'var(--ok)' : '#7c3aed' }} onClick={e => { e.stopPropagation(); onPick(a); }}><span className="num">{a.start_time}</span> {a.title}</div>)}
              {evs.length > 3 && <div className="text-[11px]" style={{ color: 'var(--ink3)' }} onClick={e => { e.stopPropagation(); onDay(ds); }}>+{evs.length - 3} المزيد</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function DayList({ date, rows, onPick, onEdit }) {
  const sorted = [...rows].sort((a, b) => a.start_time.localeCompare(b.start_time));
  if (!sorted.length) return <div className="card"><Empty icon="cal" title="لا توجد مواعيد" sub={`يوم ${fmtD(date)} خالٍ`} /></div>;
  return (
    <div className="space-y-2.5">
      {sorted.map(a => (
        <div key={a.id} className="card card-h p-4 flex items-center gap-4 cursor-pointer" onClick={() => onPick(a)}>
          <div className="text-center shrink-0 w-[70px]"><div className="text-[17px] font-bold num" style={{ color: 'var(--brand)' }}>{a.start_time}</div><div className="text-[11px] num" style={{ color: 'var(--ink3)' }}>{a.duration_min} دقيقة</div></div>
          <div className="w-1 self-stretch rounded-full" style={{ background: a.status === 'done' ? 'var(--ok)' : 'linear-gradient(var(--brand),var(--brand2))' }} />
          <div className="flex-1 min-w-0"><b className="text-[14.5px]">{a.title}</b><div className="text-[12.5px]" style={{ color: 'var(--ink2)' }}>{a.client_name || 'بدون عميل'} {a.location ? `— ${a.location}` : ''}</div></div>
          <Badge c={STC[a.status]}>{L.apptStatus[a.status]}</Badge>
          {onEdit && <Btn v="g" size="sm" onClick={e => { e.stopPropagation(); onEdit(a); }}><I n="edit" s={14} /></Btn>}
        </div>
      ))}
    </div>
  );
}

function WeekView({ cur, setCur, rows, onPick }) {
  const base = new Date(cur.y, cur.m, cur.d);
  const dow = (base.getDay() + 1) % 7;
  const start = new Date(base); start.setDate(base.getDate() - dow);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d.toISOString().slice(0, 10); });
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((ds, i) => (
        <div key={ds} className="card p-2.5 min-h-[220px]">
          <div className="text-center pb-2 mb-2" style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="text-[11.5px] font-bold" style={{ color: 'var(--ink3)' }}>{WD[i]}</div>
            <div className={`text-[16px] font-bold num inline-block w-8 h-8 leading-8 rounded-full ${ds === todayStr() ? 'text-white grad-bg' : ''}`}>{Number(ds.slice(8))}</div>
          </div>
          {rows.filter(a => a.date === ds).map(a => <div key={a.id} className="cal-ev !whitespace-normal" style={{ background: 'rgba(29,97,245,.1)', color: 'var(--brand)' }} onClick={() => onPick(a)}><b className="num">{a.start_time}</b><br />{a.title}</div>)}
        </div>
      ))}
    </div>
  );
}

function Agenda({ rows, onPick }) {
  const t = todayStr();
  const up = rows.filter(a => a.date >= t && a.status === 'scheduled').sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time)).slice(0, 40);
  if (!up.length) return <div className="card"><Empty icon="cal" title="لا توجد مواعيد قادمة" /></div>;
  let last = '';
  return (
    <div className="space-y-2">
      {up.map(a => {
        const head = a.date !== last ? (last = a.date, true) : false;
        return (
          <React.Fragment key={a.id}>
            {head && <div className="pt-2 font-bold text-[13.5px]" style={{ color: 'var(--brand)' }}>{a.date === t ? 'اليوم' : fmtD(a.date)}</div>}
            <div className="card p-3 flex items-center gap-3 cursor-pointer card-h" onClick={() => onPick(a)}>
              <span className="num font-bold text-[14px]" style={{ color: 'var(--brand)' }}>{a.start_time}</span>
              <b className="flex-1 text-[13.5px]">{a.title}</b>
              <span className="text-[12px]" style={{ color: 'var(--ink2)' }}>{a.client_name || ''}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
