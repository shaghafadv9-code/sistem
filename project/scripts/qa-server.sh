#!/usr/bin/env bash
# إعادة تشغيل خادم الاختبار على نسخة نظيفة من قاعدة البيانات
# الاستخدام: ./scripts/qa-server.sh [reset|start|stop|log]
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DD="${QA_DATA_DIR:-/tmp/ssqa/data}"
PORT="${QA_PORT:-3847}"
PIDF="/tmp/ssqa.pid"

stop_server() {
  if [ -f "$PIDF" ]; then kill "$(cat $PIDF)" 2>/dev/null || true; rm -f "$PIDF"; fi
  sleep 1
}

case "${1:-reset}" in
  reset)
    stop_server
    rm -rf "$DD" && mkdir -p "$DD"
    cp "$ROOT/data/smart-secretary.db" "$DD/"
    cd "$ROOT"
    DATA_DIR="$DD" PORT="$PORT" HOST=0.0.0.0 node server/index.js > /tmp/ssqa.log 2>&1 &
    echo $! > "$PIDF"
    for i in $(seq 1 30); do
      if curl -sf -m 2 "http://127.0.0.1:$PORT/api/health" > /dev/null; then echo "[qa] server up on :$PORT (pid $(cat $PIDF))"; exit 0; fi
      sleep 1
    done
    echo "[qa] server FAILED to start"; tail -30 /tmp/ssqa.log; exit 1
    ;;
  stop) stop_server; echo "[qa] stopped" ;;
  log) tail -60 /tmp/ssqa.log ;;
esac
