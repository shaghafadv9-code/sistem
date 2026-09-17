#!/usr/bin/env bash
# Smart Secretary — وضع التطوير (Linux / macOS): خوادم + نافذة التطبيق
# الاستخدام: ./run-dev.sh
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[خطأ] Node.js غير مثبت."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "تثبيت مكونات النظام لأول مرة..."
  npm install --no-audit --no-fund
fi

echo "تشغيل الخوادم..."
(npm run server >/tmp/ss-api.log 2>&1 &)
(npm run client >/tmp/ss-web.log 2>&1 &)
echo "انتظار إقلاع الخوادم (8 ثوانٍ)..."
sleep 8
echo "فتح نافذة التطبيق..."
npx electron .
