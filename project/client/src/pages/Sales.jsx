import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtD, L, badge, todayStr } from '../lib/format.js';
import { I, Btn, Badge, Empty, Skeleton, ErrBox, PageHead, Modal, Field, SearchInp, Pagination, Stat } from '../components/ui.jsx';
import TimelineView from '../components/TimelineView.jsx';
import AttachFiles from '../components/AttachFiles.jsx';

export default function Sales() {
  const { can, toast, company, project: gProject } = useStore();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [summary, setSummary] = useState(null);
  const [detail, setDetail] = useState(null);
  const [full, setFull] = useState(null);
  const [pay, setPay] = useState(null);
  const cur = company.currency || 'ر.س';

  const load = () => {
    setBusy(true); setErr('');
    api('/sales' + q({ page, limit: 12, q: search, project_id: gProject || undefined }))
      .then(r => { setRows(r.data); setTotal(r.total); setBusy(false); }).catch(e => { setErr(e.message); setBusy(false); });
  };
  useEffect(() => { setPage(1); }, [search, gProject]);
  useEffect(load, [page, search, gProject]);
  useEffect(() => { if (can('finance')) api('/finance/summary').then(setSummary).catch(() => {}); }, []);

  const openDetail = async (s) => {
    setDetail(s);
    try { const r = await api('/sales/' + s.id); setFull(r); } catch { setFull(null); }
  };

  return (
    <>
      <PageHead title="المبيعات والمالية" sub="عمليات البيع، الدفعات، العمولات والتسويات" />

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5 anim-in">
          <Stat icon="wallet" label="إجمالي المبيعات" value={fmtN(summary.sales?.total)} sub={`${summary.sales?.n || 0} عمليات`} color="#1d61f5" />
          <Stat icon="money" label="المحصل" value={fmtN((+summary.sales?.down || 0) + (+summary.paid || 0))} color="#16a34a" />
          <Stat icon="clock" label="المستحق (متبقي)" value={fmtN(summary.outstanding)} color="#d97706" />
          <Stat icon="users" label="العمولات" value={fmtN(summary.sales?.comm)} color="#7c3aed" />
        </div>
      )}

      <div className="card p-3.5 mb-4 anim-in"><SearchInp value={search} onChange={setSearch} ph="بحث برقم العملية، العميل، الوحدة..." /></div>

      {err && <ErrBox msg={err} retry={load} />}
      {busy && <Skeleton n={4} />}
      {!busy && !err && rows.length === 0 && <div className="card"><Empty icon="wallet" title="لا توجد عمليات بيع" /></div>}

      {!busy && !err && (
        <div className="card overflow-x-auto anim-in">
          <table className="tbl min-w-[900px]">
            <thead><tr><th>الكود</th><th>العميل</th><th>الوحدة</th><th>الصافي</th><th>المدفوع</th><th>المتبقي</th><th>العمولة</th><th>التاريخ</th><th></th></tr></thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id}>
                  <td><b className="num cursor-pointer" style={{ color: 'var(--brand)' }} onClick={() => openDetail(s)}>{s.code}</b></td>
                  <td>{s.client_name}</td>
                  <td className="num">{s.unit_code} <span style={{ color: 'var(--ink3)' }}>({s.project_code})</span></td>
                  <td className="num font-bold">{fmtN(s.net_price)}</td>
                  <td className="num" style={{ color: 'var(--ok)' }}>{fmtN(s.total_paid)}</td>
                  <td className="num" style={{ color: s.remaining > 0 ? 'var(--warn)' : 'var(--ink3)' }}>{fmtN(s.remaining)}</td>
                  <td className="num">{fmtN(s.commission)}</td>
                  <td className="num">{fmtD(s.sale_date)}</td>
                  <td><div className="flex gap-1">
                    <button className="icon-btn" onClick={() => openDetail(s)} title="التفاصيل"><I n="eye" s={17} /></button>
                    {can('finance', 'create') && s.remaining > 0 && <Btn v="ok" size="xs" onClick={() => setPay(s)}>+ دفعة</Btn>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={Math.ceil(total / 12)} total={total} onGo={setPage} />

      {summary?.byMonth?.length > 0 && (
        <div className="card p-5 mt-5 anim-in">
          <b className="text-[15px]">المبيعات الشهرية — آخر 12 شهرًا</b>
          <div className="h-[240px] mt-2" dir="ltr">
            <ResponsiveContainer><BarChart data={summary.byMonth.map(x => ({ name: x.m?.slice(2), value: x.total }))}>
              <XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="value" fill="#1d61f5" radius={[8, 8, 0, 0]} />
            </BarChart></ResponsiveContainer>
          </div>
        </div>
      )}

      {/* تفاصيل العملية */}
      <Modal open={!!detail} onClose={() => { setDetail(null); setFull(null); }} title={`عملية البيع ${detail?.code}`} w={640}>
        {full && (
          <div className="space-y-3 text-[13.5px]">
            <div className="grid grid-cols-2 gap-2">
              <div>العميل: <b>{full.client_name}</b> <span className="num" style={{ color: 'var(--ink3)' }}>{full.client_phone}</span></div>
              <div>الوحدة: <b className="num">{full.unit_code}</b> — مشروع {full.project_code} ({full.rooms} غرف، {fmtN(full.area)} م²)</div>
              <div>سعر البيع: <b className="num">{fmtN(full.sale_price)} {cur}</b></div>
              <div>الخصم: <b className="num">{fmtN(full.discount)}</b></div>
              <div>الصافي: <b className="num" style={{ color: 'var(--brand)' }}>{fmtN(full.net_price)} {cur}</b></div>
              <div>الدفعة الأولى: <b className="num">{fmtN(full.down_payment)}</b></div>
              <div>عمولة الوسيط ({full.broker_name || '—'}): <b className="num">{fmtN(full.commission)}</b></div>
              <div>التسوية (صافٍ − عمولة): <b className="num" style={{ color: 'var(--ok)' }}>{fmtN(full.settlement)}</b></div>
              <div>المدفوع: <b className="num">{fmtN(full.total_paid)}</b></div>
              <div>المتبقي: <b className="num" style={{ color: 'var(--warn)' }}>{fmtN(full.remaining)}</b></div>
              <div>الفاتورة: <b className="num">{full.invoice?.code || '—'}</b></div>
              <div>المرجع: <b className="num">{full.reference_no || '—'}</b></div>
            </div>
            <div>
              <b>الدفعات ({full.payments?.length || 0})</b>
              <div className="mt-2 space-y-1.5">
                {(full.payments || []).map(p => (
                  <div key={p.id} className="flex items-center gap-2 rounded-xl px-3 py-2 text-[13px]" style={{ background: 'var(--card2)' }}>
                    <b className="num">{fmtN(p.amount)} {cur}</b>
                    <span style={{ color: 'var(--ink2)' }}>{L.payMethod[p.method]} — {p.reference_no}</span>
                    <span className="mr-auto num" style={{ color: 'var(--ink3)' }}>{fmtD(p.paid_at)}</span>
                  </div>
                ))}
                {(full.payments || []).length === 0 && <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>لا توجد دفعات إضافية</div>}
              </div>
            </div>
            {can('finance', 'create') && full.remaining > 0 && <Btn v="ok" size="sm" onClick={() => { setPay(full); setDetail(null); setFull(null); }}>+ تسجيل دفعة</Btn>}
            <div className="pt-2" style={{ borderTop: '1px solid var(--line)' }}><TimelineView url={'/timeline/sale/' + full.id} /></div>
            <div className="pt-2" style={{ borderTop: '1px solid var(--line)' }}><AttachFiles entity={{ sale_id: full.id }} /></div>
          </div>
        )}
      </Modal>

      {/* دفعة */}
      <Modal open={!!pay} onClose={() => setPay(null)} title={`دفعة جديدة — ${pay?.code}`} w={460}
        actions={<><Btn v="ok" onClick={async () => {
          try { await api(`/sales/${pay.id}/payments`, { method: 'POST', body: pay._f }); toast('تم تسجيل الدفعة'); setPay(null); load(); }
          catch (e) { toast(e.message, 'error'); }
        }}>حفظ الدفعة</Btn><Btn v="g" onClick={() => setPay(null)}>إلغاء</Btn></>}>
        {pay && <PayForm pay={pay} setPay={setPay} cur={cur} />}
      </Modal>
    </>
  );
}

