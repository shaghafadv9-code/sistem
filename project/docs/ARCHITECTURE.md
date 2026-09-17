# معمارية النظام — Smart Secretary v1.0.0

## الشكل العام (Local-First Desktop)

```
┌─────────────────────────────────────────────────┐
│  Electron Shell (Windows .exe + Installer)      │
│  ┌──────────────┐      ┌──────────────────────┐  │
│  │ Renderer     │      │ Main Process         │  │
│  │ React 18 SPA │      │ + API Server (Node)  │  │
│  │ RTL Arabic   │◄────►│ Express :3847        │  │
│  │              │ HTTP │ JWT + Permissions    │  │
│  └──────────────┘      │ + SQLite (WAL)       │  │
│                       │ + Files vault        │  │
│                       └──────────────────────┘  │
│  البيانات: %APPDATA%/Smart Secretary/data      │
└─────────────────────────────────────────────────┘
```

**لماذا هذه المعمارية؟**
- تطبيق سطح مكتب حقيقي (نافذة، أيقونة، مثبت، إلغاء تثبيت) وليس موقعًا متنكرًا.
- كل البيانات على جهاز العميل: سريع (<50ms للاستعلامات)، يعمل دون إنترنت، آمن (لا سحابة).
- API محلي يفرض الصلاحيات — نفس الواجهة تخدم Electron والمتصفح (للمعاينة/الشبكة الداخلية مستقبلًا).

## الطبقات

| الطبقة | التقنية | الملفات |
|---|---|---|
| Desktop Shell | Electron 33 | `electron/main.js`, `preload.js` |
| UI | React 18 + Vite + Tailwind + Zustand + Recharts | `client/src/` |
| API | Express 4 + JWT + bcryptjs + multer + ExcelJS | `server/api.js`, `api2.js`, `index.js` |
| AuthZ | مصفوفة صلاحيات 20 وحدة × 8 إجراءات | `server/auth.js` |
| DB | SQLite عبر sql.js/WASM (ملف قياسي، حفظ فوري ذري، صفر ترجمة) | `server/db.js` |
| التقارير | HTML Print Engine (Chromium) + ExcelJS | `pages/Reports.jsx` + `api2.js` |
| المساعد | NLU عربي محلي (قواعد) | `api2.js` → `/assistant` |

## قاعدة البيانات (25 جدولًا)

- **الهوية:** `roles`, `role_permissions`, `users`, `sessions`
- **العمل:** `clients`, `tasks`, `task_comments`, `appointments`, `calls`, `notes`, `files`, `notifications`
- **العقار:** `projects`, `buildings`, `floors`, `units`, `reservations`, `sales`, `payments`, `invoices`
- **الحوكمة:** `audit_logs`, `settings`

القواعد: مفاتيح أجنبية + فهارس على كل FK وحقول البحث + `CHECK` للقيم المالية + `UNIQUE` للأكواد وأسماء الدخول + حذف ناعم (`deleted_at`) + طوابع زمنية + ترحيلات idempotent في `init()`.

## الأمان

1. كلمات مرور بـ bcrypt (10 rounds) — لا تُخزن نصًا أبدًا.
2. جلسات JWT (24 ساعة) + سجل جلسات في DB + حد 5 جلسات + إبطال عند الخروج/الحذف.
3. `requirePerm(module, action)` على **كل** مسار — أي طلب بلا صلاحية يُرفض 403 ويُوثق في التدقيق.
4. تحقق من المدخلات + منع القيم المالية غير المنطقية في الخادم (وليس الواجهة فقط).
5. الملفات خارج مجلد الويب + تنزيل برمز مؤقت + فحص المسار (anti-traversal) + حد 50MB.
6. سجل تدقيق: دخول/خروج/إنشاء/تعديل/حذف/تصدير/صلاحيات/إعدادات.

## الأداء

- ترقيم صفحات في كل القوائم (لا تحميل شامل).
- تحميل كسول للصفحات (React.lazy + code splitting) — الحزمة الرئيسية ~187KB.
- فهارس DB + استعلامات مجمعة للوحة القيادة.
- Debounce في البحث الموحد (220ms) + حد أدنى حرفين.
- WAL mode في SQLite للقراءة المتزامنة.

## قابلية التوسع

- إضافة كيان جديد = سطر واحد عبر مصنع `resource()` + صفحة تستخدم مكونات UI الجاهزة.
- إضافة لغة = ملف ترجمة (كل النصوص في `lib/format.js` ومفاتيح `L`).
- التحديث التلقائي: بنية `preload.js` + `electron-updater` جاهزة (تُفعّل بإضافة رابط التحديث).
