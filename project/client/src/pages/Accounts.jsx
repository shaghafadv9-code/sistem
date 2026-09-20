import React, { useMemo, useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtD, todayStr, L, badge } from '../lib/format.js';
import { I, Btn, Badge, Field, Modal, PageHead, Drawer, Confirm, Tabs, Empty } from '../components/ui.jsx';
import { useList, useFetch, Kpis, FilterBar, Table, ExcelBtn, Money } from '../components/fin.jsx';

export default function Accounts() {
  const { can, toast, company } = useStore();
  const cur = company.currency || 'ر.س';
  const [fType, setFType] = useState('');
  const [fStatus, setFStatus] = useState('active');
  const { rows, meta, busy, err, reload } = useList('/accounts', { limit: 100, type: fType, status: fStatus, page: 1 });
  const [sum, setSum] = useState(null);
  const [form, setForm] = useState(null);
  const [stat, setStat] = useState(null); // كشف الحساب
  const [stmt, setStmt] = useState(null);
  const [transfer, setTransfer] = useState(null);
  const [saving, setSaving] = useState(false);
  const [range, setRange] = useState({ from: '', to: '' });

  const loadSum = () => api('/accounts/summary').then(setSum).catch(() => {});
  React.useEffect(() => { loadSum(); }, [rows.length]);

  const openStatement = (a) => {
    setStat(a); setStmt(null);
    api(`/accounts/${a.id}/statement` + q(range)).then(setStmt).catch(e => toast(e.message, 'error'));
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = form;
      if (body.id) await api('/accounts/' + body.id, { method: 'PUT', body });
      else await api('/accounts', { method: 'POST', body });
      toast(body.id ? 'تم تحديث الحساب' : 'تم إنشاء الحساب');
      setForm(null); reload(); loadSum();
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };

  const doTransfer = async () => {
    setSaving(true);
    try {
      await api('/accounts/transfer', { method: 'POST', body: transfer });
      toast('تم تحويل المبلغ بين الحسابين');
      setTransfer(null); reload(); loadSum();
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };

  const byType = sum?.byType || [];
  const liveRows = stat ? (stmt?.rows || []) : rows;

  return (
    <>
      <PageHead title="الحسابات المالية" sub="الصندوق والحسابات البنكية وحسابات المشاريع — الأرصدة تُحسب آليًا من الحركات"
        actions={<>
          {can('accounts', 'create') && <Btn v="o" onClick={() => setTransfer({ from_account_id: rows[0]?.id, to_account_id: rows[1]?.id, amount: '', txn_date: todayStr(), notes: '' })}><I n="swap" s={15} /> تحويل بين الحسابين</Btn>}
          <ExcelBtn path="/reports/accounts_report/excel" filters={{ type: fType, status: fStatus }} name="الحسابات-والأرصدة.xlsx" can={can('accounts', 'export')} />
          {can('accounts', 'create') && <Btn v="g" onClick={() => setForm({ name: '', type: 'bank', opening_balance: 0, status: 'active', currency: cur, bank_name: '', account_no: '', iban: '', notes: '' })}><I n="plus" s={15} /> حساب جديد</Btn>}
        </>} />

      <Kpis items={[
        { icon: 'coins', label: 'إجمالي السيولة', value: fmtN(sum?.total || 0) + ' ' + cur, sub: 'مجموع أرصدة الحسابات الفعّالة' },
        { icon: 'trend', label: 'مقبوضات الشهر', value: fmtN(sum?.month_in || 0), color: 'var(--success, #15803d)' },
        { icon: 'dl', label: 'مدفوعات الشهر', value: fmtN(sum?.month_out || 0), color: '#b91c1c' },
        { icon: 'scale', label: 'صافي الشهر', value: fmtN(sum?.month_net || 0), color: (sum?.month_net || 0) >= 0 ? '#15803d' : '#b91c1c' },
        ...byType.map(t => ({ icon: t.type === 'cash' ? 'wallet2' : 'bank', label: 'رصيد ' + (L.accountType[t.type] || t.type), value: fmtN(t.balance), sub: `${t.n} حساب` })),
      ]} />

      <FilterBar onReload={reload}>
        <Tabs tabs={[{ k: '', t: 'كل الأنواع' }, ...Object.entries(L.accountType).map(([k, t]) => ({ k, t }))]} val={fType} onChange={setFType} />
        <Tabs tabs={[{ k: '', t: 'الحالة: الكل' }, ...Object.entries(L.accountStatus).map(([k, t]) => ({ k, t }))]} val={fStatus} onChange={setFStatus} />
      </FilterBar>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3.5">
        {rows.map(a => (
          <div key={a.id} className="card card-h p-4 anim-in">
            <div className="flex items-start justify-between">
              <div>
                <b className="text-[15px]">{a.name}</b>
                <div className="text-[12px]" style={{ color: 'var(--ink3)' }}><span className="num">{a.code}</span> — {L.accountType[a.type] || a.type}</div>
              </div>
              <Badge c={a.is_default ? 'b-purple' : badge.accountStatus[a.status]}>{a.is_default ? 'افتراضي' : (L.accountStatus[a.status] || a.status)}</Badge>
            </div>
            <div className="text-[22px] font-extrabold num mt-2">{fmtN(a.current_balance)} <span className="text-[13px]" style={{ color: 'var(--ink3)' }}>{a.currency || cur}</span></div>
            <div className="text-[12px] mt-1" style={{ color: 'var(--ink2)' }}>
              {a.bank_name && <span>البنك: {a.bank_name} </span>}
              {a.account_no && <span className="num">— {a.account_no}</span>}
            </div>
            <div className="flex gap-1.5 mt-3 flex-wrap">
              <Btn v="o" size="sm" onClick={() => openStatement(a)}><I n="list" s={14} /> كشف الحساب</Btn>
              {can('accounts', 'edit') && <Btn v="o" size="sm" onClick={() => setForm(a)}><I n="edit" s={14} /></Btn>}
              {can('accounts', 'export') && <ExcelBtn path={`/accounts/${a.id}/statement/excel`} filters={range} name={`كشف-${a.code}.xlsx`} label="Excel" />}
            </div>
          </div>
        ))}
      </div>

      {/* نموذج حساب */}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'تعديل حساب' : 'حساب مالي جديد'} w={560}
        actions={<><Btn v="o" onClick={() => setForm(null)}>إلغاء</Btn><Btn v="g" disabled={saving} onClick={save}><I n="check" s={15} /> حفظ</Btn></>}>
        {form && (
          <div className="space-y-3">
            <Field label="اسم الحساب *"><input className="inp" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="النوع">
                <select className="inp" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  {Object.entries(L.accountType).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                </select>
              </Field>
              <Field label="الرصيد الافتتاحي"><input type="number" className="inp num" value={form.opening_balance} onChange={e => setForm({ ...form, opening_balance: e.target.value })} /></Field>
              <Field label="البنك"><input className="inp" value={form.bank_name || ''} onChange={e => setForm({ ...form, bank_name: e.target.value })} /></Field>
              <Field label="رقم الحساب"><input className="inp num" value={form.account_no || ''} onChange={e => setForm({ ...form, account_no: e.target.value })} /></Field>
              <Field label="IBAN"><input className="inp num" value={form.iban || ''} onChange={e => setForm({ ...form, iban: e.target.value })} /></Field>
              <Field label="الحالة">
                <select className="inp" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                  {Object.entries(L.accountStatus).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                </select>
              </Field>
            </div>
            <Field label="ملاحظات"><textarea className="inp" rows={2} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
            <div className="text-[12px]" style={{ color: 'var(--ink3)' }}>الرصيد الحالي يُحسب من الرصيد الافتتاحي + المقبوضات − المدفوعات (لا يُدخل يدويًا).</div>
          </div>
        )}
      </Modal>

      {/* كشف الحساب (Drill-down) */}
      <Modal open={!!stat} onClose={() => { setStat(null); setStmt(null); }} title={`كشف حساب — ${stat?.name || ''}`} w={980}>
        {stat && (
          <div className="space-y-3">
            <div className="flex gap-2 items-end flex-wrap">
              <Field label="من تاريخ"><input type="date" className="inp num" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></Field>
              <Field label="إلى تاريخ"><input type="date" className="inp num" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></Field>
              <Btn v="o" onClick={() => openStatement(stat)}><I n="filter" s={15} /> تطبيق</Btn>
              <ExcelBtn path={`/accounts/${stat.id}/statement/excel`} filters={range} name={`كشف-${stat.code}.xlsx`} can={can('accounts', 'export')} />
            </div>
            <Kpis items={[
              { label: 'الرصيد الافتتاحي', value: fmtN(stmt?.opening_balance || 0) },
              { label: 'عدد الحركات', value: fmtN(stmt?.count || 0) },
              { label: 'الرصيد الحالي', value: fmtN(stmt?.current_balance || 0), color: 'var(--brand)' },
            ]} />
            <Table busy={!stmt} rows={stmt?.rows || []} empty="لا توجد حركات"
              cols={[
                { k: 'txn_date', t: 'التاريخ', r: r => fmtD(r.txn_date) },
                { k: 'code', t: 'رقم الحركة' },
                { k: 'kind', t: 'النوع', r: r => ({ payment: 'دفعة', deposit: 'عربون', installment: 'قسط', expense: 'مصروف', refund: 'استرداد', commission: 'عمولة', transfer: 'تحويل', reversal: 'عكس قيد' }[r.kind] || r.kind) },
                { k: 'client_name', t: 'العميل' },
                { t: 'مقبوض', r: r => r.direction === 'in' ? <span className="money-in num">{fmtN(r.amount)}</span> : <span style={{ color: 'var(--ink3)' }}>—</span> },
                { t: 'مدفوع', r: r => r.direction === 'out' ? <span className="money-out num">{fmtN(r.amount)}</span> : <span style={{ color: 'var(--ink3)' }}>—</span> },
                { t: 'الرصيد', r: r => <b className="num">{fmtN(r.running_balance)}</b> },
                { k: 'user_name', t: 'المستخدم' },
              ]} />
          </div>
        )}
      </Modal>

      {/* تحويل بين الحسابات */}
      <Modal open={!!transfer} onClose={() => setTransfer(null)} title="تحويل بين الحسابين" w={480}
        actions={<><Btn v="o" onClick={() => setTransfer(null)}>إلغاء</Btn><Btn v="g" disabled={saving} onClick={doTransfer}><I n="swap" s={15} /> تنفيذ التحويل</Btn></>}>
        {transfer && (
          <div className="space-y-3">
            <Field label="من حساب">
              <select className="inp" value={transfer.from_account_id} onChange={e => setTransfer({ ...transfer, from_account_id: e.target.value })}>
                {rows.map(a => <option key={a.id} value={a.id}>{a.name} — {fmtN(a.current_balance)}</option>)}
              </select>
            </Field>
            <Field label="إلى حساب">
              <select className="inp" value={transfer.to_account_id} onChange={e => setTransfer({ ...transfer, to_account_id: e.target.value })}>
                {rows.map(a => <option key={a.id} value={a.id}>{a.name} — {fmtN(a.current_balance)}</option>)}
              </select>
            </Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="المبلغ"><input type="number" className="inp num" value={transfer.amount} onChange={e => setTransfer({ ...transfer, amount: e.target.value })} /></Field>
              <Field label="التاريخ"><input type="date" className="inp num" value={transfer.txn_date} onChange={e => setTransfer({ ...transfer, txn_date: e.target.value })} /></Field>
            </div>
            <Field label="ملاحظات"><input className="inp" value={transfer.notes} onChange={e => setTransfer({ ...transfer, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}
