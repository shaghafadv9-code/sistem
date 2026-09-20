import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { I, Btn } from './ui.jsx';

/**
 * نافذة إجبارية لتغيير كلمة المرور الأولية (أول تشغيل).
 * الخادم يرفض كل الطلبات الأخرى بـ 403 + must_change_password حتى يتم التغيير.
 */
export default function ForcePasswordChange() {
  const toast = useStore(s => s.toast);
  const setAuth = useStore(s => s.setAuth);
  const user = useStore(s => s.user);
  const perms = useStore(s => s.perms);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const strength = (() => {
    let n = 0;
    if (next.length >= 10) n++;
    if (/[a-z]/.test(next) && /[A-Z]/.test(next)) n++;
    if (/\d/.test(next)) n++;
    if (/[^A-Za-z0-9]/.test(next)) n++;
    return n;
  })();

  const submit = async (e) => {
    e?.preventDefault();
    setErr('');
    if (!cur || !next) { setErr('أدخل كلمة المرور الحالية والجديدة'); return; }
    if (next !== again) { setErr('كلمتا المرور الجديدتان غير متطابقتين'); return; }
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { current: cur, next } });
      const me = await api('/auth/me');
      setAuth(me.user, me.perms);
      toast('تم تغيير كلمة المرور — يمكنك الآن استخدام النظام');
    } catch (e2) { setErr(e2.message || 'تعذر تغيير كلمة المرور'); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4" style={{ background: 'rgba(8,12,30,.72)' }}>
      <form onSubmit={submit} className="anim-pop w-full rounded-3xl p-7 shadow-2xl" style={{ maxWidth: 460, background: 'var(--card)' }}>
        <div className="flex items-center gap-3 mb-2">
          <span className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(245,158,11,.15)', color: '#d97706' }}><I n="lock" s={22} /></span>
          <div>
            <h2 className="text-[19px] font-bold leading-7">تغيير كلمة المرور إلزامي</h2>
            <p className="text-[12.5px]" style={{ color: 'var(--ink2)' }}>هذا حساب أولي — يجب ضبط كلمة مرور خاصة بك قبل المتابعة.</p>
          </div>
        </div>

        {err && <div className="rounded-xl px-4 py-2.5 my-3 text-[13px] font-semibold" style={{ background: 'rgba(220,38,38,.1)', color: 'var(--danger)' }}>{err}</div>}

        <label className="block mb-3 mt-4"><span className="block text-[12.5px] font-semibold mb-1.5" style={{ color: 'var(--ink2)' }}>كلمة المرور الحالية</span>
          <input className="inp" type="password" value={cur} onChange={e => setCur(e.target.value)} autoFocus placeholder="المطبوعة عند أول تشغيل" /></label>

        <label className="block mb-3"><span className="block text-[12.5px] font-semibold mb-1.5" style={{ color: 'var(--ink2)' }}>كلمة المرور الجديدة</span>
          <input className="inp" type="password" value={next} onChange={e => setNext(e.target.value)} placeholder="10 أحرف على الأقل" /></label>

        <div className="flex gap-1.5 mb-3">
          {[0, 1, 2, 3].map(i => (
            <span key={i} className="h-1.5 flex-1 rounded-full transition-all"
              style={{ background: i < strength ? (strength <= 2 ? '#f59e0b' : '#16a34a') : 'var(--line)' }} />
          ))}
        </div>
        <ul className="text-[11.5px] leading-5 mb-3 space-y-0.5" style={{ color: 'var(--ink3)' }}>
          <li>• 10 أحرف على الأقل</li>
          <li>• فئتان على الأقل: حروف كبيرة/صغيرة، أرقام، رموز</li>
          <li>• ممنوع: الكلمات الشائعة، اسم المستخدم، التسلسلات، حرف مكرر</li>
        </ul>

        <label className="block mb-5"><span className="block text-[12.5px] font-semibold mb-1.5" style={{ color: 'var(--ink2)' }}>تأكيد كلمة المرور الجديدة</span>
          <input className="inp" type="password" value={again} onChange={e => setAgain(e.target.value)} placeholder="أعد كتابتها" /></label>

        <Btn className="w-full !py-3" disabled={busy || strength < 2 || next !== again}>
          {busy ? 'جارٍ الحفظ...' : 'حفظ ومتابعة'} <I n="out" s={16} />
        </Btn>
        <p className="text-[11.5px] mt-3 text-center" style={{ color: 'var(--ink3)' }}>
          المستخدم: <b className="num">{user?.username}</b>
        </p>
      </form>
    </div>
  );
}
