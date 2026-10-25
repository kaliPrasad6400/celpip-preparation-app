#!/usr/bin/env bash
# CELPIP Mastery 12 — one-command local start (macOS / Linux).
#   ./start.sh          build (if needed) and run at http://localhost:8000
#   ./start.sh --dev    hot-reload dev mode (backend :8000 + Vite :5173)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PY="${PYTHON:-python3}"
if [ ! -x backend/.venv/bin/python ]; then
  echo "→ Creating Python virtual environment…"
  "$PY" -m venv backend/.venv
fi
if [ ! -f backend/.venv/.deps-installed ] || [ backend/requirements.txt -nt backend/.venv/.deps-installed ]; then
  echo "→ Installing backend dependencies…"
  backend/.venv/bin/pip install -q --upgrade pip
  backend/.venv/bin/pip install -q -r backend/requirements.txt
  touch backend/.venv/.deps-installed
fi
if [ ! -d frontend/node_modules ]; then
  echo "→ Installing frontend dependencies…"
  (cd frontend && npm install --silent)
fi
[ -f backend/.env ] || { cp backend/.env.example backend/.env; chmod 600 backend/.env; }

echo "→ Applying database migrations…"
(cd backend && .venv/bin/python -m app.migrate)

if [ "${1:-}" = "--dev" ]; then
  echo "→ Dev mode: http://localhost:5173"
  (cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload) &
  BACK=$!
  trap 'kill $BACK 2>/dev/null' EXIT
  (cd frontend && npm run dev)
  exit 0
fi

if [ ! -f frontend/dist/index.html ] || [ -n "$(find frontend/src frontend/index.html -newer frontend/dist/index.html -print -quit)" ]; then
  echo "→ Building the interface…"
  (cd frontend && npm run build --silent)
fi

URL="http://localhost:8000"
echo "→ CELPIP Mastery 12 is starting at $URL  (Ctrl+C to stop)"
( sleep 2; command -v open >/dev/null && open "$URL" ) >/dev/null 2>&1 &
cd backend
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
