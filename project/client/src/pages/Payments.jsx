import React, { useState } from 'react';
import { api, q, exportFile } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtD, todayStr, L, badge, methodLabel } from '../lib/format.js';
import { I, Btn, Badge, Field, Modal, PageHead, Tabs, Confirm, Empty } from '../components/ui.jsx';
import { useList, useFetch, Kpis, FilterBar, Table, ExcelBtn, Money } from '../components/fin.jsx';

const emptyPay = { kind: 'installment', amount: '', method: 'cash', paid_at: todayStr(), account_id: '', reference_no: '', check_no: '', check_due_date: '', bank_name: '', notes: '', attachment_id: null };

export default function Payments() {
  const { can, toast, company, project: gProject } = useStore();
  const cur = company.currency || 'ر.س';
  const [f, setF] = useState({ from: '', to: '', method: '', status: '', account_id: '', project_id: '', client_id: '', sale_id: '' });
  const [page, setPage] = useState(1);
  const params = { page, limit: 20, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) };
  const { rows, meta, busy, err, reload } = useList('/payments', params);
  const { data: accs } = useFetch('/accounts?limit=100');
  const { data: sales } = useFetch('/sales?limit=100&unpaid=1');
  const [form, setForm] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [cheque, setCheque] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [saving, setSaving] = useState(false);

  const accounts = accs?.data || [];
  const openNew = (saleRef) => setForm({ ...emptyPay, sale_id: saleRef?.id || '', client_id: saleRef?.client_id || '', account_id: accounts.find(a => a.is_default)?.id || accounts[0]?.id || '' });

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, amount: Number(form.amount) };
      if (body.id) await api('/payments/' + body.id, { method: 'PUT', body });
      else await api('/payments', { method: 'POST', body });
      toast('تم تسجيل الدفعة على الحساب');
      setForm(null); reload();
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };
  const doCancel = async () => {
    setSaving(true);
    try { const r = await api(`/payments/${cancel.id}/cancel`, { method: 'POST', body: { reason: cancel.reason } }); toast(r.pending_approval ? 'أُرسل طلب الإلغاء للمدير' : 'تم إلغاء الدفعة وعكس أثرها'); setCancel(null); reload(); }
    catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };
  const setCheck = async (st) => {
    try { await api(`/payments/${cheque.id}/check-status`, { method: 'POST', body: { check_status: st } }); toast('تم تحديث حالة الشيك'); setCheque(null); reload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const openReceipt = async (r) => {
    try { setReceipt(await api(`/payments/${r.id}/receipt`)); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title="الدفعات والمقبوضات" sub="كل مبلغ داخل مرتبط بعميل وعملية وحساب مستلم ومرفق — مع سند قبض وتتبع الشيكات"
        actions={<>
          <ExcelBtn path="/payments/excel" filters={f} name="الدفعات.xlsx" can={can('finance', 'export')} />
          {can('finance', 'create') && <Btn v="g" onClick={() => openNew()}><I n="plus" s={15} /> تسجيل دفعة</Btn>}
        </>} />

      <Kpis items={[
        { icon: 'coins', label: 'إجمالي المعروض', value: fmtN(meta.totals?.amount) + ' ' + cur, sub: `${meta.total} دفعة` },
        { icon: 'check', label: 'المؤكد', value: fmtN(rows.filter(r => r.status === 'confirmed').reduce((a, r) => a + Number(r.amount), 0)) },
        { icon: 'clock', label: 'شيكات معلقة', value: fmtN(rows.filter(r => r.status === 'pending').reduce((a, r) => a + Number(r.amount), 0)) },
      ]} />

      <FilterBar onReload={reload}>
        <Field label="من"><input type="date" className="inp num" value={f.from} onChange={e => { setF({ ...f, from: e.target.value }); setPage(1); }} /></Field>
        <Field label="إلى"><input type="date" className="inp num" value={f.to} onChange={e => { setF({ ...f, to: e.target.value }); setPage(1); }} /></Field>
        <Field label="الحساب"><select className="inp" value={f.account_id} onChange={e => setF({ ...f, account_id: e.target.value })}>
          <option value="">كل الحسابات</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select></Field>
        <Field label="طريقة الدفع"><select className="inp" value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>
          <option value="">الكل</option>{Object.entries(L.payMethod).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select></Field>
        <Field label="الحالة"><select className="inp" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
          <option value="">الكل</option>{Object.entries(L.payStatus).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select></Field>
        {(f.from || f.to || f.method || f.status || f.account_id) && <Btn v="o" size="sm" onClick={() => setF({ from: '', to: '', method: '', status: '', account_id: '', project_id: gProject || '', client_id: '', sale_id: '' })}>مسح الفلاتر</Btn>}
      </FilterBar>

      <Table rows={rows} busy={busy} err={err} empty="لا توجد دفعات مطابقة للفلاتر"
        cols={[
          { k: 'receipt_no', t: 'رقم الإيصال' },
          { k: 'paid_at', t: 'التاريخ', r: r => fmtD(r.paid_at) },
          { k: 'client_name', t: 'العميل', r: r => <b>{r.client_name || '—'}</b> },
          { k: 'sale_code', t: 'العملية', r: r => <span className="num">{r.sale_code || r.reservation_code || '—'}</span> },
          { k: 'unit_code', t: 'الوحدة', r: r => <span className="num">{r.unit_code || '—'}</span> },
          { k: 'kind', t: 'النوع', r: r => L.payKind[r.kind] || r.kind },
          { k: 'amount', t: 'المبلغ', r: r => <span className="money-in num">{fmtN(r.amount)}</span> },
          { k: 'method', t: 'الطريقة', r: r => methodLabel(r.method) },
          { k: 'account_name', t: 'الحساب', r: r => r.account_name || '—' },
          { k: 'check_no', t: 'الشيك', r: r => r.method === 'check' ? <span className="num">{r.check_no}<br /><span className="text-[11px]" style={{ color: 'var(--ink3)' }}>{L.checkStatus[r.check_status] || ''} — {fmtD(r.check_due_date)}</span></span> : '—' },
          { k: 'status', t: 'الحالة', r: r => <Badge c={badge.payStatus[r.status]}>{L.payStatus[r.status] || r.status}</Badge> },
          {
            t: 'إجراءات', center: true, r: r => (
              <div className="flex gap-1 justify-center" onClick={e => e.stopPropagation()}>
                <button className="icon-btn" title="سند القبض" onClick={() => openReceipt(r)}><I n="receipt" s={15} /></button>
                {r.method === 'check' && r.status === 'pending' && can('finance', 'edit') && <button className="icon-btn" title="تحديث حالة الشيك" onClick={() => setCheque(r)}><I n="check" s={15} /></button>}
                {can('finance', 'edit') && r.status === 'confirmed' && <button className="icon-btn" title="إلغاء/عكس" onClick={() => setCancel({ ...r, reason: '' })}><I n="ban" s={15} /></button>}
              </div>
            )
          },
        ]} />

      <div className="flex items-center justify-between mt-3 text-[13px] no-print" style={{ color: 'var(--ink2)' }}>
        <div>إجمالي {meta.total} دفعة — الصفحة {page} من {meta.pages || 1}</div>
        <div className="flex gap-2">
          <Btn v="o" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</Btn>
          <Btn v="o" size="sm" disabled={page >= (meta.pages || 1)} onClick={() => setPage(page + 1)}>التالي</Btn>
        </div>
      </div>

      {/* تسجيل دفعة */}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'تعديل دفعة' : 'تسجيل دفعة جديدة'} w={620}
        actions={<><Btn v="o" onClick={() => setForm(null)}>إلغاء</Btn><Btn v="g" disabled={saving} onClick={save}><I n="check" s={15} /> حفظ الدفعة</Btn></>}>
        {form && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="عملية البيع *">
                <select className="inp" value={form.sale_id || ''} onChange={e => { const s = (sales?.data || []).find(x => String(x.id) === e.target.value); setForm({ ...form, sale_id: e.target.value, client_id: s?.client_id || form.client_id }); }}>
                  <option value="">— اختر —</option>
                  {(sales?.data || []).map(s => <option key={s.id} value={s.id}>{s.code} — {s.client_name} — متبقي {fmtN(s.remaining)}</option>)}
                </select>
              </Field>
              <Field label="نوع الدفعة">
                <select className="inp" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
                  {Object.entries(L.payKind).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                </select>
              </Field>
              <Field label="المبلغ *"><input type="number" className="inp num" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
              <Field label="طريقة الدفع">
                <select className="inp" value={form.method} onChange={e => setForm({ ...form, method: e.target.value, check_no: e.target.value === 'check' ? form.check_no : '' })}>
                  {Object.entries(L.payMethod).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                </select>
              </Field>
              <Field label="الحساب المستلم *">
                <select className="inp" value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })}>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name} — {fmtN(a.current_balance)}</option>)}
                </select>
              </Field>
              <Field label="تاريخ الدفع"><input type="date" className="inp num" value={form.paid_at} onChange={e => setForm({ ...form, paid_at: e.target.value })} /></Field>
              {form.method === 'check' && <>
                <Field label="رقم الشيك *"><input className="inp num" value={form.check_no} onChange={e => setForm({ ...form, check_no: e.target.value })} /></Field>
                <Field label="تاريخ استحقاق الشيك"><input type="date" className="inp num" value={form.check_due_date} onChange={e => setForm({ ...form, check_due_date: e.target.value })} /></Field>
                <Field label="البنك"><input className="inp" value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} /></Field>
              </>}
              <Field label="رقم المرجع"><input className="inp num" value={form.reference_no} onChange={e => setForm({ ...form, reference_no: e.target.value })} /></Field>
            </div>
            <Field label="ملاحظات"><textarea className="inp" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
            <div className="text-[12px] rounded-xl p-2.5" style={{ background: 'var(--bg2)', color: 'var(--ink2)' }}>
              يُمنع تسجيل مبلغ يتجاوز المتبقي على العملية، ويُسجَّل تلقائيًا في الحساب المالي مع حركة في السجل (Audit).
            </div>
          </div>
        )}
      </Modal>

      {/* إلغاء دفعة */}
      <Modal open={!!cancel} onClose={() => setCancel(null)} title={`إلغاء الدفعة ${cancel?.receipt_no || ''}`} w={460}
        actions={<><Btn v="o" onClick={() => setCancel(null)}>رجوع</Btn><Btn v="d" disabled={saving} onClick={doCancel}>تأكيد الإلغاء</Btn></>}>
        {cancel && (
          <div className="space-y-3">
            <div className="text-[13.5px]">سيتم عكس أثر الدفعة على الحساب والعملية <b>دون حذفها من السجل</b> (بيانات مالية لا تُحذف).</div>
            <Field label="سبب الإلغاء *"><input className="inp" value={cancel.reason} onChange={e => setCancel({ ...cancel, reason: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      {/* حالة الشيك */}
      <Modal open={!!cheque} onClose={() => setCheque(null)} title={`الشيك ${cheque?.check_no || ''}`} w={400}>
        {cheque && (
          <div className="space-y-2">
            <div className="text-[13.5px]">المبلغ: <b className="num">{fmtN(cheque.amount)}</b> — الاستحقاق: <b className="num">{fmtD(cheque.check_due_date)}</b></div>
            <div className="flex gap-2 flex-wrap">
              <Btn v="g" size="sm" onClick={() => setCheck('cleared')}><I n="check" s={14} /> تم التحصيل</Btn>
              <Btn v="d" size="sm" onClick={() => setCheck('bounced')}><I n="ban" s={14} /> مرتجع</Btn>
              <Btn v="o" size="sm" onClick={() => setCheck('cancelled')}>إلغاء الشيك</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* سند القبض */}
      <Modal open={!!receipt} onClose={() => setReceipt(null)} title="سند قبض" w={560}
        actions={<><Btn v="o" onClick={() => window.print()}><I n="print" s={15} /> طباعة</Btn><Btn v="g" onClick={() => setReceipt(null)}>إغلاق</Btn></>}>
        {receipt && (
          <div className="print-area text-[13.5px] leading-7" dir="rtl">
            <div className="text-center mb-3">
              <div className="text-[17px] font-bold">{receipt.company?.company_name || company.company_name || 'الشركة'}</div>
              <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>سند قبض — {receipt.payment?.receipt_no}</div>
            </div>
            <table className="tbl">
              <tbody>
                {[
                  ['التاريخ', fmtD(receipt.payment?.paid_at)], ['استلمنا من', receipt.client?.name || '—'],
                  ['المبلغ', fmtN(receipt.payment?.amount) + ' ' + (receipt.company?.currency || cur)],
                  ['وذلك عن', (L.payKind[receipt.payment?.kind] || '') + ' — ' + (receipt.sale?.code || receipt.reservation?.code || '')],
                  ['طريقة الدفع', methodLabel(receipt.payment?.method)],
                  ['الحساب المستلم', receipt.account?.name || '—'],
                  ['المرجع', receipt.payment?.reference_no || '—'],
                  ['المستخدم', receipt.user?.name || '—'],
                ].map(([k, v], i) => <tr key={i}><th style={{ width: 160 }}>{k}</th><td>{v}</td></tr>)}
              </tbody>
            </table>
            {receipt.payment?.notes && <div className="mt-2">ملاحظات: {receipt.payment.notes}</div>}
            <div className="mt-6 flex justify-between text-[12.5px]" style={{ color: 'var(--ink2)' }}>
              <div>توقيع المستلم: .......................</div><div>الختم: .......................</div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
