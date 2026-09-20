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
│  └──────────────┘      │ + SQLite (sql.js)    │  │
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
| AuthZ | مصفوفة صلاحيات 35 وحدة × 9 إجراءات (315 صلاحية) | `server/auth.js` |
| DB | SQLite عبر sql.js/WASM (ملف قياسي، حفظ ذري، صفر ترجمة) | `server/db.js` |
| منطق الأعمال | نواة مالية (قيد مزدوج) + نواة عقارية + منطقة زمنية + أسرار | `finance_core.js`, `estate_core.js`, `time.js`, `secrets.js` |
| التقارير | HTML Print Engine (Chromium) + ExcelJS | `pages/Reports.jsx` + `api2.js` |
| المساعد | NLU عربي محلي (قواعد) + طبقة AI اختيارية بـ fallback | `assistant_engine.js`, `assistant_tools.js`, `ai.js` |

## قاعدة البيانات (49 جدولًا، 101 فهرس)

- **الهوية والصلاحيات:** `roles`, `role_permissions`, `users`, `sessions`
- **العمل:** `clients`, `client_stage_history`, `tasks`, `task_comments`, `appointments`, `calls`, `notes`, `files`, `notifications`, `communications`, `message_templates`, `dashboard_widgets`
- **العقار:** `projects`, `buildings`, `floors`, `units`, `unit_status_history`, `reservations`, `sales`, `contracts`, `quotations`, `client_interests`, `brokers`, `payment_schedule`
- **المالية (قيد مزدوج):** `accounts`, `transactions`, `payments`, `refunds`, `expenses`, `expense_categories`, `invoices`, `commissions`, `commission_payments`, `approvals`, `sys_sequences`
- **الذكاء الاصطناعي:** `ai_providers`, `ai_models`, `ai_permissions`, `ai_usage`, `assistant_conversations`, `assistant_messages`, `assistant_logs`
- **الحوكمة:** `audit_logs`, `settings`, `migrations`, `data_repairs`

القواعد: مفاتيح أجنبية + فهارس على كل FK وحقول البحث + `CHECK` للقيم المالية + `UNIQUE` للأكواد وأسماء الدخول + حذف ناعم (`deleted_at`) + طوابع زمنية + ترحيلات idempotent في `init()` و`migrations.js`.

### نموذج الحفظ (مهم — لا WAL)

المحرك هو **sql.js/WASM**: قاعدة البيانات تُحمَّل كاملة في الذاكرة، وكل كتابة تُحفَظ بإعادة تصدير الملف بالكامل
وكتابته ذرّيًا (`write` إلى `.tmp` ثم `rename`). لذلك:

- **`PRAGMA journal_mode=WAL` غير مطبَّقة عمدًا** — لا معنى لها على قاعدة في الذاكرة، و`db.pragma()` تتجاهلها صراحةً.
- الذرّية الحقيقية تأتي من `db.transaction(fn)`: داخل المعاملة لا يحدث أي `flush`، و`COMMIT` يحفظ مرة واحدة، و`ROLLBACK` يتجاهل كل شيء.
- consequence: عملية واحدة كاتبة في اللحظة (خادم Node واحد) — وهذا مقصود في نموذج Local-First. لا تشغّل خادمين على نفس `DATA_DIR`.

## الأمان

