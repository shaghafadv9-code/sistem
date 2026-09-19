import React, { useEffect, useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtD } from '../lib/format.js';
import { I, Btn, Badge, Empty, Skeleton, ErrBox, PageHead, Modal, Field, SearchInp, Confirm, Avatar } from '../components/ui.jsx';

export default function Brokers() {
  const { can, toast, company } = useStore();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [stmt, setStmt] = useState(null);
  const [payout, setPayout] = useState(null);
  const cur = company.currency || 'ر.س';

  const load = () => {
    setBusy(true); setErr('');
    api('/brokers' + q({ q: search })).then(r => { setRows(r.data || []); setBusy(false); }).catch(e => { setErr(e.message); setBusy(false); });
  };
  useEffect(load, [search]);

  const save = async () => {
    if (!edit.name?.trim()) { toast('اسم الوسيط مطلوب', 'error'); return; }
    try {
      if (edit.id) await api('/brokers/' + edit.id, { method: 'PUT', body: edit });
      else await api('/brokers', { method: 'POST', body: edit });
      toast('تم حفظ الوسيط'); setEdit(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const openStmt = async (b) => {
    try { const r = await api('/brokers/' + b.id); setStmt(r); } catch (e) { toast(e.message, 'error'); }
  };
  const doPayout = async () => {
    try {
      const r = await api(`/brokers/${payout.id}/payout`, { method: 'POST', body: { amount: payout._amt, notes: payout._notes } });
      toast(`تم صرف العمولة — المتبقي ${fmtN(r.balance)} ${cur}`);
      setPayout(null); setStmt(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title="الوسطاء والعمولات" sub="إدارة الوسطاء، كشوف العمولات، وصرف المستحقات"
        actions={can('brokers', 'create') && <Btn onClick={() => setEdit({ commission_rate: 5 })}><I n="plus" s={16} /> وسيط جديد</Btn>} />
      <div className="card p-3.5 mb-4 anim-in"><SearchInp value={search} onChange={setSearch} ph="بحث بالاسم أو الجوال أو الكود..." /></div>
      {err && <ErrBox msg={err} retry={load} />}
      {busy && <Skeleton n={4} />}
      {!busy && !err && rows.length === 0 && <div className="card"><Empty icon="users" title="لا يوجد وسطاء" action={can('brokers', 'create') && <Btn onClick={() => setEdit({ commission_rate: 5 })}>وسيط جديد</Btn>} /></div>}
      {!busy && !err && rows.length > 0 && (
        <div className="card overflow-x-auto anim-in">
          <table className="tbl min-w-[860px]">
            <thead><tr><th>الوسيط</th><th>الجوال</th><th>النسبة %</th><th>العمليات</th><th>إجمالي العمولة</th><th>المصروف</th><th>المستحق</th><th></th></tr></thead>
            <tbody>
              {rows.map(b => (
                <tr key={b.id}>
                  <td><span className="flex items-center gap-2"><Avatar name={b.name} s={30} /><span><b>{b.name}</b><span className="block text-[11px] num" style={{ color: 'var(--ink3)' }}>{b.code}</span></span></span></td>
                  <td className="num">{b.phone || '—'}</td>
                  <td className="num">%{b.commission_rate}</td>
                  <td className="num">{b.sales_count}</td>
                  <td className="num">{fmtN(b.total_commission)}</td>
                  <td className="num" style={{ color: 'var(--ok)' }}>{fmtN(b.total_paid)}</td>
                  <td className="num font-bold" style={{ color: b.balance > 0 ? 'var(--warn)' : 'var(--ink3)' }}>{fmtN(b.balance)}</td>
                  <td><div className="flex gap-1">
                    <button className="icon-btn" title="كشف العمولات" onClick={() => openStmt(b)}><I n="eye" s={17} /></button>
                    {can('brokers', 'edit') && <button className="icon-btn" title="تعديل" onClick={() => setEdit(b)}><I n="edit" s={17} /></button>}
                    {can('brokers', 'delete') && <button className="icon-btn" title="حذف" onClick={() => setDel(b)}><I n="trash" s={17} /></button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل الوسيط' : 'وسيط جديد'} w={520}
        actions={<><Btn onClick={save}>حفظ</Btn><Btn v="g" onClick={() => setEdit(null)}>إلغاء</Btn></>}>
        {edit && <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="الاسم *"><input className="inp" value={edit.name || ''} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="الجوال"><input className="inp num" value={edit.phone || ''} onChange={e => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="البريد"><input className="inp" value={edit.email || ''} onChange={e => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="نسبة العمولة %"><input type="number" min={0} max={100} className="inp num" value={edit.commission_rate ?? 0} onChange={e => setEdit({ ...edit, commission_rate: +e.target.value })} /></Field>
          </div>
          <Field label="ملاحظات"><input className="inp" value={edit.notes || ''} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </div>}
      </Modal>

      <Modal open={!!stmt} onClose={() => setStmt(null)} title={`كشف عمولات — ${stmt?.name}`} w={680}>
        {stmt && <div className="space-y-3 text-[13.5px]">
          <div className="grid grid-cols-4 gap-2 text-center">
            {[['العمليات', stmt.sales_count], ['الإجمالي', fmtN(stmt.total_commission)], ['المصروف', fmtN(stmt.total_paid)], ['المستحق', fmtN(stmt.balance)]].map(([l, v]) => (
              <div key={l} className="rounded-xl p-2.5" style={{ background: 'var(--card2)' }}><div className="font-bold num">{v}</div><div className="text-[11px]" style={{ color: 'var(--ink3)' }}>{l}</div></div>
            ))}
          </div>
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {(stmt.sales || []).map(s => (
              <div key={s.id} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--card2)' }}>
                <b className="num">{s.code}</b>
                <span className="flex-1 truncate">{s.client_name} — {s.unit_code}</span>
                <span className="num">{fmtN(s.commission)} {cur}</span>
                <span className="num text-[11.5px]" style={{ color: 'var(--ink3)' }}>{fmtD(s.sale_date)}</span>
              </div>
            ))}
            {(stmt.sales || []).length === 0 && <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>لا توجد عمليات مرتبطة</div>}
          </div>
          {can('finance', 'create') && stmt.balance > 0 && <Btn v="ok" size="sm" onClick={() => setPayout({ ...stmt, _amt: stmt.balance, _notes: '' })}>صرف المستحق ({fmtN(stmt.balance)} {cur})</Btn>}
        </div>}
      </Modal>

      <Modal open={!!payout} onClose={() => setPayout(null)} title={`صرف عمولة — ${payout?.name}`} w={440}
        actions={<><Btn v="ok" onClick={doPayout}>تأكيد الصرف</Btn><Btn v="g" onClick={() => setPayout(null)}>إلغاء</Btn></>}>
        {payout && <div className="space-y-3">
          <div className="rounded-xl p-3 text-[13px]" style={{ background: 'var(--card2)' }}>المستحق: <b className="num">{fmtN(payout.balance)} {cur}</b></div>
          <Field label={`المبلغ (${cur})`}><input type="number" min={0.01} max={payout.balance} className="inp num" value={payout._amt} onChange={e => setPayout({ ...payout, _amt: +e.target.value })} /></Field>
          <Field label="ملاحظات"><input className="inp" value={payout._notes} onChange={e => setPayout({ ...payout, _notes: e.target.value })} /></Field>
        </div>}
      </Modal>

      <Confirm open={!!del} onClose={() => setDel(null)} title="حذف الوسيط" msg={`سيتم حذف "${del?.name}"`} okText="حذف"
        onOk={async () => { try { await api('/brokers/' + del.id, { method: 'DELETE' }); toast('تم الحذف'); setDel(null); load(); } catch (e) { toast(e.message, 'error'); } }} />
    </>
  );
}
