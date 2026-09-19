import React, { useEffect, useState } from 'react';
import { api, excelUrl } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { I, Btn, Badge, Empty, Skeleton, ErrBox, PageHead, Field } from '../components/ui.jsx';
import { fmtN, L } from '../lib/format.js';

const ICONS = {
  tasks: 'check', clients: 'users', appointments: 'cal', calls: 'phone', activity: 'hist', users: 'user', reservations: 'key', sales: 'wallet', finance: 'money', units: 'home',
  collections: 'coins', overdue_installments: 'alert', schedule: 'cal', expenses_report: 'receipt', commissions_report: 'percent', accounts_report: 'bank',
  refunds_report: 'swap', contracts_report: 'clip', quotations_report: 'file', project_financials: 'scale', units_inventory: 'box',
  interested_clients: 'target', not_followed_up: 'clock', top_demands: 'trend',
};
const COLS_AR = { id: 'م', title: 'العنوان', assignee: 'المسؤول', priority: 'الأولوية', status: 'الحالة', due_date: 'الاستحقاق', category: 'التصنيف', code: 'الكود', name: 'الاسم', phone: 'الهاتف', client: 'العميل', date: 'التاريخ', time: 'الوقت', contact: 'جهة الاتصال', direction: 'الاتجاه', result: 'النتيجة', user: 'المستخدم', action: 'الإجراء', module: 'الوحدة', details: 'التفاصيل', username: 'المستخدم', role: 'الدور', last_login: 'آخر دخول', unit: 'الوحدة', price: 'السعر', deposit: 'العربون', net: 'الصافي', paid: 'المدفوع', remaining: 'المتبقي', commission: 'العمولة', settlement: 'التسوية', project: 'المشروع', rooms: 'الغرف', area: 'المساحة', receipt_no: 'رقم الإيصال', paid_at: 'تاريخ الدفع', sale: 'عملية البيع', amount: 'المبلغ', method: 'طريقة الدفع', account: 'الحساب', reference_no: 'رقم المرجع', check_no: 'رقم الشيك', contract: 'رقم العقد', days_late: 'أيام التأخير', last_payment: 'آخر دفعة', last_contact: 'آخر تواصل', employee: 'الموظف', seq: 'التسلسل', label: 'البيان', vendor: 'المورد', beneficiary: 'المستفيد', description: 'الوصف', approver: 'المعتمد', broker: 'المسوق', rate: 'النسبة %', type: 'النوع', bank: 'البنك', account_no: 'رقم الحساب', iban: 'IBAN', opening: 'الرصيد الافتتاحي', current: 'الرصيد الحالي', month_in: 'مقبوضات الشهر', month_out: 'مدفوعات الشهر', deducted: 'المخسوم', reservation: 'الحجز', requested_by: 'مقدم الطلب', approved_by: 'المعتمد', contract_date: 'تاريخ العقد', start_date: 'تاريخ البداية', end_date: 'تاريخ الانتهاء', discount: 'الخصم', signed_at: 'تاريخ التوقيع', quote_date: 'تاريخ العرض', valid_until: 'تاريخ الانتهاء', email: 'البريد الإلكتروني', budget: 'الميزانية', bathrooms: 'الحمامات', floor_pref: 'الدور المطلوب', roof: 'روف', size: 'المساحة المطلوبة', purpose: 'الغرض', stage: 'المرحلة', open_units: 'وحدات متاحة', days_since: 'أيام بدون تواصل', interests: 'عدد الاهتمامات', kind: 'البند', item: 'القيمة', count: 'العدد', units: 'عدد الوحدات', sold: 'المباع', gross_sales: 'إجمالي المبيعات', discounts: 'إجمالي الخصومات', net_sales: 'صافي المبيعات', collected: 'إجمالي المقبوضات', expenses: 'إجمالي المصروفات', commissions: 'إجمالي العمولات', commissions_paid: 'العمولات المدفوعة', net_cash_flow: 'صافي التدفق المالي', building: 'المبنى', floor: 'الدور', floor_type: 'نوع الدور', delivery_status: 'حالة التسليم', unit_type: 'نوع الوحدة' };