1. كلمات مرور بـ bcrypt (10 rounds) — لا تُخزن نصًا أبدًا.
2. **سياسة كلمات مرور مُلزِمة:** 10 أحرف كحد أدنى، رفض الكلمات الشائعة، رفض احتواء اسم المستخدم، فئتا أحرف على الأقل، منع التكرار والمتتاليات.
3. **كلمة مرور أولى عشوائية:** عند أول تشغيل تُولَّد كلمة مرور عشوائية (15+ حرفًا) وتُطبع مرة واحدة وتُكتب في `data/.initial-admin-password` بصلاحيات `0600`، مع `must_change_password=1`. بوابة `passwordChangeGate` تحجب كل المسارات (عدا قائمة بيضاء) حتى التغيير، وواجهة `ForcePasswordChange` تفرضه في المتصفح. الملف يُحذف بعد التغيير.
4. جلسات JWT (24 ساعة) + سجل جلسات في DB + حد 5 جلسات + إبطال عند الخروج/الحذف/التدوير.
5. **الأسرار خارج المستودع:** `server/secrets.js` يولّد مفتاح الجلسات ومفتاح تغليف مفاتيح AI داخل `DATA_DIR` بصلاحيات `0600`، أو يقرأهما من `SS_JWT_SECRET` / `SS_AI_MASTER_KEY`. لا سر مثبت في الكود، و`/api/system/secrets` يعيد الحالة فقط (بلا قيم) ويتيح التدوير.
6. `requirePerm(module, action)` على **كل** مسار — أي طلب بلا صلاحية يُرفض 403 ويُوثق في التدقيق. نقاط النظام (`/system/*`) تتطلب مستوى مدير.
7. تحقق من المدخلات + منع القيم المالية غير المنطقية في الخادم (وليس الواجهة فقط).
8. **الملفات:** مخزَّنة خارج مجلد الويب، والتنزيل عبر تذكرة موقعة قصيرة العمر (`/files/:id/ticket`) مع فحص صلاحية على الملف نفسه + منع اجتياز المسار + حد 50MB. ترويسات CSP و`X-Content-Type-Options` و`Referrer-Policy` مفعّلة.
9. **CORS بالرفض الصامت:** الأصول غير المدرجة في القائمة لا تحصل على `Access-Control-Allow-Origin` إطلاقًا (لا `*`).
10. سجل تدقيق: دخول/خروج/إنشاء/تعديل/حذف/تصدير/صلاحيات/إعدادات/تدوير أسرار.
11. **وضع الديمو** لا يمكن تفعيله عندما `NODE_ENV=production`، وصفحة الدخول لا تعرض أي بيانات اعتماد.

## الأداء

- ترقيم صفحات في كل القوائم (لا تحميل شامل).
- تحميل كسول للصفحات (React.lazy + code splitting) — الحزمة الرئيسية ~212KB (69KB مضغوطة).
- فهارس DB (101 فهرس) + استعلامات مجمعة للوحة القيادة.
- Debounce في البحث الموحد (220ms) + حد أدنى حرفين.
- `flush` واحد لكل معاملة بدل حفظ بعد كل كتابة.

## قابلية التوسع

- إضافة كيان جديد = سطر واحد عبر مصنع `resource()` + صفحة تستخدم مكونات UI الجاهزة.
- إضافة لغة = ملف ترجمة (كل النصوص في `lib/format.js` ومفاتيح `L`).
- التحديث التلقائي: بنية `preload.js` + `electron-updater` جاهزة (تُفعّل بإضافة رابط التحديث).

## الذكاء الاصطناعي (طبقة اختيارية — النظام يعمل كاملًا بدونها)

- **توحيد الصلاحيات:** `server/ai_permissions.js` هو المُحلِّل الوحيد. أي أداة AI تُترجَم إلى `(module, action)` ثم تُفحص بنفس `requirePerm` الخاص بالـAPI — فلا قدرة للـAI على ما لا يملكه المستخدم أصلًا. وحدات مثل `settings` محجوبة قطعًا.
- **المهلات:** مهلة إجمالية للمحادثة (28 ثانية افتراضيًا) ومهلة لكل مزود (10 ثوانٍ). مهلة العميل 45 ثانية (هامش فوق الخادم).
- **إعادة المحاولة:** حتى 3 محاولات، وأخطاء المصادقة (401/403) تتخطى المزود بالكامل بدل تكرار الفشل.
- **صدق الحالة:** `/ai/health` و`/ai/status` يعيدان `verdict` حقيقيًا (`CONNECTED` / `FAILED` / `NOT_CONFIGURED` / `UNKNOWN`) و`operational`، ولا يُعلَن أن AI يعمل إذا كانت كل النماذج فاشلة. الواجهة تعرض شريط تحذير بنفس الحكم.
- **مفاتيح المزودين** مُغلَّفة بمفتاح AI الرئيسي (AES) ولا تُعاد في أي استجابة.

## المنطقة الزمنية

`server/time.js` هو المصدر الوحيد للوقت (`TZ` افتراضيًا منطقة النظام، وتُضبط بـ `SS_TZ`).
كل التواريخ في الخادم تُنتَج عبره، و`/api/system/time` يتحقق أن تاريخ JS يطابق `date('now','localtime')` في SQLite.

## الاختبارات

- `npm test` → `scripts/qa.js` يشغّل الخادم على **نسخة مؤقتة** من قاعدة البيانات ثم ينفّذ جناحين:
  - `scripts/test.js` — الاختبارات الأساسية (46).
  - `scripts/regression.js` — اختبارات انحدار التدقيق (139) تغطي كل قضية حرجة/عالية.
- الاختبارات لا تلمس `data/smart-secretary.db` الأصلي، وقابلة للتكرار تشغيلًا بعد تشغيل.
