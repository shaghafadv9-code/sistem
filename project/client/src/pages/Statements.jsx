import React, { useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtD, todayStr, L, badge, methodLabel } from '../lib/format.js';
import { I, Btn, Badge, Field, PageHead, Tabs, Empty, Skeleton } from '../components/ui.jsx';
import { useFetch, Kpis, FilterBar, Table, ExcelBtn } from '../components/fin.jsx';

export default function Statements() {
  const { can, toast, company } = useStore();
  const cur = company.currency || 'ر.س';
  const [tab, setTab] = useState('client');
  const [range, setRange] = useState({ from: '', to: '' });
  const { data: clients } = useFetch('/clients?limit=300');
  const { data: projects } = useFetch('/projects?limit=100');
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [stmt, setStmt] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async (id = tab === 'client' ? clientId : projectId) => {
    const val = id || (tab === 'client' ? clientId : projectId);
    if (!val) return toast('اختر ' + (tab === 'client' ? 'عميلًا' : 'مشروعًا'), 'error');
    setBusy(true); setStmt(null);
    try {
      const r = await api(`/statements/${tab}/${val}` + q(range));
      setStmt({ ...r, __tab: tab });
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const sum = stmt && (stmt.__tab === 'client' ? stmt.summary : stmt);

  const exportExcel = () => {
    const id = stmt.__tab === 'client' ? clientId : projectId;
    if (!id) return;
    import('../lib/api.js').then(({ exportFile }) => exportFile(`/statements/${stmt.__tab}/${id}/excel`, range, `كشف-${stmt.__tab}-${id}.xlsx`).catch(e => toast(e.message, 'error')));
  };

  return (
    <>
      <PageHead title="كشوف الحسابات" sub="كشف العميل (قيمة ← خصم ← صافي ← دفعات ← متبقي ← متأخر) وكشف المشروع (إيراد/تحصيل/مصروف/عمولات) مع الطباعة وExcel"
        actions={<>
          {stmt && <Btn v="o" onClick={exportExcel}><I n="dl" s={15} /> Excel</Btn>}
          {stmt && <Btn v="o" onClick={() => window.print()}><I n="print" s={15} /> طباعة / PDF</Btn>}
        </>} />

      <div className="mb-3 no-print"><Tabs tabs={[{ k: 'client', t: 'كشف حساب عميل' }, { k: 'project', t: 'كشف حساب مشروع' }]} val={tab} onChange={v => { setTab(v); setStmt(null); }} /></div>

      <FilterBar onReload={() => load()} right={<Btn v="g" size="sm" onClick={() => load()}><I n="search" s={14} /> عرض الكشف</Btn>}>
        {tab === 'client'
          ? <Field label="العميل"><select className="inp" style={{ minWidth: 260 }} value={clientId} onChange={e => setClientId(e.target.value)}><option value="">— اختر عميلًا —</option>{(clients?.data || []).map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}</select></Field>
          : <Field label="المشروع"><select className="inp" style={{ minWidth: 260 }} value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">— اختر مشروعًا —</option>{(projects?.data || []).map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>}
        <Field label="من تاريخ"><input type="date" className="inp num" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="إلى تاريخ"><input type="date" className="inp num" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></Field>
      </FilterBar>

      {busy && <Skeleton n={4} />}
      {!busy && !stmt && <div className="card"><Empty icon="receipt" title="اختر عميلًا أو مشروعًا لعرض الكشف" /></div>}

      {!busy && stmt && (
        <div className="print-area">
          <div className="card p-4 mb-4">
            <div className="text-center mb-3">
              <div className="text-[18px] font-bold">{stmt.company?.company_name || company.company_name}</div>
              <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>
                {stmt.__tab === 'client'
                  ? `كشف حساب العميل: ${stmt.client?.name} (${stmt.client?.code}) — بتاريخ ${fmtD(todayStr())}`
                  : `كشف حساب المشروع: ${stmt.project?.name} (${stmt.project?.code}) — بتاريخ ${fmtD(todayStr())}`}
              </div>
              {(range.from || range.to) && <div className="text-[12px]" style={{ color: 'var(--ink3)' }}>الفترة: {range.from ? fmtD(range.from) : 'البداية'} — {range.to ? fmtD(range.to) : 'اليوم'}</div>}
            </div>

            {stmt.__tab === 'client' ? (
              <Kpis items={[
                { icon: 'coins', label: 'إجمالي القيمة', value: fmtN(sum.net_sales) + ' ' + cur, sub: `إجمالي ${fmtN(sum.gross_sales)} — خصم ${fmtN(sum.discounts)}` },
                { icon: 'check', label: 'المدفوع', value: fmtN(sum.total_paid), color: '#15803d', sub: `شيكات معلقة: ${fmtN(sum.pending_checks)}` },
                { icon: 'clock', label: 'المتبقي', value: fmtN(sum.remaining_on_client), color: '#b45309' },
                { icon: 'alert', label: 'المتأخر', value: fmtN(sum.overdue), color: '#b91c1c' },
                { icon: 'percent', label: 'نسبة السداد', value: fmtN(sum.paid_ratio) + '%' },
              ]} />
            ) : (
              <Kpis items={[
                { icon: 'coins', label: 'إجمالي المبيعات', value: fmtN(sum.net_sales) + ' ' + cur, sub: `${sum.sold_count} وحدة مباعة من ${sum.units_count}` },
                { icon: 'check', label: 'المحصّل', value: fmtN(sum.collected), color: '#15803d' },
                { icon: 'clock', label: 'المتبقي على العملاء', value: fmtN(sum.remaining), color: '#b45309' },
                { icon: 'receipt', label: 'المصروفات', value: fmtN(sum.expenses), color: '#b91c1c' },
                { icon: 'percent', label: 'العمولات المستحقة', value: fmtN(sum.commissions_due) },
                { icon: 'scale', label: 'صافي التدفق', value: fmtN(sum.net_cash_flow), color: (sum.net_cash_flow || 0) >= 0 ? '#15803d' : '#b91c1c' },
              ]} />
            )}
          </div>

          {stmt.__tab === 'client' ? (
            <>
              <h3 className="text-[15px] font-bold mb-2">الدفعات المسجلة</h3>
              <Table rows={stmt.payments || []} busy={false} err="" empty="لا توجد دفعات"
                cols={[
                  { k: 'receipt_no', t: 'رقم الإيصال' },
                  { k: 'paid_at', t: 'التاريخ', r: r => fmtD(r.paid_at) },
                  { k: 'kind', t: 'النوع', r: r => L.payKind[r.kind] || r.kind },
                  { k: 'sale_code', t: 'العملية', r: r => r.sale_code || r.reservation_code || '—' },
                  { k: 'unit_code', t: 'الوحدة' },
                  { k: 'amount', t: 'المبلغ', r: r => <b className="num">{fmtN(r.amount)}</b> },
                  { k: 'method', t: 'الطريقة', r: r => methodLabel(r.method) },
                  { k: 'account_name', t: 'الحساب', r: r => r.account_name || '—' },
                  { k: 'status', t: 'الحالة', r: r => <Badge c={badge.payStatus[r.status]}>{L.payStatus[r.status]}</Badge> },
                ]} />

              <h3 className="text-[15px] font-bold mb-2 mt-4">جدول الأقساط</h3>
              <Table rows={stmt.schedule || []} busy={false} err="" empty="لا يوجد جدول أقساط"
                cols={[
                  { k: 'seq', t: 'القسط', center: true },
                  { k: 'label', t: 'البيان' },
                  { k: 'due_date', t: 'الاستحقاق', r: r => fmtD(r.due_date) },
                  { k: 'amount', t: 'المبلغ', r: r => <span className="num">{fmtN(r.amount)}</span> },
                  { k: 'paid_amount', t: 'المدفوع', r: r => <span className="money-in num">{fmtN(r.paid_amount)}</span> },
                  { t: 'المتبقي', r: r => <span className="money-due num">{fmtN(Number(r.amount) - Number(r.paid_amount))}</span> },
                  { k: 'status', t: 'الحالة', r: r => <Badge c={badge.schedStatus[r.status]}>{L.schedStatus[r.status]}</Badge> },
                ]} />

              {(stmt.refunds || []).length > 0 && <>
                <h3 className="text-[15px] font-bold mb-2 mt-4">الاستردادات</h3>
                <Table rows={stmt.refunds} busy={false} err="" cols={[
                  { k: 'code', t: 'الكود' }, { k: 'refund_date', t: 'التاريخ', r: r => fmtD(r.refund_date) },
                  { k: 'amount', t: 'المبلغ', r: r => <span className="money-out num">{fmtN(r.amount)}</span> },
                  { k: 'reason', t: 'السبب' }, { k: 'status', t: 'الحالة', r: r => L.approvalStatus[r.status] || r.status },
                ]} />
              </>}

              <h3 className="text-[15px] font-bold mb-2 mt-4">العقود والمبيعات</h3>
              <Table rows={stmt.sales || []} busy={false} err="" empty="لا توجد مبيعات"
                cols={[
                  { k: 'code', t: 'عملية البيع' }, { k: 'sale_date', t: 'التاريخ', r: r => fmtD(r.sale_date) },
                  { k: 'unit_code', t: 'الوحدة' }, { k: 'project_name', t: 'المشروع' },
                  { k: 'sale_price', t: 'السعر', r: r => <span className="num">{fmtN(r.sale_price)}</span> },
                  { k: 'discount', t: 'الخصم', r: r => <span className="num">{fmtN(r.discount)}</span> },
                  { k: 'net_price', t: 'الصافي', r: r => <b className="num">{fmtN(r.net_price)}</b> },
                  { k: 'contract_code', t: 'العقد', r: r => r.contract_code || '—' },
                  { k: 'status', t: 'الحالة', r: r => L.saleStatus[r.status] || r.status },
                ]} />
            </>
          ) : (
            <>
              <h3 className="text-[15px] font-bold mb-2">مبيعات المشروع</h3>
              <Table rows={stmt.sales || []} busy={false} err="" empty="لا توجد مبيعات"
                cols={[
                  { k: 'code', t: 'البيع' }, { k: 'sale_date', t: 'التاريخ', r: r => fmtD(r.sale_date) },
                  { k: 'unit_code', t: 'الوحدة' }, { k: 'client_name', t: 'العميل' },
                  { k: 'net_price', t: 'الصافي', r: r => <b className="num">{fmtN(r.net_price)}</b> },
                  { k: 'paid', t: 'المدفوع', r: r => <span className="money-in num">{fmtN(r.paid)}</span> },
                  { k: 'remaining', t: 'المتبقي', r: r => <span className="money-due num">{fmtN(r.remaining)}</span> },
                  { k: 'commission', t: 'العمولة', r: r => <span className="num">{fmtN(r.commission)}</span> },
                ]} />

              <h3 className="text-[15px] font-bold mb-2 mt-4">مصروفات المشروع (Drill-down)</h3>
              <Table rows={stmt.expensesList || []} busy={false} err="" empty="لا توجد مصروفات"
                cols={[
                  { k: 'code', t: 'الكود' }, { k: 'expense_date', t: 'التاريخ', r: r => fmtD(r.expense_date) },
                  { k: 'category_name', t: 'التصنيف' }, { k: 'description', t: 'الوصف' },
                  { k: 'amount', t: 'المبلغ', r: r => <span className="money-out num">{fmtN(r.amount)}</span> },
                  { k: 'status', t: 'الحالة', r: r => L.expenseStatus[r.status] || r.status },
                ]} />

              <h3 className="text-[15px] font-bold mb-2 mt-4">عمولات المسوقين</h3>
              <Table rows={stmt.commissionsList || []} busy={false} err="" empty="لا توجد عمولات"
                cols={[
                  { k: 'code', t: 'البيع' }, { k: 'sale_date', t: 'التاريخ', r: r => fmtD(r.sale_date) },
                  { k: 'broker_name', t: 'المسوق' },
                  { k: 'commission', t: 'العمولة', r: r => <b className="num">{fmtN(r.commission)}</b> },
                  { k: 'paid', t: 'المدفوع', r: r => <span className="money-in num">{fmtN(r.paid)}</span> },
                  { t: 'المتبقي', r: r => <span className="money-due num">{fmtN(Number(r.commission) - Number(r.paid))}</span> },
                ]} />
            </>
          )}

          <div className="mt-5 text-[12px]" style={{ color: 'var(--ink3)' }}>
            هذا الكشف صادر من نظام {company.company_name || 'Smart Secretary'} — المبالغ بالـ{cur} — كل مبلغ مرتبط بحساب مالي ومرفق وسجل تدقيق.
          </div>
        </div>
      )}
    </>
  );
}
