#!/usr/bin/env bash
# Smart Secretary — تشغيل النظام (Linux / macOS)
# الاستخدام: ./run.sh
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[خطأ] Node.js غير مثبت على هذا الجهاز."
  exit 1
fi

NODEMAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODEMAJOR" -lt 20 ]; then
  echo "[خطأ] نسخة Node.js قديمة ($NODEMAJOR) — النظام يتطلب 20 أو أحدث."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[1/4] تثبيت مكونات النظام لأول مرة..."
  npm install --no-audit --no-fund
fi

if [ ! -f node_modules/electron/dist/electron ]; then
  echo "[2/4] إصلاح تثبيت Electron..."
  npm install --no-audit --no-fund -D electron@33
fi

if [ ! -d client/dist ]; then
  echo "[3/4] بناء الواجهة لأول مرة..."
  npm run build:client
fi

echo "[4/4] تشغيل Smart Secretary..."
if ! USE_BUILD=1 npx electron .; then
  echo ""
  echo "[خطأ] أُغلق التطبيق بشكل غير متوقع."
  echo "راجع ملف السجل لمعرفة السبب: data/api.log"
fi
