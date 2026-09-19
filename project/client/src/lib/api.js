// عميل API موحد — مهلة، إعادة محاولة للقراءة، معالجة جلسات/صيانة/حد استخدام
import { useStore } from './store.js';

let token = localStorage.getItem('ss_token') || '';
export const setToken = (t) => { token = t || ''; t ? localStorage.setItem('ss_token', t) : localStorage.removeItem('ss_token'); };
export const getToken = () => token;

function handleAuthExpired() {
  setToken('');
  try { useStore.getState().setAuth(null, {}); } catch {}
  if (!location.hash.includes('login')) location.hash = '#/login';
}

async function doFetch(path, opts, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch('/api' + path, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) },
      body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body
    });
  } finally { clearTimeout(timer); }
}

export async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const timeoutMs = opts.timeout || 25000;
  const retries = method === 'GET' ? 1 : 0; // إعادة محاولة واحدة لطلبات القراءة فقط
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await doFetch(path, opts, timeoutMs);
    } catch (e) {
      lastErr = e.name === 'AbortError' ? new Error('انتهت مهلة الاتصال بالخادم — تحقق من الشبكة وحاول مجددًا') : new Error('تعذر الاتصال بالخادم');
      if (attempt < retries) { await new Promise(r => setTimeout(r, 600)); continue; }
      throw lastErr;
    }

    if (res.status === 401) { handleAuthExpired(); throw new Error('انتهت الجلسة — سجل الدخول مجددًا'); }
    if (res.status === 503) {
      try {
        const j = await res.json();
        if (j.maintenance) { try { useStore.getState().setMaintenance(true, j.message || ''); } catch {} }
        throw new Error(j.error || 'الخدمة غير متاحة مؤقتًا');
      } catch (e) { if (e.message && !e.message.includes('JSON')) throw e; throw new Error('الخدمة غير متاحة مؤقتًا'); }
    }
    if (res.status === 429) throw new Error('طلبات كثيرة جدًا — انتظر قليلًا ثم حاول مجددًا');

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      if (!res.ok) throw new Error('خطأ في الاتصال بالخادم');
      return res;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'حدث خطأ');
    try { if (useStore.getState().maintenance) useStore.getState().setMaintenance(false); } catch {}
    return data;
  }
  throw lastErr || new Error('تعذر الاتصال بالخادم');
}

export const q = (o = {}) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v !== '' && v !== undefined && v !== null) p.append(k, v); });
  const s = p.toString();
  return s ? '?' + s : '';
};

export const fileUrl = (id, dl = false) => `/api/files/${id}/raw?token=${encodeURIComponent(token)}${dl ? '&dl=1' : ''}`;
export const brandUrl = (name) => name ? `/api/public/brand-file/${encodeURIComponent(name)}` : '';
// تصدير أي مسار Excel من الخادم (كشوف الحسابات، الدفعات، المصروفات، الاهتمامات...)
export async function exportFile(path, filters = {}, filename = 'export.xlsx') {
  const r = await fetch('/api' + path + q(filters), { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'تعذر التصدير'); }
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const excelUrl = (name, filters = {}) => {
  return fetch('/api/reports/' + name + '/excel' + q(filters), { headers: { Authorization: 'Bearer ' + token } })
    .then(async r => {
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'تعذر التصدير'); }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `report-${name}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
};
