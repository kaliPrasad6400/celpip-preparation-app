from __future__ import annotations

import logging
import re
import time
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from . import config, db
from .routers import context, dashboard, data, knowledge, mock, planner, practice, system

FRONTEND_DIST = config.PROJECT_DIR / "frontend" / "dist"
_SECRET_RE = re.compile(r"(sk-(?:ant-)?[A-Za-z0-9_\-]{8})[A-Za-z0-9_\-]+")


class RedactSecrets(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = _SECRET_RE.sub(r"\1…[redacted]", record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(_SECRET_RE.sub(r"\1…[redacted]", a) if isinstance(a, str) else a for a in record.args)
        # Message is rendered now so mapping/non-string args are redacted too.
        try:
            rendered = record.getMessage()
        except Exception:
            return True
        record.msg, record.args = _SECRET_RE.sub(r"\1…[redacted]", rendered), None
        return True


def setup_logging() -> None:
    config.ensure_dirs()
    root = logging.getLogger("celpip")
    if root.handlers:
        return
    root.setLevel(logging.INFO)
    fh = RotatingFileHandler(config.LOG_DIR / "app.log", maxBytes=1_000_000, backupCount=3)
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    fh.addFilter(RedactSecrets())
    sh = logging.StreamHandler()
    sh.addFilter(RedactSecrets())
    root.addHandler(fh)
    root.addHandler(sh)


def cleanup_orphan_audio() -> None:
    """Delete uploaded recordings never attached to an attempt (older than 1 day)."""
    from .models import PracticeAttempt

    if not config.AUDIO_DIR.exists():
        return
    with db.SessionLocal() as s:
        used = {p for p in s.scalars(select(PracticeAttempt.audio_path)) if p}
    cutoff = time.time() - 86400
    for f in config.AUDIO_DIR.iterdir():
        if f.name not in used and f.stat().st_mtime < cutoff:
            f.unlink(missing_ok=True)


def startup() -> None:
    from .migrate import upgrade
    from .seed.loader import seed_all

    setup_logging()
    db.init_engine()
    upgrade()
    with db.SessionLocal() as s:
        seed_all(s)
    cleanup_orphan_audio()
    logging.getLogger("celpip").info("started; database=%s", config.DB_PATH)


@asynccontextmanager
async def lifespan(app: FastAPI):
    startup()
    yield
    if db.engine is not None:
        db.engine.dispose()


app = FastAPI(title=config.APP_NAME, version=config.APP_VERSION, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    logging.getLogger("celpip").exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal error. See data/logs/app.log for details."})


for r in (system, dashboard, planner, practice, knowledge, context, mock, data):
    app.include_router(r.router)

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        f = FRONTEND_DIST / full_path
        if full_path and f.is_file() and FRONTEND_DIST in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(FRONTEND_DIST / "index.html")
