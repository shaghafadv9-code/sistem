import React, { useEffect, useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtDT } from '../lib/format.js';
import { I, Btn, Empty, Skeleton, PageHead, Pagination } from '../components/ui.jsx';

export default function Notifications() {
  const { toast, bumpNotif } = useStore();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(true);

  const load = () => {
    setBusy(true);
    api('/notifications' + q({ page, limit: 20 })).then(r => { setRows(r.data); setTotal(r.total); setBusy(false); bumpNotif(); }).catch(() => setBusy(false));
  };
  useEffect(load, [page]);

  return (
    <>
      <PageHead title="مركز الإشعارات" sub="كل التنبيهات في مكان واحد"
        actions={<Btn v="g" size="sm" onClick={async () => { await api('/notifications/read-all', { method: 'PUT' }); toast('تم تعيين الكل كمقروء'); load(); }}>تعيين الكل كمقروء</Btn>} />
      {busy && <Skeleton n={5} />}
      {!busy && rows.length === 0 && <div className="card"><Empty icon="bell" title="لا توجد إشعارات" /></div>}
      <div className="space-y-2.5 anim-in">
        {rows.map(n => (
          <div key={n.id} className="card p-4 flex items-center gap-3" style={!n.is_read ? { borderRight: '4px solid var(--brand)' } : {}}>
            <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--bg2)', color: 'var(--brand)' }}><I n="bell" s={19} /></span>
            <div className="flex-1 min-w-0"><b className="text-[14px]">{n.title}</b><div className="text-[12.5px]" style={{ color: 'var(--ink2)' }}>{n.body}</div><div className="text-[11px] num" style={{ color: 'var(--ink3)' }}>{fmtDT(n.created_at)}</div></div>
            {n.link && <Btn v="g" size="xs" onClick={() => location.hash = '#' + n.link}>فتح</Btn>}
            {!n.is_read && <Btn v="g" size="xs" onClick={async () => { await api(`/notifications/${n.id}/read`, { method: 'PUT' }); load(); }}>مقروء</Btn>}
            <button className="icon-btn" onClick={async () => { await api('/notifications/' + n.id, { method: 'DELETE' }); load(); }}><I n="trash" s={16} /></button>
          </div>
        ))}
      </div>
      <Pagination page={page} pages={Math.ceil(total / 20)} total={total} onGo={setPage} />
    </>
  );
}
