import React, { useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtDT, L, badge } from '../lib/format.js';
import { I, Btn, Badge, Field, Modal, PageHead, Tabs, Empty } from '../components/ui.jsx';
import { useList, Kpis, FilterBar, Table } from '../components/fin.jsx';

const ACTIONS = {
  large_discount: 'خصم كبير', cancel_reservation: 'إلغاء حجز', cancel_sale: 'إلغاء بيع', refund: 'استرداد',
  expense: 'مصروف', expense_pay: 'صرف مصروف', expense_cancel: 'إلغاء مصروف', payment_edit: 'تعديل دفعة',
  payment_cancel: 'إلغاء دفعة', payment_override: 'دفعة زائدة', contract_amount: 'تعديل قيمة عقد',
};

export default function Approvals() {
  const { can, toast } = useStore();
  const [f, setF] = useState({ status: 'pending', module: '' });
  const [page, setPage] = useState(1);
  const { rows, meta, busy, err, reload } = useList('/approvals', { page, limit: 20, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) });
  const [decide, setDecide] = useState(null);
  const [saving, setSaving] = useState(false);
  const canApprove = meta.extra?.can_approve || can('approvals', 'approve');

  const doDecide = async (approve) => {
    setSaving(true);
    try {
      await api(`/approvals/${decide.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: { note: decide.note } });
      toast(approve ? 'تم الاعتماد وتنفيذ العملية' : 'تم رفض الطلب');
      setDecide(null); reload();
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };

  return (
    <>
      <PageHead title="الطلبات والموافقات" sub="اعتماد المدير للخصومات الكبيرة، إلغاء الحجوزات والمبيعات، الاستردادات، المصروفات، وتعديل الدفعات — كل طلب يُسجَّل في سجل التدقيق"
        actions={<div className="text-[13px] num">معلّق: <b>{meta.extra?.pending ?? 0}</b></div>} />

      <Kpis items={[
        { icon: 'clock', label: 'طلبات معلقة', value: String(meta.extra?.pending ?? rows.filter(r => r.status === 'pending').length), color: '#b45309' },
        { icon: 'check', label: 'معتمدة (المعروضة)', value: String(rows.filter(r => r.status === 'approved').length), color: '#15803d' },
        { icon: 'ban', label: 'مرفوضة (المعروضة)', value: String(rows.filter(r => r.status === 'rejected').length), color: '#b91c1c' },
        { icon: 'scale', label: 'إجمالي المبالغ المعلقة', value: fmtN(rows.filter(r => r.status === 'pending').reduce((a, r) => a + Number(r.amount || 0), 0)) },
      ]} />

      <FilterBar onReload={reload}>
        <Tabs tabs={[{ k: '', t: 'الكل' }, ...Object.entries(L.approvalStatus).map(([k, t]) => ({ k, t }))]} val={f.status} onChange={v => { setF({ ...f, status: v }); setPage(1); }} />
        <Field label="الوحدة"><select className="inp" value={f.module} onChange={e => setF({ ...f, module: e.target.value })}>
          <option value="">الكل</option>
          {['sales', 'reservations', 'finance', 'expenses', 'contracts'].map(m => <option key={m} value={m}>{m}</option>)}
        </select></Field>
      </FilterBar>

      <Table rows={rows} busy={busy} err={err} empty="لا توجد طلبات"
        cols={[
          { k: 'code', t: 'رقم الطلب' },
          { k: 'action_type', t: 'نوع الطلب', r: r => <Badge c="b-purple">{ACTIONS[r.action_type] || r.action_type}</Badge> },
          { k: 'title', t: 'الوصف' },
          { k: 'amount', t: 'المبلغ', r: r => <b className="num">{fmtN(r.amount)}</b> },
          { k: 'requester_name', t: 'مقدّم الطلب', r: r => r.requester_name || '—' },
          { k: 'requested_at', t: 'التاريخ', r: r => fmtDT(r.requested_at) },
          { k: 'status', t: 'الحالة', r: r => <Badge c={badge.approvalStatus[r.status]}>{L.approvalStatus[r.status] || r.status}</Badge> },
          { k: 'decider_name', t: 'المعتمد', r: r => r.decider_name || '—' },
          {
            t: 'إجراءات', center: true, r: r => (
              <div className="flex gap-1 justify-center" onClick={e => e.stopPropagation()}>
                {canApprove && r.status === 'pending' && <>
                  <button className="icon-btn" title="اعتماد" onClick={() => setDecide({ ...r, note: '' })}><I n="check" s={15} /></button>
                  <button className="icon-btn" title="رفض" onClick={() => setDecide({ ...r, note: '', reject: true })}><I n="ban" s={15} /></button>
                </>}
                <button className="icon-btn" title="تفاصيل" onClick={() => setDecide({ ...r, note: '', view: true })}><I n="eye" s={15} /></button>
              </div>
            )
          },
        ]} />

      <div className="flex items-center justify-between mt-3 text-[13px] no-print" style={{ color: 'var(--ink2)' }}>
        <div>{meta.total} طلب</div>
        <div className="flex gap-2"><Btn v="o" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</Btn><Btn v="o" size="sm" disabled={page >= (meta.pages || 1)} onClick={() => setPage(page + 1)}>التالي</Btn></div>
      </div>

      <Modal open={!!decide} onClose={() => setDecide(null)} title={ACTIONS[decide?.action_type] || 'طلب اعتماد'} w={560}
        actions={decide && !decide.view ? <>
          <Btn v="o" onClick={() => setDecide(null)}>إلغاء</Btn>
          <Btn v="d" disabled={saving} onClick={() => doDecide(false)}>رفض</Btn>
          <Btn v="g" disabled={saving} onClick={() => doDecide(true)}><I n="check" s={15} /> اعتماد وتنفيذ</Btn>
        </> : <Btn v="g" onClick={() => setDecide(null)}>إغلاق</Btn>}>
        {decide && (
          <div className="space-y-3 text-[13.5px]">
            <div className="grid sm:grid-cols-2 gap-2">
              <div className="rounded-xl p-2.5" style={{ background: 'var(--bg2)' }}>النوع: <b>{ACTIONS[decide.action_type] || decide.action_type}</b></div>
              <div className="rounded-xl p-2.5" style={{ background: 'var(--bg2)' }}>المبلغ: <b className="num">{fmtN(decide.amount)}</b></div>
              <div className="rounded-xl p-2.5" style={{ background: 'var(--bg2)' }}>الوحدة: <b>{decide.module}</b></div>
              <div className="rounded-xl p-2.5" style={{ background: 'var(--bg2)' }}>الحالة: <b>{L.approvalStatus[decide.status]}</b></div>
            </div>
            <div><b>الوصف:</b> {decide.title}</div>
            {decide.payload && <div className="text-[12.5px] rounded-xl p-2.5" style={{ background: 'var(--card2)' }} dir="ltr"><code>{(() => { try { return JSON.stringify(typeof decide.payload === 'string' ? JSON.parse(decide.payload) : decide.payload, null, 1); } catch { return String(decide.payload); } })()}</code></div>}
            {!decide.view && <Field label="ملاحظة القرار"><input className="inp" value={decide.note} onChange={e => setDecide({ ...decide, note: e.target.value })} /></Field>}
            {decide.view && decide.decision_note && <div><b>ملاحظة القرار:</b> {decide.decision_note}</div>}
          </div>
        )}
      </Modal>
    </>
  );
}
