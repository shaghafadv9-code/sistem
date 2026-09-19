import React, { useEffect, useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtD, L, badge } from '../lib/format.js';
import { I, Btn, Badge, Empty, Skeleton, ErrBox, PageHead, Modal, Field, SearchInp, Pagination, Confirm, Tabs } from '../components/ui.jsx';
import AttachFiles from '../components/AttachFiles.jsx';

export default function Reservations() {
  const { can, toast, company, project: gProject } = useStore();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [detail, setDetail] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [toSale, setToSale] = useState(null);
  const cur = company.currency || 'ر.س';

  const load = () => {
    setBusy(true); setErr('');
    api('/reservations' + q({ page, limit: 12, q: search, status: fStatus, project_id: gProject || undefined }))
      .then(r => { setRows(r.data); setTotal(r.total); setBusy(false); }).catch(e => { setErr(e.message); setBusy(false); });
  };
  useEffect(() => { setPage(1); }, [search, fStatus, gProject]);
  useEffect(load, [page, search, fStatus, gProject]);

  return (
    <>
      <PageHead title="الحجوزات" sub="حجوزات الوحدات مع الإلغاء والتحويل لبيع"
        actions={can('reservations', 'create') && <Btn v="g" onClick={() => location.hash = '#/projects'}><I n="key" s={15} /> حجز جديد (من الوحدات)</Btn>} />

      <div className="card p-3.5 mb-4 flex gap-2.5 flex-wrap items-center anim-in">
        <SearchInp value={search} onChange={setSearch} ph="بحث برقم الحجز، العميل، الوحدة..." className="flex-1 min-w-[200px]" />
        <Tabs tabs={[{ k: '', t: 'الكل' }, ...Object.entries(L.resStatus).map(([k, t]) => ({ k, t }))]} val={fStatus} onChange={setFStatus} />
      </div>

      {err && <ErrBox msg={err} retry={load} />}
      {busy && <Skeleton n={4} />}
      {!busy && !err && rows.length === 0 && <div className="card"><Empty icon="key" title="لا توجد حجوزات" /></div>}

      {!busy && !err && (
        <div className="grid md:grid-cols-2 gap-3.5 anim-in">
          {rows.map(r => (
            <div key={r.id} className="card card-h p-4 cursor-pointer" onClick={() => setDetail(r)}>
              <div className="flex items-center justify-between">
                <b className="num">{r.code}</b>
                <Badge c={badge.resStatus[r.status]}>{L.resStatus[r.status]}</Badge>
              </div>
              <div className="text-[13.5px] mt-2"><b>{r.client_name}</b> <span style={{ color: 'var(--ink3)' }} className="num">— {r.client_phone}</span></div>
              <div className="text-[13px]" style={{ color: 'var(--ink2)' }}>وحدة <b className="num">{r.unit_code}</b> — مشروع {r.project_code}</div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center text-[12.5px]">
                <div className="rounded-lg py-1.5" style={{ background: 'var(--card2)' }}><div className="num font-bold">{fmtN(r.price)}</div><div style={{ color: 'var(--ink3)' }}>السعر</div></div>
                <div className="rounded-lg py-1.5" style={{ background: 'var(--card2)' }}><div className="num font-bold">{fmtN(r.deposit)}</div><div style={{ color: 'var(--ink3)' }}>العربون</div></div>
                <div className="rounded-lg py-1.5" style={{ background: 'var(--card2)' }}><div className="num font-bold">{fmtD(r.expiry_date)}</div><div style={{ color: 'var(--ink3)' }}>الانتهاء</div></div>
              </div>
              {r.status === 'active' && can('reservations', 'edit') && (
                <div className="flex gap-1.5 mt-3" onClick={e => e.stopPropagation()}>
                  {can('sales', 'create') && <Btn size="sm" onClick={() => setToSale(r)}><I n="wallet" s={14} /> تحويل لبيع</Btn>}
                  <Btn v="d" size="sm" onClick={() => setCancel(r)}>إلغاء الحجز</Btn>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} pages={Math.ceil(total / 12)} total={total} onGo={setPage} />

      {/* تفاصيل */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={`الحجز ${detail?.code}`} w={560}>
        {detail && (
          <div className="space-y-2.5 text-[13.5px]">
            <Badge c={badge.resStatus[detail.status]}>{L.resStatus[detail.status]}</Badge>
            <div className="grid grid-cols-2 gap-2">
              <div>العميل: <b>{detail.client_name}</b></div>
              <div>الوحدة: <b className="num">{detail.unit_code}</b> (مشروع {detail.project_code})</div>
              <div>السعر: <b className="num">{fmtN(detail.price)} {cur}</b></div>
              <div>الخصم: <b className="num">{fmtN(detail.discount)}</b></div>
              <div>العربون: <b className="num">{fmtN(detail.deposit)}</b> ({L.payMethod[detail.deposit_method]})</div>
              <div>المرجع: <b className="num">{detail.deposit_ref || '—'}</b></div>
              <div>تاريخ الحجز: <b className="num">{fmtD(detail.reservation_date)}</b></div>
              <div>الانتهاء: <b className="num">{fmtD(detail.expiry_date)}</b></div>
              <div>الموظف: <b>{detail.employee_name || '—'}</b></div>
            </div>
            {detail.notes && <p className="rounded-xl p-3" style={{ background: 'var(--card2)' }}>{detail.notes}</p>}
            <div className="pt-2" style={{ borderTop: '1px solid var(--line)' }}><AttachFiles entity={{ reservation_id: detail.id }} /></div>
            {detail.status === 'cancelled' && (
              <div className="rounded-xl p-3" style={{ background: 'rgba(220,38,38,.07)' }}>
                <b>بيانات الإلغاء:</b> السبب: {detail.cancel_reason} — المسترد: <b className="num">{fmtN(detail.refund_amount)}</b> — المخصوم: <b className="num">{fmtN(detail.deducted_amount)}</b> — الاسترداد: {detail.refund_status}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* إلغاء */}
      <Modal open={!!cancel} onClose={() => setCancel(null)} title={`إلغاء الحجز ${cancel?.code}`} w={500}
        actions={<><Btn v="d" onClick={async () => {
          try { await api(`/reservations/${cancel.id}/cancel`, { method: 'POST', body: cancel }); toast('تم إلغاء الحجز'); setCancel(null); load(); }
          catch (e) { toast(e.message, 'error'); }
        }}>تأكيد الإلغاء</Btn><Btn v="g" onClick={() => setCancel(null)}>تراجع</Btn></>}>
        {cancel && (
          <div className="space-y-3">
            <div className="rounded-xl p-3 text-[13px]" style={{ background: 'var(--card2)' }}>العربون المدفوع: <b className="num">{fmtN(cancel.deposit)} {cur}</b> — المسترد + المخصوم يجب ألا يتجاوزه</div>
            <Field label="سبب الإلغاء *"><input className="inp" value={cancel.cancel_reason || ''} onChange={e => setCancel({ ...cancel, cancel_reason: e.target.value })} placeholder="مثال: عدول العميل عن الشراء" /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="المسترد"><input type="number" min={0} className="inp num" value={cancel.refund_amount || 0} onChange={e => setCancel({ ...cancel, refund_amount: +e.target.value })} /></Field>
              <Field label="المخصوم"><input type="number" min={0} className="inp num" value={cancel.deducted_amount || 0} onChange={e => setCancel({ ...cancel, deducted_amount: +e.target.value })} /></Field>
              <Field label="حالة الاسترداد"><select className="inp" value={cancel.refund_status || 'pending'} onChange={e => setCancel({ ...cancel, refund_status: e.target.value })}><option value="pending">معلق</option><option value="done">تم</option><option value="none">لا يوجد</option></select></Field>
            </div>
          </div>
        )}
      </Modal>

      {/* تحويل لبيع */}
      <SaleFromReserve open={!!toSale} resv={toSale} cur={cur} onClose={() => setToSale(null)} onDone={() => { setToSale(null); load(); }} />
    </>
  );
}

export function SaleFromReserve({ open, resv, cur, onClose, onDone }) {
  const { toast, can } = useStore();
  const [f, setF] = useState({});
  const [brokers, setBrokers] = useState([]);
  useEffect(() => { if (open && resv) { setF({ reservation_id: resv.id, sale_price: resv.price, discount: resv.discount || 0, down_payment: resv.deposit || 0, broker_id: '', commission: '', broker_name: '', payment_method: 'transfer', reference_no: '', sale_date: new Date().toISOString().slice(0, 10), notes: '' }); if (can('brokers')) api('/brokers').then(r => setBrokers(r.data || [])).catch(() => {}); } }, [open]);
  const net = (+f.sale_price || 0) - (+f.discount || 0);
  const settle = net - (+f.commission || 0);
  const S = (k, v) => setF(x => ({ ...x, [k]: v }));
  return (
    <Modal open={open} onClose={onClose} title={`إتمام بيع — حجز ${resv?.code}`} w={600}
      actions={<><Btn onClick={async () => {
        try { const r = await api('/sales', { method: 'POST', body: f }); toast(`تم إنشاء البيع ${r.code}`); onDone(); }
        catch (e) { toast(e.message, 'error'); }
      }}><I n="check" s={15} /> إتمام البيع</Btn><Btn v="g" onClick={onClose}>إلغاء</Btn></>}>
      <div className="space-y-3">
        <div className="rounded-xl p-3 text-[13px]" style={{ background: 'rgba(22,163,74,.08)' }}>
          العميل: <b>{resv?.client_name}</b> — الوحدة: <b className="num">{resv?.unit_code}</b>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="سعر البيع"><input type="number" min={0} className="inp num" value={f.sale_price || 0} onChange={e => S('sale_price', +e.target.value)} /></Field>
          <Field label="الخصم"><input type="number" min={0} className="inp num" value={f.discount || 0} onChange={e => S('discount', +e.target.value)} /></Field>
          <Field label="الصافي"><input className="inp num" disabled value={fmtN(net)} /></Field>
          <Field label="الدفعة الأولى"><input type="number" min={0} className="inp num" value={f.down_payment || 0} onChange={e => S('down_payment', +e.target.value)} /></Field>
          <Field label="عمولة الوسيط (فارغ = تلقائي)"><input type="number" min={0} className="inp num" value={f.commission} placeholder={f.broker_id ? 'تلقائي من نسبة الوسيط' : '0'} onChange={e => S('commission', e.target.value)} /></Field>
          <Field label="التسوية (صافٍ − عمولة)"><input className="inp num" disabled value={fmtN(settle)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {brokers.length > 0 ? <Field label="الوسيط (عمولة تلقائية)"><select className="inp" value={f.broker_id || ''} onChange={e => S('broker_id', e.target.value ? +e.target.value : '')}><option value="">— بدون وسيط —</option>{brokers.map(b => <option key={b.id} value={b.id}>{b.name} — %{b.commission_rate}</option>)}</select></Field> : <Field label="اسم الوسيط"><input className="inp" value={f.broker_name || ''} onChange={e => S('broker_name', e.target.value)} /></Field>}
          <Field label="تاريخ البيع"><input type="date" className="inp" value={f.sale_date || ''} onChange={e => S('sale_date', e.target.value)} /></Field>
          <Field label="طريقة الدفع"><select className="inp" value={f.payment_method || 'transfer'} onChange={e => S('payment_method', e.target.value)}>{Object.entries(L.payMethod).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="رقم المرجع"><input className="inp num" value={f.reference_no || ''} onChange={e => S('reference_no', e.target.value)} /></Field>
        </div>
        <Field label="ملاحظات"><input className="inp" value={f.notes || ''} onChange={e => S('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
