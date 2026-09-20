import React, { useEffect, useRef, useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { I } from './ui.jsx';
import { go } from './Layout.jsx';

const ACTIONS = [
  { t: 'إضافة مهمة', k: 'tasks', icon: 'plus', act: 'new-task' },
  { t: 'مهام اليوم', k: 'tasks', icon: 'check', act: 'go', link: 'tasks' },
  { t: 'إضافة موعد', k: 'appointments', icon: 'plus', act: 'new-appt' },
  { t: 'مواعيد اليوم', k: 'appointments', icon: 'cal', act: 'go', link: 'appointments' },
  { t: 'إضافة عميل', k: 'clients', icon: 'plus', act: 'new-client' },
  { t: 'تسجيل اتصال', k: 'calls', icon: 'plus', act: 'new-call' },
  { t: 'إضافة ملاحظة', k: 'notes', icon: 'plus', act: 'new-note' },
  { t: 'رفع ملف', k: 'files', icon: 'ul', act: 'go', link: 'files' },
  { t: 'حجز وحدة', k: 'reservations', icon: 'key', act: 'go', link: 'reservations' },
  { t: 'إنشاء تقرير', k: 'reports', icon: 'chart', act: 'go', link: 'reports' },
  { t: 'فتح المساعد الذكي', k: 'assistant', icon: 'bot', act: 'assistant' },
  { t: 'الوسطاء والعمولات', k: 'brokers', icon: 'briefcase', act: 'go', link: 'brokers' },
  { t: 'سجل العمليات', k: 'audit', icon: 'hist', act: 'go', link: 'audit' },
];

export default function CommandPalette() {
  const { palette, setPalette, can } = useStore();
  const [text, setText] = useState('');
  const [groups, setGroups] = useState([]);
  const [sel, setSel] = useState(0);
  const inp = useRef();

  useEffect(() => {
    const f = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(!useStore.getState().palette); } };
    document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, []);
  useEffect(() => { if (palette) { setText(''); setGroups([]); setSel(0); setTimeout(() => inp.current?.focus(), 30); } }, [palette]);
  useEffect(() => {
    if (!palette || text.trim().length < 2) { setGroups([]); return; }
    const t = setTimeout(() => Promise.all([api('/search' + q({ q: text.trim() })).catch(() => ({ groups: [] })), api('/ops-search' + q({ q: text.trim() })).catch(() => ({ groups: [] }))]).then(([a, b]) => setGroups([...(a.groups || []), ...(b.groups || [])])), 220);
    return () => clearTimeout(t);
  }, [text, palette]);

  if (!palette) return null;
  const acts = ACTIONS.filter(a => can(a.k) && (!text || a.t.includes(text)));
  const flat = [...acts.map(a => ({ ...a, type: 'act' })), ...groups.flatMap(g => g.rows.map(r => ({ ...r, type: 'row', g: g.title, link: g.link })))];

  const run = (it) => {
    setPalette(false);
    if (!it) return;
    if (it.type === 'act') {
      if (it.act === 'go') go(it.link);
      else if (it.act === 'assistant') useStore.getState().setAssistant(true);
      else { sessionStorage.setItem('ss_quick', it.act); go(it.k); }
    } else go(it.link);
  };

  return (
    <div className="fixed inset-0 z-[90] flex justify-center pt-[12vh] px-4 no-print" style={{ background: 'rgba(10,15,30,.5)', backdropFilter: 'blur(3px)' }} onClick={() => setPalette(false)}>
      <div className="card anim-pop w-full overflow-hidden" style={{ maxWidth: 600, height: 'fit-content', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 py-3.5" style={{ borderBottom: '1px solid var(--line)' }}>
          <I n="search" s={19} />
          <input ref={inp} className="flex-1 bg-transparent outline-none text-[15px]" placeholder="ابحث عن عميل، مهمة، موعد، ملف... أو إجراء" value={text}
            onChange={e => { setText(e.target.value); setSel(0); }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, flat.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
              if (e.key === 'Enter') run(flat[sel]);
              if (e.key === 'Escape') setPalette(false);
            }} />
          <kbd className="text-[11px] px-1.5 py-0.5 rounded-md" style={{ background: 'var(--bg2)', color: 'var(--ink3)' }}>ESC</kbd>
        </div>
        <div className="overflow-y-auto p-2" style={{ maxHeight: '52vh' }}>
          {flat.length === 0 && <div className="p-6 text-center text-[13px]" style={{ color: 'var(--ink3)' }}>اكتب كلمتين على الأقل للبحث في كل النظام</div>}
          {acts.length > 0 && text.length < 2 && <div className="px-3 pt-2 pb-1 text-[11.5px] font-bold" style={{ color: 'var(--ink3)' }}>إجراءات سريعة</div>}
          {flat.map((it, i) => (
            <div key={i} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer" style={{ background: i === sel ? 'var(--bg2)' : 'transparent' }}
              onMouseEnter={() => setSel(i)} onClick={() => run(it)}>
              <span style={{ color: 'var(--brand)' }}><I n={it.icon || (it.type === 'act' ? 'spark' : 'chev')} s={17} /></span>
              <span className="text-[13.5px] font-semibold flex-1 truncate">{it.t || it.title}</span>
              <span className="text-[11.5px]" style={{ color: 'var(--ink3)' }}>{it.type === 'act' ? 'إجراء' : `${it.g} — ${it.sub || ''}`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
