#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# هذا التشغيل مخصص خلف Reverse Proxy يقدم HTTPS (مثل Caddy أو Nginx).
# لا تفتحي منفذ Python مباشرة للإنترنت.
export PORT="${PORT:-3000}"
export ESPAN_BIND_HOST="127.0.0.1"
export ESPAN_STRICT_PORT="1"
export ESPAN_SECURE_COOKIE="1"
export ESPAN_MAX_BODY_BYTES="${ESPAN_MAX_BODY_BYTES:-10485760}"

exec python3 server.py
