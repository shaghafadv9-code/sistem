import React, { useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtD, todayStr, L, badge } from '../lib/format.js';
import { I, Btn, Badge, Field, Modal, PageHead, Tabs, Confirm } from '../components/ui.jsx';
import { useList, useFetch, Kpis, FilterBar, Table, ExcelBtn } from '../components/fin.jsx';
import AttachFiles from '../components/AttachFiles.jsx';

export default function Contracts() {
  const { can, toast, company, project: gProject } = useStore();
  const cur = company.currency || 'ر.س';
  const [f, setF] = useState({ status: '', project_id: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const { rows, meta, busy, err, reload } = useList('/contracts', { page, limit: 20, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) });
  const { data: clients } = useFetch('/clients?limit=200');
  const { data: sales } = useFetch('/sales?limit=100');
  const [form, setForm] = useState(null);
  const [view, setView] = useState(null);
  const [sign, setSign] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, amount: Number(form.amount || 0), discount: Number(form.discount || 0) };
      const r = await api('/contracts', { method: 'POST', body });
      if (r && r.pending_approval) toast('تعديل قيمة العقد أُرسل لاعتماد المدير');
      else toast('تم إنشاء العقد');
      setForm(null); reload();
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };
  const doSign = async () => {
    setSaving(true);
    try { await api(`/contracts/${sign.id}/sign`, { method: 'POST', body: { signed_at: sign.signed_at || todayStr(), file_id: sign.file_id || null } }); toast('تم توقيع العقد وتحديث حالته'); setSign(null); reload(); }
    catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };
  const setStatus = async (r, status) => {
    try { await api('/contracts/' + r.id, { method: 'PUT', body: { status } }); toast('تم تحديث حالة العقد'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const openView = async (r) => { try { setView(await api('/contracts/' + r.id + '/print')); } catch (e) { toast(e.message, 'error'); } };

  return (
    <>
      <PageHead title="العقود" sub="عقود بيع بجميع الحالات: مسودة → بانتظار التوقيع → موقّع → ساري → مكتمل/ملغى/منتهي"
        actions={<>
          <ExcelBtn path="/contracts/excel" filters={f} name="العقود.xlsx" can={can('contracts', 'export')} />
          {can('contracts', 'create') && <Btn v="g" onClick={() => setForm({ client_id: '', sale_id: '', reservation_id: '', contract_date: todayStr(), start_date: todayStr(), end_date: '', amount: '', discount: 0, terms: '', notes: '' })}><I n="plus" s={15} /> عقد جديد</Btn>}
        </>} />

      <Kpis items={[
        { icon: 'clip', label: 'عقود معروضة', value: String(meta.total), sub: 'حسب الفلاتر' },
        { icon: 'coins', label: 'إجمالي الصافي', value: fmtN(rows.reduce((a, r) => a + Number(r.net_amount || 0), 0)) + ' ' + cur },
        { icon: 'check', label: 'سارية/موقّعة', value: String(rows.filter(r => ['signed', 'active'].includes(r.status)).length) },
        { icon: 'clock', label: 'بانتظار التوقيع', value: String(rows.filter(r => r.status === 'awaiting_signature').length), color: '#b45309' },
      ]} />

      <FilterBar onReload={reload}>
        <Field label="الحالة"><select className="inp" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">الكل</option>{Object.entries(L.contractStatus).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
        <Field label="من"><input type="date" className="inp num" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="إلى"><input type="date" className="inp num" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
      </FilterBar>

      <Table rows={rows} busy={busy} err={err} empty="لا توجد عقود"
        cols={[
          { k: 'code', t: 'رقم العقد' },
          { k: 'contract_date', t: 'التاريخ', r: r => fmtD(r.contract_date) },
          { k: 'client_name', t: 'العميل' },
          { k: 'project_name', t: 'المشروع', r: r => r.project_name || '—' },
          { k: 'unit_code', t: 'الوحدة', r: r => r.unit_code || '—' },
          { k: 'sale_code', t: 'عملية البيع', r: r => r.sale_code || '—' },
          { k: 'net_amount', t: 'قيمة العقد', r: r => <b className="num">{fmtN(r.net_amount)}</b> },
          { k: 'paid', t: 'المدفوع', r: r => <span className="money-in num">{fmtN(r.paid)}</span> },
          { k: 'remaining', t: 'المتبقي', r: r => <span className="money-due num">{fmtN(r.remaining)}</span> },
          { k: 'signed_at', t: 'تاريخ التوقيع', r: r => fmtD(r.signed_at) },
          { k: 'status', t: 'الحالة', r: r => <Badge c={badge.contractStatus[r.status]}>{L.contractStatus[r.status] || r.status}</Badge> },
          {
            t: 'إجراءات', center: true, r: r => (
              <div className="flex gap-1 justify-center" onClick={e => e.stopPropagation()}>
                <button className="icon-btn" title="عرض/طباعة" onClick={() => openView(r)}><I n="print" s={15} /></button>
                {can('contracts', 'edit') && !['cancelled', 'completed'].includes(r.status) && <button className="icon-btn" title="توقيع العقد" onClick={() => setSign({ ...r, signed_at: todayStr(), file_id: null })}><I n="clip" s={15} /></button>}
                {can('contracts', 'edit') && r.status === 'draft' && <button className="icon-btn" title="إرسال للتوقيع" onClick={() => setStatus(r, 'awaiting_signature')}><I n="send" s={15} /></button>}
                {can('contracts', 'edit') && r.status === 'active' && <button className="icon-btn" title="إكمال العقد" onClick={() => setStatus(r, 'completed')}><I n="check" s={15} /></button>}
                {can('contracts', 'edit') && !['cancelled'].includes(r.status) && <button className="icon-btn" title="إلغاء" onClick={() => setStatus(r, 'cancelled')}><I n="ban" s={15} /></button>}
              </div>
            )
          },
        ]} />

      <Modal open={!!form} onClose={() => setForm(null)} title="عقد جديد" w={640}
        actions={<><Btn v="o" onClick={() => setForm(null)}>إلغاء</Btn><Btn v="g" disabled={saving} onClick={save}><I n="check" s={15} /> حفظ العقد</Btn></>}>
        {form && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="العميل *">
                <select className="inp" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                  <option value="">— اختر —</option>{(clients?.data || []).map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
                </select>
              </Field>
              <Field label="عملية البيع المرتبطة">
                <select className="inp" value={form.sale_id} onChange={e => { const s = (sales?.data || []).find(x => String(x.id) === e.target.value); setForm({ ...form, sale_id: e.target.value, client_id: s?.client_id || form.client_id, amount: s?.sale_price ?? form.amount, discount: s?.discount ?? form.discount }); }}>
                  <option value="">— بدون —</option>{(sales?.data || []).map(s => <option key={s.id} value={s.id}>{s.code} — {s.client_name}</option>)}
                </select>
              </Field>
              <Field label="تاريخ العقد *"><input type="date" className="inp num" value={form.contract_date} onChange={e => setForm({ ...form, contract_date: e.target.value })} /></Field>
              <Field label="تاريخ البداية"><input type="date" className="inp num" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></Field>
              <Field label="تاريخ الانتهاء"><input type="date" className="inp num" value={form.end_date || ''} onChange={e => setForm({ ...form, end_date: e.target.value })} /></Field>
              <Field label="المبلغ *"><input type="number" className="inp num" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
              <Field label="الخصم"><input type="number" className="inp num" value={form.discount} onChange={e => setForm({ ...form, discount: e.target.value })} /></Field>
            </div>
            <Field label="الشروط"><textarea className="inp" rows={3} value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} /></Field>
            <div className="text-[12px] rounded-xl p-2.5" style={{ background: 'var(--bg2)', color: 'var(--ink2)' }}>أي تعديل على قيمة عقد من غير المدير يُرسل تلقائيًا لطلب اعتماد ويُسجَّل في سجل التدقيق.</div>
          </div>
        )}
      </Modal>

      <Modal open={!!sign} onClose={() => setSign(null)} title={`توقيع العقد ${sign?.code || ''}`} w={480}
        actions={<><Btn v="o" onClick={() => setSign(null)}>إلغاء</Btn><Btn v="g" disabled={saving} onClick={doSign}><I n="clip" s={15} /> تأكيد التوقيع</Btn></>}>
        {sign && (
          <div className="space-y-3">
            <Field label="تاريخ التوقيع"><input type="date" className="inp num" value={sign.signed_at} onChange={e => setSign({ ...sign, signed_at: e.target.value })} /></Field>
            <div>
              <div className="text-[12.5px] mb-1" style={{ color: 'var(--ink3)' }}>نسخة العقد الموقّعة (اختياري — تُرفق بالمكتبة)</div>
              <AttachFiles entity={{ contract_id: sign.id }} title="مرفقات العقد" />
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!view} onClose={() => setView(null)} title={`عقد ${view?.code || ''}`} w={760}
        actions={<><Btn v="o" onClick={() => window.print()}><I n="print" s={15} /> طباعة / PDF</Btn><Btn v="g" onClick={() => setView(null)}>إغلاق</Btn></>}>
        {view && (
          <div className="print-area text-[13.5px] leading-7" dir="rtl">
            <div className="text-center mb-4">
              <div className="text-[18px] font-bold">{view.company?.company_name || company.company_name}</div>
              <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>عقد بيع رقم {view.code} — بتاريخ {fmtD(view.contract_date)}</div>
            </div>
            <table className="tbl mb-3"><tbody>
              {[
                ['الطرف الأول', view.company?.company_name || company.company_name],
                ['الطرف الثاني', view.client_name + ' — ' + (view.client_phone || '')],
                ['الوحدة', (view.unit_code || '—') + ' — ' + (view.project_name || '')],
                ['قيمة العقد', fmtN(view.amount) + ' ' + (view.company?.currency || cur)],
                ['الخصم', fmtN(view.discount)],
                ['الصافي', fmtN(view.net_amount) + ' ' + (view.company?.currency || cur)],
                ['تاريخ التوقيع', fmtD(view.signed_at)],
                ['الحالة', L.contractStatus[view.status] || view.status],
              ].map(([k, v], i) => <tr key={i}><th style={{ width: 160 }}>{k}</th><td>{v}</td></tr>)}
            </tbody></table>
            {view.terms && <div><b>الشروط والأحكام:</b><div className="whitespace-pre-wrap">{view.terms}</div></div>}
            {Array.isArray(view.schedule) && view.schedule.length > 0 && (
              <div className="mt-4">
                <b>الأقساط:</b>
                <table className="tbl mt-2"><thead><tr><th>#</th><th>البيان</th><th>الاستحقاق</th><th>المبلغ</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
                  <tbody>{view.schedule.map(s => <tr key={s.id}><td className="num">{s.seq}</td><td>{s.label}</td><td className="num">{fmtD(s.due_date)}</td><td className="num">{fmtN(s.amount)}</td><td className="num">{fmtN(s.paid_amount)}</td><td className="num">{fmtN(s.remaining)}</td></tr>)}</tbody></table>
              </div>
            )}
            <div className="mt-8 flex justify-between text-[12.5px]"><div>الطرف الأول: .......................</div><div>الطرف الثاني: .......................</div></div>
          </div>
        )}
      </Modal>
    </>
  );
}
