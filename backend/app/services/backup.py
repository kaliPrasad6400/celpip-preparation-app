"""SQLite backup / restore / export.

Backups use SQLite's online backup API (consistent even while the app is running).
Restore validates the file, then automatically backs up the current database first,
so a restore can always be undone.
"""
from __future__ import annotations

import csv
import io
import json
import shutil
import sqlite3
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from .. import config, db as dbmod
from .. import models

REQUIRED_TABLES = {"user_settings", "practice_attempts", "notes", "vocabulary_items", "templates"}


def create_backup(label: str = "manual") -> Path:
    config.ensure_dirs()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe = "".join(c for c in label if c.isalnum() or c in "-_")[:30] or "backup"
    dest = config.BACKUP_DIR / f"celpip-{stamp}-{safe}.db"
    src = sqlite3.connect(config.DB_PATH)
    try:
        out = sqlite3.connect(dest)
        with out:
            src.backup(out)
        out.close()
    finally:
        src.close()
    return dest


def list_backups() -> list[dict]:
    config.ensure_dirs()
    rows = []
    for p in sorted(config.BACKUP_DIR.glob("*.db"), reverse=True):
        st = p.stat()
        rows.append({"name": p.name, "size_bytes": st.st_size, "created_at": datetime.fromtimestamp(st.st_mtime).isoformat()})
    return rows


def validate_db_file(path: Path) -> None:
    with open(path, "rb") as f:
        if f.read(16) != b"SQLite format 3\x00":
            raise ValueError("Not a SQLite database file.")
    con = sqlite3.connect(path)
    try:
        if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Database integrity check failed.")
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        con.close()
    missing = REQUIRED_TABLES - tables
    if missing:
        raise ValueError(f"Not a CELPIP Mastery backup (missing tables: {', '.join(sorted(missing))}).")


def restore_from(path: Path) -> Path:
    """Replace the live database with `path`. Returns the safety backup of the previous DB."""
    validate_db_file(path)
    safety = create_backup("pre-restore")
    if dbmod.engine is not None:
        dbmod.engine.dispose()
    for suffix in ("-wal", "-shm"):
        p = Path(str(config.DB_PATH) + suffix)
        if p.exists():
            p.unlink()
    src = sqlite3.connect(path)
    try:
        dst = sqlite3.connect(config.DB_PATH)
        with dst:
            src.backup(dst)
        dst.close()
    finally:
        src.close()
    dbmod.init_engine()
    # bring restored file up to the current schema
    from ..migrate import upgrade

    upgrade()
    return safety


def backup_path(name: str) -> Path:
    p = (config.BACKUP_DIR / name).resolve()
    if p.parent != config.BACKUP_DIR.resolve() or not p.exists() or p.suffix != ".db":
        raise FileNotFoundError(name)
    return p


def _row(obj) -> dict:
    out = {}
    for c in inspect(obj).mapper.column_attrs:
        v = getattr(obj, c.key)
        if isinstance(v, (datetime, date)):
            v = v.isoformat()
        out[c.key] = v
    return out


EXPORTABLE = {
    "notes": models.Note,
    "note_folders": models.NoteFolder,
    "vocabulary": models.VocabularyItem,
    "vocabulary_reviews": models.VocabularyReviewHistory,
    "templates": models.Template,
    "mistakes": models.Mistake,
    "mistake_occurrences": models.MistakeOccurrence,
    "attempts": models.PracticeAttempt,
    "evaluations": models.Evaluation,
    "evaluation_criteria": models.EvaluationCriterion,
    "study_plans": models.StudyPlan,
    "study_sessions": models.StudySession,
    "questions": models.PracticeQuestion,
    "mock_exams": models.MockExam,
    "mock_exam_results": models.MockExamResult,
    "official_scores": models.OfficialScore,
    "current_affairs": models.CurrentAffairsItem,
}


def export_json(db: Session) -> dict:
    out = {"exported_at": datetime.now().isoformat(), "app_version": config.APP_VERSION}
    for name, model in EXPORTABLE.items():
        out[name] = [_row(o) for o in db.scalars(select(model))]
    return out


def export_csv(db: Session, name: str) -> str:
    model = EXPORTABLE[name]
    rows = [_row(o) for o in db.scalars(select(model))]
    buf = io.StringIO()
    if not rows:
        return ""
    w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
    w.writeheader()
    for r in rows:
        w.writerow({k: json.dumps(v) if isinstance(v, (list, dict)) else v for k, v in r.items()})
    return buf.getvalue()


def clear_all_data() -> Path:
    """Delete the database (after a safety backup) and audio; the app re-creates and re-seeds."""
    safety = create_backup("pre-clear")
    if dbmod.engine is not None:
        dbmod.engine.dispose()
    for suffix in ("", "-wal", "-shm"):
        p = Path(str(config.DB_PATH) + suffix)
        if p.exists():
            p.unlink()
    if config.AUDIO_DIR.exists():
        shutil.rmtree(config.AUDIO_DIR)
    config.ensure_dirs()
    dbmod.init_engine()
    from ..migrate import upgrade
    from ..seed.loader import seed_all

    upgrade()
    with dbmod.SessionLocal() as s:
        seed_all(s)
    return safety
