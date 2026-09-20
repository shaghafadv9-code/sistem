import React, { useEffect, useState } from 'react';
import { api, q } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtDT, L } from '../lib/format.js';
import { I, Btn, Badge, Empty, Skeleton, ErrBox, PageHead, Modal, Field, SearchInp, Pagination, Confirm, Avatar } from '../components/ui.jsx';

// ================= المستخدمون =================
export function Users() {
  const { can, toast, user: me } = useStore();
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);

  const load = () => {
    setBusy(true); setErr('');
    Promise.all([api('/users' + q({ limit: 100, q: search })), api('/roles')])
      .then(([u, r]) => { setRows(u.data); setRoles(r.data); setBusy(false); }).catch(e => { setErr(e.message); setBusy(false); });
  };
  useEffect(load, [search]);

  const save = async () => {
    try {
      if (edit.id) await api('/users/' + edit.id, { method: 'PUT', body: edit });
      else await api('/users', { method: 'POST', body: edit });
      toast('تم حفظ المستخدم'); setEdit(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHead title="إدارة المستخدمين" sub="الحسابات، الأدوار، والحالات"
        actions={can('users', 'create') && <Btn onClick={() => setEdit({ status: 'active' })}><I n="plus" s={16} /> مستخدم جديد</Btn>} />
      <div className="card p-3.5 mb-4 anim-in"><SearchInp value={search} onChange={setSearch} ph="بحث بالاسم أو اسم المستخدم..." /></div>
      {err && <ErrBox msg={err} retry={load} />}
      {busy && <Skeleton n={4} />}
      {!busy && !err && (
        <div className="card overflow-x-auto anim-in">
          <table className="tbl min-w-[760px]">
            <thead><tr><th>المستخدم</th><th>اسم الدخول</th><th>الدور</th><th>الحالة</th><th>آخر دخول</th><th></th></tr></thead>
            <tbody>
              {rows.map(u => (
                <tr key={u.id}>
                  <td><span className="flex items-center gap-2"><Avatar name={u.name} s={30} /><b>{u.name}</b>{u.id === me.id && <Badge c="b-blue">أنت</Badge>}</span></td>
                  <td className="num">{u.username}</td>
                  <td><Badge c="b-purple">{u.role_ar}</Badge></td>
                  <td><Badge c={u.status === 'active' ? 'b-green' : 'b-red'}>{L.userStatus[u.status]}</Badge></td>
                  <td className="num text-[12.5px]">{fmtDT(u.last_login_at)}</td>
                  <td><div className="flex gap-1">
                    {can('users', 'edit') && <button className="icon-btn" onClick={() => setEdit({ ...u, password: '' })}><I n="edit" s={17} /></button>}
                    {can('users', 'delete') && u.id !== me.id && <button className="icon-btn" onClick={() => setDel(u)}><I n="trash" s={17} /></button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل المستخدم' : 'مستخدم جديد'} w={540}
        actions={<><Btn onClick={save}>حفظ</Btn><Btn v="g" onClick={() => setEdit(null)}>إلغاء</Btn></>}>
        {edit && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="الاسم الكامل *"><input className="inp" value={edit.name || ''} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
              {!edit.id && <Field label="اسم المستخدم *"><input className="inp num" value={edit.username || ''} onChange={e => setEdit({ ...edit, username: e.target.value })} /></Field>}
              <Field label="البريد"><input className="inp" value={edit.email || ''} onChange={e => setEdit({ ...edit, email: e.target.value })} /></Field>
              <Field label="الجوال"><input className="inp num" value={edit.phone || ''} onChange={e => setEdit({ ...edit, phone: e.target.value })} /></Field>
              <Field label="الدور *"><select className="inp" value={edit.role_id || ''} onChange={e => setEdit({ ...edit, role_id: +e.target.value })}><option value="">— اختر —</option>{roles.map(r => <option key={r.id} value={r.id}>{r.name_ar}</option>)}</select></Field>
              <Field label="الحالة"><select className="inp" value={edit.status || 'active'} onChange={e => setEdit({ ...edit, status: e.target.value })}>{Object.entries(L.userStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            </div>
            <Field label={edit.id ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور *'}><input type="password" className="inp" value={edit.password || ''} onChange={e => setEdit({ ...edit, password: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
      <Confirm open={!!del} onClose={() => setDel(null)} title="حذف المستخدم" msg={`سيتم حذف "${del?.name}" وإنهاء جلساته`} okText="حذف"
        onOk={async () => { try { await api('/users/' + del.id, { method: 'DELETE' }); toast('تم الحذف'); setDel(null); load(); } catch (e) { toast(e.message, 'error'); } }} />
    </>
  );
}

// ================= الأدوار =================
const MOD_AR = { dashboard: 'اللوحة', tasks: 'المهام', appointments: 'المواعيد', clients: 'العملاء', calls: 'الاتصالات', notes: 'الملاحظات', files: 'الملفات', notifications: 'الإشعارات', users: 'المستخدمون', roles: 'الأدوار', audit: 'السجل', settings: 'الإعدادات', reports: 'التقارير', projects: 'المشاريع', units: 'الوحدات', reservations: 'الحجوزات', sales: 'المبيعات', finance: 'المالية', backup: 'النسخ', brokers: 'الوسطاء', templates: 'القوالب', branding: 'الهوية', ai: 'الذكاء الاصطناعي', assistant: 'المساعد' };
const ACT_AR = { view: 'عرض', create: 'إنشاء', edit: 'تعديل', delete: 'حذف', export: 'تصدير', print: 'طباعة', approve: 'اعتماد', manage: 'إدارة' };

export function Roles() {
  const { can, toast } = useStore();
  const [roles, setRoles] = useState([]);
  const [meta, setMeta] = useState({ modules: [], actions: [] });
  const [sel, setSel] = useState(null);
  const [perms, setPerms] = useState(new Set());
  const [busy, setBusy] = useState(true);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);

  const load = () => {
    setBusy(true);
    Promise.all([api('/roles'), api('/roles/meta')]).then(([r, m]) => { setRoles(r.data); setMeta(m); setBusy(false); }).catch(() => setBusy(false));
  };
  useEffect(load, []);
  useEffect(() => {
    if (sel) api(`/roles/${sel.id}/permissions`).then(r => setPerms(new Set(r.data.map(p => `${p.module}:${p.action}`)))).catch(() => {});
  }, [sel?.id]);

  const toggle = (m, a) => {
    const k = `${m}:${a}`;
    setPerms(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  };
  const savePerms = async () => {
    try {
      await api(`/roles/${sel.id}`, { method: 'PUT', body: { name_ar: sel.name_ar, description: sel.description, permissions: [...perms].map(s => { const [module, action] = s.split(':'); return { module, action }; }) } });
      toast('تم حفظ الصلاحيات');
    } catch (e) { toast(e.message, 'error'); }
  };
  const saveRole = async () => {
    try {
      if (edit.id) await api(`/roles/${edit.id}`, { method: 'PUT', body: edit });
      else await api('/roles', { method: 'POST', body: edit });
      toast('تم حفظ الدور'); setEdit(null); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  if (busy) return <><PageHead title="الأدوار والصلاحيات" /><Skeleton n={4} /></>;
  return (
    <>
      <PageHead title="الأدوار والصلاحيات" sub="تحكم دقيق — تُفحص الصلاحيات في الواجهة والخادم معًا"
        actions={<div className="flex gap-2 items-center">
          <a href="#/ai_permissions" className="btn btn-secondary text-xs flex items-center gap-1.5"><I n="bot" s={15} /> صلاحيات الذكاء الاصطناعي</a>
          {can('roles', 'create') && <Btn onClick={() => setEdit({})}><I n="plus" s={16} /> دور جديد</Btn>}
        </div>} />
      <div className="grid lg:grid-cols-[280px_1fr] gap-3.5 anim-in">
        <div className="card p-3 space-y-1.5 h-fit">
          {roles.map(r => (
            <div key={r.id} className={`rounded-xl p-3 cursor-pointer ${sel?.id === r.id ? 'grad-bg text-white' : 'hover:opacity-80'}`} style={sel?.id !== r.id ? { background: 'var(--card2)' } : {}} onClick={() => setSel(r)}>
              <div className="flex items-center justify-between"><b className="text-[14px]">{r.name_ar}</b>
                <span className="flex gap-1" onClick={e => e.stopPropagation()}>
                  {can('roles', 'edit') && !r.is_system && <button className="icon-btn !w-7 !h-7" onClick={() => setEdit(r)}><I n="edit" s={14} /></button>}
                  {can('roles', 'delete') && !r.is_system && <button className="icon-btn !w-7 !h-7" onClick={() => setDel(r)}><I n="trash" s={14} /></button>}
                </span>
              </div>
              <div className="text-[11.5px] opacity-75">{r.users_count} مستخدمين {r.is_system ? '— نظام' : ''}</div>
            </div>
          ))}
        </div>
        <div className="card p-5">
          {!sel && <Empty icon="shield" title="اختر دورًا" sub="اضغط على دور من القائمة لعرض صلاحياته" />}
          {sel && (
            <>
              <div className="flex items-center justify-between mb-4">
                <b className="text-[15px]">صلاحيات: {sel.name_ar}</b>
                {can('roles', 'edit') && <Btn size="sm" onClick={savePerms}><I n="check" s={15} /> حفظ الصلاحيات</Btn>}
              </div>
              <div className="overflow-x-auto">
                <table className="tbl min-w-[640px]">
                  <thead><tr><th>الوحدة</th>{meta.actions.map(a => <th key={a} className="!text-center">{ACT_AR[a]}</th>)}<th></th></tr></thead>
                  <tbody>
                    {meta.modules.map(m => (
                      <tr key={m}>
                        <td><b className="text-[13px]">{MOD_AR[m] || m}</b></td>
                        {meta.actions.map(a => (
                          <td key={a} className="!text-center">
                            <input type="checkbox" className="w-[17px] h-[17px] accent-blue-600 cursor-pointer" checked={perms.has(`${m}:${a}`)} disabled={!can('roles', 'edit')} onChange={() => toggle(m, a)} />
                          </td>
                        ))}
                        <td><button className="text-[11px] font-bold" style={{ color: 'var(--brand)' }} onClick={() => { const all = meta.actions.every(a => perms.has(`${m}:${a}`)); setPerms(p => { const n = new Set(p); meta.actions.forEach(a => all ? n.delete(`${m}:${a}`) : n.add(`${m}:${a}`)); return n; }); }}>{meta.actions.every(a => perms.has(`${m}:${a}`)) ? 'إلغاء الكل' : 'الكل'}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل الدور' : 'دور جديد'} w={460}
        actions={<><Btn size="sm" onClick={saveRole}>حفظ</Btn><Btn v="g" size="sm" onClick={() => setEdit(null)}>إلغاء</Btn></>}>
        {edit && <div className="space-y-3">
          {!edit.id && <Field label="الاسم التقني (إنجليزي) *"><input className="inp num" value={edit.name || ''} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="sales_manager" /></Field>}
          <Field label="اسم الدور *"><input className="inp" value={edit.name_ar || ''} onChange={e => setEdit({ ...edit, name_ar: e.target.value })} placeholder="مدير المبيعات" /></Field>
          <Field label="الوصف"><input className="inp" value={edit.description || ''} onChange={e => setEdit({ ...edit, description: e.target.value })} /></Field>
        </div>}
      </Modal>
      <Confirm open={!!del} onClose={() => setDel(null)} title="حذف الدور" msg={`سيتم حذف دور "${del?.name_ar}"`} okText="حذف"
        onOk={async () => { try { await api('/roles/' + del.id, { method: 'DELETE' }); toast('تم الحذف'); setDel(null); setSel(null); load(); } catch (e) { toast(e.message, 'error'); } }} />
    </>
  );
}

// ================= سجل العمليات =================
export function Audit() {
  const { toast } = useStore();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [fMod, setFMod] = useState('');
  const [busy, setBusy] = useState(true);

  const load = () => {
    setBusy(true);
    api('/audit' + q({ page, limit: 20, q: search, module: fMod })).then(r => { setRows(r.data); setTotal(r.total); setBusy(false); }).catch(() => setBusy(false));
  };
  useEffect(() => { setPage(1); }, [search, fMod]);
  useEffect(load, [page, search, fMod]);

  const AC = { login: 'b-green', logout: 'b-gray', create: 'b-blue', update: 'b-amber', delete: 'b-red', export: 'b-purple', denied: 'b-red', login_failed: 'b-red' };

  return (
    <>
      <PageHead title="سجل العمليات" sub="توثيق كامل: من فعل ماذا ومتى" />
      <div className="card p-3.5 mb-4 flex gap-2.5 flex-wrap anim-in">
        <SearchInp value={search} onChange={setSearch} ph="بحث بالمستخدم أو التفاصيل..." className="flex-1 min-w-[200px]" />
        <select className="inp" style={{ width: 170 }} value={fMod} onChange={e => setFMod(e.target.value)}>
          <option value="">كل الوحدات</option>{Object.entries(MOD_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {busy && <Skeleton n={5} />}
      {!busy && rows.length === 0 && <div className="card"><Empty icon="hist" title="لا توجد سجلات" /></div>}
      {!busy && (
        <div className="card overflow-x-auto anim-in">
          <table className="tbl min-w-[800px]">
            <thead><tr><th>المستخدم</th><th>الإجراء</th><th>الوحدة</th><th>التفاصيل</th><th>التاريخ</th></tr></thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.id}>
                  <td><b>{a.username || '—'}</b></td>
                  <td><Badge c={AC[a.action] || 'b-gray'}>{L.action[a.action] || a.action}</Badge></td>
                  <td>{MOD_AR[a.module] || a.module}</td>
                  <td className="text-[12.5px] max-w-[340px] truncate">{a.details}</td>
                  <td className="num text-[12.5px]">{fmtDT(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={Math.ceil(total / 20)} total={total} onGo={setPage} />
    </>
  );
}

// ================= صلاحيات الذكاء الاصطناعي (AI Permissions) =================
const AI_MOD_INFO = {
  projects: { ar: 'المشاريع', icon: 'building', desc: 'استعراض وإدارة المشاريع العقارية' },
  units: { ar: 'الوحدات والعقارات', icon: 'home', desc: 'البحث عن الوحدات وتفاصيلها وحالاتها' },
  clients: { ar: 'العملاء', icon: 'users', desc: 'سجلات وبيانات العملاء وجهات الاتصال' },
  suppliers: { ar: 'المزودون والموردون', icon: 'truck', desc: 'مزودو نماذج وخدمات الذكاء الاصطناعي' },
  reservations: { ar: 'الحجوزات', icon: 'clip', desc: 'إنشاء ومتابعة وتعديل حجوزات الوحدات' },
  appointments: { ar: 'المواعيد والتقويم', icon: 'cal', desc: 'جدولة وإدارة المواعيد والاجتماعات' },
  tasks: { ar: 'المهام ومتابعة العمل', icon: 'check', desc: 'إسناد ومتابعة وإكمال مهام النظام' },
  payments: { ar: 'الدفعات والتحصيل', icon: 'dollar', desc: 'تسجيل دفعات الحجوزات والمبيعات' },
  expenses: { ar: 'المصروفات المالية', icon: 'scale', desc: 'تسجيل وتوثيق المصروفات التشغيلية' },
  accounts: { ar: 'الحسابات المالية', icon: 'briefcase', desc: 'أرصدة الصناديق والبنوك وكشوفات الحساب' },
  reports: { ar: 'التقارير والإحصائيات', icon: 'chart', desc: 'تقارير المبيعات والأداء والملخصات' },
  contracts: { ar: 'العقود والاتفاقيات', icon: 'doc', desc: 'بيانات العقود الموثقة وتواريخها' },
  quotations: { ar: 'عروض الأسعار', icon: 'tag', desc: 'إعداد ومراجعة عروض الأسعار للعملاء' },
  calls: { ar: 'سجل الاتصالات', icon: 'phone', desc: 'توثيق سجل المكالمات والمتابعات الهاتفيّة' },
  notes: { ar: 'الملاحظات والتدوينات', icon: 'note', desc: 'الملاحظات السريعة ومتابعات العملاء' }
};

const AI_ACT_INFO = {
  view: { ar: 'عرض وقراءة', desc: 'السماح للذكاء بالاطلاع على البيانات' },
  create: { ar: 'إنشاء وإضافة', desc: 'السماح للذكاء بإنشاء سجلات جديدة' },
  edit: { ar: 'تعديل', desc: 'السماح للذكاء بتعديل وتحديث السجلات' },
  delete: { ar: 'حذف', desc: 'السماح للذكاء بحذف وإلغاء السجلات' },
  search: { ar: 'بحث وفلترة', desc: 'السماح للذكاء بالبحث المتقدم والتصفية' },
  execute: { ar: 'تنفيذ عمليات', desc: 'السماح بتنفيذ الإجراءات التشغيلية' }
};

export function AIPermissions() {
  const { toast } = useStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [permMap, setPermMap] = useState({});
  const [modules, setModules] = useState([]);
  const [actions, setActions] = useState([]);

  const load = () => {
    setLoading(true);
    api('/ai/permissions')
      .then(res => {
        const map = {};
        if (Array.isArray(res.permissions)) {
          res.permissions.forEach(p => {
            map[`${p.module}:${p.action}`] = !!p.enabled;
          });
        } else if (res.permissions && typeof res.permissions === 'object') {
          Object.entries(res.permissions).forEach(([m, acts]) => {
            Object.entries(acts).forEach(([a, val]) => {
              map[`${m}:${a}`] = !!val;
            });
          });
        }
        setPermMap(map);
        const mods = (res.modules || Object.keys(AI_MOD_INFO)).map(m => (typeof m === 'object' ? m.key : m));
        const acts = (res.actions || Object.keys(AI_ACT_INFO)).map(a => (typeof a === 'object' ? a.key : a));
        setModules(mods);
        setActions(acts);
        setLoading(false);
      })
      .catch(err => {
        toast(err.message, 'error');
        setLoading(false);
      });
  };

  useEffect(load, []);

  const isEnabled = (m, a) => !!permMap[`${m}:${a}`];

  const toggleSingle = (m, a) => {
    const k = `${m}:${a}`;
    setPermMap(prev => ({ ...prev, [k]: !prev[k] }));
  };

  const toggleModule = (m) => {
    const allEnabled = actions.every(a => permMap[`${m}:${a}`]);
    setPermMap(prev => {
      const next = { ...prev };
      actions.forEach(a => {
        next[`${m}:${a}`] = !allEnabled;
      });
      return next;
    });
  };

  const enableAll = () => {
    setPermMap(prev => {
      const next = { ...prev };
      modules.forEach(m => {
        actions.forEach(a => {
          next[`${m}:${a}`] = true;
        });
      });
      return next;
    });
    toast('تم تحديد تفعيل كافة الصلاحيات');
  };

  const disableAll = () => {
    setPermMap(prev => {
      const next = { ...prev };
      modules.forEach(m => {
        actions.forEach(a => {
          next[`${m}:${a}`] = false;
        });
      });
      return next;
    });
    toast('تم تحديد تعطيل كافة الصلاحيات');
  };

  const save = async () => {
    setSaving(true);
    try {
      const permissions = [];
      modules.forEach(m => {
        actions.forEach(a => {
          permissions.push({
            module: m,
            action: a,
            enabled: permMap[`${m}:${a}`] ? 1 : 0
          });
        });
      });

      await api('/ai/permissions', {
        method: 'PUT',
        body: { permissions }
      });
      toast('تم حفظ صلاحيات الذكاء الاصطناعي بنجاح');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const filteredModules = modules.filter(m => {
    if (!filterText) return true;
    const nameAr = AI_MOD_INFO[m]?.ar || m;
    return nameAr.includes(filterText) || m.toLowerCase().includes(filterText.toLowerCase());
  });

  const totalPossible = modules.length * actions.length;
  const totalActive = Object.values(permMap).filter(Boolean).length;

  return (
    <>
      <PageHead
        title="صلاحيات الذكاء الاصطناعي"
        sub="نظام مستقل ومتقدم لإدارة وصول المساعد الذكي لكل موديول وإجراء"
        actions={
          <div className="flex gap-2">
            <Btn v="g" size="sm" onClick={load} disabled={loading || saving}>
              <I n="hist" s={15} /> تحديث
            </Btn>
            <Btn size="sm" onClick={save} disabled={loading || saving}>
              <I n="check" s={15} /> {saving ? 'جارٍ الحفظ...' : 'حفظ التغييرات'}
            </Btn>
          </div>
        }
      />

      {/* الشريط الأمني لاستثناء الإعدادات نهائياً */}
      <div className="card p-4 mb-4 border-r-4 border-amber-500 flex items-start gap-3 bg-amber-500/5 anim-in">
        <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
          <I n="shield" s={22} />
        </div>
        <div className="flex-1">
          <b className="text-[14px] text-amber-500 block mb-1">
            سياسة الأمان الصارمة: الإعدادات وإدارة النظام مستثناة نهائياً
          </b>
          <p className="text-[12.5px] text-slate-400 leading-relaxed">
            وفقاً للضوابط الأمنية لنظام سكرتير ذكي، تم عزل صفحات <b>الإعدادات (Settings)</b> وإدارة المستخدمين والأدوار والنسخ الاحتياطي نهائياً. لا يملك المساعد الذكي أي قدرة برمجية أو صلاحية للاطلاع عليها أو تعديلها مهما كانت الصلاحيات، ولا تظهر هذه الأقسام في شبكة التحكم أدناه.
          </p>
        </div>
      </div>

      {/* أدوات التحكم السريع والبحث والإحصاء */}
      <div className="card p-4 mb-4 flex flex-wrap items-center justify-between gap-3 anim-in">
        <div className="flex items-center gap-3 flex-1 min-w-[240px]">
          <SearchInp
            value={filterText}
            onChange={setFilterText}
            ph="تصفية الوحدات (المشاريع، الوحدات، الحجوزات...)..."
            className="w-full max-w-sm"
          />
          <div className="text-[12.5px] text-slate-400 whitespace-nowrap">
            مفعل: <span className="font-bold text-emerald-400">{totalActive}</span> من {totalPossible} صلاحية
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Btn v="g" size="sm" onClick={enableAll}>
            <I n="check" s={14} /> تفعيل الكل
          </Btn>
          <Btn v="g" size="sm" onClick={disableAll}>
            <I n="trash" s={14} /> تعطيل الكل
          </Btn>
        </div>
      </div>

      {/* شبكة الصلاحيات الكاملة */}
      {loading ? (
        <Skeleton n={6} />
      ) : (
        <div className="card overflow-x-auto anim-in">
          <table className="tbl min-w-[840px]">
            <thead>
              <tr>
                <th className="w-[240px]">الوحدة والمجال</th>
                {actions.map(a => (
                  <th key={a} className="!text-center">
                    <div>{AI_ACT_INFO[a]?.ar || a}</div>
                    <span className="text-[10px] opacity-60 font-normal block">{a}</span>
                  </th>
                ))}
                <th className="!text-center w-[100px]">التحكم بالصف</th>
              </tr>
            </thead>
            <tbody>
              {filteredModules.map(m => {
                const info = AI_MOD_INFO[m] || { ar: m, icon: 'clip', desc: '' };
                const rowAll = actions.every(a => permMap[`${m}:${a}`]);
                return (
                  <tr key={m} className="hover:bg-slate-800/20">
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-slate-800 text-slate-300">
                          <I n={info.icon || 'clip'} s={16} />
                        </div>
                        <div>
                          <b className="text-[13.5px] block">{info.ar}</b>
                          <span className="text-[11px] text-slate-400 block">{info.desc || m}</span>
                        </div>
                      </div>
                    </td>
                    {actions.map(a => {
                      const checked = isEnabled(m, a);
                      return (
                        <td key={a} className="!text-center">
                          <label className="inline-flex items-center justify-center cursor-pointer p-1.5 rounded-lg hover:bg-slate-800/40 transition">
                            <input
                              type="checkbox"
                              className="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
                              checked={checked}
                              onChange={() => toggleSingle(m, a)}
                            />
                          </label>
                        </td>
                      );
                    })}
                    <td className="!text-center">
                      <button
                        type="button"
                        className={`text-[11px] font-bold px-2 py-1 rounded transition ${rowAll ? 'text-rose-400 hover:bg-rose-500/10' : 'text-indigo-400 hover:bg-indigo-500/10'}`}
                        onClick={() => toggleModule(m)}
                      >
                        {rowAll ? 'تعطيل الكل' : 'تفعيل الكل'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
