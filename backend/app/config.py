"""Process-level configuration.

Secrets (API keys) live only in backend/.env (gitignored) and in this process's
memory. They are never written to the database, never returned by any API
endpoint, and never logged.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import dotenv_values, set_key, unset_key

APP_NAME = "CELPIP Mastery 12"
APP_VERSION = "1.0.0"

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent
ENV_FILE = Path(os.environ.get("CELPIP_ENV_FILE", BACKEND_DIR / ".env"))

_db_env = os.environ.get("CELPIP_DB_PATH")
# A custom database path keeps its audio/backups/logs beside it unless CELPIP_DATA_DIR is set.
DATA_DIR = Path(os.environ.get("CELPIP_DATA_DIR") or (Path(_db_env).parent / (Path(_db_env).stem + "-data") if _db_env else PROJECT_DIR / "data"))
DB_PATH = Path(_db_env) if _db_env else DATA_DIR / "celpip.db"
AUDIO_DIR = DATA_DIR / "audio"
BACKUP_DIR = DATA_DIR / "backups"
LOG_DIR = DATA_DIR / "logs"

SECRET_KEYS = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY")


def ensure_dirs() -> None:
    for d in (DATA_DIR, AUDIO_DIR, BACKUP_DIR, LOG_DIR):
        d.mkdir(parents=True, exist_ok=True)


def _env() -> dict[str, str]:
    values: dict[str, str] = {}
    if ENV_FILE.exists():
        values.update({k: v for k, v in dotenv_values(ENV_FILE).items() if v})
    # Real environment variables override the file.
    for k in SECRET_KEYS:
        if os.environ.get(k):
            values[k] = os.environ[k]
    return values


def get_secret(name: str) -> str | None:
    if name not in SECRET_KEYS:
        raise ValueError("unknown secret")
    return _env().get(name) or None


def set_secret(name: str, value: str | None) -> None:
    """Persist a key to backend/.env (never the database)."""
    if name not in SECRET_KEYS:
        raise ValueError("unknown secret")
    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not ENV_FILE.exists():
        ENV_FILE.touch(mode=0o600)
    if value:
        set_key(str(ENV_FILE), name, value.strip(), quote_mode="never")
    else:
        unset_key(str(ENV_FILE), name)
    os.environ.pop(name, None)
    try:
        os.chmod(ENV_FILE, 0o600)
    except OSError:
        pass


def mask_secret(value: str | None) -> str | None:
    if not value:
        return None
    return f"{value[:7]}…{value[-4:]}" if len(value) > 14 else "••••"