export default function Reports() {
  const { can, toast } = useStore();
  const [list, setList] = useState([]);
  const [sel, setSel] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({});
  const [opts, setOpts] = useState({});

  useEffect(() => {
    api('/reports').then(r => { setList(r.reports || []); setBusy(false); }).catch(() => setBusy(false));
  }, []);
  // قوائم اختيار الفلاتر (مشاريع/عملاء/حسابات/مسوقون/موظفون/تصنيفات)
  useEffect(() => {
    Promise.all([
      api('/projects?limit=200').catch(() => ({ data: [] })),
      api('/clients?limit=300').catch(() => ({ data: [] })),
      api('/accounts?limit=100').catch(() => ({ data: [] })),
      api('/brokers?limit=100').catch(() => ({ data: [] })),
      api('/users?limit=100').catch(() => ({ data: [] })),
      api('/expense-categories').catch(() => ({ data: [] })),
      api('/buildings?limit=500').catch(() => ({ data: [] })),
      api('/floors?limit=800').catch(() => ({ data: [] })),
      api('/interests/meta').catch(() => null),
    ]).then(([p, c, a, b, u, ec, bd, fl, im]) => setOpts({
      project: p.data || [], client: c.data || [], account: a.data || [], broker: b.data || [], employee: u.data || [],
      expenseCategory: ec.data || [], building: bd.data || [], floor: fl.data || [], meta: im,
    }));
  }, []);

  const open = async (rep, fl = filters) => {
    if (!can(rep.module)) { toast('لا تملك صلاحية هذا التقرير', 'error'); return; }
    setSel(rep); setLoading(true); setData(null);
    const clean = Object.fromEntries(Object.entries(fl || {}).filter(([, v]) => v !== '' && v !== undefined && v !== null));
    setFilters(clean);
    const qs = new URLSearchParams(clean).toString();
    try { const r = await api('/reports/' + rep.key + (qs ? '?' + qs : '')); setData(r); }
    catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  };
  const doPrint = () => window.print();
  const doExcel = async () => {
    try { await excelUrl(sel.key, filters); toast('تم تنزيل ملف Excel بهوية الشركة'); }
    catch (e) { toast(e.message, 'error'); }
  };
  const MONEY = ['amount', 'price', 'deposit', 'net', 'paid', 'remaining', 'commission', 'settlement', 'discount', 'budget', 'opening', 'current', 'month_in', 'month_out', 'collected', 'expenses', 'deducted', 'net_sales', 'gross_sales', 'discounts', 'net_cash_flow', 'commissions', 'commissions_paid'];
  const cellVal = (r, c) => {
    const v = r[c];
    if (v === null || v === undefined || v === '') return '—';
    if (MONEY.includes(c) || String(c).startsWith('month_')) return fmtN(v);
    return String(v).slice(0, 70);
  };
  const FilterInput = ({ f: fl }) => {
    const v = filters[fl.k] ?? '';
    const set = (nv) => setFilters({ ...filters, [fl.k]: nv });
    if (fl.type === 'date') return <Field label={fl.t}><input type="date" className="inp num" value={v} onChange={e => set(e.target.value)} /></Field>;
    if (fl.type === 'number') return <Field label={fl.t}><input type="number" className="inp num" value={v} onChange={e => set(e.target.value)} /></Field>;
    if (fl.type === 'bool') return <Field label={fl.t}><select className="inp" value={v} onChange={e => set(e.target.value)}><option value="">الكل</option><option value="1">نعم</option><option value="0">لا</option></select></Field>;
    if (fl.type === 'method') return <Field label={fl.t}><select className="inp" value={v} onChange={e => set(e.target.value)}><option value="">الكل</option>{Object.entries(L.payMethod).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>;
    if (fl.type === 'paymentStatus') return <Field label={fl.t}><select className="inp" value={v} onChange={e => set(e.target.value)}><option value="">الكل</option>{Object.entries(L.payStatus).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>;
    if (fl.type === 'accountType') return <Field label={fl.t}><select className="inp" value={v} onChange={e => set(e.target.value)}><option value="">الكل</option>{Object.entries(L.accountType).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>;
    if (fl.type === 'propertyType') return <Field label={fl.t}><select className="inp" value={v} onChange={e => set(e.target.value)}><option value="">الكل</option>{(opts.meta?.property_types || Object.entries(L.propertyType).map(([k, t]) => ({ k, t }))).map(t => <option key={t.k} value={t.k}>{t.t}</option>)}</select></Field>;
    if (fl.type === 'floorType') return <Field label={fl.t}><select className="inp" value={v} onChange={e => set(e.target.value)}><option value="">الكل</option>{(opts.meta?.floor_types || Object.entries(L.floorType).map(([k, t]) => ({ k, t }))).map(t => <option key={t.k} value={t.k}>{t.t}</option>)}</select></Field>;
    if (fl.type === 'stage') return <Field label={fl.t}><select className="inp" value={v} onChange={e => set(e.target.value)}><option value="">الكل</option>{(opts.meta?.stages || []).map(t => <option key={t.k} value={t.k}>{t.name}</option>)}</select></Field>;
    if (fl.type === 'project') return <Field label={fl.t}><select className="inp" value={v} onChange={e => set(e.target.value)}><option value="">الكل</option>{(opts.project || []).map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>;
    if (fl.type === 'building') return <Field label={fl.t}><select className="inp" value={v} onChange={e => set(e.target.value)}><option value="">الكل</option>{(opts.building || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>;
    if (fl.type === 'floor') return <Field label={fl.t}><select className="inp" value={v} onChange={e => set(e.target.value)}><option value="">الكل</option>{(opts.floor || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>;
    if (fl.type === 'client') return <Field label={fl.t}><select className="inp" value={v} onChange={e => set(e.target.value)}><option value="">الكل</option>{(opts.client || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>;
    if (fl.type === 'account') return <Field label={fl.t}><select className="inp" value={v} onChange={e => set(e.target.value)}><option value="">الكل</option>{(opts.account || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>;
    if (fl.type === 'broker') return <Field label={fl.t}><select className="inp" value={v} onChange={e => set(e.target.value)}><option value="">الكل</option>{(opts.broker || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>;
    if (fl.type === 'employee') return <Field label={fl.t}><select className="inp" value={v} onChange={e => set(e.target.value)}><option value="">الكل</option>{(opts.employee || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>;
    if (fl.type === 'expenseCategory') return <Field label={fl.t}><select className="inp" value={v} onChange={e => set(e.target.value)}><option value="">الكل</option>{(opts.expenseCategory || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>;
    return <Field label={fl.t}><input className="inp" value={v} onChange={e => set(e.target.value)} /></Field>;
  };

  if (busy) return <><PageHead title="مركز التقارير" /><Skeleton n={3} /></>;

  return (
    <>
      <div className="no-print">
        <PageHead title="مركز التقارير" sub="تقارير احترافية بهوية الشركة — عرض، طباعة، وتصدير Excel" />
        {can('reports') && <AIReport />}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3.5 mb-5 anim-in">
          {list.map(r => (
            <div key={r.key} className={`card card-h p-4 cursor-pointer text-center ${sel?.key === r.key ? '!border-[var(--brand)]' : ''}`} onClick={() => open(r)} style={sel?.key === r.key ? { borderColor: 'var(--brand)', boxShadow: '0 0 0 3px rgba(29,97,245,.14)' } : {}}>
              <span className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center mb-2" style={{ background: 'linear-gradient(135deg, rgba(29,97,245,.13), rgba(124,58,237,.1))', color: 'var(--brand)' }}><I n={ICONS[r.key] || 'chart'} s={24} /></span>
              <b className="text-[13.5px]">{r.title}</b>
            </div>
          ))}
        </div>

        {loading && <Skeleton n={4} />}
        {!loading && !data && <div className="card"><Empty icon="chart" title="اختر تقريرًا لعرضه" sub="اضغط على أي بطاقة بالأعلى" /></div>}

        {!loading && data && (
          <div className="card p-5 anim-in">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
              <div><b className="text-[16px]">{data.def.title}</b><div className="text-[12px] num" style={{ color: 'var(--ink3)' }}>عدد السجلات: {data.rows.length}</div></div>
              <div className="flex gap-2">
                {can('reports', 'export') && <Btn v="g" size="sm" onClick={doExcel}><I n="dl" s={15} /> Excel</Btn>}
                {can('reports', 'print') && <Btn v="p" size="sm" onClick={doPrint}><I n="print" s={15} /> طباعة / PDF</Btn>}
              </div>
            </div>
            {(data.def.filters || []).length > 0 && (
              <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4 p-3 rounded-xl" style={{ background: 'var(--card2)' }}>
                {data.def.filters.map(fl => <FilterInput key={fl.k} f={fl} />)}
                <div className="flex items-end gap-2">
                  <Btn v="g" size="sm" onClick={() => open(sel)}><I n="filter" s={14} /> تطبيق الفلاتر</Btn>
                  <Btn v="o" size="sm" onClick={() => { setFilters({}); open(sel, {}); }}>مسح</Btn>
                </div>
              </div>
            )}
            <div className="text-[12px] mb-2" style={{ color: 'var(--ink3)' }}>
              رقم التقرير: <b className="num">{data.meta.no}</b> — التاريخ: <b className="num">{data.meta.date}</b> — المستخدم: <b>{data.meta.user}</b>
              {Object.keys(filters).length > 0 && <> — الفلاتر المطبقة: <b>{Object.entries(filters).map(([k, v]) => `${k}=${v}`).join(' ، ')}</b></>}
            </div>
            <div className="overflow-x-auto">
              <table className="tbl min-w-[600px]">
                <thead><tr>{data.def.cols.map(c => <th key={c}>{COLS_AR[c] || c}</th>)}</tr></thead>
                <tbody>
                  {data.rows.slice(0, 200).map((r, i) => <tr key={i}>{data.def.cols.map(c => <td key={c} className="text-[12.5px]">{cellVal(r, c)}</td>)}</tr>)}
                </tbody>
              </table>
              {data.rows.length > 200 && <div className="text-[12px] mt-2" style={{ color: 'var(--ink3)' }}>عرض أول 200 سجل — صدّر Excel للكامل</div>}
            </div>
          </div>
        )}
      </div>

      {/* أول الصفحة للطباعة */}
      <style>{`@media print { .no-print { display: none !important; } }`}</style>

      {/* ورقة الطباعة RTL */}
      {data && (
        <div className="print-area">
          <div className="print-sheet p-8">
            <div className="rpt-head">
              <div className="flex items-center gap-3">
                {data.meta.company.brand_logo && <img src={`/api/public/brand-file/${data.meta.company.brand_logo}`} alt="" style={{ height: 48 }} />}
                <div><div className="text-[20px] font-bold">{data.meta.company.company_name}</div>
                <div className="text-[12px]">{data.meta.company.company_address} — {data.meta.company.company_phone}</div></div>
              </div>
              <div className="text-left">
                <div className="text-[17px] font-bold">{data.def.title}</div>
                <div className="text-[11px]">رقم التقرير: {data.meta.no}</div>
                <div className="text-[11px]">التاريخ: {data.meta.date}</div>
                <div className="text-[11px]">المستخدم: {data.meta.user}</div>
              </div>
            </div>
            <table>
              <thead><tr>{data.def.cols.map(c => <th key={c}>{COLS_AR[c] || c}</th>)}</tr></thead>
              <tbody>{data.rows.map((r, i) => <tr key={i}>{data.def.cols.map(c => <td key={c}>{String(r[c] ?? '—')}</td>)}</tr>)}</tbody>
            </table>
            <div className="rpt-foot">
              <span>{data.meta.company.reports_footer}</span>
              <span>صفحة 1 — إجمالي السجلات: {data.rows.length}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AIReport() {
  const { toast, can } = useStore();
  const [prompt, setPrompt] = useState('');
  const [out, setOut] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  if (!can('assistant')) return null;
  const gen = async () => {
    if (!prompt.trim()) { toast('اكتب موضوع التقرير', 'error'); return; }
    setBusy(true);
    try {
      const r = await api('/ai/report', { method: 'POST', timeout: 120000, body: { prompt } });
      setOut(r.markdown || ''); setModel(r.model || '');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <div className="card p-4 mb-5 anim-in" style={{ background: 'linear-gradient(135deg, rgba(124,58,237,.07), rgba(29,97,245,.05))' }}>
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setOpen(!open)}>
        <span style={{ color: 'var(--brand)' }}><I n="bot" s={20} /></span>
        <b className="text-[15px]">مولّد التقارير الذكي</b>
        <Badge c="b-purple">AI</Badge>
        <span className="mr-auto" style={{ color: 'var(--ink3)' }}><I n={open ? 'chevD' : 'chev'} s={17} /></span>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          <Field label="اكتب موضوع التقرير — سيُبنى على أرقامك الحقيقية (قراءة فقط)"><input className="inp" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="مثال: ملخص أداء المبيعات هذا الشهر مع توصيات" /></Field>
          <Btn onClick={gen} disabled={busy}><I n="spark" s={15} /> {busy ? 'جارٍ التوليد...' : 'توليد التقرير'}</Btn>
          {out && <div className="rounded-xl p-4 text-[13.5px] leading-8 whitespace-pre-wrap" style={{ background: 'var(--card)' }}>
            {out}
            <div className="text-[11px] num mt-2" style={{ color: 'var(--ink3)' }} dir="ltr">generated by {model}</div>
          </div>}
        </div>
      )}
    </div>
  );
}
