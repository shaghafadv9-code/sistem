import React, { useEffect, useState } from 'react';
import { api, setToken } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { I, Btn } from '../components/ui.jsx';

export default function Login({ onDone }) {
  const [brand, setBrand] = useState(null);
  useEffect(() => {
    // لا تُعرض أي بيانات دخول داخل الواجهة — يُجلب فقط وضع الديمو لعرض تنبيه
    Promise.all([
      fetch('/api/brand/public').then(r => r.json()).catch(() => ({})),
      fetch('/api/settings/public').then(r => r.ok ? r.json() : {}).catch(() => ({}))
    ]).then(([b, s]) => setBrand({ ...(b || {}), demo_mode_enabled: !!(s && s.demo_mode_enabled) }));
  }, []);
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useStore(s => s.toast);

  const submit = async (e) => {
    e?.preventDefault();
    if (!u || !p) { setErr('أدخل اسم المستخدم وكلمة المرور'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username: u.trim(), password: p } });
      setToken(r.token);
      const me = await api('/auth/me');
      useStore.getState().setAuth(me.user, me.perms);
      try { const c = await api('/settings/public'); useStore.getState().setCompany(c); } catch {}
      toast(`مرحبًا ${me.user.name}`);
      onDone();
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  };

  return (
    <div className="h-full flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg,#0f1b3d,#1d2a5e 45%,#3b1d6e)' }}>
      <div className="anim-pop w-full flex overflow-hidden rounded-3xl shadow-2xl" style={{ maxWidth: 880, background: 'var(--card)' }}>
        <div className="hidden md:flex flex-col justify-between p-8 text-white w-[46%]" style={{ background: 'linear-gradient(150deg,#1d61f5,#7c3aed)' }}>
          <div className="flex items-center gap-2.5">
            {brand?.logo ? <img src={brand.logo} alt="" className="w-11 h-11 rounded-2xl object-contain" style={{ background: '#fff' }} /> : <span className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center"><I n="spark" s={24} /></span>}
            <div><b className="text-[18px] block leading-6">{brand?.company_name || 'Smart Secretary'}</b>{brand?.tagline && <span className="text-[12px] opacity-80">{brand.tagline}</span>}</div>
          </div>
          <div>
            <h2 className="text-[26px] font-bold leading-10">نظام السكرتارية<br />والإدارة الذكية</h2>
            <p className="opacity-85 mt-2 text-[14px]">مهام • مواعيد • عملاء • حجوزات • مالية • تقارير — كل أعمالك في مكان واحد.</p>
            <div className="flex gap-2 mt-5 flex-wrap">
              {['آمن ومحلي', 'سريع', 'عربي RTL', 'تقارير PDF'].map(f => <span key={f} className="text-[12px] px-3 py-1.5 rounded-full bg-white/20 font-semibold">{f}</span>)}
            </div>
          </div>
          <div className="text-[12px] opacity-70">الإصدار 1.0 — نسخة الإنتاج</div>
        </div>
        <form className="flex-1 p-8" onSubmit={submit}>
          <h1 className="text-[22px] font-bold">تسجيل الدخول</h1>
          <p className="text-[13px] mt-1 mb-6" style={{ color: 'var(--ink2)' }}>مرحبًا بعودتك — أدخل بياناتك للمتابعة</p>
          {err && <div className="rounded-xl px-4 py-2.5 mb-4 text-[13px] font-semibold" style={{ background: 'rgba(220,38,38,.1)', color: 'var(--danger)' }}>{err}</div>}
          <label className="block mb-4"><span className="block text-[12.5px] font-semibold mb-1.5" style={{ color: 'var(--ink2)' }}>اسم المستخدم</span>
            <input className="inp" autoFocus value={u} onChange={e => setU(e.target.value)} placeholder="مثال: admin" /></label>
          <label className="block mb-5"><span className="block text-[12.5px] font-semibold mb-1.5" style={{ color: 'var(--ink2)' }}>كلمة المرور</span>
            <input className="inp" type="password" value={p} onChange={e => setP(e.target.value)} placeholder="••••••••" /></label>
          <Btn className="w-full !py-3" disabled={busy}>{busy ? 'جارٍ التحقق...' : 'دخول'} <I n="out" s={16} /></Btn>
          {brand?.demo_mode_enabled && (
            <div className="mt-5 rounded-xl p-3 text-[12px] leading-6" style={{ background: 'rgba(245,158,11,.12)', color: 'var(--ink2)' }}>
              <b>وضع البيانات التجريبية مفعّل</b> — تُعرض حسابات الديمو المعروفة في هذه الحالة فقط.
              أوقفه من الإعدادات قبل الاستخدام الفعلي.
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
