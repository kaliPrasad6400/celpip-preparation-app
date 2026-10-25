from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from . import config


class Base(DeclarativeBase):
    pass


def make_engine(db_path=None):
    path = db_path or config.DB_PATH
    eng = create_engine(
        f"sqlite:///{path}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )

    @event.listens_for(eng, "connect")
    def _pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()

    return eng


engine = None
SessionLocal: sessionmaker[Session] = sessionmaker(autoflush=False, expire_on_commit=False)


def init_engine(db_path=None):
    global engine
    config.ensure_dirs()
    engine = make_engine(db_path)
    SessionLocal.configure(bind=engine)
    return engine


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
