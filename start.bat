@echo off
REM CELPIP Mastery 12 - local start for Windows (requires Python 3.11+ and Node.js 20+)
cd /d "%~dp0"
if not exist backend\.venv\Scripts\python.exe (
  echo Creating Python virtual environment...
  py -3 -m venv backend\.venv || python -m venv backend\.venv
)
backend\.venv\Scripts\python -m pip install -q -r backend\requirements.txt
if not exist frontend\node_modules (
  pushd frontend & call npm install & popd
)
if not exist backend\.env copy backend\.env.example backend\.env >nul
pushd backend & .venv\Scripts\python -m app.migrate & popd
if not exist frontend\dist\index.html (
  pushd frontend & call npm run build & popd
)
start "" http://localhost:8000
pushd backend
.venv\Scripts\uvicorn app.main:app --host 127.0.0.1 --port 8000
popd
