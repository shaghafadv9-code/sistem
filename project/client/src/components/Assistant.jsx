import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { I, Btn } from './ui.jsx';

const SUGGEST = [
  'مواعيدي اليوم',
  'أضف موعد مع أحمد يوم الأحد الساعة 5 مساءً',
  'ورني مهامي المتأخرة',
  'أضف مهمة لمتابعة العميل بعد 3 أيام',
  'احجز العقار 101 لأحمد',
  'كم باقي على أحمد؟'
];

export default function Assistant() {
  const { assistant, setAssistant } = useStore();
  const [convId, setConvId] = useState(() => localStorage.getItem('assistant_conv_id') || (`conv_${Date.now()}`));
  const [activeContext, setActiveContext] = useState(null);
  const [msgs, setMsgs] = useState([
    {
      me: false,
      text: 'أهلًا بك! أنا مساعدك التنفيذي الذكي داخل النظام.\nيمكنني فهم طلباتك باللغة الطبيعية وتنفيذها فعليًا وفق صلاحياتك (إنشاء حجز، تسجيل دفعة، إضافة مصروف، الاستعلام عن رصيد، والبحث في العقارات والعملاء).'
    }
  ]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [mode, setMode] = useState('...');
  const [aiState, setAiState] = useState(null);
  const [lastMeta, setLastMeta] = useState('');
  const box = useRef();
  const msgsRef = useRef(msgs);
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  useEffect(() => {
    localStorage.setItem('assistant_conv_id', convId);
  }, [convId]);

  const startNewChat = () => {
    const nextId = `conv_${Date.now()}`;
    setConvId(nextId);
    setActiveContext(null);
    setPending(null);
    setMsgs([
      {
        me: false,
        text: 'تم بدء جلسة محادثة جديدة نظيفة. كيف يمكنني مساعدتك اليوم؟'
      }
    ]);
  };

  useEffect(() => {
    // الحالة تُعرض بصدق: لا نعلن أن الذكاء الاصطناعي يعمل إذا كانت كل النماذج فاشلة
    api('/ai/status')
      .then(s => {
        if (s.verdict === 'CONNECTED' && s.def) setMode(`تنفيذي ذكي — ${s.def.model}`);
        else if (s.verdict === 'NOT_CONFIGURED') setMode('تنفيذي محلي — لم يُضبط مزود ذكاء اصطناعي');
        else if (s.verdict === 'FAILED') setMode(`تنفيذي محلي — الذكاء الاصطناعي متعطل (${s.models?.failed || 0} نموذج فاشل)`);
        else if (s.verdict === 'UNKNOWN') setMode('تنفيذي محلي — لم يُفحص الذكاء الاصطناعي بعد');
        else setMode('تنفيذي محلي — الذكاء الاصطناعي متوقف/معطل');
        setAiState(s);
      })
      .catch(() => { setMode('تنفيذي محلي'); setAiState(null); });
  }, [assistant]);

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
    if (busy) return;

    // إضافة رسالة المستخدم فورًا
    if (!confirm) {
      setMsgs(m => [...m, { me: true, text: txt }]);
    }
    setText('');
    setBusy(true);
    setLastMeta('جاري المعالجة والتنفيذ...');

    try {
      // إرسال السجل الكامل لدعم الجلسات المتعددة
      const current = msgsRef.current;
      const history = [...current, { me: true, text: txt }]
        .filter(m => !m.isError)
        .slice(-12)
        .map(m => ({ role: m.me ? 'user' : 'assistant', content: m.text }));

      const r = await api('/assistant', {
        method: 'POST',
        body: {
          text: txt,
          messages: history,
          confirmed: confirm,
          pending: confirm ? pending : null,
          conversation_id: convId
        }
      });

      if (r.context) {
        setActiveContext(r.context);
      }

      // التعامل مع التوجيه التلقائي إن وُجد
      if (r.navigate) {
        location.hash = '#' + r.navigate;
      }

      // إشعار الصفحات الأخرى لتحديث بياناتها فورياً (التقويم، المهام، الحجوزات...)
      window.dispatchEvent(new CustomEvent('app:refresh', { detail: r }));
      window.dispatchEvent(new CustomEvent('assistant:action', { detail: r }));

      setMsgs(m => [
        ...m,
        {
          me: false,
          text: r.reply,
          cards: r.cards,
          actions: r.actions,
          hasPending: !!r.hasPending || !!r.pending,
          ai: !!r.ai,
          model: r.model,
          fallback: r.fallback,
          isError: !!r.isError
        }
      ]);

      setPending(r.pending || null);
      setLastMeta('');
    } catch (e) {
      const msg = e.message || 'تعذر معالجة الطلب';
      setMsgs(m => [
        ...m,
        {
          me: false,
          text: `⚠️ ${msg}`,
          isError: true
        }
      ]);
      setLastMeta('خطأ اتصال');
    } finally {
      setBusy(false);
      setTimeout(() => setLastMeta(''), 3000);
    }
  };

  const handleRetry = (idx) => {
    const m = msgs[idx];
    if (m && m.isError) {
      let lastUser = '';
      for (let i = idx - 1; i >= 0; i--) if (msgs[i].me) { lastUser = msgs[i].text; break; }
      if (lastUser) send(lastUser);
    }
  };

  return (
    <div className="fixed inset-0 z-[85] pointer-events-none no-print">
      <div className="absolute inset-0 pointer-events-auto" style={{ background: 'rgba(10,15,30,.35)' }} onClick={() => setAssistant(false)} />
      <div className="absolute top-0 bottom-0 left-0 w-[420px] pointer-events-auto anim-slide flex flex-col" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-pop)', maxWidth: '94vw' }}>
        <div className="px-5 py-3.5 flex items-center gap-3 grad-bg text-white">
          <span className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center"><I n="bot" s={20} /></span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <b>المساعد التنفيذي</b>
              <button
                type="button"
                className="text-[11px] bg-white/20 hover:bg-white/30 text-white px-2 py-0.5 rounded-lg transition"
                onClick={startNewChat}
                title="بدء محادثة جديدة وتصفير السياق"
              >
                + محادثة جديدة
              </button>
            </div>
            <div className="text-[11.5px] opacity-80">الوضع: {mode}</div>
            {lastMeta && <div className="text-[11px] opacity-70 mt-0.5">{lastMeta}</div>}
          </div>
          <button className="icon-btn !text-white hover:!bg-white/20" onClick={() => setAssistant(false)}><I n="x" s={18} /></button>
        </div>

        {aiState && aiState.verdict !== 'CONNECTED' && (
          <div className="px-4 py-2.5 text-[12px] leading-5 flex items-start gap-2"
            style={{ background: aiState.verdict === 'FAILED' ? 'rgba(220,38,38,.10)' : 'rgba(245,158,11,.12)', borderBottom: '1px solid var(--line)' }}>
            <I n="alert" s={15} />
            <span>
              <b>{aiState.verdict === 'FAILED' ? 'الذكاء الاصطناعي الخارجي متعطل' : aiState.verdict === 'NOT_CONFIGURED' ? 'لم يُضبط أي مزود ذكاء اصطناعي' : 'حالة الذكاء الاصطناعي غير مؤكدة'}</b>
              {aiState.hint ? ` — ${aiState.hint}` : ' — يعمل المساعد بالمحرك التنفيذي المحلي فقط.'}
              <br />
              <span style={{ color: 'var(--ink3)' }} className="num">
                نماذج: {aiState.models?.healthy || 0} سليم / {aiState.models?.failed || 0} فاشل / {aiState.models?.unknown || 0} غير مفحوص
                {aiState.limits ? ` — مهلة إجمالية ${aiState.limits.total_timeout_sec}ث، ${aiState.limits.max_attempts} محاولات` : ''}
              </span>
            </span>
          </div>
        )}

        <div ref={box} className="flex-1 overflow-y-auto p-4 space-y-3">
          {msgs.map((m, i) => (
            <div key={i} className={`msg-in flex ${m.me ? 'justify-start' : 'justify-end'}`} style={{ flexDirection: 'row' }}>
              <div className="max-w-[90%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-6 whitespace-pre-wrap"
                style={m.me
                  ? { background: 'linear-gradient(135deg,#1d61f5,#7c3aed)', color: '#fff' }
                  : m.isError
                    ? { background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.2)' }
                    : { background: 'var(--bg2)', border: '1px solid var(--line)' }}>
                {m.ai && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md ml-1" style={{ background: 'rgba(124,58,237,.15)', color: '#7c3aed' }}>AI</span>}
                {m.fallback && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md ml-1" style={{ background: 'rgba(245,158,11,.15)', color: '#d97706' }}>بديل</span>}
                {m.model && !m.me && <span className="text-[10px] num px-1 py-0.5 ml-1" style={{ color: 'var(--ink3)' }} dir="ltr">{m.model}</span>}
                {m.text}

                {/* بطاقات البيانات التفاعلية */}
                {(m.cards || []).length > 0 && (
                  <div className="mt-2.5 space-y-1.5">
                    {m.cards.map((c, j) => (
                      <div key={j} className="rounded-xl px-3 py-2 cursor-pointer transition-all hover:border-primary"
                        style={{ background: 'var(--card)', border: '1px solid var(--line)' }}
                        onClick={() => { if (c.link) { setAssistant(false); location.hash = '#' + c.link; } }}>
                        <div className="font-bold text-[12.5px] text-primary">{c.title}</div>
                        <div className="text-[11.5px]" style={{ color: 'var(--ink2)' }}>{c.sub}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* أزرار الإجراءات */}
                {(m.actions || []).map((a, j) => (
                  <Btn key={j} v="g" size="xs" className="mt-2 ml-1.5" onClick={() => { setAssistant(false); location.hash = '#' + a.link; }}>
                    {a.label}
                  </Btn>
                ))}

                {/* زر إعادة المحاولة عند الخطأ */}
                {m.isError && (
                  <div className="mt-2">
                    <Btn v="g" size="xs" onClick={() => handleRetry(i)}><I n="refresh" s={12} /> إعادة المحاولة</Btn>
                  </div>
                )}

                {/* صندوق التأكيد للعمليات الحساسة */}
                {m.hasPending && (
                  <div className="mt-3 p-3 rounded-xl" style={{ background: 'rgba(29,97,245,.08)', border: '1px solid rgba(29,97,245,.25)' }}>
                    <div className="text-[11.5px] font-bold text-primary mb-2 flex items-center gap-1">
                      <I n="alert-circle" s={14} /> تأكيد العملية الحساسة:
                    </div>
                    <div className="flex gap-2">
                      <Btn v="p" size="xs" onClick={() => send('', true)} disabled={busy}>
                        <I n="check" s={12} /> تأكيد وتنفيذ الآن
                      </Btn>
                      <Btn v="g" size="xs" onClick={() => { setPending(null); setMsgs(x => [...x, { me: false, text: 'تم إلغاء العملية ولم يتم إجراء أي تغيير.' }]); }} disabled={busy}>
                        إلغاء العملية
                      </Btn>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-end">
              <div className="rounded-2xl px-4 py-3 typing flex items-center gap-2" style={{ background: 'var(--bg2)' }}>
                <span /><span /><span /><span className="text-[11px] mr-2" style={{ color: 'var(--ink3)' }}>{lastMeta || 'جاري المعالجة...'}</span>
              </div>
            </div>
          )}
        </div>

        <div className="p-3" style={{ borderTop: '1px solid var(--line)' }}>
          {/* مؤشر السياق الحي */}
          {activeContext && (activeContext.client || activeContext.project || activeContext.unit || activeContext.task || activeContext.appointment || activeContext.pending_flow) && (
            <div className="flex items-center justify-between text-[11px] px-2.5 py-1 mb-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <span className="truncate">
                📌 في السياق:{' '}
                {[
                  activeContext.client && `العميل: ${activeContext.client.name}`,
                  activeContext.project && `المشروع: ${activeContext.project.name}`,
                  activeContext.unit && `الوحدة: ${activeContext.unit.code}`,
                  activeContext.task && `المهمة: ${activeContext.task.title}`,
                  activeContext.appointment && `الموعد: ${activeContext.appointment.title}`,
                  activeContext.pending_flow?.waiting_for && `(بانتظار ${activeContext.pending_flow.waiting_for === 'time' ? 'الوقت' : activeContext.pending_flow.waiting_for === 'unit' ? 'رقم العقار' : 'السعر'})`
                ].filter(Boolean).join(' | ')}
              </span>
              <button
                type="button"
                className="opacity-70 hover:opacity-100 mr-1 text-[10px]"
                onClick={() => setActiveContext(null)}
                title="إخفاء مؤشر السياق"
              >
                ✕
              </button>
            </div>
          )}

          <div className="flex gap-1.5 flex-wrap mb-2.5">
            {SUGGEST.map(s => (
              <button key={s} className="text-[11px] px-2.5 py-1 rounded-full font-semibold transition-all hover:bg-primary hover:text-white"
                style={{ background: 'var(--bg2)', color: 'var(--ink2)' }}
                onClick={() => send(s)}
                disabled={busy}>
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input className="inp" placeholder="اطلب عملية (حجز، دفعة، مصروف، استعلام)..." value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} disabled={busy} />
            <Btn v="p" onClick={() => send()} disabled={busy || !text.trim()}><I n="send" s={16} /></Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