function PayForm({ pay, setPay, cur }) {
  const f = pay._f || { amount: pay.remaining, method: 'transfer', reference_no: '', paid_at: todayStr(), notes: '' };
  const S = (k, v) => setPay({ ...pay, _f: { ...f, [k]: v } });
  return (
    <div className="space-y-3">
      <div className="rounded-xl p-3 text-[13px]" style={{ background: 'var(--card2)' }}>المتبقي على العملية: <b className="num">{fmtN(pay.remaining)} {cur}</b></div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`المبلغ (${cur}) *`}><input type="number" min={0.01} max={pay.remaining} className="inp num" value={f.amount} onChange={e => S('amount', +e.target.value)} /></Field>
        <Field label="الطريقة"><select className="inp" value={f.method} onChange={e => S('method', e.target.value)}>{Object.entries(L.payMethod).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="رقم المرجع"><input className="inp num" value={f.reference_no} onChange={e => S('reference_no', e.target.value)} /></Field>
        <Field label="التاريخ"><input type="date" className="inp" value={f.paid_at} onChange={e => S('paid_at', e.target.value)} /></Field>
      </div>
      <Field label="ملاحظات"><input className="inp" value={f.notes} onChange={e => S('notes', e.target.value)} /></Field>
    </div>
  );
}
