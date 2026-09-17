import React, { useEffect, useState, useCallback } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtN, fmtD } from '../lib/format.js';
import { I, Skeleton, ErrBox, Empty, Btn } from './ui.jsx';

/** خطاف موحد لجلب القوائم مع الفلاتر والترقيم وإعادة التحميل */
export function useList(path, params = {}, deps = []) {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, pages: 1, totals: null });
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const key = JSON.stringify(params);
  const load = useCallback(() => {
    setBusy(true); setErr('');
    api(path + q(JSON.parse(key)))
      .then(r => { setRows(r.data || []); setMeta({ total: r.total ?? (r.data || []).length, pages: r.pages || 1, totals: r.totals || null, extra: r }); setBusy(false); })
      .catch(e => { setErr(e.message); setBusy(false); });
  }, [path, key]);
  useEffect(load, [load, ...deps]);
  return { rows, meta, busy, err, reload: load, setRows };
}

/** خطاف موحد للبيانات المفردة/الصغيرة (قوائم الاختيار) */
export function useFetch(path, deps = []) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let live = true;
    setBusy(true);
    api(path).then(d => { if (live) { setData(d); setBusy(false); } }).catch(() => { if (live) { setData(null); setBusy(false); } });
    return () => { live = false; };
  }, [path, ...deps]);
  return { data, busy };
}

export const Money = ({ v, cur, cls = '', showZero = true }) => {
  const n = Number(v || 0);
  if (!showZero && !n) return <span className={cls} style={{ color: 'var(--ink3)' }}>—</span>;
  return <span className={`money-cell num ${cls}`}>{fmtN(n)}</span>;
};

/** شريط فلاتر موحد */
export const FilterBar = ({ children, onSearch, search, setSearch, ph = 'بحث...', onReload, right }) => (
  <div className="card p-3.5 mb-4 flex gap-2.5 flex-wrap items-center anim-in no-print">
    {setSearch !== undefined && (
      <input className="inp flex-1 min-w-[190px]" value={search} placeholder={ph}
        onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSearch && onSearch()} />
    )}
    {children}
    <div className="flex-1" />
    {right}
    {onReload && <button className="icon-btn" title="تحديث" onClick={onReload}><I n="refresh" s={17} /></button>}
  </div>
);

/** صف مؤشرات (KPI) */
export const Kpis = ({ items }) => (
  <div className="kpi-grid mb-4">
    {items.map((k, i) => (
      <div key={i} className="kpi anim-in" onClick={k.onClick} style={k.onClick ? { cursor: 'pointer' } : undefined}>
        <div className="flex items-center gap-2">
          {k.icon && <span className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'var(--bg2)', color: k.color || 'var(--brand)' }}><I n={k.icon} s={16} /></span>}
          <span className="lbl">{k.label}</span>
        </div>
        <div className="val num" style={k.color ? { color: k.color } : undefined}>{k.value}</div>
        {k.sub && <div className="text-[11.5px]" style={{ color: 'var(--ink3)' }}>{k.sub}</div>}
      </div>
    ))}
  </div>
);

/** جدول بيانات متجاوب */
export const Table = ({ cols, rows, busy, err, empty = 'لا توجد بيانات', onRow, footer }) => (
  <div className="card overflow-hidden anim-in">
    {err && <div className="p-4"><ErrBox msg={err} /></div>}
    {busy && <div className="p-3"><Skeleton n={5} /></div>}
    {!busy && !err && rows.length === 0 && <Empty title={empty} />}
    {!busy && !err && rows.length > 0 && (
      <div className="tbl-wrap" style={{ maxHeight: '68vh' }}>
        <table className="tbl">
          <thead><tr>{cols.map((c, i) => <th key={i} style={c.w ? { width: c.w } : undefined}>{c.t}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r.id ?? ri} onClick={onRow ? () => onRow(r) : undefined} style={onRow ? { cursor: 'pointer' } : undefined}>
                {cols.map((c, ci) => (
                  <td key={ci} className={c.num ? 'num' : ''} style={c.center ? { textAlign: 'center' } : undefined}>
                    {c.r ? c.r(r) : (c.money ? <Money v={r[c.k]} /> : (r[c.k] ?? '—'))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>
    )}
  </div>
);

/** نموذج عام: صفوف حقول + أزرار */
export const FormRow = ({ children, cols = 2 }) => (
  <div className={`grid gap-3 ${cols === 1 ? '' : cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>{children}</div>
);

/** زر تصدير Excel لمسار مخصص */
export const ExcelBtn = ({ path, filters = {}, name = 'export.xlsx', label = 'تصدير Excel', can = true }) => {
  const toast = useStore(s => s.toast);
  const [busy, setBusy] = useState(false);
  if (!can) return null;
  return (
    <Btn v="o" size="sm" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const { exportFile } = await import('../lib/api.js');
        await exportFile(path, filters, name);
        toast('تم تجهيز ملف Excel');
      } catch (e) { toast(e.message, 'error'); }
      setBusy(false);
    }}><I n="dl" s={14} /> {busy ? 'جارٍ التصدير...' : label}</Btn>
  );
};

/** طباعة منطقة محددة (كشوف/عقود) */
export const PrintArea = ({ children, title }) => (
  <div className="print-area">
    {title && <h2 className="text-[17px] font-bold mb-3">{title}</h2>}
    {children}
  </div>
);

export const money = (v) => fmtN(Number(v || 0));
export const dateOnly = (d) => fmtD(d);
