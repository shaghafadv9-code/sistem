import React, { useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtD, todayStr, L, badge, methodLabel } from '../lib/format.js';
import { I, Btn, Badge, Field, Modal, PageHead, Tabs, Confirm } from '../components/ui.jsx';
import { useList, useFetch, Kpis, FilterBar, Table, ExcelBtn } from '../components/fin.jsx';

export default function Schedule() {
  const { can, toast, company, project: gProject } = useStore();
  const cur = company.currency || 'ر.س';
  const [mode, setMode] = useState('all');
  const [f, setF] = useState({ from: '', to: '', status: '', project_id: gProject || '', client_id: '' });
  const [page, setPage] = useState(1);
  const qs = { page, limit: 20, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), ...(mode === 'overdue' ? { overdue: 1 } : {}), ...(mode === 'open' ? { unpaid: 1 } : {}) };
  const { rows, meta, busy, err, reload } = useList('/schedule', qs);
  const { data: sales } = useFetch('/sales?limit=100');
  const { data: accs } = useFetch('/accounts?limit=100');
  const [pay, setPay] = useState(null);
  const [gen, setGen] = useState(null);
  const [saving, setSaving] = useState(false);
  const accounts = accs?.data || [];

  const doPay = async () => {
    setSaving(true);
    try {
      await api(`/schedule/${pay.id}/pay`, { method: 'POST', body: { amount: Number(pay.amount), method: pay.method, account_id: pay.account_id, paid_at: pay.paid_at, reference_no: pay.reference_no, notes: pay.notes } });
      toast('تم تسجيل دفع القسط');
      setPay(null); reload();
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };
  const doGen = async () => {
    setSaving(true);
    try {
      await api('/schedule/generate', { method: 'POST', body: { sale_id: gen.sale_id, installments: Number(gen.installments), first_due_date: gen.first_due_date, period_days: Number(gen.period_days), keep_paid: true } });
      toast('تم توليد جدول الأقساط');
      setGen(null); reload();
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };
  const cancelRow = async (r) => {
    try { await api('/schedule/' + r.id, { method: 'DELETE' }); toast('تم إلغاء القسط'); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title="جدول الأقساط والاستحقاقات" sub="مواعيد الدفعات لكل عقد/عميل/وحدة، مع المدفوع والمتبقي والمتأخرات وأيام التأخير"
        actions={<>
          <ExcelBtn path="/schedule/excel" filters={f} name="جدول-الأقساط.xlsx" can={can('schedule', 'export')} />
          <ExcelBtn path="/schedule/overdue/excel" filters={{ days: 1 }} name="المتأخرات.xlsx" label="تصدير المتأخرات"
            can={can('schedule', 'export')} />
          {can('schedule', 'create') && <Btn v="o" onClick={() => setGen({ sale_id: sales?.data?.[0]?.id || '', installments: 12, first_due_date: todayStr(), period_days: 30 })}><I n="refresh" s={15} /> توليد جدول</Btn>}
        </>} />

      <Kpis items={[
        { icon: 'clip', label: 'إجمالي الأقساط المعروضة', value: fmtN(meta.totals?.amount) + ' ' + cur, sub: `${meta.total} قسط` },
        { icon: 'check', label: 'المدفوع منها', value: fmtN(meta.totals?.paid), color: '#15803d' },
        { icon: 'clock', label: 'المتبقي', value: fmtN(meta.totals?.remaining), color: '#b45309' },
        { icon: 'alert', label: 'المتأخرات (كل العملاء)', value: fmtN(rows.filter(r => r.status === 'overdue').reduce((a, r) => a + Number(r.remaining || 0), 0)), color: '#b91c1c' },
      ]} />

      <div className="mb-3 no-print"><Tabs tabs={[{ k: 'all', t: 'الكل' }, { k: 'open', t: 'غير مسدد' }, { k: 'overdue', t: 'متأخر فقط' }]} val={mode} onChange={setMode} /></div>

      <FilterBar onReload={reload}>
        <Field label="استحقاق من"><input type="date" className="inp num" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="إلى"><input type="date" className="inp num" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="الحالة"><select className="inp" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">الكل</option>{Object.entries(L.schedStatus).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
      </FilterBar>

      <Table rows={rows} busy={busy} err={err} empty="لا توجد أقساط"
        cols={[
          { k: 'code', t: 'الكود' },
          { k: 'client_name', t: 'العميل', r: r => <><b>{r.client_name}</b><div className="text-[11.5px] num" style={{ color: 'var(--ink3)' }}>{r.client_phone}</div></> },
          { k: 'project_name', t: 'المشروع', r: r => r.project_name || '—' },
          { k: 'unit_code', t: 'الوحدة' },
          { k: 'sale_code', t: 'البيع' },
          { k: 'seq', t: 'القسط', r: r => `${r.seq} — ${r.label || ''}` },
          { k: 'due_date', t: 'الاستحقاق', r: r => fmtD(r.due_date) },
          { k: 'amount', t: 'المبلغ', r: r => <span className="num">{fmtN(r.amount)}</span> },
          { k: 'paid_amount', t: 'المدفوع', r: r => <span className="money-in num">{fmtN(r.paid_amount)}</span> },
          { k: 'remaining', t: 'المتبقي', r: r => <span className="money-due num">{fmtN(r.remaining)}</span> },
          { k: 'status', t: 'الحالة', r: r => <Badge c={badge.schedStatus[r.status]}>{L.schedStatus[r.status] || r.status}</Badge> },
          { k: 'days_late', t: 'أيام التأخير', center: true, r: r => Number(r.days_late) > 0 ? <Badge c="b-red">{r.days_late} يوم</Badge> : <span style={{ color: 'var(--ink3)' }}>—</span> },
          {
            t: 'إجراءات', center: true, r: r => (
              <div className="flex gap-1 justify-center" onClick={e => e.stopPropagation()}>
                {can('schedule', 'edit') && !['paid', 'cancelled'].includes(r.status) && <button className="icon-btn" title="دفع القسط" onClick={() => setPay({ ...r, amount: r.remaining, method: 'cash', account_id: accounts.find(a => a.is_default)?.id || accounts[0]?.id, paid_at: todayStr(), reference_no: '', notes: '' })}><I n="coins" s={15} /></button>}
                {can('schedule', 'delete') && r.status !== 'paid' && <button className="icon-btn" title="إلغاء القسط" onClick={() => cancelRow(r)}><I n="x" s={15} /></button>}
              </div>
            )
          },
        ]} />

      <div className="flex items-center justify-between mt-3 text-[13px] no-print" style={{ color: 'var(--ink2)' }}>
        <div>{meta.total} قسط — الصفحة {page} من {meta.pages || 1}</div>
        <div className="flex gap-2"><Btn v="o" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</Btn><Btn v="o" size="sm" disabled={page >= (meta.pages || 1)} onClick={() => setPage(page + 1)}>التالي</Btn></div>
      </div>

      <Modal open={!!pay} onClose={() => setPay(null)} title={`دفع قسط ${pay?.label || ''}`} w={520}
        actions={<><Btn v="o" onClick={() => setPay(null)}>إلغاء</Btn><Btn v="g" disabled={saving} onClick={doPay}><I n="coins" s={15} /> تأكيد الدفع</Btn></>}>
        {pay && (
          <div className="space-y-3">
            <div className="text-[13px] rounded-xl p-2.5" style={{ background: 'var(--bg2)' }}>
              العميل: <b>{pay.client_name}</b> — المتبقي على القسط: <b className="num">{fmtN(pay.remaining)}</b> {cur}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="المبلغ"><input type="number" className="inp num" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} /></Field>
              <Field label="طريقة الدفع"><select className="inp" value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value })}>{Object.entries(L.payMethod).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
              <Field label="الحساب المستلم"><select className="inp" value={pay.account_id} onChange={e => setPay({ ...pay, account_id: e.target.value })}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              <Field label="التاريخ"><input type="date" className="inp num" value={pay.paid_at} onChange={e => setPay({ ...pay, paid_at: e.target.value })} /></Field>
              <Field label="المرجع"><input className="inp num" value={pay.reference_no} onChange={e => setPay({ ...pay, reference_no: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!gen} onClose={() => setGen(null)} title="توليد جدول أقساط" w={480}
        actions={<><Btn v="o" onClick={() => setGen(null)}>إلغاء</Btn><Btn v="g" disabled={saving} onClick={doGen}>توليد</Btn></>}>
        {gen && (
          <div className="space-y-3">
            <Field label="عملية البيع"><select className="inp" value={gen.sale_id} onChange={e => setGen({ ...gen, sale_id: e.target.value })}>{(sales?.data || []).map(s => <option key={s.id} value={s.id}>{s.code} — {s.client_name} — متبقي {fmtN(s.remaining)}</option>)}</select></Field>
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="عدد الأقساط"><input type="number" className="inp num" value={gen.installments} onChange={e => setGen({ ...gen, installments: e.target.value })} /></Field>
              <Field label="أول استحقاق"><input type="date" className="inp num" value={gen.first_due_date} onChange={e => setGen({ ...gen, first_due_date: e.target.value })} /></Field>
              <Field label="كل (يوم)"><input type="number" className="inp num" value={gen.period_days} onChange={e => setGen({ ...gen, period_days: e.target.value })} /></Field>
            </div>
            <div className="text-[12px]" style={{ color: 'var(--ink3)' }}>يُعيد الخادم توزيع المتبقي على الأقساط مع الحفاظ على ما سُدّد فعليًا.</div>
          </div>
        )}
      </Modal>
    </>
  );
}
