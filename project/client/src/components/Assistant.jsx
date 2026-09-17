import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { I, Btn } from './ui.jsx';
import { go } from './Layout.jsx';

const SUGGEST = ['ما هي مهامي اليوم؟', 'ما هي المواعيد القادمة؟', 'اعرض الحجوزات الحالية', 'العملاء الذين يحتاجون متابعة', 'كم إجمالي المبيعات؟', 'ما الوحدات المتاحة؟'];

export default function Assistant() {
  const { assistant, setAssistant } = useStore();
  const [msgs, setMsgs] = useState([{ me: false, text: 'أهلًا بك! أنا مساعدك الذكي. اسألني عن مهامك، مواعيدك، الحجوزات، أو اطلب مني إنشاء مهمة.' }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [mode, setMode] = useState('...');
  const box = useRef();
  useEffect(() => { api('/ai/status').then(s => setMode(s.def ? `ذكي — ${s.def.model}` : 'محلي')).catch(() => setMode('محلي')); }, [assistant]);

  useEffect(() => { box.current?.scrollTo(0, 99999); }, [msgs, busy]);
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && setAssistant(false);
    if (assistant) document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, [assistant]);

  if (!assistant) return null;
  const send = async (t, confirm = false) => {
    const txt = (t ?? text).trim();
    if (!txt && !confirm) return;
    if (!confirm) setMsgs(m => [...m, { me: true, text: txt }]);
    setText(''); setBusy(true);
    try {
      // أولًا: المساعد المحلي (يدعم البطاقات والتأكيد)
      const r = await api('/assistant', { method: 'POST', body: { text: txt, confirmed: confirm, pending: confirm ? pending : null } });
      const understood = !/لم أفهم/.test(r.reply || '');
      if (understood || confirm) {
        setMsgs(m => [...m, { me: false, text: r.reply, cards: r.cards, actions: r.actions, hasPending: !!r.pending }]);
        setPending(r.pending || null);
      } else {
        // لم يفهم المحلي → جرّب نموذج الذكاء الاصطناعي
        try {
          const ai = await api('/ai/assistant', { method: 'POST', timeout: 60000, body: { message: txt } });
          setMsgs(m => [...m, { me: false, text: ai.reply, ai: ai.mode === 'ai' }]);
          if (ai.mode === 'ai') setMode('ذكي ✓');
        } catch (e2) { setMsgs(m => [...m, { me: false, text: r.reply, actions: r.actions }]); }
      }
    } catch (e) { setMsgs(m => [...m, { me: false, text: 'تعذر الاتصال بالمساعد: ' + e.message }]); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[85] pointer-events-none no-print">
      <div className="absolute inset-0 pointer-events-auto" style={{ background: 'rgba(10,15,30,.35)' }} onClick={() => setAssistant(false)} />
      <div className="absolute top-0 bottom-0 left-0 w-[400px] pointer-events-auto anim-slide flex flex-col pointer-events-auto" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-pop)', maxWidth: '94vw' }}>
        <div className="px-5 py-4 flex items-center gap-3 grad-bg text-white">
          <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><I n="bot" s={22} /></span>
          <div className="flex-1"><b>المساعد الذكي</b><div className="text-[12px] opacity-80">الوضع: {mode} — يحترم صلاحياتك</div></div>
          <button className="icon-btn !text-white hover:!bg-white/20" onClick={() => setAssistant(false)}><I n="x" s={18} /></button>
        </div>
        <div ref={box} className="flex-1 overflow-y-auto p-4 space-y-3">
          {msgs.map((m, i) => (
            <div key={i} className={`msg-in flex ${m.me ? 'justify-start' : 'justify-end'}`} style={{ flexDirection: 'row' }}>
              <div className="max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-6 whitespace-pre-wrap" style={m.me ? { background: 'linear-gradient(135deg,#1d61f5,#7c3aed)', color: '#fff' } : { background: 'var(--bg2)' }}>
                {m.ai && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md ml-1" style={{ background: 'rgba(124,58,237,.15)', color: '#7c3aed' }}>AI</span>}{m.text}
                {(m.cards || []).length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {m.cards.map((c, j) => (
                      <div key={j} className="rounded-xl px-3 py-2 cursor-pointer" style={{ background: 'var(--card)', border: '1px solid var(--line)' }}
                        onClick={() => { setAssistant(false); if (c.link) location.hash = '#' + c.link; }}>
                        <div className="font-bold text-[12.5px]">{c.title}</div>
                        <div className="text-[11.5px]" style={{ color: 'var(--ink2)' }}>{c.sub}</div>
                      </div>
                    ))}
                  </div>
                )}
                {(m.actions || []).map((a, j) => <Btn key={j} v="g" size="xs" className="mt-2 ml-1.5" onClick={() => { setAssistant(false); location.hash = '#' + a.link; }}>{a.label}</Btn>)}
                {m.hasPending && (
                  <div className="mt-2 flex gap-1.5">
                    <Btn v="p" size="xs" onClick={() => send('', true)}>تأكيد التنفيذ</Btn>
                    <Btn v="g" size="xs" onClick={() => { setPending(null); setMsgs(x => [...x, { me: false, text: 'تم الإلغاء.' }]); }}>إلغاء</Btn>
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="flex justify-end"><div className="rounded-2xl px-4 py-3 typing" style={{ background: 'var(--bg2)' }}><span /><span /><span /></div></div>}
        </div>
        <div className="p-3" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="flex gap-1.5 flex-wrap mb-2.5">
            {SUGGEST.slice(0, 4).map(s => <button key={s} className="text-[11.5px] px-2.5 py-1 rounded-full font-semibold" style={{ background: 'var(--bg2)', color: 'var(--ink2)' }} onClick={() => send(s)}>{s}</button>)}
          </div>
          <div className="flex gap-2">
            <input className="inp" placeholder="اكتب سؤالك..." value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />
            <Btn v="p" onClick={() => send()} disabled={busy}><I n="send" s={16} /></Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
