import React, { useEffect, useState, lazy, Suspense } from 'react';
import { api, getToken } from './lib/api.js';
import { useStore } from './lib/store.js';
import { Toasts, NoPerm } from './components/ui.jsx';
import ErrorBoundary, { installGlobalHandlers } from './components/ErrorBoundary.jsx';
import Layout from './components/Layout.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import Assistant from './components/Assistant.jsx';
import ForcePasswordChange from './components/ForcePasswordChange.jsx';
import Login from './pages/Login.jsx';

// تحميل كسول مع إعادة محاولة تلقائية عند فشل تحميل الـ chunk (تحديث نسخة أثناء التشغيل)
function lazyRetry(factory) {
  return lazy(() => factory().catch((e) => {
    const k = 'ss_chunk_retry';
    if (!sessionStorage.getItem(k)) {
      sessionStorage.setItem(k, '1');
      location.reload();
      return new Promise(() => {});
    }
    sessionStorage.removeItem(k);
    throw e;
  }));
}
const Dashboard = lazyRetry(() => import('./pages/Dashboard.jsx'));
const Tasks = lazyRetry(() => import('./pages/Tasks.jsx'));
const Calendar = lazyRetry(() => import('./pages/Calendar.jsx'));
const Clients = lazyRetry(() => import('./pages/Clients.jsx'));
const Calls = lazyRetry(() => import('./pages/Calls.jsx'));
const Notes = lazyRetry(() => import('./pages/Notes.jsx'));
const Files = lazyRetry(() => import('./pages/Files.jsx'));
const Projects = lazyRetry(() => import('./pages/Projects.jsx'));
const Reservations = lazyRetry(() => import('./pages/Reservations.jsx'));
const Sales = lazyRetry(() => import('./pages/Sales.jsx'));
const Brokers = lazyRetry(() => import('./pages/Brokers.jsx'));
const Reports = lazyRetry(() => import('./pages/Reports.jsx'));
const Quotations = lazyRetry(() => import('./pages/Quotations.jsx'));
const Contracts = lazyRetry(() => import('./pages/Contracts.jsx'));
const Schedule = lazyRetry(() => import('./pages/Schedule.jsx'));
const Accounts = lazyRetry(() => import('./pages/Accounts.jsx'));
const Payments = lazyRetry(() => import('./pages/Payments.jsx'));
const Expenses = lazyRetry(() => import('./pages/Expenses.jsx'));
const Commissions = lazyRetry(() => import('./pages/Commissions.jsx'));
const Statements = lazyRetry(() => import('./pages/Statements.jsx'));
const Approvals = lazyRetry(() => import('./pages/Approvals.jsx'));
const Interests = lazyRetry(() => import('./pages/Interests.jsx'));
const Pipeline = lazyRetry(() => import('./pages/Pipeline.jsx'));
const Communications = lazyRetry(() => import('./pages/Communications.jsx'));
const Notifications = lazyRetry(() => import('./pages/Notifications.jsx'));
const Users = lazyRetry(() => import('./pages/Admin.jsx').then(m => ({ default: m.Users })));
const Roles = lazyRetry(() => import('./pages/Admin.jsx').then(m => ({ default: m.Roles })));
const Audit = lazyRetry(() => import('./pages/Admin.jsx').then(m => ({ default: m.Audit })));
const AIPermissions = lazyRetry(() => import('./pages/Admin.jsx').then(m => ({ default: m.AIPermissions })));
const Settings = lazyRetry(() => import('./pages/Settings.jsx').then(m => ({ default: m.Settings })));
const Backup = lazyRetry(() => import('./pages/Settings.jsx').then(m => ({ default: m.Backup })));
const PageLoader = () => (<div className="space-y-3 pt-2 anim-in"><div className="skel" style={{ height: 120 }} /><div className="skel" style={{ height: 220 }} /></div>);

const ROUTES = {
  dashboard: { c: Dashboard, m: 'dashboard' },
  tasks: { c: Tasks, m: 'tasks' },
  appointments: { c: Calendar, m: 'appointments' },
  clients: { c: Clients, m: 'clients' },
  calls: { c: Calls, m: 'calls' },
  notes: { c: Notes, m: 'notes' },
  files: { c: Files, m: 'files' },
  projects: { c: Projects, m: 'projects' },
  reservations: { c: Reservations, m: 'reservations' },
  sales: { c: Sales, m: 'sales' },
  brokers: { c: Brokers, m: 'brokers' },
  quotations: { c: Quotations, m: 'quotations' },
  contracts: { c: Contracts, m: 'contracts' },
  schedule: { c: Schedule, m: 'schedule' },
  accounts: { c: Accounts, m: 'accounts' },
  payments: { c: Payments, m: 'finance' },
  expenses: { c: Expenses, m: 'expenses' },
  commissions: { c: Commissions, m: 'commissions' },
  statements: { c: Statements, m: 'statements' },
  approvals: { c: Approvals, m: 'approvals' },
  interests: { c: Interests, m: 'interests' },
  pipeline: { c: Pipeline, m: 'pipeline' },
  communications: { c: Communications, m: 'communications' },
  reports: { c: Reports, m: 'reports' },
  notifications: { c: Notifications, m: 'notifications' },
  users: { c: Users, m: 'users' },
  roles: { c: Roles, m: 'roles' },
  ai_permissions: { c: AIPermissions, m: 'roles' },
  audit: { c: Audit, m: 'audit' },
  settings: { c: Settings, m: 'settings' },
  backup: { c: Backup, m: 'backup' },
};

