import React, { useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtD, fmtDT, todayStr, L, badge } from '../lib/format.js';
import { I, Btn, Badge, Field, Modal, PageHead, Tabs, Avatar, Empty } from '../components/ui.jsx';
import { useFetch, Kpis, FilterBar, ExcelBtn } from '../components/fin.jsx';

export default function Pipeline() {
  const { can, toast, project: gProject } = useStore();
  const [f, setF] = useState({ employee_id: '', project_id: gProject || '' });
  const { data: boardData, busy, } = useFetch('/pipeline' + q({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) }), [f.employee_id, f.project_id]);
  const board = boardData?.stages || [];
  const totalClients = boardData?.total || 0;
  const err = '';
  const reload = () => {};
  const { data: users } = useFetch('/users?limit=100');
  const { data: projects } = useFetch('/projects?limit=100');
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState(null);
  const [comms, setComms] = useState(null);
  const [commForm, setCommForm] = useState(null);
  const [moveTo, setMoveTo] = useState(null);
  const [saving, setSaving] = useState(false);
  const stages = board.filter(b => b.k !== 'other');

  const openClient = async (c) => {
    setDetail(c); setHistory(null); setComms(null);
    try { setHistory((await api(`/clients/${c.id}/stages`)).data); } catch { setHistory([]); }
    try { setComms((await api(`/clients/${c.id}/communications?limit=20`)).data); } catch { setComms([]); }
  };
  const doMove = async () => {
    setSaving(true);
    try {
      await api(`/clients/${moveTo.client_id}/stage`, { method: 'PUT', body: { stage: moveTo.stage, note: moveTo.note } });
      toast('تم تحديث مرحلة العميل'); setMoveTo(null); setDetail(null); reload();
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };
  const saveComm = async () => {
    setSaving(true);
    try {
      await api('/communications', { method: 'POST', body: commForm });
      toast('تم تسجيل التواصل'); setCommForm(null); reload();
      if (detail) { setComms((await api(`/clients/${detail.id}/communications?limit=20`)).data); setHistory((await api(`/clients/${detail.id}/stages`)).data); }
    } catch (e) { toast(e.message, 'error'); }
    setSaving(false);
  };

  return (
    <>
      <PageHead title="مسار البيع (Pipeline)" sub="عميل محتمل ← تم التواصل ← مهتم ← معاينة ← عرض سعر ← تفاوض ← حجز ← عقد ← بيع ← مغلق — مع تسجيل تاريخ كل انتقال"
        actions={<ExcelBtn path="/reports/interested_clients/excel" filters={f} name="العملاء-المهتمون.xlsx" can={can('interests', 'export')} />} />

      <Kpis items={[
        { icon: 'users', label: 'إجمالي العملاء في المسار', value: String(totalClients) },
        ...(stages || []).slice(0, 4).map(s => ({ icon: 'flow', label: s.name, value: String(s.clients.length || 0) })),
      ]} />

      <FilterBar onReload={reload}>
        <Field label="الموظف"><select className="inp" value={f.employee_id} onChange={e => setF({ ...f, employee_id: e.target.value })}><option value="">الكل</option>{(users?.data || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="المشروع"><select className="inp" value={f.project_id} onChange={e => setF({ ...f, project_id: e.target.value })}><option value="">الكل</option>{(projects?.data || []).map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
      </FilterBar>

      {busy && <div className="skel" style={{ height: 240 }} />}
      {!busy && board.length === 0 && <div className="card"><Empty title="لا يوجد عملاء في المسار" /></div>}
      {err && <div className="card p-4 text-[13px]" style={{ color: 'var(--danger)' }}>{err}</div>}

      {!busy && !err && (
        <div className="flex gap-3 overflow-x-auto pb-3" style={{ alignItems: 'flex-start' }}>
          {board.map(col => (
            <div key={col.k} className="pipe-col">
              <div className="flex items-center justify-between px-1">
                <b className="text-[13px]">{col.name}</b>
                <Badge c="b-gray">{col.clients.length}</Badge>
              </div>
              <div className="text-[11.5px] px-1" style={{ color: 'var(--ink3)' }}>قيمة الفرص: {fmtN(col.clients.reduce((a, c) => a + Number(c.potential_value || 0), 0))}</div>
              <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: '58vh' }}>
                {col.clients.length === 0 && <div className="text-[12px] text-center py-4" style={{ color: 'var(--ink3)' }}>لا عملاء</div>}
                {col.clients.map(c => (
                  <div key={c.id} className="pipe-card" onClick={() => openClient(c)}>
                    <div className="flex items-center gap-2">
                      <Avatar name={c.name} s={28} />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold truncate">{c.name}</div>
                        <div className="text-[11px] num" style={{ color: 'var(--ink3)' }}>{c.phone}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-1.5 text-[11.5px]" style={{ color: 'var(--ink2)' }}>
                      <span>{c.interests ? String(c.interests).split(',').filter(Boolean).length + ' اهتمام' : 'بدون اهتمامات'}</span>
                      <span className="num">{fmtD(c.last_contact_at || c.stage_changed_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ملف العميل في المسار */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name || ''} w={760}
        actions={can('pipeline', 'edit') && <Btn v="g" onClick={() => setMoveTo({ client_id: detail.id, stage: detail.pipeline_stage || 'lead', note: '' })}><I n="flow" s={15} /> نقل لمرحلة أخرى</Btn>}>
        {detail && (
          <div className="space-y-3 text-[13.5px]">
            <div className="grid sm:grid-cols-3 gap-2">
              <div className="rounded-xl p-2.5" style={{ background: 'var(--bg2)' }}>الجوال: <b className="num">{detail.phone || '—'}</b></div>
              <div className="rounded-xl p-2.5" style={{ background: 'var(--bg2)' }}>المرحلة: <b>{L.stage[detail.pipeline_stage] || detail.pipeline_stage || 'عميل محتمل'}</b></div>
              <div className="rounded-xl p-2.5" style={{ background: 'var(--bg2)' }}>آخر تواصل: <b className="num">{fmtDT(detail.last_contact_at)}</b></div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <b>سجل التواصل</b>
                {can('communications', 'create') && <Btn v="o" size="sm" onClick={() => setCommForm({ client_id: detail.id, kind: 'call', direction: 'out', body: '', result: '', occurred_at: todayStr(), next_follow_up: '' })}><I n="plus" s={14} /> تسجيل تواصل</Btn>}
              </div>
              {comms === null && <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>جارٍ التحميل...</div>}
              {comms && comms.length === 0 && <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>لا يوجد سجل تواصل بعد</div>}
              {comms && comms.length > 0 && (
                <div className="space-y-1.5" style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {comms.map(c => (
                    <div key={c.id} className="rounded-xl p-2.5" style={{ background: 'var(--card2)' }}>
                      <div className="flex items-center justify-between"><b>{L.commKind[c.kind] || c.kind}</b><span className="num text-[11.5px]" style={{ color: 'var(--ink3)' }}>{fmtDT(c.occurred_at)}</span></div>
                      <div>{c.body}</div>
                      {c.result && <div className="text-[12px]" style={{ color: 'var(--ink2)' }}>النتيجة: {c.result}</div>}
                      {c.next_follow_up && <div className="text-[12px]" style={{ color: 'var(--warn, #b45309)' }}>متابعة: {fmtD(c.next_follow_up)}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <b>تاريخ المراحل</b>
              {history === null && <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>جارٍ التحميل...</div>}
              {history && (
                <div className="mt-1.5 space-y-1.5" style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {history.map(h => (
                    <div key={h.id} className="flex items-center justify-between text-[12.5px] rounded-lg px-2.5 py-1.5" style={{ background: 'var(--card2)' }}>
                      <span><Badge c="b-sky">{L.stage[h.to_stage] || h.to_stage}</Badge> {h.note}</span>
                      <span className="num" style={{ color: 'var(--ink3)' }}>{fmtDT(h.created_at)} — {h.user_name || ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!moveTo} onClose={() => setMoveTo(null)} title="نقل العميل لمرحلة" w={460}
        actions={<><Btn v="o" onClick={() => setMoveTo(null)}>إلغاء</Btn><Btn v="g" disabled={saving} onClick={doMove}><I n="check" s={15} /> تأكيد</Btn></>}>
        {moveTo && (
          <div className="space-y-3">
            <Field label="المرحلة الجديدة"><select className="inp" value={moveTo.stage} onChange={e => setMoveTo({ ...moveTo, stage: e.target.value })}>{stages.map(s => <option key={s.k} value={s.k}>{s.name}</option>)}</select></Field>
            <Field label="ملاحظة (تُسجَّل في التاريخ)"><input className="inp" value={moveTo.note} onChange={e => setMoveTo({ ...moveTo, note: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!commForm} onClose={() => setCommForm(null)} title="تسجيل تواصل / متابعة" w={520}
        actions={<><Btn v="o" onClick={() => setCommForm(null)}>إلغاء</Btn><Btn v="g" disabled={saving} onClick={saveComm}><I n="check" s={15} /> حفظ</Btn></>}>
        {commForm && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="نوع التواصل"><select className="inp" value={commForm.kind} onChange={e => setCommForm({ ...commForm, kind: e.target.value })}>{Object.entries(L.commKind).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
              <Field label="الاتجاه"><select className="inp" value={commForm.direction} onChange={e => setCommForm({ ...commForm, direction: e.target.value })}><option value="out">صادر</option><option value="in">وارد</option></select></Field>
              <Field label="التاريخ والوقت"><input type="datetime-local" className="inp num" value={String(commForm.occurred_at).replace(' ', 'T').slice(0, 16)} onChange={e => setCommForm({ ...commForm, occurred_at: e.target.value.replace('T', ' ') })} /></Field>
              <Field label="المتابعة القادمة"><input type="date" className="inp num" value={commForm.next_follow_up || ''} onChange={e => setCommForm({ ...commForm, next_follow_up: e.target.value })} /></Field>
            </div>
            <Field label="نص التواصل"><textarea className="inp" rows={2} value={commForm.body} onChange={e => setCommForm({ ...commForm, body: e.target.value })} /></Field>
            <Field label="النتيجة"><input className="inp" value={commForm.result} onChange={e => setCommForm({ ...commForm, result: e.target.value })} placeholder="مهتم / يحتاج وقتًا / يرفض..." /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}
