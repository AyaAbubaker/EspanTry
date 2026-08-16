#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ Python 3 غير موجود. ثبتيه أولًا."
  exit 1
fi

for pid in $(pgrep -f '[p]ython3 .*server.py' 2>/dev/null || true); do
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  case "$cwd" in
    *ESPAN*|*Espan*|*espan*) kill "$pid" >/dev/null 2>&1 || true ;;
  esac
done
sleep 0.3

rm -f .espan_port
printf 'تشغيل ESPAN — النسخة النهائية المحلية...\n'
ESPAN_BIND_HOST=127.0.0.1 ESPAN_SECURE_COOKIE=0 python3 server.py &
SERVER_PID=$!
cleanup(){ kill "$SERVER_PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

for _ in $(seq 1 80); do
  [ -f .espan_port ] && break
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    wait "$SERVER_PID" || true
    echo "❌ تعذر تشغيل الخادم."
    exit 1
  fi
  sleep 0.1
done

[ -f .espan_port ] || { echo "❌ لم يتم تحديد رابط التشغيل."; exit 1; }
PORT_USED="$(cat .espan_port)"
URL="http://localhost:${PORT_USED}/auth.html"
printf '\n✅ ESPAN جاهز\nالرابط الصحيح: %s\n' "$URL"
if command -v xdg-open >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  (sleep 0.4; xdg-open "$URL" >/dev/null 2>&1 || true) &
fi
echo "اتركي هذه النافذة مفتوحة أثناء استخدام الموقع. للإيقاف Ctrl+C."
wait "$SERVER_PID"
