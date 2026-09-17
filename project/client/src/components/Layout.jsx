import React, { useEffect, useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { arDate, fmtDT } from '../lib/format.js';
import { I, Avatar, Badge } from './ui.jsx';

const NAV = [
  { sec: 'الرئيسية' },
  { k: 'dashboard', t: 'لوحة القيادة', icon: 'dash', m: 'dashboard' },
  { sec: 'العمل اليومي' },
  { k: 'tasks', t: 'المهام', icon: 'check', m: 'tasks' },
  { k: 'appointments', t: 'المواعيد', icon: 'cal', m: 'appointments' },
  { k: 'clients', t: 'العملاء', icon: 'users', m: 'clients' },
  { k: 'interests', t: 'اهتمامات العملاء', icon: 'target', m: 'interests' },
  { k: 'pipeline', t: 'مسار البيع', icon: 'flow', m: 'pipeline' },
  { k: 'communications', t: 'سجل التواصل والمتابعات', icon: 'chat', m: 'communications' },
  { k: 'calls', t: 'الاتصالات', icon: 'phone', m: 'calls' },
  { k: 'notes', t: 'الملاحظات', icon: 'note', m: 'notes' },
  { k: 'files', t: 'الملفات', icon: 'folder', m: 'files' },
  { sec: 'العقارات والمالية' },
  { k: 'projects', t: 'المشاريع والوحدات', icon: 'bldg', m: 'projects' },
  { k: 'reservations', t: 'الحجوزات', icon: 'key', m: 'reservations' },
  { k: 'quotations', t: 'عروض الأسعار', icon: 'clip', m: 'quotations' },
  { k: 'contracts', t: 'العقود', icon: 'file', m: 'contracts' },
  { k: 'sales', t: 'المبيعات', icon: 'wallet', m: 'sales' },
  { k: 'schedule', t: 'جدول الأقساط', icon: 'cal', m: 'schedule' },
  { k: 'accounts', t: 'الحسابات المالية', icon: 'bank', m: 'accounts' },
  { k: 'payments', t: 'الدفعات والمقبوضات', icon: 'receipt', m: 'finance' },
  { k: 'expenses', t: 'المصروفات', icon: 'receipt', m: 'expenses' },
  { k: 'commissions', t: 'عمولات المسوقين', icon: 'percent', m: 'commissions' },
  { k: 'brokers', t: 'المسوقون', icon: 'briefcase', m: 'brokers' },
  { k: 'statements', t: 'كشوف الحسابات', icon: 'scale', m: 'statements' },
  { sec: 'الإدارة' },
  { k: 'approvals', t: 'الموافقات والطلبات', icon: 'clip', m: 'approvals' },
  { k: 'reports', t: 'التقارير', icon: 'chart', m: 'reports' },
  { k: 'users', t: 'المستخدمون', icon: 'user', m: 'users' },
  { k: 'roles', t: 'الأدوار والصلاحيات', icon: 'shield', m: 'roles' },
  { k: 'audit', t: 'سجل العمليات', icon: 'hist', m: 'audit' },
  { k: 'settings', t: 'الإعدادات', icon: 'gear', m: 'settings' },
  { k: 'backup', t: 'النسخ الاحتياطي', icon: 'db', m: 'backup' },
];

export function go(route) { location.hash = '#/' + route; }

export default function Layout({ route, children }) {
  const { user, can, theme, toggleTheme, setPalette, setAssistant, sidebar, setSidebar, online, notifTick, company } = useStore();
  const [notifs, setNotifs] = useState({ data: [], unread: 0 });
  const [showN, setShowN] = useState(false);
  const [showU, setShowU] = useState(false);
  const [projects, setProjects] = useState([]);
  const { project, setProject } = useStore();
  const [clock, setClock] = useState(new Date());

  useEffect(() => { const t = setInterval(() => setClock(new Date()), 15000); return () => clearInterval(t); }, []);
  useEffect(() => {
    api('/notifications' + q({ limit: 8 })).then(setNotifs).catch(() => {});
  }, [notifTick, route]);
  useEffect(() => {
    if (can('projects')) api('/projects' + q({ limit: 50 })).then(r => setProjects(r.data || [])).catch(() => {});
  }, []);

  const logout = async () => { try { await api('/auth/logout', { method: 'POST' }); } catch {} location.hash = '#/login'; location.reload(); };
  const readAll = async () => { await api('/notifications/read-all', { method: 'PUT' }).catch(() => {}); setNotifs(n => ({ ...n, unread: 0, data: n.data.map(x => ({ ...x, is_read: 1 })) })); };

  return (
    <div className="app-shell h-full flex">
      {/* الشريط الجانبي */}
      {sidebar && (
        <aside className="w-[248px] shrink-0 flex flex-col no-print" style={{ background: 'var(--card)', borderLeft: '1px solid var(--line)' }}>
          <div className="px-5 pt-5 pb-4 flex items-center gap-3 cursor-pointer" onClick={() => go('dashboard')}>
            {company.logo ? <img src={company.logo} alt="" className="w-11 h-11 rounded-2xl object-contain shadow" style={{ background: '#fff' }} /> : <span className="w-11 h-11 rounded-2xl grad-bg flex items-center justify-center text-white shadow-lg"><I n="spark" s={23} /></span>}
            <div>
              <div className="font-bold text-[16px] leading-5">Smart Secretary</div>
              <div className="text-[11.5px]" style={{ color: 'var(--ink3)' }}>{company.company_name || 'سكرتير ذكي'}</div>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-0.5">
            {NAV.map((n, i) => n.sec
              ? <div key={i} className="text-[11px] font-bold px-3 pt-4 pb-1.5" style={{ color: 'var(--ink3)' }}>{n.sec}</div>
              : can(n.m) && (
                <div key={n.k} className={`nav-it ${route === n.k ? 'on' : ''}`} onClick={() => go(n.k)}>
                  <I n={n.icon} s={19} />
                  <span className="text-[13.5px]">{n.t}</span>
                </div>
              ))}
          </nav>
          <div className="p-3" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="rounded-xl p-3 flex items-center gap-2.5" style={{ background: 'linear-gradient(135deg, rgba(29,97,245,.1), rgba(124,58,237,.08))' }}>
              <span className="dot-live" />
              <div className="text-[12px]"><b>النظام يعمل</b><br /><span style={{ color: 'var(--ink2)' }}>متصل محليًا — آمن</span></div>
            </div>
          </div>
        </aside>
      )}

      {/* المحتوى */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-2.5 px-5 py-3 no-print" style={{ background: 'var(--card)', borderBottom: '1px solid var(--line)' }}>
          <button className="icon-btn" onClick={() => setSidebar()} title="القائمة"><I n="menu" s={19} /></button>
          <div className="hidden md:block">
            <div className="text-[13px] font-semibold">{arDate()}</div>
            <div className="text-[11.5px] num" style={{ color: 'var(--ink3)' }}>{clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
          <div className="flex-1" />
          {/* مبدل المشاريع */}
          {can('projects') && projects.length > 0 && (
            <select className="inp hidden lg:block" style={{ width: 190 }} value={project} onChange={e => setProject(e.target.value)} title="المشروع الحالي">
              <option value="">كل المشاريع</option>
              {projects.map(p => <option key={p.id} value={p.id}>مشروع {p.code} — {p.name}</option>)}
            </select>
          )}
          <button className="inp hidden sm:flex items-center gap-2 cursor-pointer" style={{ width: 250 }} onClick={() => setPalette(true)}>
            <I n="search" s={16} c="" /><span style={{ color: 'var(--ink3)' }} className="text-[13px]">بحث سريع...</span>
            <kbd className="mr-auto text-[11px] px-1.5 py-0.5 rounded-md num" style={{ background: 'var(--bg2)', color: 'var(--ink3)' }}>Ctrl K</kbd>
          </button>
          <button className="icon-btn sm:hidden" onClick={() => setPalette(true)}><I n="search" s={19} /></button>
          <button className="icon-btn" onClick={toggleTheme} title={theme === 'light' ? 'الوضع الداكن' : 'الوضع الفاتح'}><I n={theme === 'light' ? 'moon' : 'sun'} s={19} /></button>
          <button className="icon-btn grad-bg !text-white" onClick={() => setAssistant(true)} title="المساعد الذكي"><I n="bot" s={19} /></button>
          {/* الإشعارات */}
          <div className="relative">
            <button className="icon-btn" onClick={() => { setShowN(!showN); setShowU(false); }} title="الإشعارات">
              <I n="bell" s={19} />
              {notifs.unread > 0 && <span className="absolute top-0.5 left-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center num" style={{ background: 'var(--danger)' }}>{notifs.unread}</span>}
            </button>
            {showN && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowN(false)} />
                <div className="card anim-pop absolute left-0 top-11 w-[340px] z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
                    <b className="text-[14px]">الإشعارات {notifs.unread > 0 && <Badge c="b-red">{notifs.unread} جديد</Badge>}</b>
                    <button className="text-[12px] font-semibold" style={{ color: 'var(--brand)' }} onClick={readAll}>تعيين كمقروء</button>
                  </div>
                  <div className="max-h-[380px] overflow-y-auto">
                    {notifs.data.length === 0 && <div className="p-6 text-center text-[13px]" style={{ color: 'var(--ink3)' }}>لا توجد إشعارات</div>}
                    {notifs.data.map(n => (
                      <div key={n.id} className="px-4 py-3 flex gap-2.5 cursor-pointer hover:opacity-80" style={{ borderBottom: '1px solid var(--line)', background: n.is_read ? 'transparent' : 'rgba(29,97,245,.05)' }}
                        onClick={() => { api(`/notifications/${n.id}/read`, { method: 'PUT' }).catch(() => {}); setShowN(false); if (n.link) location.hash = '#' + n.link; }}>
                        <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--bg2)', color: 'var(--brand)' }}><I n={n.type === 'task' ? 'check' : n.type === 'appointment' ? 'cal' : n.type === 'warning' ? 'alert' : 'bell'} s={17} /></span>
                        <div className="min-w-0"><div className="text-[13px] font-semibold">{n.title}</div><div className="text-[12px] truncate" style={{ color: 'var(--ink2)' }}>{n.body}</div><div className="text-[11px] num" style={{ color: 'var(--ink3)' }}>{fmtDT(n.created_at)}</div></div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          {/* الحساب */}
          <div className="relative">
            <button className="flex items-center gap-2 rounded-xl px-2 py-1 hover:opacity-80" onClick={() => { setShowU(!showU); setShowN(false); }}>
              <Avatar name={user?.name} />
              <span className="hidden xl:block text-right"><span className="block text-[13px] font-bold leading-4">{user?.name}</span><span className="text-[11.5px]" style={{ color: 'var(--ink3)' }}>{user?.role_ar}</span></span>
            </button>
            {showU && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowU(false)} />
                <div className="card anim-pop absolute left-0 top-11 w-[230px] z-50 p-2">
                  <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--line)' }}><b className="text-[13.5px]">{user?.name}</b><div className="text-[12px]" style={{ color: 'var(--ink3)' }}>{user?.username} — {user?.role_ar}</div></div>
                  <div className="nav-it" onClick={() => { setShowU(false); go('settings'); }}><I n="gear" s={17} /><span className="text-[13px]">الإعدادات</span></div>
                  <div className="nav-it" onClick={logout} style={{ color: 'var(--danger)' }}><I n="out" s={17} /><span className="text-[13px]">تسجيل الخروج</span></div>
                </div>
              </>
            )}
          </div>
        </header>
        {!online && <div className="px-5 py-2 text-[13px] font-semibold text-center no-print" style={{ background: 'rgba(217,119,6,.15)', color: 'var(--warn)' }}>انقطع الاتصال — النظام يعمل محليًا وسيُستأنف المزامنة تلقائيًا</div>}
        <main className="flex-1 overflow-y-auto p-5" style={{ background: 'var(--bg)' }}>
          <div className="mx-auto" style={{ maxWidth: 1280 }}>{children}</div>
        </main>
      </div>
    </div>
  );
}
