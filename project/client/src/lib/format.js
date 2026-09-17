export const fmtN = (v) => Number(v || 0).toLocaleString('en-US');
export const fmtD = (d) => { if (!d) return '—'; try { return new Date(d.length <= 10 ? d + 'T00:00:00' : d.replace(' ', 'T')).toLocaleDateString('en-GB'); } catch { return d; } };
export const fmtDT = (d) => { if (!d) return '—'; try { return new Date(d.replace(' ', 'T')).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }); } catch { return d; } };
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const timeGreet = () => { const h = new Date().getHours(); return h < 12 ? 'صباح الخير' : h < 17 ? 'مساء الخير' : 'مساء النور'; };
export const arDate = () => new Date().toLocaleDateString('ar-SA-u-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const L = {
  taskStatus: { new: 'جديدة', in_progress: 'قيد التنفيذ', paused: 'معلقة', completed: 'مكتملة', cancelled: 'ملغاة' },
  priority: { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', urgent: 'عاجلة' },
  apptStatus: { scheduled: 'مجدول', done: 'تم', cancelled: 'ملغي', postponed: 'مؤجل' },
  clientStatus: { active: 'نشط', potential: 'محتمل', inactive: 'غير نشط', vip: 'مميز', blocked: 'محظور' },
  callDir: { in: 'وارد', out: 'صادر' },
  callResult: { answered: 'تم الرد', missed: 'فائت', busy: 'مشغول', no_answer: 'لا رد', follow_up: 'يحتاج متابعة', deal: 'صفقة', other: 'أخرى' },
  unitStatus: { available: 'متاحة', reserved: 'محجوزة', sold: 'مباعة', resale: 'إعادة بيع', blocked: 'موقوفة' },
  resStatus: { active: 'نشط', completed: 'مكتمل', cancelled: 'ملغي', expired: 'منتهي' },
  saleStatus: { active: 'نشطة', completed: 'مكتملة', cancelled: 'ملغاة' },
  payMethod: { cash: 'نقد', transfer: 'تحويل بنكي', check: 'شيك', card: 'شبكة', online: 'دفع إلكتروني', other: 'أخرى' },
  payStatus: { pending: 'معلقة', confirmed: 'مؤكدة', cancelled: 'ملغاة', reversed: 'معكوسة', bounced: 'مرتجع' },
  payKind: { deposit: 'عربون', down_payment: 'دفعة أولى', installment: 'قسط', full: 'سداد كامل', other: 'أخرى' },
  checkStatus: { pending: 'بانتظار التحصيل', cleared: 'تم التحصيل', bounced: 'مرتجع', cancelled: 'ملغى', '': '—' },
  accountType: { cash: 'نقدي (صندوق)', bank: 'بنكي', project: 'مشروع', other: 'أخرى' },
  accountStatus: { active: 'فعّال', inactive: 'موقوف', closed: 'مغلق' },
  expenseStatus: { draft: 'مسودة', pending: 'بحاجة اعتماد', approved: 'معتمد', paid: 'مصروف', cancelled: 'ملغى', rejected: 'مرفوض' },
  schedStatus: { upcoming: 'قادم', due: 'مستحق', partial: 'جزئي', paid: 'مدفوع', overdue: 'متأخر', cancelled: 'ملغى' },
  contractStatus: { draft: 'مسودة', awaiting_signature: 'بانتظار التوقيع', signed: 'موقّع', active: 'ساري', completed: 'مكتمل', cancelled: 'ملغى', expired: 'منتهي' },
  quoteStatus: { draft: 'مسودة', sent: 'مُرسل', accepted: 'مقبول', rejected: 'مرفوض', expired: 'منتهي', cancelled: 'ملغى', converted: 'محوّل لحجز' },
  commStatus: { pending: 'مستحقة', partial: 'مدفوعة جزئيًا', paid: 'مدفوعة', overdue: 'متأخرة' },
  interestStatus: { active: 'نشط', inactive: 'موقوف' },
  approvalStatus: { pending: 'بانتظار الاعتماد', approved: 'معتمد', rejected: 'مرفوض', cancelled: 'ملغى' },
  floorType: { normal: 'دور عادي', ground: 'أرضي', mezzanine: 'ميزانين', roof: 'روف', terrace: 'سطح/تراس', basement: 'قبو', other: 'أخرى' },
  propertyType: { apartment: 'شقة', villa: 'فيلا', duplex: 'دوبلكس', roof: 'روف', studio: 'استوديو', land: 'أرض', office: 'مكتب', shop: 'معرض/محل', other: 'أخرى' },
  purpose: { residence: 'سكن', investment: 'استثمار', resale: 'إعادة بيع', other: 'أخرى' },
  deliveryStatus: { ready: 'جاهزة للتسليم', under_construction: 'تحت الإنشاء', off_plan: 'على الخارطة' },
  commKind: { whatsapp: 'واتساب', call: 'مكالمة', sms: 'رسالة نصية', email: 'بريد إلكتروني', meeting: 'اجتماع', note: 'ملاحظة', visit: 'زيارة' },
  stage: { lead: 'عميل محتمل', contacted: 'تم التواصل', interested: 'مهتم', visit: 'معاينة', quotation: 'عرض سعر', negotiation: 'تفاوض', reserved: 'حجز', contract: 'عقد', sold: 'بيع', closed: 'مغلق' },
  userStatus: { active: 'نشط', inactive: 'موقوف', locked: 'مقفل' },
  action: { login: 'دخول', logout: 'خروج', create: 'إنشاء', update: 'تعديل', delete: 'حذف', export: 'تصدير', denied: 'مرفوض', seed: 'تهيئة', login_failed: 'فشل دخول' },
};
export const badge = {
  taskStatus: { new: 'b-blue', in_progress: 'b-amber', paused: 'b-gray', completed: 'b-green', cancelled: 'b-red' },
  priority: { low: 'b-gray', medium: 'b-blue', high: 'b-amber', urgent: 'b-red' },
  unitStatus: { available: 'b-green', reserved: 'b-amber', sold: 'b-blue', resale: 'b-purple', blocked: 'b-red' },
  resStatus: { active: 'b-green', completed: 'b-blue', cancelled: 'b-red', expired: 'b-gray' },
  payStatus: { pending: 'b-amber', confirmed: 'b-green', cancelled: 'b-red', reversed: 'b-gray', bounced: 'b-red' },
  expenseStatus: { draft: 'b-gray', pending: 'b-amber', approved: 'b-blue', paid: 'b-green', cancelled: 'b-red', rejected: 'b-red' },
  schedStatus: { upcoming: 'b-gray', due: 'b-blue', partial: 'b-amber', paid: 'b-green', overdue: 'b-red', cancelled: 'b-gray' },
  contractStatus: { draft: 'b-gray', awaiting_signature: 'b-amber', signed: 'b-blue', active: 'b-green', completed: 'b-teal', cancelled: 'b-red', expired: 'b-gray' },
  quoteStatus: { draft: 'b-gray', sent: 'b-blue', accepted: 'b-green', rejected: 'b-red', expired: 'b-gray', cancelled: 'b-red', converted: 'b-purple' },
  approvalStatus: { pending: 'b-amber', approved: 'b-green', rejected: 'b-red', cancelled: 'b-gray' },
  accountStatus: { active: 'b-green', inactive: 'b-gray', closed: 'b-red' },
  commStatus: { pending: 'b-amber', partial: 'b-blue', paid: 'b-green', overdue: 'b-red' },
  saleStatus: { active: 'b-green', completed: 'b-blue', cancelled: 'b-red' },
};
export const methodLabel = (m) => L.payMethod[m] || m || '—';
