// Smart Secretary — Time / Timezone utility (Single Source of Truth)
// المشكلة السابقة: استخدام new Date().toISOString().slice(0,10) يعطي تاريخ UTC
// بينما SQLite يستخدم date('now','localtime'). في بيئة UTC+3 يتباعد التاريخان
// خلال الساعات 00:00–03:00 المحلية.
// الحل: كل تواريخ الأعمال تمر من هنا، والمنطقة الزمنية قابلة للضبط (الافتراضي Asia/Riyadh).
//
// ملاحظة: SQLite في هذا التطبيق يخزّن datetime('now','localtime') أي بتوقيت آلة الخادم.
// APP_TZ يجب أن يطابق توقيت آلة الخادم في التشغيل العادي (سطح المكتب = جهاز المستخدم).
// لذلك الافتراضي الفعلي هو توقيت النظام، ويمكن تجاوزه بـ APP_TZ عند النشر على خادم بتوقيت مختلف.

const SYSTEM_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Riyadh'; } catch { return 'Asia/Riyadh'; } })();
const TZ = process.env.APP_TZ || SYSTEM_TZ;

function fmt(parts, date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, ...parts }).format(d);
}

/** التاريخ المحلي الحالي بصيغة YYYY-MM-DD — هذا هو "اليوم" لكل قواعد الأعمال */
function today(date) { return fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }, date || new Date()); }

/** التاريخ والوقت المحلي بصيغة YYYY-MM-DD HH:MM:SS */
function nowStr(date) {
  const d = date || new Date();
  const day = today(d);
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
  return `${day} ${t === '24:00:00' ? '00:00:00' : t}`;
}

/** أول يوم في الشهر المحلي الحالي */
function monthStart(date) { return today(date || new Date()).slice(0, 8) + '01'; }

/** أول يوم في السنة المحلية الحالية */
function yearStart(date) { return today(date || new Date()).slice(0, 5) + '01-01'; }

/** تاريخ بعد n يوم (محلي) */
function addDays(days, from) {
  const base = parse(from || today());
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

/** تاريخ بعد n شهر (محلي) — مع تصحيح نهاية الشهر */
function addMonths(months, from) {
  const s = String(from || today());
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  const base = new Date(Date.UTC(y, (m - 1) + Number(months || 0), 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d || 1, lastDay));
  return base.toISOString().slice(0, 10);
}

/** تحويل أي مدخل (ISO / YYYY-MM-DD / Date) إلى YYYY-MM-DD محلي. قيمة فارغة → today() */
function dateOnly(v) {
  if (v === undefined || v === null || v === '') return today();
  if (v instanceof Date) return today(v);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                 // تاريخ صريح — لا يُزاح
  const iso = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') : null;
  const d = iso ? new Date(iso) : new Date(s);
  if (isNaN(d.getTime())) return s.slice(0, 10);
  return today(d);
}

/** تحليل YYYY-MM-DD كمنتصف النهار المحلي لتفادي انزياح اليوم */
function parse(s) {
  const d = dateOnly(s);
  return new Date(d + 'T12:00:00Z');
}

const isodate = today;      // اسم بديل متوافق
const timestamp = nowStr;   // اسم بديل متوافق

module.exports = { TZ, today, nowStr, monthStart, yearStart, addDays, addMonths, dateOnly, parse, isodate, timestamp };
