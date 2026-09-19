import React, { useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtD, todayStr, L, badge } from '../lib/format.js';
import { I, Btn, Badge, Field, Modal, PageHead, Tabs, Confirm } from '../components/ui.jsx';
import { useList, useFetch, Kpis, FilterBar, Table, ExcelBtn } from '../components/fin.jsx';

export default function Quotations() {
  const { can, toast, company, project: gProject } = useStore();
  const cur = company.currency || 'ر.س';
  const [f, setF] = useState({ status: '', project_id: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const { rows, meta, busy, err, reload } = useList('/quotations', { page, limit: 20, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) });
  const { data: clients } = useFetch('/clients?limit=200');
  const { data: units } = useFetch('/units?limit=300&status=available');
  const { data: brokers } = useFetch('/brokers?limit=100');
  const [form, setForm] = useState(null);
  const [view, setView] = useState(null);
  const [convert, setConvert] = useState(null);
  const [accs, setAccs] = useState(null);
  const [saving, setSaving] = useState(false);
  const accounts = accs?.data || [];

  const openNew = async () => {
    setAccs(await api('/accounts?limit=50').catch(() => ({ data: [] })));
    setForm({ client_id: '', unit_id: '', price: '', discount: 0, quote_date: todayStr(), valid_until: '', broker_id: '', notes: '', terms: '' });
  };
  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, price: Number(form.price), discount: Number(form.discount) };
      if (body.id) await api('/quotations/' + body.id, { method: 'PUT', body });
      else await api('/quotations', { method: 'POST', body });
      toast('تم حفظ عرض السعر'); setForm(null); reload();
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };
  const setStatus = async (r, status) => {
    try { await api(`/quotations/${r.id}/status`, { method: 'POST', body: { status } }); toast('تم تحديث حالة العرض'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const doConvert = async () => {
    setSaving(true);
    try {
      await api(`/quotations/${convert.id}/convert`, { method: 'POST', body: { deposit: Number(convert.deposit || 0), deposit_method: convert.deposit_method, account_id: convert.account_id, reservation_date: todayStr(), expiry_date: convert.expiry_date || null } });
      toast('تم تحويل العرض إلى حجز وإنشاء العربون'); setConvert(null); reload();
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };
  const openView = async (r) => { try { setView(await api('/quotations/' + r.id)); } catch (e) { toast(e.message, 'error'); } };

  const unitOf = (id) => (units?.data || []).find(u => String(u.id) === String(id));

  return (
    <>
      <PageHead title="عروض الأسعار" sub="عرض سعر قابل للطباعة والتحويل إلى حجز مع ربط العميل والوحدة والمسوق"
        actions={<>
          <ExcelBtn path="/quotations/excel" filters={f} name="عروض-الأسعار.xlsx" can={can('quotations', 'export')} />
          {can('quotations', 'create') && <Btn v="g" onClick={openNew}><I n="plus" s={15} /> عرض سعر جديد</Btn>}
        </>} />

      <Kpis items={[
        { icon: 'clip', label: 'عروض معروضة', value: String(meta.total), sub: 'حسب الفلاتر الحالية' },
        { icon: 'coins', label: 'إجمالي الصافي', value: fmtN(rows.reduce((a, r) => a + Number(r.net_price || 0), 0)) + ' ' + cur },
        { icon: 'check', label: 'محوّلة إلى حجز', value: String(rows.filter(r => r.status === 'converted').length) },
      ]} />

      <FilterBar onReload={reload}>
        <Field label="الحالة"><select className="inp" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">الكل</option>{Object.entries(L.quoteStatus).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
        <Field label="من"><input type="date" className="inp num" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="إلى"><input type="date" className="inp num" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
      </FilterBar>

      <Table rows={rows} busy={busy} err={err} empty="لا توجد عروض أسعار"
        cols={[
          { k: 'code', t: 'الكود' },
          { k: 'quote_date', t: 'التاريخ', r: r => fmtD(r.quote_date) },
          { k: 'valid_until', t: 'صالح حتى', r: r => fmtD(r.valid_until) },
          { k: 'client_name', t: 'العميل', r: r => <><b>{r.client_name}</b><div className="text-[11.5px] num" style={{ color: 'var(--ink3)' }}>{r.client_phone}</div></> },
          { k: 'unit_code', t: 'الوحدة', r: r => r.unit_code || '—' },
          { k: 'project_name', t: 'المشروع', r: r => r.project_name || '—' },
          { k: 'price', t: 'السعر', r: r => <span className="num">{fmtN(r.price)}</span> },
          { k: 'discount', t: 'الخصم', r: r => <span className="num">{fmtN(r.discount)}</span> },
          { k: 'net_price', t: 'الصافي', r: r => <b className="num">{fmtN(r.net_price)}</b> },
          { k: 'status', t: 'الحالة', r: r => <Badge c={badge.quoteStatus[r.status]}>{L.quoteStatus[r.status] || r.status}</Badge> },
          {
            t: 'إجراءات', center: true, r: r => (
              <div className="flex gap-1 justify-center" onClick={e => e.stopPropagation()}>
                <button className="icon-btn" title="عرض/طباعة" onClick={() => openView(r)}><I n="eye" s={15} /></button>
                {can('reservations', 'create') && !['converted', 'cancelled'].includes(r.status) && <button className="icon-btn" title="تحويل إلى حجز" onClick={async () => { setAccs(await api('/accounts?limit=50').catch(() => ({ data: [] }))); setConvert({ ...r, deposit: 0, deposit_method: 'cash', account_id: '', expiry_date: '' }); }}><I n="key" s={15} /></button>}
                {can('quotations', 'edit') && r.status === 'draft' && <button className="icon-btn" title="إرسال للعميل" onClick={() => setStatus(r, 'sent')}><I n="send" s={15} /></button>}
                {can('quotations', 'edit') && r.status === 'sent' && <button className="icon-btn" title="قبول" onClick={() => setStatus(r, 'accepted')}><I n="check" s={15} /></button>}
                {can('quotations', 'edit') && !['converted', 'cancelled'].includes(r.status) && <button className="icon-btn" title="تعديل" onClick={() => setForm(r)}><I n="edit" s={15} /></button>}
              </div>
            )
          },
        ]} />

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'تعديل عرض سعر' : 'عرض سعر جديد'} w={620}
        actions={<><Btn v="o" onClick={() => setForm(null)}>إلغاء</Btn><Btn v="g" disabled={saving} onClick={save}><I n="check" s={15} /> حفظ</Btn></>}>
        {form && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="العميل *">
                <select className="inp" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                  <option value="">— اختر —</option>{(clients?.data || []).map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
                </select>
              </Field>
              <Field label="الوحدة">
                <select className="inp" value={form.unit_id || ''} onChange={e => { const u = unitOf(e.target.value); setForm({ ...form, unit_id: e.target.value, price: u?.price ?? form.price }); }}>
                  <option value="">— بدون وحدة —</option>{(units?.data || []).map(u => <option key={u.id} value={u.id}>{u.code} — {L.propertyType[u.type] || u.type} — {fmtN(u.price)}</option>)}
                </select>
              </Field>
              <Field label="السعر *"><input type="number" className="inp num" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></Field>
              <Field label="الخصم"><input type="number" className="inp num" value={form.discount} onChange={e => setForm({ ...form, discount: e.target.value })} /></Field>
              <Field label="تاريخ العرض"><input type="date" className="inp num" value={form.quote_date} onChange={e => setForm({ ...form, quote_date: e.target.value })} /></Field>
              <Field label="صالح حتى"><input type="date" className="inp num" value={form.valid_until || ''} onChange={e => setForm({ ...form, valid_until: e.target.value })} /></Field>
              <Field label="المسوق"><select className="inp" value={form.broker_id || ''} onChange={e => setForm({ ...form, broker_id: e.target.value })}><option value="">بدون مسوق</option>{(brokers?.data || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
            </div>
            <Field label="الشروط"><textarea className="inp" rows={3} value={form.terms || ''} onChange={e => setForm({ ...form, terms: e.target.value })} placeholder="شروط الدفع، مدة التسليم، الضمان..." /></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!view} onClose={() => setView(null)} title={`عرض سعر ${view?.code || ''}`} w={720}
        actions={<><Btn v="o" onClick={() => window.print()}><I n="print" s={15} /> طباعة / PDF</Btn><Btn v="g" onClick={() => setView(null)}>إغلاق</Btn></>}>
        {view && (
          <div className="print-area text-[13.5px] leading-7" dir="rtl">
            <div className="text-center mb-4">
              <div className="text-[18px] font-bold">{view.company?.company_name || company.company_name}</div>
              <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>عرض سعر رقم {view.code} — بتاريخ {fmtD(view.quote_date)}</div>
            </div>
            <table className="tbl mb-3"><tbody>
              {[
                ['العميل', view.client_name + ' — ' + (view.client_phone || '')],
                ['الوحدة', (view.unit_code || '—') + ' — ' + (view.project_name || '')],
                ['السعر', fmtN(view.price) + ' ' + (view.company?.currency || cur)],
                ['الخصم', fmtN(view.discount)],
                ['الصافي المستحق', fmtN(view.net_price) + ' ' + (view.company?.currency || cur)],
                ['صالح حتى', fmtD(view.valid_until) + (view.valid_days !== null && view.valid_days !== undefined ? ` (${view.valid_days} يوم)` : '')],
                ['المسوق', view.broker_name || '—'],
              ].map(([k, v], i) => <tr key={i}><th style={{ width: 160 }}>{k}</th><td>{v}</td></tr>)}
            </tbody></table>
            {view.terms && <div><b>الشروط:</b><div className="whitespace-pre-wrap">{view.terms}</div></div>}
            <div className="mt-6 text-[12.5px]" style={{ color: 'var(--ink2)' }}>هذا العرض غير ملزم ويعتبر ساريًا حتى التاريخ المذكور أعلاه.</div>
          </div>
        )}
      </Modal>

      <Modal open={!!convert} onClose={() => setConvert(null)} title={`تحويل العرض ${convert?.code || ''} إلى حجز`} w={520}
        actions={<><Btn v="o" onClick={() => setConvert(null)}>إلغاء</Btn><Btn v="g" disabled={saving} onClick={doConvert}><I n="key" s={15} /> تحويل وإنشاء العربون</Btn></>}>
        {convert && (
          <div className="space-y-3">
            <div className="text-[13px] rounded-xl p-2.5" style={{ background: 'var(--bg2)' }}>
              العميل: <b>{convert.client_name}</b> — الوحدة: <b className="num">{convert.unit_code}</b> — الصافي: <b className="num">{fmtN(convert.net_price)}</b>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="مبلغ العربون"><input type="number" className="inp num" value={convert.deposit} onChange={e => setConvert({ ...convert, deposit: e.target.value })} /></Field>
              <Field label="طريقة العربون"><select className="inp" value={convert.deposit_method} onChange={e => setConvert({ ...convert, deposit_method: e.target.value })}>{Object.entries(L.payMethod).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
              <Field label="الحساب المستلم"><select className="inp" value={convert.account_id} onChange={e => setConvert({ ...convert, account_id: e.target.value })}><option value="">الحساب الافتراضي</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              <Field label="انتهاء الحجز"><input type="date" className="inp num" value={convert.expiry_date || ''} onChange={e => setConvert({ ...convert, expiry_date: e.target.value })} /></Field>
            </div>
            <div className="text-[12px]" style={{ color: 'var(--ink3)' }}>سيتم إنشاء العربون كدفعة حقيقية على الحساب أولًا (حجز ← عربون ← حركة ← حساب) دون تكرار أي مبلغ.</div>
          </div>
        )}
      </Modal>
    </>
  );
}
