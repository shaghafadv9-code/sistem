import React, { useEffect, useState } from 'react';

// ---------- أيقونات SVG ----------
const P = {
  dash: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  check: 'M9 12l2 2 4-5M12 3l7 4v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V7l7-4z',
  cal: 'M8 3v4M16 3v4M4 9h16M6 5h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2z',
  users: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.87M15.5 3.13a3.5 3.5 0 010 6.74',
  user: 'M19 19v-1a4 4 0 00-4-4H9a4 4 0 00-4 4v1M12 11a4 4 0 100-8 4 4 0 000 8z',
  phone: 'M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 2 .7 2.8a2 2 0 01-.5 2.1L8 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.3 1.9.6 2.8.7a2 2 0 011.8 2z',
  note: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z',
  file: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8M10.3 21a2 2 0 003.4 0',
  shield: 'M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10zM9 12l2 2 4-4',
  hist: 'M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 7M3 3v4h4M12 7v5l3 2',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5h0a1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  chart: 'M3 3v18h18M8 17V9M13 17V5M18 17v-6',
  bldg: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1',
  home: 'M3 10.5L12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 11-7.8 7.8 5.5 5.5 0 017.8-7.8zm0 0L19 3m-3 3l3 3',
  money: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
  db: 'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3zM3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3',
  bot: 'M12 8V4M8 4h8M9 13h.01M15 13h.01M10 16.5c.5.5 1.5.5 2 .5s1.5 0 2-.5M12 2a7 7 0 017 7v11a2 2 0 01-2 2H7a2 2 0 01-2-2V9a7 7 0 017-7z',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14', x: 'M18 6L6 18M6 6l12 12',
  edit: 'M17 3a2.8 2.8 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z',
  trash: 'M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6',
  eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  dl: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2',
  ul: 'M12 15V3m0 0L8 7m4-4l4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  out: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  chev: 'M9 18l6-6-6-6', chevD: 'M6 9l6 6 6-6',
  clock: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
  alert: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  pin: 'M12 17v5M9 3h6l1 7 3 3H5l3-3 1-7z',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  folder: 'M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v11z',
  tag: 'M20.6 13.4L11 3H4v7l9.6 10.4a2 2 0 002.8 0l4.2-4.2a2 2 0 000-2.8zM7 7h.01',
  link: 'M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2z',
  card: 'M2 5h20v14H2zM2 10h20', wallet: 'M20 7H4a2 2 0 010-4h14v4M20 7a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V5M18 14h.01',
  spark: 'M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9L19 15z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  kan: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM9 3v18M15 3v18',
  wifi: 'M5 12.9a10 10 0 0114 0M8.5 16.4a5 5 0 017 0M2 9.4a15 15 0 0120 0M12 20h.01',
  wifiOff: 'M1 1l22 22M8.5 16.4a5 5 0 017 0M2 9.4a15 15 0 0120 0M5 12.9a10 10 0 0114 0M12 20h.01',
  copy: 'M9 9h11v11H9zM5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1',
  filter: 'M22 3H2l8 9.5V19l4 2v-8.5L22 3z',
  play: 'M6 4l14 8-14 8V4z',
  briefcase: 'M4 7h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7zM8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M4 13h16',
  template: 'M4 4h16v16H4zM4 9h16M9 9v11',
  palette: 'M12 3a9 9 0 100 18c1.4 0 2-.8 2-2v-2c0-1.1.9-2 2-2h2a4.5 4.5 0 004.4-5.4C21.4 5.7 17 3 12 3zM8 13h.01M12 9h.01M16 11h.01',
  wrench: 'M14.7 6.3a4.5 4.5 0 00-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 006-6L14 12l-2-2 2.7-3.7z',
  coins: 'M9 14c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3zM3 8v8c0 1.66 4.03 3 9 3s9-1.34 9-3V8M12 3v3',
  receipt: 'M6 2h12v20l-3-2-3 2-3-2-3 2V2zM9 7h6M9 11h6M9 15h4',
  swap: 'M7 4l-4 4 4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  percent: 'M19 5L5 19M7.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM16.5 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  clip: 'M9 4h6v3H9zM8 5H6a2 2 0 00-2 2v13a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 12l2 2 4-4',
  target: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z',
  flow: 'M4 4h6v6H4zM14 14h6v6h-6zM10 7h4a2 2 0 012 2v5M7 10v4a2 2 0 002 2h5',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  chat: 'M21 12a8 8 0 01-8 8H8l-5 3 1.4-4.6A8 8 0 1121 12z',
  ban: 'M12 22a10 10 0 100-20 10 10 0 000 20zM5 5l14 14',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v9',
  ruler: 'M3 9l6-6 12 12-6 6L3 9zM7 8l1.5 1.5M10 5l1.5 1.5M11 12l1.5 1.5M14 9l1.5 1.5M15 16l1.5 1.5',
  bed: 'M3 18v-7a2 2 0 012-2h14a2 2 0 012 2v7M3 14h18M7 9V6h10v3',
  wallet2: 'M3 7h15a3 3 0 013 3v7a3 3 0 01-3 3H4a1 1 0 01-1-1V7zM3 7l12-3v3M16 13h.01',
  scale: 'M12 3v18M5 7h14M7 7l-3 7h6L7 7zM17 7l-3 7h6l-3-7z',
  bank: 'M3 10l9-6 9 6M5 10v9M9 10v9M15 10v9M19 10v9M3 19h18M12 4v2',
  heart: 'M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 000-7.8z',
};
export const I = ({ n, s = 18, c = '', w = 1.9 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" className={c}><path d={P[n] || P.dash} /></svg>
);

// ---------- عناصر ----------
export const Btn = ({ children, v = 'p', size = '', className = '', ...p }) => (
  <button className={`btn btn-${v} ${size === 'sm' ? 'btn-sm' : ''} ${size === 'xs' ? 'btn-xs' : ''} ${className}`} {...p}>{children}</button>
);
export const IconBtn = ({ title, ...p }) => <button className="icon-btn" title={title} {...p} />;
export const Badge = ({ c = 'b-gray', children }) => <span className={`badge ${c}`}>{children}</span>;
export const Avatar = ({ name = '?', s = 34 }) => {
  const hues = [210, 260, 160, 20, 330, 190, 280, 120];
  const h = hues[(name.charCodeAt(0) || 0) % hues.length];
  return <span className="inline-flex items-center justify-center rounded-full font-bold shrink-0" style={{ width: s, height: s, fontSize: s * 0.38, background: `linear-gradient(135deg,hsl(${h} 70% 55%),hsl(${h + 30} 70% 45%))`, color: '#fff' }}>{(name || '?').trim()[0]}</span>;
};
export const Field = ({ label, children, hint }) => (
  <label className="block">
    {label && <span className="block text-[12.5px] font-semibold mb-1.5" style={{ color: 'var(--ink2)' }}>{label}</span>}
    {children}
    {hint && <span className="block text-[11.5px] mt-1" style={{ color: 'var(--ink3)' }}>{hint}</span>}
  </label>
);
export const SearchInp = ({ value, onChange, ph = 'بحث...', className = '' }) => (
  <div className={`relative ${className}`}>
    <span className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink3)' }}><I n="search" s={17} /></span>
    <input className="inp pr-10" value={value} onChange={e => onChange(e.target.value)} placeholder={ph} />
  </div>
);
export const Empty = ({ icon = 'folder', title = 'لا توجد بيانات', sub = '', action }) => (
  <div className="flex flex-col items-center justify-center py-14 text-center anim-in">
    <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'var(--bg2)', color: 'var(--ink3)' }}><I n={icon} s={30} /></div>
    <div className="font-bold text-[15px]">{title}</div>
    {sub && <div className="text-[13px] mt-1" style={{ color: 'var(--ink2)' }}>{sub}</div>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
export const ErrBox = ({ msg, retry }) => (
  <div className="card p-8 text-center anim-in">
    <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-3" style={{ background: 'rgba(220,38,38,.1)', color: 'var(--danger)' }}><I n="alert" s={26} /></div>
    <div className="font-bold">{msg || 'حدث خطأ أثناء تحميل البيانات'}</div>
    {retry && <Btn v="g" size="sm" className="mt-4" onClick={retry}><I n="refresh" s={15} /> إعادة المحاولة</Btn>}
  </div>
);
export const Skeleton = ({ n = 4, h = 64 }) => (
  <div className="space-y-3">{Array.from({ length: n }).map((_, i) => <div key={i} className="skel" style={{ height: h }} />)}</div>
);
export const NoPerm = () => (
  <div className="card p-10 text-center anim-in">
    <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-3" style={{ background: 'rgba(217,119,6,.12)', color: 'var(--warn)' }}><I n="shield" s={26} /></div>
    <div className="font-bold text-[16px]">صلاحية مرفوضة</div>
    <div className="text-[13px] mt-1" style={{ color: 'var(--ink2)' }}>لا تملك إذن الوصول إلى هذه الصفحة — تواصل مع مدير النظام</div>
  </div>
);
export const PageHead = ({ title, sub, actions }) => (
  <div className="flex items-center justify-between gap-3 flex-wrap mb-5 anim-in">
    <div>
      <h1 className="text-[21px] font-bold">{title}</h1>
      {sub && <p className="text-[13px] mt-0.5" style={{ color: 'var(--ink2)' }}>{sub}</p>}
    </div>
    <div className="flex items-center gap-2 flex-wrap">{actions}</div>
  </div>
);
export const Pagination = ({ page, pages, total, onGo }) => {
  if (!pages || pages <= 1) return total ? <div className="text-[12px] mt-3" style={{ color: 'var(--ink3)' }}>إجمالي: {total}</div> : null;
  return (
    <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
      <div className="text-[12px]" style={{ color: 'var(--ink3)' }}>صفحة {page} من {pages} — إجمالي {total}</div>
      <div className="flex gap-1.5">
        <Btn v="g" size="sm" disabled={page <= 1} onClick={() => onGo(page - 1)}>السابق</Btn>
        <Btn v="g" size="sm" disabled={page >= pages} onClick={() => onGo(page + 1)}>التالي</Btn>
      </div>
    </div>
  );
};
export const Tabs = ({ tabs, val, onChange }) => (
  <div className="inline-flex gap-1 p-1 rounded-xl" style={{ background: 'var(--bg2)' }}>
    {tabs.map(t => <button key={t.k} className={`tab-it ${val === t.k ? 'on' : ''}`} onClick={() => onChange(t.k)}>{t.t}</button>)}
  </div>
);
export const Stat = ({ icon, label, value, sub, color = 'var(--brand)', onClick }) => (
  <div className={`card card-h p-4 flex items-center gap-3 ${onClick ? 'cursor-pointer' : ''}`} onClick={onClick}>
    <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}1a`, color }}><I n={icon} s={22} /></span>
    <div className="min-w-0">
      <div className="text-[12px]" style={{ color: 'var(--ink2)' }}>{label}</div>
      <div className="text-[20px] font-bold num leading-7">{value}</div>
      {sub && <div className="text-[11.5px]" style={{ color: 'var(--ink3)' }}>{sub}</div>}
    </div>
  </div>
);

// ---------- نافذة منبثقة ----------
export function Modal({ open, onClose, title, children, w = 560, actions }) {
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onClose?.();
    if (open) document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(10,15,30,.5)', backdropFilter: 'blur(3px)' }} onClick={onClose}>
      <div className="card anim-pop w-full overflow-hidden flex flex-col" style={{ maxWidth: w, maxHeight: '92vh' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="font-bold text-[15.5px]">{title}</div>
          <IconBtn onClick={onClose} title="إغلاق"><I n="x" s={18} /></IconBtn>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {actions && <div className="px-5 py-3.5 flex justify-start gap-2" style={{ borderTop: '1px solid var(--line)', background: 'var(--card2)' }}>{actions}</div>}
      </div>
    </div>
  );
}

// ---------- درج جانبي ----------
export function Drawer({ open, onClose, title, children, w = 420 }) {
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onClose?.();
    if (open) document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80]" style={{ background: 'rgba(10,15,30,.45)' }} onClick={onClose}>
      <div className="absolute top-0 bottom-0 left-0 anim-slide flex flex-col" style={{ width: Math.min(w, window.innerWidth - 32), background: 'var(--card)', boxShadow: 'var(--shadow-pop)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="font-bold text-[15px]">{title}</div>
          <IconBtn onClick={onClose} title="إغلاق"><I n="x" s={18} /></IconBtn>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

// ---------- تأكيد ----------
export function Confirm({ open, onClose, onOk, title = 'تأكيد العملية', msg = 'هل أنت متأكد؟', danger = true, okText = 'تأكيد' }) {
  return (
    <Modal open={open} onClose={onClose} title={title} w={420} actions={<><Btn v={danger ? 'd' : 'p'} onClick={onOk}>{okText}</Btn><Btn v="g" onClick={onClose}>تراجع</Btn></>}>
      <p className="text-[14px] leading-7">{msg}</p>
    </Modal>
  );
}

// ---------- تنبيهات ----------
export const Toasts = ({ toasts }) => (
  <div className="fixed bottom-5 left-5 z-[100] space-y-2 no-print" style={{ maxWidth: 360 }}>
    {toasts.map(t => (
      <div key={t.id} className="card anim-pop px-4 py-3 flex items-center gap-2.5 text-[13.5px] font-semibold" style={{ borderRight: `4px solid ${t.type === 'error' ? 'var(--danger)' : t.type === 'warn' ? 'var(--warn)' : 'var(--ok)'}` }}>
        <I n={t.type === 'error' ? 'alert' : 'check'} s={17} c="" />
        {t.msg}
      </div>
    ))}
  </div>
);
