import React, { useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtD, todayStr, L, badge, methodLabel } from '../lib/format.js';
import { I, Btn, Badge, Field, Modal, PageHead, Tabs, Empty } from '../components/ui.jsx';
import { useList, useFetch, Kpis, FilterBar, Table, ExcelBtn } from '../components/fin.jsx';

export default function Commissions() {
  const { can, toast, company } = useStore();
  const cur = company.currency || 'ر.س';
  const [tab, setTab] = useState('due');
  const [f, setF] = useState({ broker_id: '', status: '', from: '', to: '', project_id: '' });
  const [page, setPage] = useState(1);
  const params = { page, limit: 20, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) };
  const { rows, meta, busy, err, reload } = useList('/commissions', params);
  const { data: payouts, reload: rp } = useFetch('/commission-payments');
  const { data: brokers } = useFetch('/brokers?limit=100');
  const { data: accs } = useFetch('/accounts?limit=100');
  const [pay, setPay] = useState(null);
  const [stmt, setStmt] = useState(null);
  const [saving, setSaving] = useState(false);
  const accounts = accs?.data || [];

  const doPay = async () => {
    setSaving(true);
    try {
      await api('/commissions/payout', { method: 'POST', body: { broker_id: pay.broker_id, sale_id: pay.sale_id || null, amount: Number(pay.amount), account_id: pay.account_id, method: pay.method, pay_date: pay.pay_date, reference_no: pay.reference_no, notes: pay.notes } });
      toast('تم تسجيل صرف العمولة'); setPay(null); reload(); rp();
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };
  const openStmt = async (id) => {
    try { setStmt(await api('/brokers/' + id + '/statement')); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title="عمولات المسوقين" sub="عمولة كل عملية بيع: النسبة والقيمة والمصروف والمتبقي وتاريخ الاستحقاق — مع كشف حساب لكل مسوق"
        actions={<>
          <ExcelBtn path="/commissions/excel" filters={f} name="العمولات.xlsx" can={can('commissions', 'export')} />
          {can('commissions', 'create') && <Btn v="g" onClick={() => setPay({ broker_id: (brokers?.data || [])[0]?.id || '', sale_id: '', amount: '', account_id: accounts.find(a => a.is_default)?.id || '', method: 'transfer', pay_date: todayStr(), reference_no: '', notes: '' })}><I n="coins" s={15} /> صرف عمولة</Btn>}
        </>} />

      <Kpis items={[
        { icon: 'percent', label: 'إجمالي العمولات (المعروضة)', value: fmtN(meta.totals?.commission ?? rows.reduce((a, r) => a + Number(r.commission || 0), 0)) + ' ' + cur },
        { icon: 'check', label: 'المدفوع', value: fmtN(rows.reduce((a, r) => a + Number(r.paid || 0), 0)), color: '#15803d' },
        { icon: 'clock', label: 'المتبقي', value: fmtN(rows.reduce((a, r) => a + Number(r.remaining || 0), 0)), color: '#b45309' },
        { icon: 'alert', label: 'متأخرة', value: String(rows.filter(r => r.status === 'متأخرة').length), color: '#b91c1c' },
      ]} />

      <div className="mb-3 no-print"><Tabs tabs={[{ k: 'due', t: 'العمولات' }, { k: 'payouts', t: 'دفعات العمولات' }, { k: 'brokers', t: 'كشوف المسوقين' }]} val={tab} onChange={setTab} /></div>

      {tab === 'due' && <>
        <FilterBar onReload={reload}>
          <Field label="المسوق"><select className="inp" value={f.broker_id} onChange={e => setF({ ...f, broker_id: e.target.value })}><option value="">الكل</option>{(brokers?.data || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="من"><input type="date" className="inp num" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="إلى"><input type="date" className="inp num" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
        </FilterBar>
        <Table rows={rows} busy={busy} err={err} empty="لا توجد عمولات"
          cols={[
            { k: 'sale_code', t: 'عملية البيع', r: r => r.sale_code || r.code },
            { k: 'sale_date', t: 'التاريخ', r: r => fmtD(r.sale_date) },
            { k: 'broker_name', t: 'المسوق' },
            { k: 'client_name', t: 'العميل' },
            { k: 'unit_code', t: 'الوحدة' },
            { k: 'project_name', t: 'المشروع', r: r => r.project_name || '—' },
            { k: 'rate', t: 'النسبة %', r: r => r.rate !== undefined && r.rate !== null ? <span className="num">{r.rate}</span> : '—' },
            { k: 'net_price', t: 'قيمة البيع', r: r => <span className="num">{fmtN(r.net_price)}</span> },
            { k: 'commission', t: 'العمولة', r: r => <b className="num">{fmtN(r.commission)}</b> },
            { k: 'paid', t: 'المدفوع', r: r => <span className="money-in num">{fmtN(r.paid)}</span> },
            { k: 'remaining', t: 'المتبقي', r: r => <span className="money-due num">{fmtN(r.remaining)}</span> },
            { k: 'due_date', t: 'الاستحقاق', r: r => fmtD(r.due_date) },
            { k: 'status', t: 'الحالة', r: r => <Badge c={r.status === 'مدفوعة' ? 'b-green' : r.status === 'متأخرة' ? 'b-red' : 'b-amber'}>{r.status}</Badge> },
            {
              t: 'إجراءات', center: true, r: r => (
                <div className="flex gap-1 justify-center" onClick={e => e.stopPropagation()}>
                  {can('commissions', 'create') && Number(r.remaining) > 0.01 && <button className="icon-btn" title="صرف العمولة" onClick={() => setPay({ broker_id: r.broker_id, sale_id: r.sale_id || r.id, amount: r.remaining, account_id: accounts.find(a => a.is_default)?.id || '', method: 'transfer', pay_date: todayStr(), reference_no: '', notes: '' })}><I n="coins" s={15} /></button>}
                  {r.broker_id && <button className="icon-btn" title="كشف المسوق" onClick={() => openStmt(r.broker_id)}><I n="list" s={15} /></button>}
                </div>
              )
            },
          ]} />
      </>}

      {tab === 'payouts' && (
        <Table rows={payouts?.data || []} busy={!payouts} err="" empty="لم تُصرف أي عمولة بعد"
          cols={[
            { k: 'code', t: 'الكود' },
            { k: 'pay_date', t: 'التاريخ', r: r => fmtD(r.pay_date) },
            { k: 'broker_name', t: 'المسوق', r: r => r.broker_name || '—' },
            { k: 'sale_code', t: 'عملية البيع', r: r => r.sale_code || '—' },
            { k: 'amount', t: 'المبلغ', r: r => <span className="money-out num">{fmtN(r.amount)}</span> },
            { k: 'method', t: 'الطريقة', r: r => methodLabel(r.method) },
            { k: 'account_name', t: 'الحساب', r: r => r.account_name || '—' },
            { k: 'user_name', t: 'المستخدم', r: r => r.user_name || '—' },
          ]} />
      )}

      {tab === 'brokers' && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {(brokers?.data || []).map(b => (
            <div key={b.id} className="card p-4">
              <div className="flex items-center justify-between"><b>{b.name}</b><Badge c={b.status === 'active' ? 'b-green' : 'b-gray'}>{b.status === 'active' ? 'فعّال' : b.status}</Badge></div>
              <div className="text-[12.5px]" style={{ color: 'var(--ink2)' }}>نسبة العمولة: <span className="num">{b.commission_rate}%</span> — {b.commission_method === 'fixed' ? 'مبلغ ثابت' : 'نسبة من البيع'}</div>
              {b.phone && <div className="text-[12px] num" style={{ color: 'var(--ink3)' }}>{b.phone}</div>}
              <div className="flex gap-1.5 mt-3"><Btn v="o" size="sm" onClick={() => openStmt(b.id)}><I n="list" s={14} /> كشف الحساب</Btn></div>
            </div>
          ))}
          {(brokers?.data || []).length === 0 && <div className="card"><Empty title="لا يوجد مسوقون" /></div>}
        </div>
      )}

      <Modal open={!!pay} onClose={() => setPay(null)} title="صرف عمولة لمسوق" w={520}
        actions={<><Btn v="o" onClick={() => setPay(null)}>إلغاء</Btn><Btn v="g" disabled={saving} onClick={doPay}><I n="coins" s={15} /> تسجيل الصرف</Btn></>}>
        {pay && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="المسوق *"><select className="inp" value={pay.broker_id} onChange={e => setPay({ ...pay, broker_id: e.target.value })}>{(brokers?.data || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
              <Field label="المبلغ *"><input type="number" className="inp num" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} /></Field>
              <Field label="الحساب المالي"><select className="inp" value={pay.account_id} onChange={e => setPay({ ...pay, account_id: e.target.value })}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              <Field label="طريقة الدفع"><select className="inp" value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value })}>{Object.entries(L.payMethod).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
              <Field label="التاريخ"><input type="date" className="inp num" value={pay.pay_date} onChange={e => setPay({ ...pay, pay_date: e.target.value })} /></Field>
              <Field label="المرجع"><input className="inp num" value={pay.reference_no} onChange={e => setPay({ ...pay, reference_no: e.target.value })} /></Field>
            </div>
            <div className="text-[12px]" style={{ color: 'var(--ink3)' }}>لا يمكن صرف مبلغ يتجاوز متبقي العمولة على العملية المحددة.</div>
          </div>
        )}
      </Modal>

      <Modal open={!!stmt} onClose={() => setStmt(null)} title={`كشف حساب المسوق — ${stmt?.broker?.name || ''}`} w={760}
        actions={<><Btn v="o" onClick={() => window.print()}><I n="print" s={15} /> طباعة</Btn><Btn v="g" onClick={() => setStmt(null)}>إغلاق</Btn></>}>
        {stmt && (
          <div className="print-area space-y-3">
            <Kpis items={[
              { label: 'إجمالي العمولات', value: fmtN(stmt.totals?.commission || 0) + ' ' + cur },
              { label: 'المدفوع', value: fmtN(stmt.totals?.paid || 0), color: '#15803d' },
              { label: 'المتبقي', value: fmtN(stmt.totals?.remaining || 0), color: '#b45309' },
            ]} />
            <Table rows={stmt.sales || []} busy={false} err="" empty="لا توجد عمولات"
              cols={[
                { k: 'code', t: 'عملية البيع' }, { k: 'sale_date', t: 'التاريخ', r: r => fmtD(r.sale_date) },
                { k: 'client_name', t: 'العميل' }, { k: 'unit_code', t: 'الوحدة' },
                { k: 'net_price', t: 'قيمة البيع', r: r => <span className="num">{fmtN(r.net_price)}</span> },
                { k: 'commission', t: 'العمولة', r: r => <b className="num">{fmtN(r.commission)}</b> },
                { k: 'paid', t: 'المدفوع', r: r => <span className="money-in num">{fmtN(r.paid)}</span> },
                { k: 'remaining', t: 'المتبقي', r: r => <span className="money-due num">{fmtN(r.remaining)}</span> },
              ]} />
            {(stmt.payments || []).length > 0 && <>
              <b>دفعات العمولة</b>
              <Table rows={stmt.payments} busy={false} err="" cols={[
                { k: 'code', t: 'الكود' }, { k: 'pay_date', t: 'التاريخ', r: r => fmtD(r.pay_date) },
                { k: 'amount', t: 'المبلغ', r: r => <span className="money-out num">{fmtN(r.amount)}</span> },
                { k: 'method', t: 'الطريقة', r: r => methodLabel(r.method) }, { k: 'account_name', t: 'الحساب', r: r => r.account_name || '—' },
              ]} />
            </>}
          </div>
        )}
      </Modal>
    </>
  );
}
