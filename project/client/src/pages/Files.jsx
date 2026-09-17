import React, { useEffect, useRef, useState } from 'react';
import { api, q, fileUrl, getToken } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { fmtD } from '../lib/format.js';
import { I, Btn, Empty, Skeleton, ErrBox, PageHead, Modal, Field, SearchInp, Pagination, Confirm, Tabs } from '../components/ui.jsx';

const CATS = [['', 'الكل'], ['general', 'عام'], ['contracts', 'عقود'], ['ids', 'هويات'], ['invoices', 'فواتير'], ['images', 'صور'], ['other', 'أخرى']];
const CAT_AR = { general: 'عام', contracts: 'عقود', ids: 'هويات', invoices: 'فواتير', images: 'صور', other: 'أخرى' };

export default function Files() {
  const { can, toast } = useStore();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('');
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [upBusy, setUpBusy] = useState(false);
  const [ren, setRen] = useState(null);
  const [del, setDel] = useState(null);
  const [preview, setPreview] = useState(null);
  const inp = useRef();

  const load = () => {
    setBusy(true); setErr('');
    api('/files' + q({ page, limit: 24, q: search, category: cat }))
      .then(r => { setRows(r.data); setTotal(r.total); setBusy(false); }).catch(e => { setErr(e.message); setBusy(false); });
  };
  useEffect(() => { setPage(1); }, [search, cat]);
  useEffect(load, [page, search, cat]);

  const doUpload = async (files) => {
    if (!files?.length) return;
    setUpBusy(true);
    try {
      const fd = new FormData();
      [...files].forEach(f => fd.append('files', f));
      fd.append('category', cat || 'general');
      const res = await fetch('/api/files/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken() }, body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'فشل الرفع');
      toast(`تم رفع ${j.files.length} ملفات`);
      load();
    } catch (e) { toast(e.message, 'error'); }
    setUpBusy(false);
  };

  const icon = (m) => m?.startsWith('image/') ? 'eye' : m?.includes('pdf') ? 'file' : m?.includes('sheet') || m?.includes('excel') ? 'chart' : m?.includes('word') ? 'note' : 'file';
  const size = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

  return (
    <>
      <PageHead title="إدارة الملفات" sub="رفع ومعاينة وتنظيم ملفات الشركة"
        actions={can('files', 'create') && <><input ref={inp} type="file" multiple className="hidden" onChange={e => { doUpload(e.target.files); e.target.value = ''; }} /><Btn onClick={() => inp.current.click()} disabled={upBusy}><I n="ul" s={16} /> {upBusy ? 'جارٍ الرفع...' : 'رفع ملفات'}</Btn></>} />

      <div className="card p-3.5 mb-4 flex gap-2.5 flex-wrap items-center anim-in"
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); can('files', 'create') && doUpload(e.dataTransfer.files); }}>
        <SearchInp value={search} onChange={setSearch} ph="بحث في الملفات... (اسحب ملفات هنا للرفع)" className="flex-1 min-w-[220px]" />
        <Tabs tabs={CATS.map(([k, t]) => ({ k, t }))} val={cat} onChange={setCat} />
      </div>

      {err && <ErrBox msg={err} retry={load} />}
      {busy && <Skeleton n={4} />}
      {!busy && !err && rows.length === 0 && <div className="card"><Empty icon="folder" title="لا توجد ملفات" sub="اسحب ملفات وأفلتها هنا أو اضغط رفع" /></div>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3.5 anim-in">
        {rows.map(f => (
          <div key={f.id} className="card card-h p-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-2.5" style={{ background: 'rgba(29,97,245,.1)', color: 'var(--brand)' }}><I n={icon(f.mime)} s={24} /></div>
            <div className="font-bold text-[13.5px] truncate" title={f.original_name}>{f.original_name}</div>
            <div className="text-[11.5px] mt-1 num" style={{ color: 'var(--ink3)' }}>{CAT_AR[f.category] || f.category} — {size(f.size)} — {fmtD(f.created_at)}</div>
            <div className="text-[11.5px] truncate" style={{ color: 'var(--ink3)' }}>{f.uploader || ''}</div>
            <div className="flex gap-1.5 mt-3">
              <Btn v="g" size="xs" onClick={() => setPreview(f)}><I n="eye" s={13} /> معاينة</Btn>
              <a className="btn btn-g btn-xs" href={fileUrl(f.id, true)}><I n="dl" s={13} /> تنزيل</a>
              {can('files', 'edit') && <button className="icon-btn !w-8 !h-8" onClick={() => setRen(f)} title="إعادة تسمية"><I n="edit" s={15} /></button>}
              {can('files', 'delete') && <button className="icon-btn !w-8 !h-8" onClick={() => setDel(f)} title="حذف"><I n="trash" s={15} /></button>}
            </div>
          </div>
        ))}
      </div>
      <Pagination page={page} pages={Math.ceil(total / 24)} total={total} onGo={setPage} />

      <Modal open={!!ren} onClose={() => setRen(null)} title="إعادة تسمية" w={440}
        actions={<><Btn size="sm" onClick={async () => { try { await api('/files/' + ren.id, { method: 'PUT', body: { name: ren.original_name, category: ren.category } }); toast('تم الحفظ'); setRen(null); load(); } catch (e) { toast(e.message, 'error'); } }}>حفظ</Btn><Btn v="g" size="sm" onClick={() => setRen(null)}>إلغاء</Btn></>}>
        {ren && <div className="space-y-3">
          <Field label="الاسم"><input className="inp" value={ren.original_name} onChange={e => setRen({ ...ren, original_name: e.target.value })} /></Field>
          <Field label="التصنيف"><select className="inp" value={ren.category} onChange={e => setRen({ ...ren, category: e.target.value })}>{CATS.filter(c => c[0]).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
        </div>}
      </Modal>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.original_name} w={760}>
        {preview && (
          preview.mime?.startsWith('image/')
            ? <img src={fileUrl(preview.id)} alt="" className="max-h-[60vh] mx-auto rounded-xl" />
            : preview.mime?.includes('pdf')
              ? <iframe src={fileUrl(preview.id)} className="w-full rounded-xl" style={{ height: '60vh' }} title="pdf" />
              : <div className="text-center py-8"><p className="mb-4 text-[13.5px]" style={{ color: 'var(--ink2)' }}>لا يمكن معاينة هذا النوع داخل النظام</p><a className="btn btn-p" href={fileUrl(preview.id, true)}><I n="dl" s={15} /> تنزيل الملف</a></div>
        )}
      </Modal>

      <Confirm open={!!del} onClose={() => setDel(null)} title="حذف الملف" msg={`سيتم حذف "${del?.original_name}"`} okText="حذف"
        onOk={async () => { try { await api('/files/' + del.id, { method: 'DELETE' }); toast('تم الحذف'); setDel(null); load(); } catch (e) { toast(e.message, 'error'); } }} />
    </>
  );
}
