#!/bin/bash
# مساعد تشغيل/إيقاف الخادم أثناء التطوير
cd /home/user/project
case "$1" in
  stop)
    P=$(ps -eo pid,args | grep -E "[s]erver/inde[x]\.js" | awk '{print $1}')
    [ -n "$P" ] && kill $P && echo "stopped: $P" || echo "not running"
    ;;
  start)
    P=$(ps -eo pid,args | grep -E "[s]erver/inde[x]\.js" | awk '{print $1}')
    [ -n "$P" ] && kill $P; sleep 1
    (PORT=3847 DATA_DIR=/home/user/project/data setsid node server/index.js > /tmp/api.log 2>&1 < /dev/null &)
    sleep 6; curl -s -m 3 http://127.0.0.1:3847/api/health; echo
    ;;
esac
