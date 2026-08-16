#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="backups/espan-${STAMP}.sqlite3"
python3 - "$OUT" <<'PY'
import sqlite3, sys
from pathlib import Path
src = Path('data/espan.sqlite3')
out = Path(sys.argv[1])
if not src.exists():
    raise SystemExit('قاعدة البيانات غير موجودة.')
source = sqlite3.connect(src)
target = sqlite3.connect(out)
with target:
    source.backup(target)
target.close(); source.close()
print(out)
PY
chmod 600 "$OUT" 2>/dev/null || true
echo "✅ تم إنشاء النسخة الاحتياطية: $OUT"