function Maintenance() {
  const { maintenanceMsg, setMaintenance, user } = useStore();
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="card p-8 text-center anim-in" style={{ maxWidth: 460 }}>
        <div className="text-[42px]">🛠️</div>
        <div className="font-bold text-[17px] mt-2">وضع الصيانة مفعّل</div>
        <div className="text-[13px] mt-2 leading-6" style={{ color: 'var(--ink2)' }}>{maintenanceMsg || 'النظام قيد الصيانة حاليًا — يرجى المحاولة بعد قليل.'}</div>
        {!user && <div className="text-[12px] mt-2" style={{ color: 'var(--ink2)' }}>يمكن للمدير تسجيل الدخول أثناء الصيانة.</div>}
        <div className="flex gap-2 justify-center mt-5">
          <button className="btn" onClick={() => { setMaintenance(false); location.reload(); }}>إعادة المحاولة</button>
          {!user && <button className="btn g" onClick={() => setMaintenance(false)}>دخول الإدارة</button>}
        </div>
      </div>
    </div>
  );
}

function BootError({ onRetry }) {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="card p-8 text-center anim-in" style={{ maxWidth: 440 }}>
        <div className="text-[42px]">📡</div>
        <div className="font-bold text-[16px] mt-2">تعذر الاتصال بالخادم</div>
        <div className="text-[13px] mt-2 leading-6" style={{ color: 'var(--ink2)' }}>تأكد من تشغيل البرنامج والشبكة ثم أعد المحاولة.</div>
        <button className="btn mt-5" onClick={onRetry}>إعادة المحاولة</button>
      </div>
    </div>
  );
}

export default function App() {
  const { user, setAuth, setCompany, toasts, setOnline, can, toast, maintenance } = useStore();
  const [route, setRoute] = useState(() => (location.hash || '#/dashboard').replace('#/', ''));
  const [ready, setReady] = useState(false);
  const [bootFail, setBootFail] = useState(false);
  const [bootTick, setBootTick] = useState(0);

  useEffect(() => {
    const f = () => setRoute((location.hash || '#/dashboard').replace('#/', ''));
    window.addEventListener('hashchange', f);
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    installGlobalHandlers((m, t) => useStore.getState().toast(m, t));
    // Ctrl+K يفتح لوحة الأوامر / البحث الشامل
    const kb = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); useStore.getState().setPalette(true); }
    };
    window.addEventListener('keydown', kb);
    return () => { window.removeEventListener('hashchange', f); window.removeEventListener('online', on); window.removeEventListener('offline', on); window.removeEventListener('keydown', kb); };
  }, []);

  useEffect(() => {
    let alive = true;
    setReady(false); setBootFail(false);
    (async () => {
      if (!getToken()) { if (alive) setReady(true); return; }
      try {
        const me = await api('/auth/me', { timeout: 15000 });
        if (!alive) return;
        setAuth(me.user, me.perms);
        try {
          const b = await api('/brand/public');
          setCompany({ company_name: b.company_name, currency: b.currency, logo: b.logo, tagline: b.tagline, footer: b.footer });
          if (b.primary) document.documentElement.style.setProperty('--brand', b.primary);
        } catch { try { setCompany(await api('/settings/public')); } catch {} }
        setReady(true);
      } catch (e) {
        if (!alive) return;
        // 401 يعالجها api.js (تحويل للدخول) — أي فشل آخر = شاشة خطأ مع إعادة
        if (!getToken()) setReady(true);
        else { setBootFail(true); setReady(true); }
      }
    })();
    return () => { alive = false; };
  }, [bootTick]);

  if (!ready) return <div className="h-full flex items-center justify-center"><div className="text-center"><div className="skel mx-auto" style={{ width: 64, height: 64, borderRadius: 18 }} /><div className="mt-3 font-bold">Smart Secretary</div><div className="text-[12px] mt-1" style={{ color: 'var(--ink2)' }}>جارٍ التحميل…</div></div></div>;
  if (bootFail && getToken()) return <><BootError onRetry={() => setBootTick(t => t + 1)} /><Toasts toasts={toasts} /></>;
  if (maintenance) return <><Maintenance /><Toasts toasts={toasts} /></>;
  if (!user) return <><Login onDone={() => location.hash = '#/dashboard'} /><Toasts toasts={toasts} /></>;
  // تغيير كلمة المرور الأولية إلزامي قبل أي استخدام (الخادم يرفض الباقي بـ 403)
  if (user.must_change_password) return <><ForcePasswordChange /><Toasts toasts={toasts} /></>;
  if (route === 'login') { location.hash = '#/dashboard'; return null; }

  const R = ROUTES[route];
  const Page = R?.c;
  const allowed = R ? can(R.m) : false;

  return (
    <ErrorBoundary title="تعذر عرض التطبيق">
      <Layout route={route}>
        {!R && <div className="card p-10 text-center"><b>الصفحة غير موجودة</b></div>}
        {R && !allowed && <NoPerm />}
        {R && allowed && (
          <ErrorBoundary key={route} title="تعذر عرض هذه الصفحة" compact>
            <Suspense fallback={<PageLoader />}>
              <Page />
            </Suspense>
          </ErrorBoundary>
        )}
      </Layout>
      <CommandPalette />
      <Assistant />
      <Toasts toasts={toasts} />
    </ErrorBoundary>
  );
}
