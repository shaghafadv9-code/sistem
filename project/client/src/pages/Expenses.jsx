import React, { useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtD, todayStr, L, badge, methodLabel } from '../lib/format.js';
import { I, Btn, Badge, Field, Modal, PageHead, Tabs, Confirm } from '../components/ui.jsx';
import { useList, useFetch, Kpis, FilterBar, Table, ExcelBtn } from '../components/fin.jsx';

export default function Expenses() {
  const { can, toast, company, project: gProject } = useStore();
  const cur = company.currency || 'ر.س';
  const [tab, setTab] = useState('list');
  const [f, setF] = useState({ from: '', to: '', status: '', category_id: '', project_id: '', account_id: '' });
  const [page, setPage] = useState(1);
  const { rows, meta, busy, err, reload } = useList('/expenses', { page, limit: 20, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) });
  const { data: cats, reload: rc } = useFetch('/expense-categories');
  const { data: accs } = useFetch('/accounts?limit=100');
  const { data: projs } = useFetch('/projects?limit=100');
  const [form, setForm] = useState(null);
  const [catForm, setCatForm] = useState(null);
  const [reject, setReject] = useState(null);
  const [saving, setSaving] = useState(false);
  const categories = cats?.data || [];
  const accounts = accs?.data || [];
  const canApprove = can('expenses', 'approve');

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, amount: Number(form.amount) };
      delete body.__cat;
      if (body.id) await api('/expenses/' + body.id, { method: 'PUT', body });
      else {
        const r = await api('/expenses', { method: 'POST', body });
        toast(r.pending_approval ? 'تم إنشاء المصروف وإرساله لاعتماد المدير' : 'تم إنشاء المصروف');
      }
      setForm(null); reload();
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };
  const act = async (r, action, body = {}) => {
    try { await api(`/expenses/${r.id}/${action}`, { method: 'POST', body }); toast('تم تنفيذ الإجراء'); setReject(null); reload(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const saveCat = async () => {
    try {
      if (catForm.id) await api('/expense-categories/' + catForm.id, { method: 'PUT', body: catForm });
      else await api('/expense-categories', { method: 'POST', body: catForm });
      toast('تم حفظ التصنيف'); setCatForm(null); rc();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title="المصروفات" sub="تصنيفات مصروفات كاملة مع الاعتماد والصرف من الحسابات المالية"
        actions={<>
          <ExcelBtn path="/expenses/excel" filters={f} name="المصروفات.xlsx" can={can('expenses', 'export')} />
          {can('expenses', 'create') && <Btn v="g" onClick={() => setForm({ expense_date: todayStr(), amount: '', category_id: categories[0]?.id || '', account_id: accounts.find(a => a.is_default)?.id || accounts[0]?.id || '', method: 'cash', project_id: gProject || '', pay_now: false, description: '', vendor: '', beneficiary: '', reference_no: '', notes: '' })}><I n="plus" s={15} /> مصروف جديد</Btn>}
        </>} />

      <Kpis items={[
        { icon: 'receipt', label: 'إجمالي المعروض', value: fmtN(meta.totals?.amount) + ' ' + cur, sub: `${meta.total} مصروف` },
        { icon: 'check', label: 'المصروف فعليًا', value: fmtN(rows.filter(r => r.status === 'paid').reduce((a, r) => a + Number(r.amount), 0)), color: '#b91c1c' },
        { icon: 'clock', label: 'بحاجة اعتماد', value: fmtN(rows.filter(r => r.status === 'pending').reduce((a, r) => a + Number(r.amount), 0)), color: '#b45309' },
      ]} />

      <div className="mb-3 no-print"><Tabs tabs={[{ k: 'list', t: 'المصروفات' }, { k: 'cats', t: 'التصنيفات' }]} val={tab} onChange={setTab} /></div>

      {tab === 'list' && <>
        <FilterBar onReload={reload}>
          <Field label="من"><input type="date" className="inp num" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="إلى"><input type="date" className="inp num" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
          <Field label="التصنيف"><select className="inp" value={f.category_id} onChange={e => setF({ ...f, category_id: e.target.value })}><option value="">الكل</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="الحالة"><select className="inp" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">الكل</option>{Object.entries(L.expenseStatus).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
        </FilterBar>

        <Table rows={rows} busy={busy} err={err} empty="لا توجد مصروفات"
          cols={[
            { k: 'code', t: 'الكود' },
            { k: 'expense_date', t: 'التاريخ', r: r => fmtD(r.expense_date) },
            { k: 'category_name', t: 'التصنيف', r: r => r.category_name || '—' },
            { k: 'description', t: 'الوصف' },
            { k: 'project_name', t: 'المشروع', r: r => r.project_name || '—' },
            { k: 'account_name', t: 'الحساب', r: r => r.account_name || '—' },
            { k: 'amount', t: 'المبلغ', r: r => <span className="money-out num">{fmtN(r.amount)}</span> },
            { k: 'method', t: 'الطريقة', r: r => methodLabel(r.method) },
            { k: 'employee_name', t: 'الموظف', r: r => r.employee_name || '—' },
            { k: 'status', t: 'الحالة', r: r => <Badge c={badge.expenseStatus[r.status]}>{L.expenseStatus[r.status] || r.status}</Badge> },
            {
              t: 'إجراءات', center: true, r: r => (
                <div className="flex gap-1 justify-center" onClick={e => e.stopPropagation()}>
                  {canApprove && r.status === 'pending' && <>
                    <button className="icon-btn" title="اعتماد" onClick={() => act(r, 'approve')}><I n="check" s={15} /></button>
                    <button className="icon-btn" title="رفض" onClick={() => setReject({ id: r.id, note: '' })}><I n="ban" s={15} /></button>
                  </>}
                  {can('expenses', 'edit') && ['draft', 'approved'].includes(r.status) && <button className="icon-btn" title="صرف من الحساب" onClick={() => act(r, 'pay')}><I n="swap" s={15} /></button>}
                  {can('expenses', 'edit') && r.status !== 'cancelled' && <button className="icon-btn" title="إلغاء" onClick={() => act(r, 'cancel', { reason: 'إلغاء من الشاشة' })}><I n="x" s={15} /></button>}
                  {can('expenses', 'edit') && r.status === 'draft' && <button className="icon-btn" title="تعديل" onClick={() => setForm(r)}><I n="edit" s={15} /></button>}
                </div>
              )
            },
          ]} />
        <div className="flex items-center justify-between mt-3 text-[13px] no-print" style={{ color: 'var(--ink2)' }}>
          <div>الإجمالي {fmtN(meta.totals?.amount)} — {meta.total} سجل</div>
          <div className="flex gap-2"><Btn v="o" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</Btn><Btn v="o" size="sm" disabled={page >= (meta.pages || 1)} onClick={() => setPage(page + 1)}>التالي</Btn></div>
        </div>
      </>}

      {tab === 'cats' && (
        <div className="grid md:grid-cols-3 gap-3">
          {can('expenses', 'create') && <div className="card p-4 flex items-center justify-center cursor-pointer" onClick={() => setCatForm({ name: '', notes: '', is_active: 1 })} style={{ borderStyle: 'dashed' }}><div className="text-center"><I n="plus" s={22} /><div className="text-[13px] mt-1">تصنيف جديد</div></div></div>}
          {categories.map(c => (
            <div key={c.id} className="card p-4">
              <div className="flex items-center justify-between"><b>{c.name}</b><Badge c={c.is_active ? 'b-green' : 'b-gray'}>{c.is_active ? 'مفعّل' : 'موقوف'}</Badge></div>
              <div className="text-[12px] mt-1" style={{ color: 'var(--ink3)' }}>{c.notes || '—'}</div>
              <div className="flex gap-1.5 mt-3">{can('expenses', 'edit') && <Btn v="o" size="sm" onClick={() => setCatForm(c)}><I n="edit" s={14} /> تعديل</Btn>}</div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'تعديل مصروف' : 'مصروف جديد'} w={640}
        actions={<><Btn v="o" onClick={() => setForm(null)}>إلغاء</Btn><Btn v="g" disabled={saving} onClick={save}><I n="check" s={15} /> حفظ</Btn></>}>
        {form && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="التصنيف *"><select className="inp" value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })}>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="المبلغ *"><input type="number" className="inp num" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
              <Field label="التاريخ"><input type="date" className="inp num" value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} /></Field>
              <Field label="الحساب المالي"><select className="inp" value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              <Field label="طريقة الدفع"><select className="inp" value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}>{Object.entries(L.payMethod).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
              <Field label="المشروع"><select className="inp" value={form.project_id || ''} onChange={e => setForm({ ...form, project_id: e.target.value })}><option value="">بدون مشروع</option>{(projs?.data || []).map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
              <Field label="المورد"><input className="inp" value={form.vendor || ''} onChange={e => setForm({ ...form, vendor: e.target.value })} /></Field>
              <Field label="المستفيد"><input className="inp" value={form.beneficiary || ''} onChange={e => setForm({ ...form, beneficiary: e.target.value })} /></Field>
              <Field label="رقم المرجع"><input className="inp num" value={form.reference_no || ''} onChange={e => setForm({ ...form, reference_no: e.target.value })} /></Field>
            </div>
            <Field label="الوصف"><textarea className="inp" rows={2} value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!form.pay_now} onChange={e => setForm({ ...form, pay_now: e.target.checked })} /> صرف المبلغ فورًا من الحساب بعد الحفظ</label>
            <div className="text-[12px] rounded-xl p-2.5" style={{ background: 'var(--bg2)', color: 'var(--ink2)' }}>المصروفات التي تتجاوز الحد المعتمد تُحوَّل آليًا لطلب اعتماد المدير وتُسجَّل في سجل التدقيق.</div>
          </div>
        )}
      </Modal>

      <Modal open={!!catForm} onClose={() => setCatForm(null)} title={catForm?.id ? 'تعديل تصنيف' : 'تصنيف مصروفات جديد'} w={420}
        actions={<><Btn v="o" onClick={() => setCatForm(null)}>إلغاء</Btn><Btn v="g" onClick={saveCat}>حفظ</Btn></>}>
        {catForm && <div className="space-y-3">
          <Field label="الاسم *"><input className="inp" value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} /></Field>
          <Field label="ملاحظات"><input className="inp" value={catForm.notes || ''} onChange={e => setCatForm({ ...catForm, notes: e.target.value })} /></Field>
        </div>}
      </Modal>

      <Modal open={!!reject} onClose={() => setReject(null)} title="رفض المصروف" w={420}
        actions={<><Btn v="o" onClick={() => setReject(null)}>رجوع</Btn><Btn v="d" onClick={() => act({ id: reject.id }, 'reject', { note: reject.note })}>تأكيد الرفض</Btn></>}>
        {reject && <Field label="سبب الرفض"><input className="inp" value={reject.note} onChange={e => setReject({ ...reject, note: e.target.value })} /></Field>}
      </Modal>
    </>
  );
}
