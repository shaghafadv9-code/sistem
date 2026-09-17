// Smart Secretary — مُصدِّر Excel احترافي موحّد (RTL + هوية الشركة + رقم التقرير + الفلاتر المستخدمة)
const ExcelJS = require('exceljs');
const { db } = require('./db');

function settings() {
  const o = {};
  try { db.prepare('SELECT key, value FROM settings').all().forEach(r => o[r.key] = r.value); } catch {}
  return o;
}
function reportNo(prefix = 'REP') { return `${prefix}-${Date.now().toString(36).toUpperCase()}`; }

const MONEY = /(amount|price|paid|remaining|total|balance|net|commission|discount|salary|budget|collected|expense|deduct|refund|opening|current|due|settlement|profit|cost|value|مبلغ|سعر|رصيد)/i;
const DATE = /(date|day|_at$|due_date|paid_at)$/i;

function humanFilters(filters = {}) {
  const labels = {
    from: 'من تاريخ', to: 'إلى تاريخ', status: 'الحالة', project_id: 'المشروع', unit_id: 'الوحدة', client_id: 'العميل',
    broker_id: 'المسوق', employee_id: 'الموظف', account_id: 'الحساب', method: 'طريقة الدفع', kind: 'نوع العملية',
    category_id: 'التصنيف', q: 'بحث', type: 'النوع', rooms: 'عدد الغرف', rooms_min: 'من غرف', rooms_max: 'إلى غرف',
    price_min: 'أقل سعر', price_max: 'أعلى سعر', area_min: 'أقل مساحة', area_max: 'أعلى مساحة', floor_type: 'نوع الدور',
    building_id: 'المبنى', floor_id: 'الدور', purpose: 'الغرض', property_type: 'نوع العقار', stage: 'المرحلة',
    delivery_status: 'التسليم', source: 'المصدر', days: 'عدد الأيام', with_roof: 'روف', rooms_op: 'عامل الغرف'
  };
  const out = [];
  Object.entries(filters || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || ['page', 'limit'].includes(k)) return;
    out.push(`${labels[k] || k}: ${v}`);
  });
  return out;
}

// يولّد ويُرسل ملف Excel — أعمدة: [{k,t,money?,width?}]
async function sendSheet(res, { sheet = 'تقرير', title = 'تقرير', cols = [], rows = [], filters = {}, totalsKeys = [], prefix = 'REP', user, req }) {
  const s = settings();
  const wb = new ExcelJS.Workbook();
  wb.creator = s.company_name || 'Smart Secretary';
  wb.created = new Date();
  const ws = wb.addWorksheet(String(sheet).slice(0, 30), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 5 }], pageSetup: { paperSize: 9, orientation: cols.length > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });

  const lastCol = Math.max(1, cols.length);
  const fillHeader = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D61F5' } };
  const thin = { style: 'thin', color: { argb: 'FFD0D7E4' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };

  ws.mergeCells(1, 1, 1, lastCol);
  const c1 = ws.getCell(1, 1); c1.value = s.company_name || 'Smart Secretary';
  c1.font = { bold: true, size: 16, color: { argb: 'FF142359' } }; c1.alignment = { horizontal: 'right' };

  ws.mergeCells(2, 1, 2, lastCol);
  const no = reportNo(prefix);
  const c2 = ws.getCell(2, 1);
  c2.value = `${title} — التاريخ: ${new Date().toLocaleDateString('en-GB')} — رقم التقرير: ${no} — المُعدّ: ${user?.name || ''}`;
  c2.font = { bold: true, size: 11, color: { argb: 'FF5B6478' } };

  ws.mergeCells(3, 1, 3, lastCol);
  const f = humanFilters(filters);
  const c3 = ws.getCell(3, 1);
  c3.value = f.length ? `الفلاتر المستخدمة: ${f.join(' | ')}` : 'الفلاتر المستخدمة: بدون فلاتر (كل البيانات)';
  c3.font = { size: 10, color: { argb: 'FF8B93A7' } };

  const header = ws.getRow(5);
  cols.forEach((col, i) => {
    const cell = header.getCell(i + 1);
    cell.value = col.t || col.k;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = fillHeader;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = border;
  });
  header.height = 24;

  rows.forEach((row, ri) => {
    const r = ws.addRow(cols.map(c => {
      let v = row[c.k];
      if (v === undefined || v === null) v = '';
      if (c.money || (MONEY.test(c.k) && typeof v === 'number')) v = Number(v) || 0;
      return v;
    }));
    r.eachCell((cell, ci) => {
      cell.border = border;
      cell.alignment = { horizontal: cols[ci - 1].money || MONEY.test(cols[ci - 1].k) ? 'left' : 'right', vertical: 'middle', wrapText: false };
      if (cols[ci - 1].money || MONEY.test(cols[ci - 1].k)) cell.numFmt = '#,##0.00';
      if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FC' } };
      if (cols[ci - 1].bold) cell.font = { bold: true };
    });
  });

  if (totalsKeys.length && rows.length) {
    const r = ws.addRow(cols.map((c, i) => {
      if (i === 0) return 'الإجمالي';
      if (totalsKeys.includes(c.k)) return rows.reduce((a, x) => a + (Number(x[c.k]) || 0), 0);
      return '';
    }));
    r.eachCell((cell, ci) => {
      cell.font = { bold: true, color: { argb: 'FF142359' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EDF5' } };
      cell.border = border;
      if (cols[ci - 1].money || MONEY.test(cols[ci - 1].k)) cell.numFmt = '#,##0.00';
    });
  }

  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width || Math.max(12, Math.min(34, String(c.t || c.k).length + 8)); });

  ws.mergeCells(ws.rowCount + 2, 1, ws.rowCount + 2, lastCol);
  const foot = ws.getCell(ws.rowCount, 1);
  foot.value = s.reports_footer || '';
  foot.font = { size: 9, italic: true, color: { argb: 'FF8B93A7' } };

  if (req) {
    try {
      const { audit } = require('./auth');
      audit({ ...req.user, ip: req.ip }, 'export', 'reports', 'excel', null, `${title} — ${rows.length} سجل`);
    } catch {}
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(String(sheet))}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
  return no;
}

module.exports = { sendSheet, humanFilters, settings, reportNo };
