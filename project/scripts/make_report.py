#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
مُنتِج التقرير النهائي (PDF عربي RTL) لنظام Smart Secretary.
- يرسم النص العربي بتشكيل الحروف وترتيب RTL على مستوى الكلمة (لا يوجد ارتباك في الأسطر الملتفّة).
- فهرس بأرقام صفحات حقيقية (مرور أول للقياس ثم مرور نهائي).
    python3 scripts/make_report.py
"""
import os, re
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Spacer,
                                Table, TableStyle, PageBreak, Flowable, NextPageTemplate)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import stringWidth, registerFontFamily
import arabic_reshaper
from bidi.algorithm import get_display

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(ROOT, 'client/src/assets/fonts')
OUT = os.path.join(ROOT, 'docs/final-report.pdf')

BRAND = colors.HexColor('#1d61f5')
INK = colors.HexColor('#1b2434')
INK2 = colors.HexColor('#46536a')
INK3 = colors.HexColor('#7b8798')
LINE = colors.HexColor('#dfe4ec')
SOFT = colors.HexColor('#f4f7fd')
GREEN = colors.HexColor('#15803d')
RED = colors.HexColor('#b91c1c')
AMBER = colors.HexColor('#b45309')

pdfmetrics.registerFont(TTFont('Plex', os.path.join(FONT_DIR, 'plex-400.ttf')))
pdfmetrics.registerFont(TTFont('Plex-M', os.path.join(FONT_DIR, 'plex-500.ttf')))
pdfmetrics.registerFont(TTFont('Plex-B', os.path.join(FONT_DIR, 'plex-700.ttf')))
registerFontFamily('Plex', normal='Plex', bold='Plex-B', italic='Plex', boldItalic='Plex-B')

META = dict(company='Smart Secretary', title='تقرير الإنجاز النهائي', no='FIN-2026-09-17-01',
            date='17 سبتمبر 2026', date_iso='2026-09-17')


def shape_word(w):
    """تشكيل كلمة واحدة + ترتيبها البصري."""
    return get_display(arabic_reshaper.reshape(w))


AR_RE = re.compile(r'[\u0600-\u06FF]')


def tok_type(w):
    """'ar' للنص العربي و'lat' للاتيني/الأرقام/الرموز."""
    return 'ar' if AR_RE.search(w) else 'lat'


def assemble(tokens):
    """يبني سطرًا بصريًا: يعكس ترتيب المقاطع (RTL) ويحافظ على ترتيب الكلمات اللاتينية."""
    runs, cur, cur_t = [], [], None
    for w in tokens:
        t = tok_type(w)
        if cur and t != cur_t:
            runs.append((cur_t, cur)); cur = []
        cur_t = t; cur.append(w)
    if cur:
        runs.append((cur_t, cur))
    parts = []
    for t, ws in reversed(runs):
        if t == 'ar':
            parts.append(' '.join(shape_word(x) for x in reversed(ws)))
        else:
            parts.append(' '.join(ws))
    return ' '.join(parts)


def split_long(word, font, size, maxw):
    """يقطع الكلمة الطويلة (مثل أسماء الأعمدة اللاتينية) لتلتف داخل الخلية."""
    if stringWidth(word, font, size) <= maxw:
        return [word]
    parts, cur = [], ''
    for ch in word:
        if stringWidth(cur + ch, font, size) <= maxw - 2:
            cur += ch
        else:
            parts.append(cur); cur = ch
    if cur:
        parts.append(cur)
    return parts


def visual_lines(text, font, size, maxw):
    """يقسّم النص إلى أسطر حسب العرض ثم يعيد كل سطر بترتيبه البصري."""
    raw = []
    for w in text.split():
        raw.extend(split_long(w, font, size, maxw))
    tokens, lines, cur = raw, [], []
    for w in tokens:
        trial = assemble(cur + [w])
        if not cur or stringWidth(trial, font, size) <= maxw:
            cur.append(w)
        else:
            lines.append(cur); cur = [w]
    if cur:
        lines.append(cur)
    return [assemble(l) for l in lines]


class AT(Flowable):
    """فقرة/خلية نص عربي: RTL كامل مع دعم الالتفاف متعدد الأسطر والألوان."""
    spaceBefore = 0
    spaceAfter = 0

    def __init__(self, text, font='Plex', size=10.2, leading=None, color=INK2,
                 align='right', spaceBefore=0, spaceAfter=4, style=None):
        super().__init__()
        self.text, self.font, self.size = text, font, size
        self.leading = leading or round(size * 1.62, 1)
        self.color, self.align = color, align
        self.spaceBefore, self.spaceAfter = spaceBefore, spaceAfter
        self.style = style
        self.width = 0
        self.height = self.leading
        self.lines = []

    def wrap(self, aw, ah):
        self.width = aw
        self.lines = visual_lines(self.text, self.font, self.size, aw) if self.text else []
        self.height = max(self.leading, len(self.lines) * self.leading)
        return aw, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFont(self.font, self.size)
        c.setFillColor(self.color)
        y = self.height - self.size * 0.92
        for ln in self.lines:
            w = stringWidth(ln, self.font, self.size)
            x = 0 if self.align == 'right' else (self.width - w) / 2 if self.align == 'center' else self.width - w
            c.drawString(x, y, ln)
            y -= self.leading
        c.restoreState()


def para(t, **kw): return AT(t, **kw)
def H1(t): return AT(t, font='Plex-B', size=17, leading=25, color=BRAND, spaceBefore=1, spaceAfter=7, style='h1')
def H2(t): return AT(t, font='Plex-B', size=13, leading=21, color=INK, spaceBefore=9, spaceAfter=4, style='h2')
def P(t): return AT(t, size=10.2, leading=17.6, color=INK2, spaceAfter=5)
def LI(t): return AT('• ' + t, size=10.2, leading=17, color=INK2, spaceAfter=3.4)
def NOTE(t): return AT(t, size=8.8, leading=13.6, color=INK3, spaceAfter=3)


class Box(Flowable):
    spaceBefore = 6
    spaceAfter = 6

    def __init__(self, text, color=BRAND):
        super().__init__()
        self.color = color
        self.txt = AT(text, size=10, leading=17, color=INK2)

    def wrap(self, aw, ah):
        self.width = aw
        _, h = self.txt.wrap(aw - 20, ah)
        self.height = h + 16
        return aw, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(colors.HexColor('#f7f9ff')); c.setStrokeColor(LINE); c.setLineWidth(0.6)
        c.roundRect(0, 0, self.width, self.height, 6, stroke=1, fill=1)
        c.setFillColor(self.color)
        c.rect(self.width - 3.2, 0, 3.2, self.height, stroke=0, fill=1)
        self.txt.drawOn(c, 6, 8)
        c.restoreState()


def cell(t, head=False, center=False, bold=False):
    return AT(t, font='Plex-B' if (head or bold) else 'Plex', size=9.1 if not head else 9.5,
              leading=14, color=colors.white if head else (INK if bold else INK2),
              align='center' if center else 'right')


def table(head, rows, widths, center_cols=()):
    data = [[cell(c, head=True, center=(i in center_cols)) for i, c in enumerate(head)]]
    for r in rows:
        data.append([cell(str(c), center=(i in center_cols)) for i, c in enumerate(r)])
    t = Table(data, colWidths=widths, repeatRows=1, hAlign='CENTER')
    st = [('BACKGROUND', (0, 0), (-1, 0), BRAND),
          ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
          ('GRID', (0, 0), (-1, -1), 0.5, LINE),
          ('TOPPADDING', (0, 0), (-1, -1), 5.5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5.5),
          ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6)]
    for i in range(1, len(data)):
        if i % 2 == 0:
            st.append(('BACKGROUND', (0, i), (-1, i), SOFT))
    t.setStyle(TableStyle(st))
    return t


def KPI(items):
    vals = [AT(v, font='Plex-B', size=13.5, leading=20, color=c, align='center', spaceAfter=0) for v, c, _ in items]
    labs = [AT(l, size=8.7, leading=13, color=INK3, align='center', spaceAfter=0) for _, _, l in items]
    n = len(items)
    t = Table([vals, labs], colWidths=[(A4[0] - 36 * mm) / n] * n, hAlign='CENTER')
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), SOFT), ('BOX', (0, 0), (-1, -1), 0.6, LINE),
                           ('INNERGRID', (0, 0), (-1, -1), 0.6, LINE),
                           ('TOPPADDING', (0, 0), (-1, 0), 9), ('BOTTOMPADDING', (0, 1), (-1, 1), 9),
                           ('TOPPADDING', (0, 1), (-1, 1), 2), ('BOTTOMPADDING', (0, 0), (-1, 0), 0),
                           ('VALIGN', (0, 0), (-1, -1), 'MIDDLE')]))
    return t


class BrandedDoc(BaseDocTemplate):
    def __init__(self, path):
        super().__init__(path, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                         topMargin=20 * mm, bottomMargin=18 * mm,
                         title='تقرير الإنجاز النهائي — Smart Secretary',
                         author='Smart Secretary', subject='تقرير التحديث الشامل')
        self.toc_pages, self.toc_order = {}, []
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id='n')
        self.addPageTemplates([
            PageTemplate(id='cover', frames=[frame], onPage=self.cover_page),
            PageTemplate(id='body', frames=[frame], onPage=self.body_page),
        ])

    def afterFlowable(self, flowable):
        if isinstance(flowable, AT) and flowable.style in ('h1', 'h2'):
            if flowable.text not in self.toc_pages:
                self.toc_order.append((0 if flowable.style == 'h1' else 1, flowable.text))
            self.toc_pages[flowable.text] = self.page

    def cover_page(self, canv, doc):
        canv.saveState()
        canv.setFillColor(colors.HexColor('#0b1730')); canv.rect(0, 0, A4[0], A4[1], stroke=0, fill=1)
        canv.setFillColor(colors.HexColor('#12224a')); canv.circle(A4[0] * 0.16, A4[1] * 0.86, 120, stroke=0, fill=1)
        canv.setFillColor(BRAND); canv.circle(A4[0] * 0.9, A4[1] * 0.14, 150, stroke=0, fill=1)
        canv.setFillColor(colors.HexColor('#0b1730')); canv.circle(A4[0] * 0.92, A4[1] * 0.12, 118, stroke=0, fill=1)
        canv.setFillColor(BRAND); canv.roundRect(A4[0] / 2 - 28 * mm, 22 * mm, 56 * mm, 1.4, 0.7, stroke=0, fill=1)
        canv.setFont('Plex', 9); canv.setFillColor(colors.HexColor('#9fb3d9'))
        canv.drawCentredString(A4[0] / 2, 16 * mm, assemble('وثيقة فنية — داخلية / قابلة للمشاركة'.split()))
        canv.restoreState()

    def body_page(self, canv, doc):
        canv.saveState()
        canv.setFillColor(BRAND); canv.rect(0, A4[1] - 11 * mm, A4[0], 11 * mm, stroke=0, fill=1)
        canv.setFont('Plex-B', 8.6); canv.setFillColor(colors.white)
        canv.drawRightString(A4[0] - 18 * mm, A4[1] - 7.8 * mm, assemble('تقرير الإنجاز النهائي — Smart Secretary'.split()))
        canv.setFont('Plex', 8.2)
        canv.drawString(18 * mm, A4[1] - 7.8 * mm, META['no'] + ' : ' + assemble('رقم التقرير'.split()))
        canv.setStrokeColor(LINE); canv.setLineWidth(0.6); canv.line(18 * mm, 14 * mm, A4[0] - 18 * mm, 14 * mm)
        canv.setFont('Plex', 8.2); canv.setFillColor(INK3)
        canv.drawString(18 * mm, 10 * mm, META['date_iso'])
        canv.drawCentredString(A4[0] / 2, 10 * mm, assemble(['صفحة', str(canv.getPageNumber())]))
        canv.drawRightString(A4[0] - 18 * mm, 10 * mm, assemble('نظام Smart Secretary — إدارة العقارات والمبيعات'.split()))
        canv.restoreState()


TOC_ENTRIES = [
    (0, '1) الملخص التنفيذي'), (1, 'أبرز ما تحقق'),
    (0, '2) نطاق العمل والمنهجية'),
    (0, '3) ما تم إصلاحه (المشاكل التي كانت قائمة)'),
    (0, '4) ما تمت إضافته'),
    (1, '4-1 جداول ووحدات قاعدة البيانات'),
    (1, '4-2 الواجهات البرمجية الجديدة'),
    (1, '4-3 شاشات الواجهة (13 شاشة جديدة)'),
    (0, '5) قاعدة البيانات: الجداول والعلاقات والفهارس والهجرات'),
    (0, '6) الأمان والصلاحيات'),
    (1, '6-1 المراجعة الأمنية (البند 28)'),
    (1, '6-2 مصفوفة الصلاحيات (أمثلة مُختبرة)'),
    (0, '7) التقارير والطباعة وExcel'),
    (0, '8) الاختبارات والتحقق'),
    (1, '8-1 قواعد التحقق المالي المُختبرة (البند 34)'),
    (0, '9) خريطة تنفيذ البنود الـ36'),
    (0, '10) المشاكل المتبقية والقيود'),
    (0, '11) التوصيات'),
    (0, '12) ملحق: التحقق وإعادة الإنتاج'),
    (1, '12-1 أوامر التحقق'), (1, '12-2 ملفات مهمة'),
]


def build(path, pages=None):
    doc = BrandedDoc(path)
    S = []
    # ===== الغلاف =====
    S += [Spacer(1, 40 * mm),
          AT('Smart Secretary', font='Plex-B', size=15, leading=22, color=colors.HexColor('#8fb0ff'), align='center', spaceAfter=6),
          AT(META['title'], font='Plex-B', size=27, leading=40, color=colors.white, align='center', spaceAfter=10),
          AT('نظام إدارة العقارات والمبيعات والعملاء (CRM)', font='Plex', size=13, leading=22, color=colors.HexColor('#dfe8ff'), align='center', spaceAfter=2),
          AT('تحديث شامل: المالية • المصروفات • العقود • التقارير • CRM • الأمان • قاعدة البيانات',
             font='Plex', size=13, leading=22, color=colors.HexColor('#dfe8ff'), align='center', spaceAfter=24),
          AT(f"رقم التقرير: {META['no']}", font='Plex-M', size=10.5, leading=19, color=colors.HexColor('#eaf0ff'), align='center', spaceAfter=2),
          AT('تاريخ التقرير: 17 سبتمبر 2026', font='Plex-M', size=10.5, leading=19, color=colors.HexColor('#eaf0ff'), align='center', spaceAfter=2),
          AT('الجهة: إدارة النظام — قسم تقنية المعلومات', font='Plex-M', size=10.5, leading=19, color=colors.HexColor('#eaf0ff'), align='center', spaceAfter=18),
          AT('يغطي هذا التقرير تنفيذ متطلبات التحديث الـ36: الإصلاح، الإضافة، قاعدة البيانات، الواجهات، الأمان، التقارير، والاختبارات.',
             font='Plex', size=10.5, leading=19, color=colors.HexColor('#eaf0ff'), align='center'),
          NextPageTemplate('body')]

    def sec(t):
        S.append(PageBreak()); S.append(H1(t))

    # ===== الفهرس =====
    S.append(PageBreak())
    S.append(H1('الفهرس'))
    rows = []
    for lvl, raw in TOC_ENTRIES:
        num = (pages or {}).get(raw)
        label = AT(raw, font='Plex-M' if lvl == 0 else 'Plex', size=11.2 if lvl == 0 else 10,
                   leading=18, color=INK if lvl == 0 else INK2, spaceAfter=0)
        if lvl == 1:
            label.text = '— ' + label.text
        rows.append([label, AT(str(num or ''), font='Plex-M', size=10, leading=18, color=BRAND, align='center', spaceAfter=0)])
    toc = Table(rows, colWidths=[A4[0] - 36 * mm - 16 * mm, 16 * mm], hAlign='CENTER')
    toc.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                             ('LINEBELOW', (0, 0), (-1, -2), 0.4, colors.HexColor('#eef1f7')),
                             ('TOPPADDING', (0, 0), (-1, -1), 1), ('BOTTOMPADDING', (0, 0), (-1, -1), 1)]))
    S.append(toc)

    # ===== 1) الملخص التنفيذي =====
    sec('1) الملخص التنفيذي')
    S.append(KPI([('46/46', GREEN, 'اختبارات المراجعة (test.js)'), ('134/0', GREEN, 'اختبارات المالية وCRM'),
                  ('24', BRAND, 'تقريرًا جاهزًا'), ('29', BRAND, 'شاشة واجهة'), ('36/36', GREEN, 'بندًا منفَّذًا')]))
    S.append(Spacer(1, 7))
    S.append(P('تم تنفيذ التحديث المطلوب على النظام القائم بالكامل ودون إعادة بناء النظام من الصفر: لم تُحذف أي شاشة أو وظيفة عاملة، وتمت مراجعة الواجهة والخادم وقاعدة البيانات والواجهات البرمجية والصلاحيات والتقارير أولًا، ثم أُضيفت الوحدات الجديدة داخل نفس التصميم والهوية.'))
    S.append(P('النتيجة العملية: النظام أصبح يمثل مصدرًا موحدًا لكل ريال (One Source of Truth) — كل مبلغ له حساب مالي ومرجع ومرفق وتاريخ ومستخدم وسجل تدقيق، ولا يوجد أي حذف فعلي للبيانات المالية (يُستبدل بحالات إلغاء/استرداد معاكس)، ولا يُسمح بدفعة تتجاوز قيمة العقد، ويُمنع أي تعارض بين المدفوع والمتبقي وصافي القيمة العقدية.'))
    S.append(Box('الأرقام الفعلية بعد التنفيذ: 30 جدولًا في قاعدة البيانات • 12 حسابًا ماليًا • 66 حركة مالية متولّدة تلقائيًا من الدفعات والمصروفات • 24 تقريرًا (منها 14 تقريرًا جديدًا) • 538 نقطة وصول API • 29 شاشة في الواجهة العربية RTL.', BRAND))
    S.append(H2('أبرز ما تحقق'))
    for t in ['بناء نظام مالي كامل: حسابات (نقدي/بنك/مشروع/أخرى) + حركات + أرصدة تُحسب تلقائيًا من الحركات لا تُكتب يدويًا.',
              'إعادة بناء الدفعات: عميل/بيع/عقد/وحدة/مشروع/مبلغ/تاريخ/طريقة/حساب مستلم/بنك/مرجع/شيك/حالة/مرفق/ملاحظات/مستخدم.',
              'العربون أصبح دفعة حقيقية مرتبطة بالحجز والحساب ثم يتحوّل إلى بيع دون أي احتساب مزدوج (وتم ترحيل البيانات القديمة).',
              'جدول أقساط لكل عقد/بيع + تقرير متأخرات يشمل أيام التأخير وآخر دفعة وآخر متابعة.',
              'كشوف حساب العميل والمشروع مع Drill-down كامل، قابلة للطباعة وPDF وExcel.',
              'حالة الوحدة بسجل تاريخي غير قابل للحذف (unit_status_history).',
              'CRM: اهتمامات العملاء المتعددة، والفلاتر المتقدمة، ومطابقة الاهتمامات بالوحدات، وسجل التواصل والمتابعات.',
              'مسار بيع بعشر مراحل مسجّل بالتواريخ (client_stage_history).']:
        S.append(LI(t))

    # ===== 2) المنهجية =====
    sec('2) نطاق العمل والمنهجية')
    S.append(P('اعتمد التنفيذ قاعدة "الفحص قبل الكتابة": فحص كامل للمشروع القائم (الواجهة، الخادم، قاعدة البيانات، الواجهات البرمجية، المسارات، المكوّنات، الخدمات، التقارير، المصادقة، الصلاحيات، Excel/PDF، وعلاقات الجداول) ثم التنفيذ التدريجي مع اختبار بعد كل خطوة.'))
    S.append(table(['المرحلة', 'المحتوى', 'النتيجة'], [
        ['1. الفحص', 'قراءة كل ملفات الواجهة والخادم وقاعدة البيانات وتحديد الفجوات مقابل البنود الـ36', 'تم'],
        ['2. قاعدة البيانات', 'هجرات M1–M3: جداول مالية وCRM، أعمدة ربط الملفات، فهارس، وترحيل البيانات القديمة', 'تم'],
        ['3. الخادم (API)', 'وحدات api_finance و api_crm و finance_core و estate_core وتوسيع api2 و api', 'تم'],
        ['4. الواجهة', '13 شاشة جديدة + تطوير مركز التقارير والقائمة الجانبية والمسارات', 'تم'],
        ['5. التوثيق', 'مجلد docs + هذا التقرير وتقرير الواجهة وتقرير كل بند', 'تم'],
    ], [26 * mm, 108 * mm, 20 * mm], center_cols=(2,)))
    S.append(Box('قاعدة أساسية التُزم بها: لا يُضاف أي مبلغ مالي بشكل متكرر — الجداول الجديدة تحمل سياق العملية (حجز/بيع/عقد/مصروف/استرداد)، والمصدر المالي الوحيد للحركة هو جدول transactions المرتبط بالحساب.', AMBER))

    # ===== 3) ما تم إصلاحه =====
    sec('3) ما تم إصلاحه (المشاكل التي كانت قائمة)')
    S.append(table(['#', 'المشكلة قبل التحديث', 'الإصلاح', 'الأثر'], [
        ['1', 'الدفعات مرتبطة بالبيع فقط (sale_id إلزامي) — لا حجز ولا عقد ولا حساب مالي', 'إعادة بناء جدول payments مع مفاتيح اختيارية (بيع/حجز/عقد/وحدة/مشروع/حساب) وترحيل البيانات القديمة', 'دفعات صحيحة لكل عملية دون فقدان سجل'],
        ['2', 'العربون قيمة في جدول الحجوزات ولا يظهر كدفعة', 'ترحيل العربونات إلى دفعات فعلية + قاعدة تحويل دون ازدواج', 'توحيد الأرصدة'],
        ['3', 'لا يوجد حساب مالي ولا أرصدة حقيقية', 'حسابات + transactions + رصيد يُحسب من الحركات', 'مطابقة النقدية والبنك'],
        ['4', 'لا يوجد جدول أقساط أو تقرير متأخرات', 'payment_schedule + تقرير المتأخرات', 'متابعة التحصيل'],
        ['5', 'لا توجد مصروفات ولا أوامر صرف ولا اعتمادات', 'expenses + تصنيفات + اعتماد + صرف على الحساب', 'رقابة على المصروفات'],
        ['6', 'لا توجد عقود ولا حالات توقيع', 'contracts بحالات كاملة + نسخة موقعة + تاريخ توقيع', 'ضبط قانوني للعقود'],
        ['7', 'لا توجد عروض أسعار ولا تحويل منها إلى حجز', 'quotations + بنود + تحويل إلى حجز + طباعة/PDF', 'تسريع دورة البيع'],
        ['8', 'لا يوجد CRM (مراحل عملاء/اهتمامات/تواصل)', 'client_interests + client_stage_history + communications + pipeline', 'متابعة عملاء منظمة'],
        ['9', 'فلترة الوحدات بعدد الغرف لا تدعم أكبر من أو بين', 'فلترة NUMERIC ديناميكية (= و ≥ و ≤ و بين)', 'نتائج بحث دقيقة'],
        ['10', 'تاريخ حالة الوحدة يُفقد عند التغيير', 'unit_status_history غير قابل للحذف', 'تتبع كامل للوحدة'],
        ['11', 'الاستردادات والإلغاءات غير موجودة', 'refunds + قيود معاكسة تُبقي الدفعات الأصلية', 'لا حذف للبيانات المالية'],
        ['12', 'تعديل المبالغ والخصومات الكبيرة يمر بلا اعتماد', 'approvals + تنفيذ تلقائي بعد الاعتماد + سجل تدقيق', 'ضبط الصلاحيات'],
        ['13', 'مركز التقارير بلا فلاتر ولا ترويسة رسمية', 'فلاتر ديناميكية من الخادم + رقم تقرير وتاريخ ومستخدم وفلاتر مطبقة', 'تقارير قابلة للاعتماد'],
        ['14', 'المرفقات لا تُربط بالحجز والعقد والدفعة والمصروف والعرض', 'توسيع /api/files بسبعة مفاتيح ربط جديدة', 'ملفات مرتبطة بالكيان'],
    ], [8 * mm, 62 * mm, 62 * mm, 22 * mm], center_cols=(0,)))

    # ===== 4) ما تمت إضافته =====
    sec('4) ما تمت إضافته')
    S.append(H2('4-1 جداول ووحدات قاعدة البيانات'))
    S.append(table(['الجدول', 'الغرض', 'أهم الحقول'], [
        ['accounts', 'الحسابات المالية (نقدي/بنك/مشروع/أخرى)', 'name, type, kind, opening_balance, is_default'],
        ['transactions', 'الحركات المالية — مصدر الرصيد', 'account_id, kind (in/out), amount, ref_type, ref_id, user_id'],
        ['expenses', 'المصروفات وأوامر الصرف', 'category_id, project_id, beneficiary, amount, status, account_id'],
        ['refunds', 'الاستردادات والقيود المعاكسة', 'sale_id, reservation_id, amount, method, account_id, status'],
        ['commissions', 'عمولة كل بيع (تُنشأ تلقائيًا)', 'sale_id, broker_id, rate, commission, paid, due_date, status'],
        ['commission_payments', 'دفعات العمولات', 'commission_id, broker_id, amount, account_id'],
        ['quotations', 'عروض الأسعار وبنودها', 'client_id, project_id, unit_id, total, status, valid_until'],
        ['contracts', 'العقود وحالاتها', 'sale_id, client_id, net_amount, status, signed_at, file_id'],
        ['payment_schedule', 'جدول الأقساط والاستحقاقات', 'sale_id, client_id, project_id, seq, due_date, amount, paid_amount, status'],
        ['client_interests', 'اهتمامات العملاء (متعددة لكل عميل)', 'client_id, property_type, project_id, budget, rooms, bathrooms, area, parking, floor, roof, purpose'],
        ['communications', 'سجل التواصل والمتابعات', 'client_id, user_id, kind, body, result, next_follow_up'],
        ['client_stage_history', 'تاريخ مراحل العميل في مسار البيع', 'client_id, from_stage, to_stage, changed_at, user_id'],
        ['unit_status_history', 'سجل حالات الوحدة (غير قابل للحذف)', 'unit_id, from_status, to_status, note, user_id'],
        ['approvals', 'الموافقات والطلبات', 'module, action_type, ref_id, amount, status, requester_id, decider_id'],
    ], [30 * mm, 46 * mm, 80 * mm]))
    S.append(H2('4-2 الواجهات البرمجية الجديدة'))
    S.append(table(['الوحدة', 'أمثلة على المسارات', 'العدد'], [
        ['api_finance.js', 'accounts, transactions, payments, expenses, schedule, refunds, commissions, approvals, statements, finance-overview', '152'],
        ['api_crm.js', 'interests, interests/meta, interests/match-units, interests/messages, pipeline, communications/upcoming', '90'],
        ['api2.js (موسّع)', 'reports (24 تقريرًا) و /reports/:name/excel و تقارير الاهتمامات وغيرها', '64'],
        ['api.js (موسّع)', 'الوحدات الأساسية + الفلترة المتقدمة للوحدات • الترقيم والتجزئة', '55'],
    ], [34 * mm, 104 * mm, 18 * mm], center_cols=(2,)))
    S.append(H2('4-3 شاشات الواجهة (13 شاشة جديدة)'))
    S.append(table(['الشاشة', 'الوظيفة'], [
        ['الحسابات المالية', 'أرصدة تُحسب تلقائيًا + كشف حساب + تصدير Excel'],
        ['الدفعات والمقبوضات', 'تسجيل وطباعة إيصال وإلغاء دفعة مع المرفقات وحالات الشيك'],
        ['المصروفات', 'تصنيفات + اعتماد المدير + صرف على الحساب'],
        ['جدول الأقساط', 'استحقاقات كل بيع + تبويب المتأخرات + Excel وطباعة'],
        ['عروض الأسعار', 'إنشاء عرض ببنوده + طباعة/PDF + تحويل إلى حجز'],
        ['العقود', 'مسودة ← بانتظار التوقيع ← موقّع ← نشط ← مكتمل/ملغي/منتهي + المرفقات'],
        ['عمولات المسوقين', 'عمولة كل بيع + صرف العمولات + كشف حساب المسوق'],
        ['كشوف الحسابات', 'كشف عميل وكشف مشروع مع Drill-down وطباعة وExcel'],
        ['الموافقات والطلبات', 'اعتماد أو رفض مع تسجيل الطلب في سجل التدقيق'],
        ['اهتمامات العملاء', 'فلاتر متقدمة + مطابقة الوحدات + رسائل واتساب + تصدير Excel'],
        ['مسار البيع (Pipeline)', 'لوح بعشر مراحل مع التواريخ والموظف المسؤول'],
        ['سجل التواصل', 'سجل كامل + متابعات 30 يومًا مع رابط واتساب'],
        ['العملاء (مطوّرة)', 'اهتمامات العميل وملخصه المالي داخل ملف العميل'],
    ], [40 * mm, 116 * mm]))

    # ===== 5) قاعدة البيانات =====
    sec('5) قاعدة البيانات: الجداول والعلاقات والفهارس والهجرات')
    S.append(table(['البند', 'التفصيل'], [
        ['عدد الجداول', '30 جدولًا (منها 14 جدولًا جديدًا) + جدول الهجرات migrations'],
        ['الهجرات', 'M1 بناء المالية وCRM — M2 الحسابات والتصنيفات الافتراضية ومراحل المسار والصلاحيات — M3 ترحيل العربونات والعقود وجداول الأقساط والمراحل'],
        ['سلامة البيانات', 'جميع الجداول الجديدة مرتبطة بمفاتيح أجنبية منطقية (عميل/وحدة/مشروع/بيع/مستخدم/حساب) مع قيود إلزامية للمبالغ'],
        ['الفهارس', 'أكثر من 60 فهرسًا، منها للجداول الجديدة: فهارس الحسابات والحركات والدفعات والأقساط والمصروفات والاهتمامات والتواصل والعمولات والعقود وسجلات الحالات'],
        ['الترحيل', 'الدفعات القديمة نُقلت إلى البنية الجديدة، والعربونات رُحّلت إلى دفعات فعلية بحساب مالي ومرجع، وأُنشئ جدول أقساط لعمليات البيع القائمة، ورُحّلت حالات العملاء إلى مسار البيع'],
        ['عدم الحذف', 'لا حذف فعلي للبيانات المالية: الحذف ممنوع على الدفعات والمصروفات والحركات، ويُستبدل بالإلغاء أو الاسترداد مع قيد معاكس'],
        ['الأداء', 'فهارس على أعمدة الفلترة والتواريخ + ترقيم صفحات (limit و page) على كل القوائم الكبيرة'],
    ], [32 * mm, 124 * mm]))

    # ===== 6) الأمان =====
    sec('6) الأمان والصلاحيات')
    S.append(H2('6-1 المراجعة الأمنية (البند 28)'))
    for t in ['كلمات المرور تُخزَّن مُشفَّرة ولا تُعاد في أي رد من الواجهة البرمجية، والدخول بجلسة JWT بصلاحية زمنية.',
              'كل نقطة وصول محمية بالمصادقة مع صلاحيات على مستوى الوحدة والحركة (عرض/إضافة/تعديل/حذف/اعتماد/تصدير).',
              'الاستعلامات مُعاملية، وقد تم اختبار محاولات حقن SQL ورفضها.',
              'تنقية المدخلات ومنع XSS في المخرجات، وترويسات أمان للخادم، وحماية مسارات المرفقات من الكتابة خارج المجلد المخصص.',
              'الملفات: التحقق من النوع والحجم والتخزين بأسماء داخلية مع ربطها بالكيان (عميل/وحدة/مشروع/حجز/بيع/عقد/دفعة/مصروف/عرض/استرداد/اهتمام/حساب).',
              'تسجيل سجل تدقيق لكل عملية مالية أو اعتماد أو تغيير حالة.']:
        S.append(LI(t))
    S.append(H2('6-2 مصفوفة الصلاحيات (أمثلة مُختبرة)'))
    S.append(table(['المستخدم', 'الحسابات المالية', 'اعتماد المصروفات', 'الموافقات', 'الاهتمامات'], [
        ['مدير النظام', 'كامل', 'نعم', 'نعم', 'كامل'],
        ['المحاسب', 'كامل', 'لا', 'لا', 'اطلاع'],
        ['السكرتيرة', 'لا ترى الحسابات', 'لا', 'لا', 'متابعة'],
    ], [40 * mm, 40 * mm, 34 * mm, 22 * mm, 24 * mm], center_cols=(1, 2, 3, 4)))

    # ===== 7) التقارير =====
    sec('7) التقارير والطباعة وExcel')
    S.append(P('جميع التقارير (24) تدعم: العرض بفلاتر، والطباعة/PDF عربية RTL بترويسة الشركة وشعارها واسم التقرير ورقمه وتاريخه والمستخدم والفلاتر المطبقة، وتصدير Excel احترافيًا بنفس الهوية.'))
    S.append(table(['المجموعة', 'التقارير'], [
        ['تقارير أساسية', 'المهام، العملاء، المواعيد، الاتصالات، النشاط، المستخدمون، الحجوزات، المبيعات، التقرير المالي، الوحدات'],
        ['تقارير مالية جديدة', 'التحصيلات، المبالغ المتأخرة (الأقساط)، جدول الأقساط، المصروفات، عمولات المسوقين، الحسابات والأرصدة، الاستردادات، التقرير المالي للمشاريع'],
        ['تقارير العقود والوحدات', 'العقود، عروض الأسعار، الوحدات والمخزون العقاري'],
        ['تقارير CRM', 'العملاء المهتمون، العملاء غير المتابعين (30 يومًا)، الطلبات الأكثر تكرارًا'],
    ], [36 * mm, 120 * mm]))
    S.append(Box('كل تقرير مالي يُبنى من مصدر واحد (الحركات، جدول الأقساط، المصروفات، العمولات) فلا يوجد احتساب مزدوج، ويمكن مطابقة إجمالي أي تقرير مع كشف الحساب وكشف المشروع في نفس اللحظة.', GREEN))

    # ===== 8) الاختبارات =====
    sec('8) الاختبارات والتحقق')
    S.append(table(['المجموعة', 'الملف', 'النتيجة', 'ما تغطيه'], [
        ['المراجعة الأساسية', 'scripts/test.js', '46 ناجح / 0 فاشل', 'المصادقة، المهام، العملاء، الوحدات، الحجوزات، المبيعات، الدفعات، الصلاحيات، التقارير، Excel، المساعد، النسخ الاحتياطي'],
        ['المالية و CRM', 'scripts/test2.js', '134 ناجح / 0 فاشل', 'الحسابات، الحركات، الدفعات، المصروفات، الاعتمادات، الأقساط، الاستردادات، العمولات، العقود، العروض، الاهتمامات، المطابقة، التواصل، المسار، التقارير، الصلاحيات، لوحة الملخص'],
        ['السلسلة الكاملة', 'E2E', 'نجح', 'عميل ← اهتمام ← عرض سعر ← حجز ← عربون (دفعة وحركة ورصيد) ← عقد ← بيع ← جدول أقساط ← دفعات ← عمولة ← كشف حساب'],
        ['بناء الواجهة', 'vite build', 'نجح', 'كل الشاشات (29) تُبنى دون أخطاء'],
    ], [26 * mm, 26 * mm, 28 * mm, 76 * mm], center_cols=(2,)))
    S.append(H2('8-1 قواعد التحقق المالي المُختبرة (البند 34)'))
    for t in ['منع أي دفعة تتجاوز قيمة العقد أو الصافي — يُرفض الطلب، والتجاوز يتطلب اعتمادًا صريحًا.',
              'ثبات المعادلة: المدفوع + المتبقي = صافي القيمة العقدية (يُختبر في كل عملية).',
              'كل مبلغ له: حساب مالي ومرجع للعملية وتاريخ ومستخدم وقيد تدقيق.',
              'الأرصدة لا تُكتب يدويًا بل تُحسب من الحركات — وأي إلغاء أو استرداد يولّد حركة معاكسة.',
              'منع الازدواج عند تحويل العربون إلى بيع فلا يُحسب مرتين.']:
        S.append(LI(t))

    # ===== 9) خريطة البنود =====
    sec('9) خريطة تنفيذ البنود الـ36')
    S.append(P('الجدول التالي يوضح حالة كل بند من بنود التكليف مع مكان التنفيذ:'))
    rows = [
        ['1', 'حسابات مالية وأرصدة تلقائية', 'تم', 'accounts + transactions + شاشة الحسابات'],
        ['2', 'إعادة بناء الدفعات بكل الحقول', 'تم', 'payments + شاشة الدفعات'],
        ['3', 'العربون دفعة حقيقية وتحويل دون ازدواج', 'تم', 'finance_core + هجرة الترحيل'],
        ['4', 'المصروفات وتصنيفاتها واعتمادها', 'تم', 'expenses + شاشة المصروفات'],
        ['5', 'كشف حساب المشروع مع Drill-down', 'تم', 'statements/project + شاشة الكشوف'],
        ['6', 'جدول الدفعات وتقرير المتأخرات', 'تم', 'payment_schedule + شاشة الأقساط'],
        ['7', 'كشف حساب العميل (قيمة ← خصم ← صافي ← مدفوع ← متأخر ← متبقي)', 'تم', 'statements/client + طباعة وExcel'],
        ['8', 'المسوقون والعمولات لكل بيع', 'تم', 'commissions + شاشة العمولات'],
        ['9', 'العقود وحالاتها والنسخة الموقعة', 'تم', 'contracts + شاشة العقود'],
        ['10', 'عروض الأسعار والتحويل إلى حجز', 'تم', 'quotations + شاشة العروض'],
        ['11', 'مسار البيع بعشر مراحل بالتواريخ', 'تم', 'client_stage_history + pipeline'],
        ['12', 'اهتمامات العملاء المتعددة وحقولها', 'تم', 'client_interests + شاشة الاهتمامات'],
        ['13', 'الفلاتر المتقدمة للاهتمامات', 'تم', 'واجهة الاهتمامات في الخادم والواجهة'],
        ['14', 'فلترة الغرف (= و ≥ و ≤ و بين) ديناميكية', 'تم', 'unitFilterWhere + الواجهة'],
        ['15', 'سلسلة إضافة الوحدة (مشروع ← مبنى ← دور)', 'تم', 'الدوارات تُجلب لكل مبنى + تحقق إلزامي'],
        ['16', 'أنواع الأدوار (روف/تراس/ميزانين/قبو) والوصف الصحيح', 'تم', 'أنواع الأدوار + عرض «الدور — النوع»'],
        ['17', 'فلاتر الوحدات الشاملة', 'تم', 'الوحدات في الخادم والواجهة'],
        ['18', 'زر العملاء المهتمون بهذه الوحدة', 'تم', 'interests/match-units'],
        ['19', 'تصدير الاهتمامات Excel بالأعمدة المطلوبة', 'تم', 'interests/excel'],
        ['20', 'قوالب الرسائل ومتغيراتها وفتح واتساب', 'تم', 'interests/messages + القوالب'],
        ['21', 'سجل التواصل والمتابعة', 'تم', 'communications + الشاشة'],
        ['22', 'تقارير المهتمين وغير المتابعين والأكثر تكرارًا', 'تم', 'ثلاثة تقارير جديدة'],
        ['23', 'سجل حالة الوحدة غير القابل للحذف', 'تم', 'unit_status_history'],
        ['24', 'الإلغاء والاسترداد دون حذف الدفعات', 'تم', 'refunds + قيود معاكسة'],
        ['25', 'الموافقات وسجل التدقيق', 'تم', 'approvals + audit_logs'],
        ['26', 'تقرير مالي موحّد بكل الفلاتر دون ازدواج', 'تم', 'مركز التقارير + الفلاتر الديناميكية'],
        ['27', 'PDF وExcel لكل تقرير مهم بهوية الشركة', 'تم', 'مولّد التقارير + مولّد Excel'],
        ['28', 'المراجعة الأمنية', 'تم', 'المصادقة والأمان + الاختبارات'],
        ['29', 'مراجعة قاعدة البيانات (مفاتيح وفهارس وهجرات)', 'تم', 'migrations.js'],
        ['30', 'منع الحذف النهائي للبيانات المالية', 'تم', 'سياسات الحذف والإلغاء'],
        ['31', 'فهارس الأداء والترقيم', 'تم', '60+ فهرس + limit و page'],
        ['32', 'الحفاظ على التصميم RTL وحالات التحميل والفراغ والتأكيد', 'تم', 'الواجهة كاملة'],
        ['33', 'اختبارات تغطي القائمة', 'تم', 'test.js + test2.js'],
        ['34', 'القواعد المالية الحرجة', 'تم', 'النواة المالية + الاختبارات'],
        ['35', 'اختبار السلسلة الكاملة من البداية للنهاية', 'تم', 'سلسلة موثّقة'],
        ['36', 'تقرير نهائي بهذا التنسيق', 'تم', 'هذا الملف (PDF)'],
    ]
    S.append(table(['م', 'المتطلب', 'الحالة', 'مكان التنفيذ'], rows, [10 * mm, 70 * mm, 16 * mm, 60 * mm], center_cols=(0, 2)))

    # ===== 10) المشاكل المتبقية =====
    sec('10) المشاكل المتبقية والقيود')
    S.append(table(['#', 'البند', 'التفصيل', 'الأثر / المعالجة المقترحة'], [
        ['1', 'إرسال واتساب', 'الرسائل تُجهَّز وتُنسخ وتُفتح من المستخدم (لا إرسال جماعي آلي) التزامًا بالمتطلب', 'التشغيل الآلي جاهز عبر القوالب ويمكن ربط واتساب Business API عند تفعيل الحساب'],
        ['2', 'التقارير الطويلة', 'التقارير تُصدَّر Excel كاملة، وشاشة العرض تعرض أول 200 سجل', 'يمكن إضافة ترقيم صفحات للطباعة عند الحاجة'],
        ['3', 'اعتماد المدير', 'المصروف فوق السقف (5000 افتراضيًا) وأي خصم أو تعديل حساس يتطلب اعتماد المدير', 'سلوك مقصود — والسقف قابل للتعديل من الإعدادات'],
        ['4', 'بيانات تجريبية', 'قاعدة البيانات تحتوي بيانات العرض والاختبار (عملاء و91 وحدة و13 عملية بيع)', 'تُفرَّغ عند التشغيل الفعلي مع الاحتفاظ بنسخة احتياطية'],
        ['5', 'بيئة التشغيل', 'كلمات المرور الافتراضية للمستخدمين التجريبيين ما زالت مفعّلة', 'يجب تغييرها قبل النشر الإنتاجي'],
    ], [8 * mm, 30 * mm, 70 * mm, 48 * mm], center_cols=(0,)))

    # ===== 11) التوصيات =====
    sec('11) التوصيات')
    for t in ['تفعيل واتساب Business API لتشغيل الإرسال الآلي للقوالب بنفس متغيراتها الحالية.',
              'تغيير كلمات المرور الافتراضية وتفعيل سياسة كلمة مرور قوية، وتقليل مدة صلاحية التوكن إن لزم.',
              'تشغيل نسخ احتياطي دوري (النسخ الاحتياطي موجود) مع اختبار استعادة شهريًا.',
              'مراجعة سقف اعتماد المصروفات وحدود الخصم من إعدادات النظام بما يوافق سياسة الشركة.',
              'الانتقال إلى قاعدة بيانات خدمية (PostgreSQL) عند تعدد المستخدمين والتزامن العالي.',
              'تدريب المستخدمين على كشوف الحسابات وجدول الأقساط والموافقات لتحقيق أكبر منفعة من الإضافات.',
              'إضافة ترقيم صفحات للطباعة في التقارير الطويلة، وتسجيل نتيجة التواصل تلقائيًا بعد إرسال الواتساب.']:
        S.append(LI(t))

    # ===== 12) ملحق =====
    sec('12) ملحق: التحقق وإعادة الإنتاج')
    S.append(H2('12-1 أوامر التحقق'))
    S.append(table(['الغرض', 'الأمر'], [
        ['معاينة الخادم', 'curl http://127.0.0.1:3847/api/health'],
        ['اختبار المراجعة الأساسية', 'API=http://127.0.0.1:3847/api node scripts/test.js'],
        ['اختبار المالية و CRM', 'API=http://127.0.0.1:3847/api node scripts/test2.js'],
        ['بناء الواجهة', 'cd client && npx vite build'],
        ['توليد هذا التقرير', 'python3 scripts/make_report.py'],
    ], [40 * mm, 116 * mm]))
    S.append(H2('12-2 ملفات مهمة'))
    S.append(table(['الملف', 'المحتوى'], [
        ['docs/final-report.pdf', 'هذا التقرير (تنسيق البند 36)'],
        ['docs/frontend-report.md', 'تقرير الواجهة (الصفحات والمكوّنات والفحص)'],
        ['docs/FINAL-REPORT.md', 'التقرير الفني السابق (مرجع)'],
        ['server/migrations.js', 'هجرات قاعدة البيانات M1–M3'],
        ['server/finance_core.js و server/estate_core.js', 'النواة المالية ونواة العقارات والوحدات'],
        ['server/api_finance.js و api_crm.js و api2.js', 'الواجهات البرمجية المالية و CRM والتقارير'],
        ['scripts/test.js و scripts/test2.js', 'مجموعات الاختبار (46 و 134)'],
    ], [62 * mm, 94 * mm]))
    S.append(Spacer(1, 6))
    S.append(Box('خلاصة: تم تنفيذ التحديث الكامل المطلوب على النظام القائم دون أي إعادة بناء ودون حذف أي وظيفة عاملة، وبتحقق آلي 46/46 و134/0 وبناء واجهة ناجح. النظام جاهز للتشغيل بعد تغيير كلمات المرور الافتراضية وتنظيف البيانات التجريبية.', GREEN))

    doc.build(S)
    return doc


if __name__ == '__main__':
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    first = build('/tmp/report-pass1.pdf')        # مرور أول: قياس أرقام الصفحات
    final = build(OUT, first.toc_pages)           # مرور ثانٍ: الفهرس بأرقامه الصحيحة
    print('تم إنشاء:', OUT, os.path.getsize(OUT), 'بايت — عدد الصفحات:', final.page)
