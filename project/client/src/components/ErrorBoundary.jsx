import React from 'react';
import { I, Btn } from './ui.jsx';

// حد أخطاء React — يمنع الشاشة البيضاء نهائيًا ويعرض حالة خطأ احترافية مع إعادة المحاولة
export default class ErrorBoundary extends React.Component {
  constructor(p) {
    super(p);
    this.state = { error: null, info: '' };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    this.setState({ info: (info?.componentStack || '').split('\n').slice(0, 3).join(' ').slice(0, 300) });
    try { console.error('[UI crash]', error, info); } catch {}
  }
  render() {
    if (!this.state.error) return this.props.children;
    const { title = 'حدث خطأ غير متوقع', compact } = this.props;
    return (
      <div className={compact ? 'p-4' : 'h-full flex items-center justify-center p-6'}>
        <div className="card p-8 text-center anim-in w-full" style={{ maxWidth: 480 }}>
          <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-3" style={{ background: 'rgba(220,38,38,.1)', color: 'var(--danger)' }}><I n="alert" s={26} /></div>
          <div className="font-bold text-[16px]">{title}</div>
          <div className="text-[13px] mt-1.5 leading-6" style={{ color: 'var(--ink2)' }}>
            {String(this.props.message || this.state.error?.message || 'تعذر عرض هذه الصفحة').slice(0, 220)}
          </div>
          <div className="flex gap-2 justify-center mt-5">
            <Btn size="sm" onClick={() => { this.setState({ error: null }); this.props.onRetry?.(); }}><I n="refresh" s={15} /> إعادة المحاولة</Btn>
            <Btn v="g" size="sm" onClick={() => { location.hash = '#/dashboard'; location.reload(); }}>العودة للرئيسية</Btn>
          </div>
        </div>
      </div>
    );
  }
}

// التقاط الأخطاء غير المعالجة عالميًا (وعود + سكربت) لمنع أي انهيار صامت
export function installGlobalHandlers(toast) {
  window.addEventListener('unhandledrejection', (e) => {
    try { console.error('[unhandled]', e.reason); } catch {}
    const msg = e.reason?.message || '';
    if (msg && !msg.includes('الجلسة') && toast) toast('تعذر إتمام العملية: ' + msg.slice(0, 120), 'error');
  });
  window.addEventListener('error', (e) => {
    try { console.error('[window.error]', e.message); } catch {}
  });
}
