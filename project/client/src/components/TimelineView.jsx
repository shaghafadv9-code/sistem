import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtDT } from '../lib/format.js';
import { I } from './ui.jsx';

const ICONS = { sale: 'wallet', reservation: 'key', payment: 'money', invoice: 'file', call: 'phone', appointment: 'cal', note: 'note', file: 'folder', task: 'check', info: 'spark' };

// خط زمني عام — url يرجع { events: [{date, kind, title, sub}] }
export default function TimelineView({ url, title = 'السجل الزمني' }) {
  const [ev, setEv] = useState(null);
  useEffect(() => { setEv(null); api(url).then(r => setEv(r.events || [])).catch(() => setEv([])); }, [url]);
  return (
    <div>
      <b className="text-[14px]">{title}</b>
      <div className="mt-3">
        {ev === null && <div className="skel" style={{ height: 90 }} />}
        {ev !== null && ev.length === 0 && <div className="text-[12.5px]" style={{ color: 'var(--ink3)' }}>لا توجد أحداث مسجلة بعد</div>}
        {ev !== null && ev.map((t, i) => (
          <div key={i} className="flex gap-3 pb-4 relative">
            {i < ev.length - 1 && <span className="absolute right-[15px] top-8 bottom-0 w-0.5" style={{ background: 'var(--line)' }} />}
            <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10" style={{ background: 'var(--bg2)', color: 'var(--brand)' }}>
              <I n={ICONS[t.kind] || 'spark'} s={15} />
            </span>
            <div className="flex-1 rounded-xl p-2.5 min-w-0" style={{ background: 'var(--card2)' }}>
              <div className="text-[13px] font-bold">{t.title}</div>
              {t.sub && <div className="text-[12px]" style={{ color: 'var(--ink2)' }}>{t.sub}</div>}
              <div className="text-[11.5px] num" style={{ color: 'var(--ink3)' }}>{fmtDT(t.date)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
