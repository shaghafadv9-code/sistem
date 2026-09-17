import React, { useEffect, useRef, useState } from 'react';
import { api, q, fileUrl, getToken } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { I, Btn } from './ui.jsx';

// مرفقات كيان (عميل/وحدة/بيع/حجز/مشروع/مهمة/موعد) — entity مثل {client_id: 5}
export default function AttachFiles({ entity, title = 'المرفقات' }) {
  const { can, toast } = useStore();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const inp = useRef();
  const key = JSON.stringify(entity);

  const load = () => api('/files' + q({ ...entity, limit: 50 })).then(r => setRows(r.data || [])).catch(() => {});
  useEffect(load, [key]);
  if (!can('files', 'view')) return null;

  const doUpload = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      [...files].forEach(f => fd.append('files', f));
      Object.entries(entity).forEach(([k, v]) => fd.append(k, v));
      const res = await fetch('/api/files/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken() }, body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'فشل الرفع');
      toast(`تم إرفاق ${j.files.length} ملفات`);
      load();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const del = async (id) => {
    try { await api('/files/' + id, { method: 'DELETE' }); toast('تم حذف الملف'); load(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <b className="text-[14px]">{title} ({rows.length})</b>
        {can('files', 'create') && <>
          <input ref={inp} type="file" multiple className="hidden" onChange={e => { doUpload(e.target.files); e.target.value = ''; }} />
          <Btn v="g" size="xs" onClick={() => inp.current.click()} disabled={busy}><I n="ul" s={13} /> {busy ? 'جارٍ الرفع...' : 'إرفاق'}</Btn>
        </>}
      </div>
      {rows.length === 0 && <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>لا توجد مرفقات بعد</div>}
      <div className="space-y-1.5">
        {rows.map(f => (
          <div key={f.id} className="flex items-center gap-2 rounded-xl px-3 py-2 text-[12.5px]" style={{ background: 'var(--card2)' }}>
            <I n={f.mime?.startsWith('image/') ? 'eye' : 'file'} s={15} />
            <span className="font-bold truncate flex-1" title={f.original_name}>{f.original_name}</span>
            <a className="icon-btn !w-7 !h-7" href={fileUrl(f.id, true)} title="تنزيل"><I n="dl" s={14} /></a>
            {can('files', 'delete') && <button className="icon-btn !w-7 !h-7" onClick={() => del(f.id)} title="حذف"><I n="trash" s={14} /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}
